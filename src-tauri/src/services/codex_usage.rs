//! Live Codex quota reader. The session JSONL reader remains the offline fallback.

use reqwest::{Client, StatusCode, Url};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;
use vibe_core::{ProviderRateLimit, RateLimitProvider, RateLimitStatus, RateLimitWindow};

const DEFAULT_BASE: &str = "https://chatgpt.com/backend-api";
const MAX_ATTEMPTS: usize = 3;

#[derive(Debug)]
pub enum FetchError {
    NotLoggedIn,
    Unauthorized,
    Transient,
    BadResponse,
}

#[derive(Clone, Debug, PartialEq)]
struct AuthInfo {
    access_token: String,
    account_id: Option<String>,
}

pub async fn fetch(http: &Client) -> Result<ProviderRateLimit, FetchError> {
    let home = codex_home();
    let mut auth = load_auth(&home).ok_or(FetchError::NotLoggedIn)?;
    let mut endpoint = usage_url_from_home(&home).ok_or(FetchError::BadResponse)?;
    let mut response = send(http, &endpoint, &auth).await?;

    if response.0 == StatusCode::UNAUTHORIZED {
        if let Some(fresh) = load_auth(&home).filter(|fresh| fresh != &auth) {
            auth = fresh;
            endpoint = usage_url_from_home(&home).ok_or(FetchError::BadResponse)?;
            response = send(http, &endpoint, &auth).await?;
        }
    }
    if response.0 == StatusCode::UNAUTHORIZED {
        return Err(FetchError::Unauthorized);
    }
    if response.0 != StatusCode::OK {
        return Err(FetchError::BadResponse);
    }
    parse_usage_response(&response.1, now_epoch()).ok_or(FetchError::BadResponse)
}

async fn send(
    http: &Client,
    endpoint: &Url,
    auth: &AuthInfo,
) -> Result<(StatusCode, Value), FetchError> {
    for attempt in 0..MAX_ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(500 << (attempt - 1))).await;
        }
        let mut request = http
            .get(endpoint.clone())
            .bearer_auth(&auth.access_token)
            .header("Accept", "application/json")
            .timeout(Duration::from_secs(10));
        if let Some(account) = auth.account_id.as_deref().filter(|s| !s.is_empty()) {
            request = request.header("ChatGPT-Account-Id", account);
        }
        match request.send().await {
            Ok(response) => {
                let status = response.status();
                let retryable = status.is_server_error()
                    || status == StatusCode::REQUEST_TIMEOUT
                    || status.as_u16() == 425;
                if retryable && attempt + 1 < MAX_ATTEMPTS {
                    continue;
                }
                let bytes = response.bytes().await.map_err(|_| FetchError::Transient)?;
                let value = serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null);
                return Ok((status, value));
            }
            Err(_) if attempt + 1 < MAX_ATTEMPTS => continue,
            Err(_) => return Err(FetchError::Transient),
        }
    }
    Err(FetchError::Transient)
}

fn codex_home() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|h| h.join(".codex")))
        .unwrap_or_else(|| PathBuf::from(".codex"))
}

fn load_auth(home: &Path) -> Option<AuthInfo> {
    let value: Value = serde_json::from_slice(&std::fs::read(home.join("auth.json")).ok()?).ok()?;
    let tokens = value.get("tokens")?;
    let access_token = tokens.get("access_token")?.as_str()?.trim().to_string();
    if access_token.is_empty() {
        return None;
    }
    Some(AuthInfo {
        access_token,
        account_id: tokens
            .get("account_id")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn usage_url_from_home(home: &Path) -> Option<Url> {
    let configured = std::fs::read_to_string(home.join("config.toml"))
        .ok()
        .and_then(|raw| parse_chatgpt_base_url(&raw));
    usage_url(configured.as_deref().unwrap_or(DEFAULT_BASE))
}

fn parse_chatgpt_base_url(raw: &str) -> Option<String> {
    for raw_line in raw.lines() {
        let line = raw_line.trim();
        if line.starts_with('[') {
            break;
        }
        let Some(rest) = line.strip_prefix("chatgpt_base_url") else {
            continue;
        };
        let value = rest.trim().strip_prefix('=')?.trim();
        if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
            return Some(value[1..value.len() - 1].to_string());
        }
    }
    None
}

fn usage_url(raw_base: &str) -> Option<Url> {
    let mut base = raw_base.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        base = DEFAULT_BASE.to_string();
    }
    let parsed = Url::parse(&base).ok()?;
    let loopback = parsed
        .host_str()
        .is_some_and(|h| h.eq_ignore_ascii_case("localhost") || h == "127.0.0.1" || h == "::1");
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) {
        return None;
    }
    if matches!(parsed.host_str(), Some("chatgpt.com" | "chat.openai.com"))
        && !base.contains("/backend-api")
    {
        base.push_str("/backend-api");
    }
    base.push_str(if base.contains("/backend-api") {
        "/wham/usage"
    } else {
        "/api/codex/usage"
    });
    Url::parse(&base).ok()
}

