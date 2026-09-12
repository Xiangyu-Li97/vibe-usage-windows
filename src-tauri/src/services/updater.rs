//! Self-update — Windows counterpart of Sparkle (custom flow, same as ATM):
//! fetch latest.json from GitHub Releases, compare versions, download the
//! NSIS installer, verify SHA-256, launch it and exit.

use crate::state::{AppCtx, UpdateInfo};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

pub const UPDATE_MANIFEST_URL: &str =
    "https://github.com/vibe-cafe/vibe-usage-windows/releases/latest/download/latest.json";

pub const fn available() -> bool {
    !cfg!(feature = "external-test-diagnostics")
}

fn require_updates() -> Result<(), String> {
    if available() {
        Ok(())
    } else {
        Err("外测版不检查或安装正式版更新".into())
    }
}

#[derive(Debug, Deserialize)]
struct Manifest {
    version: String,
    #[serde(default)]
    notes: Option<String>,
    url: String,
    #[serde(default)]
    sha256: Option<String>,
}

/// Check for a newer version; stores + emits `update-available` when found.
pub async fn check(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    require_updates()?;
    let http = {
        let ctx = app.state::<AppCtx>();
        ctx.http.clone()
    };
    let info = fetch_update(
        &http,
        &app.package_info().version.to_string(),
        UPDATE_MANIFEST_URL,
    )
    .await?;
    if let Some(ref info) = info {
        let ctx = app.state::<AppCtx>();
        *ctx.update_info.lock().unwrap() = Some(info.clone());
        let _ = app.emit("update-available", info);
    }
    Ok(info)
}

async fn fetch_update(
    http: &reqwest::Client,
    current: &str,
    manifest_url: &str,
) -> Result<Option<UpdateInfo>, String> {
    require_updates()?;
    let res = http
        .get(manifest_url)
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| format!("网络错误：{e}"))?;
    let status = res.status();
    if status.as_u16() == 404 {
        log::info!("update manifest not found; treating as no update");
        return Ok(None);
    }
    if !status.is_success() {
        return Err(format!("HTTP 错误 {}", status.as_u16()));
    }
    let manifest: Manifest = res.json().await.map_err(|e| format!("清单解析失败：{e}"))?;

    if !vibe_core::version::is_newer(&manifest.version, current) {
        return Ok(None);
    }

    let info = UpdateInfo {
        version: manifest.version,
        notes: manifest.notes,
        url: manifest.url,
        sha256: manifest.sha256,
    };
    Ok(Some(info))
}

/// Download + verify + launch the installer, then quit so it can replace us.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    require_updates()?;
    let info = {
        let ctx = app.state::<AppCtx>();
        let info = ctx.update_info.lock().unwrap().clone();
        info
    }
    .ok_or("没有可安装的更新")?;

    if !cfg!(windows) {
        return Err("自动更新仅支持 Windows".into());
    }

    let http = {
        let ctx = app.state::<AppCtx>();
        ctx.http.clone()
    };
    let bytes = http
        .get(&info.url)
        .timeout(std::time::Duration::from_secs(600))
        .send()
        .await
        .map_err(|e| format!("下载失败：{e}"))?
        .error_for_status()
        .map_err(|e| format!("下载失败：{e}"))?
        .bytes()
        .await
        .map_err(|e| format!("下载失败：{e}"))?;

    if let Some(expected) = &info.sha256 {
        let actual = hex::encode(Sha256::digest(&bytes));
        if !actual.eq_ignore_ascii_case(expected) {
            return Err("安装包校验失败 (SHA-256 不匹配)".into());
        }
    }

    let installer = std::env::temp_dir().join(format!("VibeUsage-{}-Setup.exe", info.version));
    std::fs::write(&installer, &bytes).map_err(|e| format!("写入安装包失败：{e}"))?;

    crate::process_utils::launch_executable(&installer)
        .map_err(|e| format!("启动安装器失败：{e}"))?;
    app.exit(0);
    Ok(())
}

#[cfg(all(test, feature = "external-test-diagnostics"))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn external_build_rejects_manifest_before_network_access() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/latest.json", listener.local_addr().unwrap());
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_millis(200))
            .build()
            .unwrap();
        let result = fetch_update(&client, "0.0.1", &url).await;
        assert_eq!(result.unwrap_err(), "外测版不检查或安装正式版更新");
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    }
}
