//! ZCode API-key storage. Release builds use the current Windows user's
//! encrypted Credential Manager vault; keys never enter settings.json.

use serde::Serialize;
use vibe_core::quota_product::ZCodeQuotaRegion;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZCodeCredentialStatus {
    pub big_model_configured: bool,
    pub z_ai_configured: bool,
}

pub fn status() -> Result<ZCodeCredentialStatus, String> {
    Ok(ZCodeCredentialStatus {
        big_model_configured: load(ZCodeQuotaRegion::BigModel)?.is_some(),
        z_ai_configured: load(ZCodeQuotaRegion::ZAi)?.is_some(),
    })
}

pub fn load(region: ZCodeQuotaRegion) -> Result<Option<String>, String> {
    platform::load(target(region))
}

pub fn store(region: ZCodeQuotaRegion, value: Option<&str>) -> Result<(), String> {
    let trimmed = value.map(str::trim).filter(|value| !value.is_empty());
    match trimmed {
        Some(secret) => platform::store(target(region), secret),
        None => platform::delete(target(region)),
    }
}

fn target(region: ZCodeQuotaRegion) -> &'static str {
    match region {
        ZCodeQuotaRegion::BigModel => "ai.vibecafe.vibe-usage.windows/zcode/bigmodel",
        ZCodeQuotaRegion::ZAi => "ai.vibecafe.vibe-usage.windows/zcode/zai",
    }
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::ptr;
    use windows_sys::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    };

    const ERROR_NOT_FOUND: i32 = 1168;

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn load(target: &str) -> Result<Option<String>, String> {
        let target = wide(target);
        let mut raw: *mut CREDENTIALW = ptr::null_mut();
        // SAFETY: target is a terminated UTF-16 buffer and `raw` is initialized
        // by CredReadW. Its allocation is released exactly once with CredFree.
        let ok = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) };
        if ok == 0 {
            let error = std::io::Error::last_os_error();
            return if error.raw_os_error() == Some(ERROR_NOT_FOUND) {
                Ok(None)
            } else {
                Err("无法读取 Windows 凭据管理器".into())
            };
        }
        if raw.is_null() {
            return Ok(None);
        }
        // SAFETY: CredReadW returned a valid CREDENTIALW whose blob remains
        // alive until the matching CredFree below.
        let bytes = unsafe {
            let credential = &*raw;
            if credential.CredentialBlobSize == 0 || credential.CredentialBlob.is_null() {
                Vec::new()
            } else {
                std::slice::from_raw_parts(
                    credential.CredentialBlob,
                    credential.CredentialBlobSize as usize,
                )
                .to_vec()
            }
        };
        // SAFETY: `raw` came from CredReadW and has not been freed yet.
        unsafe { CredFree(raw.cast::<c_void>()) };
        let value = String::from_utf8(bytes)
            .map_err(|_| "Windows 凭据管理器中的 ZCode Key 格式无效".to_string())?;
        let value = value.trim().to_string();
        Ok((!value.is_empty()).then_some(value))
    }

    pub fn store(target: &str, secret: &str) -> Result<(), String> {
        let mut target = wide(target);
        let mut username = wide("Vibe Usage");
        let mut blob = secret.as_bytes().to_vec();
        // SAFETY: every pointer references a live buffer for the duration of
        // CredWriteW. Generic credential blobs may contain arbitrary bytes.
        let mut credential: CREDENTIALW = unsafe { std::mem::zeroed() };
        credential.Type = CRED_TYPE_GENERIC;
        credential.TargetName = target.as_mut_ptr();
        credential.CredentialBlobSize = blob.len() as u32;
        credential.CredentialBlob = blob.as_mut_ptr();
        credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
        credential.UserName = username.as_mut_ptr();
        let ok = unsafe { CredWriteW(&credential, 0) };
        if ok == 0 {
            Err("无法写入 Windows 凭据管理器".into())
        } else {
            Ok(())
        }
    }

    pub fn delete(target: &str) -> Result<(), String> {
        let target = wide(target);
        // SAFETY: target is a terminated UTF-16 buffer.
        let ok = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
        if ok != 0 {
            return Ok(());
        }
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(ERROR_NOT_FOUND) {
            Ok(())
        } else {
            Err("无法删除 Windows 凭据管理器中的 ZCode Key".into())
        }
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn load(_target: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    pub fn store(_target: &str, _secret: &str) -> Result<(), String> {
        Err("ZCode Key 只能在 Windows 凭据管理器中保存".into())
    }

    pub fn delete(_target: &str) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn regions_use_separate_credential_targets() {
        assert_ne!(
            target(ZCodeQuotaRegion::BigModel),
            target(ZCodeQuotaRegion::ZAi)
        );
        assert_eq!(
            ZCodeQuotaRegion::BigModel.environment_key(),
            "BIGMODEL_API_KEY"
        );
        assert_eq!(ZCodeQuotaRegion::ZAi.environment_key(), "Z_AI_API_KEY");
    }
}
