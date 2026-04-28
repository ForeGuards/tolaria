use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const APP_CONFIG_DIR: &str = "com.tolaria.app";
const LEGACY_APP_CONFIG_DIR: &str = "com.laputa.app";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VaultEntry {
    pub label: String,
    pub path: String,
    /// Unix timestamp in milliseconds of the last time this vault was opened
    /// or made active. Missing for entries written by older app versions; use
    /// 0 as the implicit fallback in that case so they sort to the bottom of
    /// recents.
    #[serde(default)]
    pub last_opened_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VaultList {
    pub vaults: Vec<VaultEntry>,
    pub active_vault: Option<String>,
    #[serde(default)]
    pub hidden_defaults: Vec<String>,
}

fn app_config_dir() -> Result<PathBuf, String> {
    dirs::config_dir().ok_or_else(|| "Could not determine config directory".to_string())
}

fn preferred_app_config_path(file_name: &str) -> Result<PathBuf, String> {
    Ok(app_config_dir()?.join(APP_CONFIG_DIR).join(file_name))
}

fn resolve_existing_or_preferred_app_config_path(file_name: &str) -> Result<PathBuf, String> {
    let preferred = preferred_app_config_path(file_name)?;
    if preferred.exists() {
        return Ok(preferred);
    }

    let legacy = app_config_dir()?
        .join(LEGACY_APP_CONFIG_DIR)
        .join(file_name);
    if legacy.exists() {
        return Ok(legacy);
    }

    Ok(preferred)
}

fn vault_list_path() -> Result<PathBuf, String> {
    resolve_existing_or_preferred_app_config_path("vaults.json")
}

fn load_at(path: &PathBuf) -> Result<VaultList, String> {
    if !path.exists() {
        return Ok(VaultList::default());
    }
    let content =
        fs::read_to_string(path).map_err(|e| format!("Failed to read vault list: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse vault list: {}", e))
}

fn save_at(path: &PathBuf, list: &VaultList) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    let json = serde_json::to_string_pretty(list)
        .map_err(|e| format!("Failed to serialize vault list: {}", e))?;
    fs::write(path, json).map_err(|e| format!("Failed to write vault list: {}", e))
}

pub fn load_vault_list() -> Result<VaultList, String> {
    load_at(&vault_list_path()?)
}

pub fn save_vault_list(list: &VaultList) -> Result<(), String> {
    save_at(&preferred_app_config_path("vaults.json")?, list)
}

