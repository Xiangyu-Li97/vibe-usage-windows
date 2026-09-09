//! Subscription quota (订阅配额) types + readers — port of Models/RateLimit.swift,
//! Services/CodexRateLimitReader.swift and Services/ClaudeRateLimitReader.swift.

pub mod claude;
pub mod codex;

use serde::{Deserialize, Serialize};

/// One subscription window (5h or 7d). Serialized camelCase for the frontend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitWindow {
    /// 0-100
    pub utilization: f64,
    /// epoch seconds
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<f64>,
    /// seconds; present → the elapsed-time bar can render
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_duration: Option<f64>,
}

/// Provider-neutral quota meter. CLI-backed products are not required to use
/// Codex's exact 5h/7d shape, so the UI renders these labels directly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RateLimitMeter {
    pub id: String,
    pub label: String,
    pub utilization: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resets_at: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_duration: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum RateLimitProvider {
    #[serde(rename = "codex")]
    Codex,
    #[serde(rename = "claudeCode")]
    ClaudeCode,
    #[serde(rename = "kimi-code")]
    KimiCode,
    #[serde(rename = "zcode")]
    ZCode,
    #[serde(rename = "grok")]
    Grok,
    #[serde(rename = "cursor")]
    Cursor,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RateLimitStatus {
    Ok,
    NoData,
    Disabled,
    Unauthorized,
    RetryableError,
    Error { message: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRateLimit {
    pub provider: RateLimitProvider,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub meters: Vec<RateLimitMeter>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub five_hour: Option<RateLimitWindow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seven_day: Option<RateLimitWindow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_as_of: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetched_at: Option<f64>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub five_hour_not_enforced: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset_credits_count: Option<u64>,
    pub status: RateLimitStatus,
}

impl ProviderRateLimit {
    pub fn empty(provider: RateLimitProvider, status: RateLimitStatus) -> Self {
        Self {
            provider,
            meters: Vec::new(),
            five_hour: None,
            seven_day: None,
            plan_label: None,
            data_as_of: None,
            fetched_at: None,
            five_hour_not_enforced: false,
            reset_credits_count: None,
            status,
        }
    }
}

pub(crate) fn now_epoch() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}