fn number(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64)
}

fn parse_usage_response(root: &Value, now: f64) -> Option<ProviderRateLimit> {
    let limits = root.get("rate_limit")?.as_object()?;
    let mut five_hour = None;
    let mut seven_day = None;
    for slot in ["primary_window", "secondary_window"] {
        let Some(raw) = limits.get(slot) else {
            continue;
        };
        if raw.is_null() {
            continue;
        }
        let dict = raw.as_object()?;
        let used = number(dict.get("used_percent"))?;
        let seconds = dict.get("limit_window_seconds")?.as_i64()?;
        let resets_at = number(dict.get("reset_at"))
            .filter(|v| *v > 0.0)
            .or_else(|| {
                number(dict.get("reset_after_seconds"))
                    .filter(|v| *v >= 0.0)
                    .map(|v| now + v)
            });
        let window = RateLimitWindow {
            utilization: used,
            resets_at,
            window_duration: Some(seconds as f64),
        };
        if seconds >= 2 * 24 * 3600 {
            seven_day = Some(window);
        } else {
            five_hour = Some(window);
        }
    }
    let status = if five_hour.is_none() && seven_day.is_none() {
        RateLimitStatus::NoData
    } else {
        RateLimitStatus::Ok
    };
    let plan_label = root
        .get("plan_type")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(capitalize);
    let reset_credits_count = root
        .pointer("/rate_limit_reset_credits/available_count")
        .and_then(Value::as_u64)
        .filter(|n| *n > 0);
    Some(ProviderRateLimit {
        provider: RateLimitProvider::Codex,
        five_hour_not_enforced: five_hour.is_none(),
        five_hour,
        seven_day,
        plan_label,
        data_as_of: Some(now),
        reset_credits_count,
        status,
    })
}

fn capitalize(raw: &str) -> String {
    let mut chars = raw.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
        .unwrap_or_default()
}

fn now_epoch() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn top_level_config_only_and_safe_urls() {
        assert_eq!(
            parse_chatgpt_base_url("chatgpt_base_url = \"https://example.test/base\"\n[x]\nchatgpt_base_url = \"https://bad\""),
            Some("https://example.test/base".into())
        );
        assert!(usage_url("http://remote.example").is_none());
        assert!(usage_url("http://localhost:8080").is_some());
        assert_eq!(
            usage_url("https://chatgpt.com").unwrap().as_str(),
            "https://chatgpt.com/backend-api/wham/usage"
        );
    }

    #[test]
    fn weekly_only_response_is_classified_by_duration() {
        let value = json!({
            "plan_type":"pro",
            "rate_limit":{"primary_window":{"used_percent":26,"limit_window_seconds":604800,"reset_after_seconds":60}},
            "rate_limit_reset_credits":{"available_count":2}
        });
        let result = parse_usage_response(&value, 1000.0).unwrap();
        assert_eq!(result.status, RateLimitStatus::Ok);
        assert!(result.five_hour.is_none());
        assert!(result.five_hour_not_enforced);
        assert_eq!(result.seven_day.unwrap().utilization, 26.0);
        assert_eq!(result.reset_credits_count, Some(2));
    }

    #[test]
    fn malformed_non_null_window_rejects_payload() {
        let value = json!({"rate_limit":{"primary_window":{"used_percent":12}}});
        assert!(parse_usage_response(&value, 1000.0).is_none());
    }
}
