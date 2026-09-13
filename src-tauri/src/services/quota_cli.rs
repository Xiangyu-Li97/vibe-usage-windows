//! Typed, JSON-only bridge to the vendored CLI subscription quota contract.

use crate::services::{sync_engine, zcode_credentials};
use crate::state::AppCtx;
use chrono::DateTime;
use serde::Deserialize;
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use vibe_core::quota_product::ZCodeQuotaRegion;
use vibe_core::{ProviderRateLimit, RateLimitMeter, RateLimitProvider, RateLimitStatus};

const SCHEMA_VERSION: u32 = 1;
const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FetchError {
    CredentialStore,
    RuntimeUnavailable,
    Timeout,
    Launch,
    ProcessFailure,
    InvalidJson,
    UnsupportedSchema,
    UnknownProduct,
}

impl FetchError {
    pub const fn diagnostic_code(self) -> &'static str {
        match self {
            Self::CredentialStore => "credential_store",
            Self::RuntimeUnavailable => "cli_runtime_unavailable",
            Self::Timeout => "cli_timeout",
            Self::Launch => "cli_launch_failed",
            Self::ProcessFailure => "cli_process_failure",
            Self::InvalidJson => "invalid_json",
            Self::UnsupportedSchema => "unsupported_schema",
            Self::UnknownProduct => "unknown_product",
        }
    }
}

impl std::fmt::Display for FetchError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::CredentialStore => "无法读取 Windows 凭据管理器",
            Self::RuntimeUnavailable => "本地配额运行时不可用",
            Self::Timeout => "本地配额读取超时",
            Self::Launch => "无法启动本地配额读取器",
            Self::ProcessFailure => "本地配额读取器执行失败",
            Self::InvalidJson => "本地配额返回格式无效",
            Self::UnsupportedSchema => "本地配额协议版本不兼容",
            Self::UnknownProduct => "本地配额返回了未知产品",
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope {
    schema_version: u32,
    products: Vec<Product>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Product {
    id: String,
    status: String,
    #[serde(default)]
    meters: Vec<Meter>,
    plan_label: Option<String>,
    fetched_at: String,
    data_as_of: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meter {
    id: String,
    label: String,
    utilization: f64,
    resets_at: Option<String>,
    window_seconds: Option<f64>,
}

pub async fn fetch(
    app: &AppHandle,
    providers: &[RateLimitProvider],
) -> Result<Vec<ProviderRateLimit>, FetchError> {
    let providers = providers
        .iter()
        .copied()
        .filter(|provider| uses_cli(*provider))
        .collect::<Vec<_>>();
    if providers.is_empty() {
        return Ok(Vec::new());
    }

    let (region, zcode_key) = if providers.contains(&RateLimitProvider::ZCode) {
        let region = app
            .state::<AppCtx>()
            .settings
            .lock()
            .unwrap()
            .z_code_quota_region;
        let key = zcode_credentials::load(region).map_err(|_| FetchError::CredentialStore)?;
        (region, key)
    } else {
        (ZCodeQuotaRegion::default(), None)
    };

    let mut args = vec!["quota".to_string(), "fetch".to_string()];
    for provider in &providers {
        args.push("--product".into());
        args.push(cli_id(*provider).to_string());
    }
    args.push("--json".into());

    let mut command =
        sync_engine::quota_command(app, &args).map_err(|_| FetchError::RuntimeUnavailable)?;
    command
        .env_remove("BIGMODEL_API_KEY")
        .env_remove("Z_AI_API_KEY")
        .stdin(Stdio::null());
    if let Some(key) = zcode_key.as_deref() {
        command.env(region.environment_key(), key);
    }
    let output = tokio::time::timeout(TIMEOUT, crate::process_lifecycle::output(&mut command))
        .await
        .map_err(|_| FetchError::Timeout)?
        .map_err(|_| FetchError::Launch)?;
    if !output.status.success() {
        return Err(FetchError::ProcessFailure);
    }
    decode(&output.stdout)
}

fn decode(data: &[u8]) -> Result<Vec<ProviderRateLimit>, FetchError> {
    let envelope: Envelope = serde_json::from_slice(data).map_err(|_| FetchError::InvalidJson)?;
    if envelope.schema_version != SCHEMA_VERSION {
        return Err(FetchError::UnsupportedSchema);
    }
    envelope.products.into_iter().map(map_product).collect()
}

fn map_product(product: Product) -> Result<ProviderRateLimit, FetchError> {
    let provider = match product.id.as_str() {
        "kimi-code" => RateLimitProvider::KimiCode,
        "zcode" => RateLimitProvider::ZCode,
        "grok" => RateLimitProvider::Grok,
        _ => return Err(FetchError::UnknownProduct),
    };
    let meters = product
        .meters
        .into_iter()
        .map(|meter| RateLimitMeter {
            id: meter.id,
            label: meter.label,
            utilization: meter.utilization.clamp(0.0, 100.0),
            resets_at: meter.resets_at.as_deref().and_then(parse_epoch),
            window_duration: meter.window_seconds.filter(|value| *value > 0.0),
        })
        .collect::<Vec<_>>();
    let status = match product.status.as_str() {
        "ok" if !meters.is_empty() => RateLimitStatus::Ok,
        "ok" | "no_data" | "unsupported" => RateLimitStatus::NoData,
        "missing_credentials" | "expired_credentials" | "unauthorized" => {
            RateLimitStatus::Unauthorized
        }
        "retryable_error" => RateLimitStatus::RetryableError,
        _ => RateLimitStatus::Error {
            message: "无法识别本地配额状态".into(),
        },
    };
    Ok(ProviderRateLimit {
        provider,
        meters,
        five_hour: None,
        seven_day: None,
        plan_label: product.plan_label,
        data_as_of: product.data_as_of.as_deref().and_then(parse_epoch),
        fetched_at: parse_epoch(&product.fetched_at),
        five_hour_not_enforced: false,
        reset_credits_count: None,
        status,
    })
}

fn parse_epoch(value: &str) -> Option<f64> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|date| date.timestamp_millis() as f64 / 1000.0)
}

