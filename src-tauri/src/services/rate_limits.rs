//! Rate-limit coordination — port of Services/RateLimitCoordinator.swift.
//! 60s debounce per provider; force refresh bypasses it.

use crate::services::{claude_usage, codex_usage};
use crate::state::AppCtx;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use vibe_core::rate_limit::codex;
use vibe_core::statusline_hook::StatuslineHook;
use vibe_core::{ProviderRateLimit, RateLimitProvider, RateLimitStatus};

const MAX_AGE: Duration = Duration::from_secs(60);

pub fn statusline_hook(app: &AppHandle) -> StatuslineHook {
    StatuslineHook::new(crate::services::sync_engine::node_for_statusline(app))
}

pub async fn get_rate_limits(app: &AppHandle, force: bool) -> Vec<ProviderRateLimit> {
    let ctx = app.state::<AppCtx>();
    // A caller that had to wait for an in-flight refresh consumes its result
    // instead of repeating a forced refresh immediately afterwards.
    let (_refresh_guard, effective_force) = match ctx.rate_limit_refresh.try_lock() {
        Ok(guard) => (guard, force),
        Err(_) => (ctx.rate_limit_refresh.lock().await, false),
    };
    let (codex_enabled, claude_enabled) = {
        let settings = ctx.settings.lock().unwrap();
        (
            settings.codex_rate_limit_enabled,
            settings.claude_rate_limit_enabled,
        )
    };

    let needs_codex = codex_enabled && {
        let ctx = app.state::<AppCtx>();
        let cache = ctx.rate_limits.lock().unwrap();
        effective_force
            || cache
                .codex
                .as_ref()
                .map(|(_, at)| at.elapsed() > MAX_AGE)
                .unwrap_or(true)
    };
    if needs_codex {
        let http = app.state::<AppCtx>().http.clone();
        let live = codex_usage::fetch(&http).await;
        let snapshot = match live {
            Ok(snapshot) => snapshot,
            Err(error) => {
                let fallback = tauri::async_runtime::spawn_blocking(codex::read)
                    .await
                    .unwrap_or_else(|_| {
                        ProviderRateLimit::empty(RateLimitProvider::Codex, RateLimitStatus::NoData)
                    });
                if fallback.status != RateLimitStatus::NoData {
                    fallback
                } else if matches!(error, codex_usage::FetchError::Unauthorized) {
                    ProviderRateLimit::empty(
                        RateLimitProvider::Codex,
                        RateLimitStatus::Unauthorized,
                    )
                } else {
                    fallback
                }
            }
        };
        let ctx = app.state::<AppCtx>();
        ctx.rate_limits.lock().unwrap().codex = Some((snapshot, Instant::now()));
    }

    let needs_claude = claude_enabled && {
        let ctx = app.state::<AppCtx>();
        let cache = ctx.rate_limits.lock().unwrap();
        effective_force
            || cache
                .claude
                .as_ref()
                .map(|(_, at)| at.elapsed() > MAX_AGE)
                .unwrap_or(true)
    };
    if needs_claude {
        let snapshot = match claude_usage::fetch().await {
            Ok(snapshot) => snapshot,
            Err(error) => {
                log::debug!("Claude live quota unavailable: {error}");
                tauri::async_runtime::spawn_blocking(claude_usage::cached_snapshot)
                    .await
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| {
                        ProviderRateLimit::empty(
                            RateLimitProvider::ClaudeCode,
                            RateLimitStatus::NoData,
                        )
                    })
            }
        };
        let ctx = app.state::<AppCtx>();
        ctx.rate_limits.lock().unwrap().claude = Some((snapshot, Instant::now()));
    }

    let ctx = app.state::<AppCtx>();
    let cache = ctx.rate_limits.lock().unwrap();
    let codex_snapshot = if codex_enabled {
        cache
            .codex
            .as_ref()
            .map(|(s, _)| s.clone())
            .unwrap_or_else(|| {
                ProviderRateLimit::empty(RateLimitProvider::Codex, RateLimitStatus::NoData)
            })
    } else {
        ProviderRateLimit::empty(RateLimitProvider::Codex, RateLimitStatus::NoData)
    };
    let claude_snapshot = if claude_enabled {
        cache
            .claude
            .as_ref()
            .map(|(s, _)| s.clone())
            .unwrap_or_else(|| {
                ProviderRateLimit::empty(RateLimitProvider::ClaudeCode, RateLimitStatus::Disabled)
            })
    } else {
        ProviderRateLimit::empty(RateLimitProvider::ClaudeCode, RateLimitStatus::NoData)
    };
    vec![codex_snapshot, claude_snapshot]
}

/// Enable Claude display. The read itself is non-invasive and never edits the
/// user's Claude configuration.
pub async fn enable_claude(app: &AppHandle) -> Result<Vec<ProviderRateLimit>, String> {
    {
        let ctx = app.state::<AppCtx>();
        ctx.settings.lock().unwrap().claude_rate_limit_enabled = true;
        ctx.save_settings();
        let settings = ctx.settings.lock().unwrap().clone();
        let _ = app.emit("settings-updated", &settings);
    }

    Ok(get_rate_limits(app, true).await)
}
