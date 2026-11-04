use eyre::{eyre, Context, Result};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// Home-relative folder each agent runtime scans for skills.
/// Both Claude Code and Codex look for `<home>/<dir>/skills/<name>/SKILL.md`.
fn runtime_folder(target: &str) -> Result<&'static str> {
    match target {
        "claude" => Ok(".claude"),
        "codex" => Ok(".codex"),
        other => Err(eyre!("unknown agent target: {other}")),
    }
}

/// Executables an agent can drive, resolved for this install.
#[derive(serde::Serialize)]
pub struct AgentPaths {
    /// The bundled server binary — transcribes from the command line, no server and no GUI needed.
    pub server: Option<String>,
    /// The Vibe app itself, for suggesting the user open it. It takes no useful CLI flags.
    pub vibe: Option<String>,
}

/// Resolve the paths baked into an installed skill. Both are optional: a missing binary should
/// leave the rest of the skill usable rather than failing the install.
#[tauri::command]
pub fn get_agent_paths(app_handle: tauri::AppHandle) -> AgentPaths {
    AgentPaths {
        server: crate::cmd::server_cmd::resolve_server_binary(&app_handle)
            .ok()
            .map(|path| path.display().to_string()),
        vibe: std::env::current_exe().ok().map(|path| path.display().to_string()),
    }
}

/// Folder name of the skill. Early Tyto builds installed it as `vibe` (see `remove_legacy_skill`).
const SKILL_NAME: &str = "tyto";

/// Write the skill under `home`, creating `<runtime>/skills/tyto/` on the way.
/// Overwriting is intended: reinstalling is how a stale API base URL gets refreshed.
fn write_skill(home: &Path, target: &str, contents: &str) -> Result<PathBuf> {
    let skills = home.join(runtime_folder(target)?).join("skills");
    let folder = skills.join(SKILL_NAME);
    fs::create_dir_all(&folder).context("create the agent skill folder")?;
    let path = folder.join("SKILL.md");
    fs::write(&path, contents).context("write the agent skill file")?;
    remove_legacy_skill(&skills);
    Ok(path)
}

/// Remove the skill an early Tyto build wrote to `skills/vibe/`, so the agent does not see it twice.
/// Only a file that mentions Tyto is removed: the original Vibe app installs to the same folder.
fn remove_legacy_skill(skills: &Path) {
    let folder = skills.join("vibe");
    let path = folder.join("SKILL.md");
    let Ok(old) = fs::read_to_string(&path) else { return };
    if !old.contains("Tyto") {
        return;
    }
    if let Err(error) = fs::remove_file(&path) {
        tracing::warn!("could not remove the old skill {}: {error}", path.display());
        return;
    }
    // Leaves the folder alone if anything else is in it.
    let _ = fs::remove_dir(&folder);
}

/// Install the Tyto skill for one agent runtime.
///
/// The target lives outside every directory the fs plugin is scoped to, so this goes through
/// `std::fs` here instead of the frontend — no capability to widen, and nothing the browser mock
/// can silently satisfy in the real app's place.
///
/// @returns the absolute path written, so the UI can tell the user where the skill went.
#[tauri::command]
pub fn install_agent_skill(app_handle: tauri::AppHandle, target: String, contents: String) -> Result<PathBuf> {
    let home = app_handle.path().home_dir().context("resolve the home directory")?;
    let path = write_skill(&home, &target, &contents)?;
    tracing::debug!("installed the agent skill to {}", path.display());
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::{runtime_folder, write_skill};

    #[test]
    fn maps_known_targets_only() {
        assert_eq!(runtime_folder("claude").unwrap(), ".claude");
        assert_eq!(runtime_folder("codex").unwrap(), ".codex");
        assert!(runtime_folder("cursor").is_err());
    }

    #[test]
    fn creates_the_skill_folder_and_overwrites_an_earlier_install() {
        let home = std::env::temp_dir().join(format!("tyto-skill-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);

        let path = write_skill(&home, "codex", "first").unwrap();
        assert_eq!(path, home.join(".codex/skills/tyto/SKILL.md"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "first");

        let again = write_skill(&home, "codex", "second").unwrap();
        assert_eq!(again, path);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "second");

        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn removes_the_old_tyto_skill_but_not_the_vibe_one() {
        let home = std::env::temp_dir().join(format!("tyto-legacy-skill-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);

        let ours = home.join(".claude/skills/vibe");
        std::fs::create_dir_all(&ours).unwrap();
        std::fs::write(ours.join("SKILL.md"), "description: Work with Tyto").unwrap();
        write_skill(&home, "claude", "new").unwrap();
        assert!(!ours.exists());

        let theirs = home.join(".codex/skills/vibe");
        std::fs::create_dir_all(&theirs).unwrap();
        std::fs::write(theirs.join("SKILL.md"), "description: Work with Vibe").unwrap();
        write_skill(&home, "codex", "new").unwrap();
        assert!(theirs.join("SKILL.md").exists());

        std::fs::remove_dir_all(&home).unwrap();
    }
}
