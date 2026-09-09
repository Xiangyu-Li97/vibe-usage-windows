//! Local-only subscription product discovery and two-slot selection policy.
//! Discovery checks conventional files/apps/commands but never opens a
//! credential store, reads credential contents, or performs network I/O.

use crate::RateLimitProvider;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;

pub const MAXIMUM_SELECTION_COUNT: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum ZCodeQuotaRegion {
    #[default]
    #[serde(rename = "bigModel")]
    BigModel,
    #[serde(rename = "zAI")]
    ZAi,
}

impl ZCodeQuotaRegion {
    pub fn environment_key(self) -> &'static str {
        match self {
            Self::BigModel => "BIGMODEL_API_KEY",
            Self::ZAi => "Z_AI_API_KEY",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum QuotaProductAvailability {
    Ready,
    PendingProtocol,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaProduct {
    pub provider: RateLimitProvider,
    pub availability: QuotaProductAvailability,
    pub is_detected: bool,
}

impl QuotaProduct {
    pub fn is_selectable(&self) -> bool {
        self.availability == QuotaProductAvailability::Ready && self.is_detected
    }
}

#[derive(Debug, Clone)]
pub struct DiscoveryEnvironment {
    pub home: PathBuf,
    pub path_directories: Vec<PathBuf>,
    pub path_extensions: Vec<String>,
    pub app_data: Option<PathBuf>,
    pub local_app_data: Option<PathBuf>,
    pub program_files: Vec<PathBuf>,
    pub windows: bool,
}

impl DiscoveryEnvironment {
    pub fn live() -> Self {
        let path_directories = std::env::var_os("PATH")
            .map(|value| std::env::split_paths(&value).collect())
            .unwrap_or_default();
        let path_extensions = std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
            .split(';')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect();
        Self {
            home: dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
            path_directories,
            path_extensions,
            app_data: std::env::var_os("APPDATA").map(PathBuf::from),
            local_app_data: std::env::var_os("LOCALAPPDATA").map(PathBuf::from),
            program_files: ["ProgramFiles", "ProgramFiles(x86)"]
                .into_iter()
                .filter_map(std::env::var_os)
                .map(PathBuf::from)
                .collect(),
            windows: cfg!(windows),
        }
    }
}

pub fn discover() -> Vec<QuotaProduct> {
    discover_with(&DiscoveryEnvironment::live())
}

pub fn discover_with(environment: &DiscoveryEnvironment) -> Vec<QuotaProduct> {
    catalog()
        .into_iter()
        .map(|(provider, availability)| QuotaProduct {
            provider,
            availability,
            is_detected: is_detected(provider, environment),
        })
        .collect()
}

pub fn catalog() -> [(RateLimitProvider, QuotaProductAvailability); 6] {
    [
        (RateLimitProvider::Codex, QuotaProductAvailability::Ready),
        (
            RateLimitProvider::ClaudeCode,
            QuotaProductAvailability::Ready,
        ),
        (RateLimitProvider::KimiCode, QuotaProductAvailability::Ready),
        (RateLimitProvider::ZCode, QuotaProductAvailability::Ready),
        (RateLimitProvider::Grok, QuotaProductAvailability::Ready),
        (
            RateLimitProvider::Cursor,
            QuotaProductAvailability::PendingProtocol,
        ),
    ]
}

pub fn initial_selection(products: &[QuotaProduct]) -> Vec<RateLimitProvider> {
    normalize_selection(
        products
            .iter()
            .filter(|product| product.is_selectable())
            .map(|product| product.provider),
    )
}

pub fn update_selection(
    selection: &[RateLimitProvider],
    provider: RateLimitProvider,
    selected: bool,
) -> Vec<RateLimitProvider> {
    let mut next = normalize_selection(selection.iter().copied())
        .into_iter()
        .filter(|value| *value != provider)
        .collect::<Vec<_>>();
    if selected {
        while next.len() >= MAXIMUM_SELECTION_COUNT {
            next.remove(0);
        }
        next.push(provider);
    }
    normalize_selection(next)
}

pub fn normalize_selection(
    selection: impl IntoIterator<Item = RateLimitProvider>,
) -> Vec<RateLimitProvider> {
    let known: HashSet<_> = catalog().into_iter().map(|entry| entry.0).collect();
    let mut seen = HashSet::new();
    selection
        .into_iter()
        .filter(|provider| known.contains(provider) && seen.insert(*provider))
        .take(MAXIMUM_SELECTION_COUNT)
        .collect()
}

fn is_detected(provider: RateLimitProvider, environment: &DiscoveryEnvironment) -> bool {
    relative_paths(provider)
        .iter()
        .any(|relative| environment.home.join(relative).exists())
        || application_paths(provider, environment)
            .iter()
            .any(|path| path.exists())
        || executable_names(provider)
            .iter()
            .any(|name| executable_exists(name, environment))
}

fn relative_paths(provider: RateLimitProvider) -> &'static [&'static str] {
    match provider {
        RateLimitProvider::Codex => &[".codex"],
        RateLimitProvider::ClaudeCode => &[".claude", ".claude.json"],
        RateLimitProvider::KimiCode => &[".kimi", ".kimi-code", ".config/kimi"],
        RateLimitProvider::ZCode => &[".zcode", ".config/zcode"],
        RateLimitProvider::Grok => &[".grok"],
        RateLimitProvider::Cursor => &[".cursor"],
    }
}

fn executable_names(provider: RateLimitProvider) -> &'static [&'static str] {
    match provider {
        RateLimitProvider::Codex => &["codex"],
        RateLimitProvider::ClaudeCode => &["claude"],
        RateLimitProvider::KimiCode => &["kimi"],
        RateLimitProvider::ZCode => &["zcode"],
        RateLimitProvider::Grok => &["grok"],
        RateLimitProvider::Cursor => &["cursor"],
    }
}

fn application_paths(
    provider: RateLimitProvider,
    environment: &DiscoveryEnvironment,
) -> Vec<PathBuf> {
    if !environment.windows {
        return Vec::new();
    }
    let mut roots = environment.program_files.clone();
    if let Some(local) = &environment.local_app_data {
        roots.push(local.clone());
        roots.push(local.join("Programs"));
    }
    let mut paths = Vec::new();
    for root in roots {
        match provider {
            RateLimitProvider::Codex => paths.push(root.join("Codex").join("Codex.exe")),
            RateLimitProvider::ClaudeCode => {
                paths.push(root.join("Claude").join("Claude.exe"));
            }
            RateLimitProvider::ZCode => paths.push(root.join("ZCode").join("ZCode.exe")),
            RateLimitProvider::Cursor => {
                paths.push(root.join("Cursor").join("Cursor.exe"));
                paths.push(root.join("cursor").join("Cursor.exe"));
            }
            RateLimitProvider::KimiCode | RateLimitProvider::Grok => {}
        }
    }
    if let Some(app_data) = &environment.app_data {
        match provider {
            RateLimitProvider::ClaudeCode => paths.push(app_data.join("Claude")),
            RateLimitProvider::Cursor => paths.push(app_data.join("Cursor")),
            _ => {}
        }
    }
    paths
}

fn executable_exists(name: &str, environment: &DiscoveryEnvironment) -> bool {
    environment.path_directories.iter().any(|directory| {
        executable_candidates(name, environment)
            .iter()
            .any(|candidate| directory.join(candidate).is_file())
    })
}

fn executable_candidates(name: &str, environment: &DiscoveryEnvironment) -> Vec<String> {
    if !environment.windows {
        return vec![name.to_string()];
    }
    let mut candidates = vec![name.to_string()];
    for extension in &environment.path_extensions {
        let extension = extension.trim();
        let extension = if extension.starts_with('.') {
            extension.to_string()
        } else {
            format!(".{extension}")
        };
        candidates.push(format!("{name}{extension}"));
        candidates.push(format!("{name}{}", extension.to_ascii_lowercase()));
    }
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    fn environment(root: &Path) -> DiscoveryEnvironment {
        DiscoveryEnvironment {
            home: root.join("home"),
            path_directories: vec![root.join("bin")],
            path_extensions: vec![".EXE".into(), ".CMD".into()],
            app_data: Some(root.join("appdata")),
            local_app_data: Some(root.join("localappdata")),
            program_files: vec![root.join("program-files")],
            windows: true,
        }
    }

    #[test]
    fn discovers_windows_commands_and_ordinary_app_locations() {
        let root = tempfile::tempdir().unwrap();
        let env = environment(root.path());
        fs::create_dir_all(&env.path_directories[0]).unwrap();
        fs::write(env.path_directories[0].join("kimi.CMD"), "").unwrap();
        fs::create_dir_all(
            env.local_app_data
                .as_ref()
                .unwrap()
                .join("Programs")
                .join("Cursor"),
        )
        .unwrap();
        fs::write(
            env.local_app_data
                .as_ref()
                .unwrap()
                .join("Programs")
                .join("Cursor")
                .join("Cursor.exe"),
            "",
        )
        .unwrap();

        let products = discover_with(&env);
        assert!(products
            .iter()
            .any(|product| product.provider == RateLimitProvider::KimiCode && product.is_detected));
        assert!(products
            .iter()
            .any(|product| product.provider == RateLimitProvider::Cursor && product.is_detected));
    }

    #[test]
    fn first_launch_selects_detected_ready_products_but_not_cursor() {
        let products = vec![
            QuotaProduct {
                provider: RateLimitProvider::Cursor,
                availability: QuotaProductAvailability::PendingProtocol,
                is_detected: true,
            },
            QuotaProduct {
                provider: RateLimitProvider::KimiCode,
                availability: QuotaProductAvailability::Ready,
                is_detected: true,
            },
            QuotaProduct {
                provider: RateLimitProvider::Grok,
                availability: QuotaProductAvailability::Ready,
                is_detected: true,
            },
        ];
        assert_eq!(
            initial_selection(&products),
            vec![RateLimitProvider::KimiCode, RateLimitProvider::Grok]
        );
    }

    #[test]
    fn selecting_a_third_product_keeps_the_two_most_recent() {
        assert_eq!(
            update_selection(
                &[RateLimitProvider::Codex, RateLimitProvider::ClaudeCode],
                RateLimitProvider::Grok,
                true,
            ),
            vec![RateLimitProvider::ClaudeCode, RateLimitProvider::Grok]
        );
    }

    #[test]
    fn selection_is_deduplicated_and_capped() {
        assert_eq!(
            normalize_selection([
                RateLimitProvider::Codex,
                RateLimitProvider::Codex,
                RateLimitProvider::ClaudeCode,
                RateLimitProvider::Grok,
            ]),
            vec![RateLimitProvider::Codex, RateLimitProvider::ClaudeCode]
        );
    }
}