pub fn uses_cli(provider: RateLimitProvider) -> bool {
    matches!(
        provider,
        RateLimitProvider::KimiCode | RateLimitProvider::ZCode | RateLimitProvider::Grok
    )
}

fn cli_id(provider: RateLimitProvider) -> &'static str {
    match provider {
        RateLimitProvider::KimiCode => "kimi-code",
        RateLimitProvider::ZCode => "zcode",
        RateLimitProvider::Grok => "grok",
        _ => unreachable!("native provider passed to CLI bridge"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_provider_neutral_meters() {
        let snapshots = decode(
            br#"{"schemaVersion":1,"products":[{"id":"grok","status":"ok","meters":[{"id":"credits","label":"7d","utilization":30,"resetsAt":"2026-09-14T00:00:00Z","windowSeconds":604800}],"planLabel":"X Premium+","fetchedAt":"2026-09-08T02:00:00Z","dataAsOf":"2026-09-08T01:00:00Z","source":"local_log"}]}"#,
        )
        .unwrap();
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].provider, RateLimitProvider::Grok);
        assert_eq!(snapshots[0].meters[0].label, "7d");
        assert_eq!(snapshots[0].meters[0].utilization, 30.0);
    }

    #[test]
    fn rejects_unknown_schema_and_product() {
        assert!(decode(br#"{"schemaVersion":2,"products":[]}"#).is_err());
        assert!(decode(
            br#"{"schemaVersion":1,"products":[{"id":"unknown","status":"ok","meters":[],"fetchedAt":"2026-09-08T02:00:00Z"}]}"#
        )
        .is_err());
    }

    #[test]
    fn credential_failures_are_typed_without_preserving_messages() {
        let snapshots = decode(
            br#"{"schemaVersion":1,"products":[{"id":"zcode","status":"unauthorized","meters":[],"fetchedAt":"2026-09-08T02:00:00Z","message":"Bearer must-not-survive"}]}"#,
        )
        .unwrap();
        assert_eq!(snapshots[0].status, RateLimitStatus::Unauthorized);
        assert!(!format!("{snapshots:?}").contains("must-not-survive"));
    }
}