fn current_unix_millis() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Update `last_opened_at` for the entry whose path matches. Adds the entry
/// (with the path's basename as a fallback label) when it isn't yet in the
/// list, so freshly-opened-and-not-yet-registered vaults still appear in
/// recents.
pub fn touch_vault_last_opened(path: &str) -> Result<(), String> {
    let mut list = load_vault_list().unwrap_or_default();
    let now = current_unix_millis();
    if let Some(entry) = list.vaults.iter_mut().find(|entry| entry.path == path) {
        entry.last_opened_at = Some(now);
    } else {
        let label = std::path::Path::new(path)
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| path.to_string());
        list.vaults.push(VaultEntry {
            label,
            path: path.to_string(),
            last_opened_at: Some(now),
        });
    }
    save_vault_list(&list)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn save_and_reload(list: &VaultList) -> VaultList {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("vaults.json");
        save_at(&path, list).unwrap();
        load_at(&path).unwrap()
    }

    #[test]
    fn default_vault_list_is_empty() {
        let vl = VaultList::default();
        assert!(vl.vaults.is_empty());
        assert!(vl.active_vault.is_none());
    }

    #[test]
    fn roundtrip_preserves_data() {
        let list = VaultList {
            vaults: vec![
                VaultEntry {
                    label: "My Vault".to_string(),
                    path: "/Users/luca/Laputa".to_string(),
                    last_opened_at: Some(1_700_000_000_000),
                },
                VaultEntry {
                    label: "Work".to_string(),
                    path: "/Users/luca/Work".to_string(),
                    last_opened_at: None,
                },
            ],
            active_vault: Some("/Users/luca/Laputa".to_string()),
            hidden_defaults: vec![],
        };
        let loaded = save_and_reload(&list);
        assert_eq!(loaded.vaults.len(), 2);
        assert_eq!(loaded.vaults[0].label, "My Vault");
        assert_eq!(loaded.vaults[0].path, "/Users/luca/Laputa");
        assert_eq!(loaded.vaults[0].last_opened_at, Some(1_700_000_000_000));
        assert_eq!(loaded.vaults[1].label, "Work");
        assert_eq!(loaded.vaults[1].last_opened_at, None);
        assert_eq!(loaded.active_vault.as_deref(), Some("/Users/luca/Laputa"));
    }

    #[test]
    fn load_returns_default_for_missing_file() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("nonexistent.json");
        let result = load_at(&path).unwrap();
        assert!(result.vaults.is_empty());
        assert!(result.active_vault.is_none());
    }

    #[test]
    fn load_returns_error_for_malformed_json() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("bad.json");
        fs::write(&path, "not valid json{{{").unwrap();
        let err = load_at(&path).unwrap_err();
        assert!(err.contains("Failed to parse vault list"));
    }

    #[test]
    fn save_creates_parent_directories() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("nested").join("dir").join("vaults.json");
        let list = VaultList {
            vaults: vec![VaultEntry {
                label: "Test".to_string(),
                path: "/tmp/test".to_string(),
                last_opened_at: None,
            }],
            active_vault: None,
            hidden_defaults: vec![],
        };
        save_at(&path, &list).unwrap();
        assert!(path.exists());
        let loaded = load_at(&path).unwrap();
        assert_eq!(loaded.vaults.len(), 1);
    }

    #[test]
    fn vault_list_path_returns_ok() {
        let result = vault_list_path();
        assert!(result.is_ok());
        let path = result.unwrap();
        let path = path.to_str().unwrap();
        assert!(path.contains("com.tolaria.app") || path.contains("com.laputa.app"));
    }

    #[test]
    fn preferred_vault_list_path_uses_tolaria_namespace() {
        let result = preferred_app_config_path("vaults.json");
        assert!(result.is_ok());
        assert!(result
            .unwrap()
            .to_str()
            .unwrap()
            .contains("com.tolaria.app"));
    }

    #[test]
    fn empty_vault_list_roundtrip() {
        let list = VaultList::default();
        let loaded = save_and_reload(&list);
        assert!(loaded.vaults.is_empty());
        assert!(loaded.active_vault.is_none());
        assert!(loaded.hidden_defaults.is_empty());
    }

    #[test]
    fn hidden_defaults_roundtrip() {
        let list = VaultList {
            vaults: vec![],
            active_vault: None,
            hidden_defaults: vec!["/Users/luca/Documents/Getting Started".to_string()],
        };
        let loaded = save_and_reload(&list);
        assert_eq!(loaded.hidden_defaults.len(), 1);
        assert_eq!(
            loaded.hidden_defaults[0],
            "/Users/luca/Documents/Getting Started"
        );
    }

    #[test]
    fn load_legacy_format_without_hidden_defaults() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("legacy.json");
        // Simulate old format without hidden_defaults field
        fs::write(&path, r#"{"vaults":[],"active_vault":null}"#).unwrap();
        let loaded = load_at(&path).unwrap();
        assert!(loaded.hidden_defaults.is_empty());
    }

    #[test]
    fn load_legacy_format_without_last_opened_at() {
        // Older app versions persisted entries without the `last_opened_at`
        // field. They must continue to load and treat the value as None.
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("legacy.json");
        fs::write(
            &path,
            r#"{"vaults":[{"label":"Old","path":"/tmp/old"}],"active_vault":null}"#,
        )
        .unwrap();
        let loaded = load_at(&path).unwrap();
        assert_eq!(loaded.vaults.len(), 1);
        assert_eq!(loaded.vaults[0].last_opened_at, None);
    }
}
