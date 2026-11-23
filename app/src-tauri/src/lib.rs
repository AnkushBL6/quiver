//! Tauri shell: exposes quiver-core as IPC commands and watches skill dirs.

use notify_debouncer_mini::{
    DebounceEventResult, Debouncer, new_debouncer, notify::RecommendedWatcher,
    notify::RecursiveMode,
};
use quiver_core::*;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

mod icon;
mod shell;

struct AppState {
    quiver: RwLock<Quiver>,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    /// Serializes mutating operations so concurrent clicks can't interleave.
    op: Mutex<()>,
    watcher: Mutex<Option<Debouncer<RecommendedWatcher>>>,
}

type Res<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Run blocking work off the IPC thread.
async fn blocking<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce(&AppState) -> Res<T> + Send + 'static,
) -> Res<T> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || f(&app.state::<AppState>()))
        .await
        .map_err(err)?
}

fn q(st: &AppState) -> Quiver {
    st.quiver.read().expect("quiver lock").clone()
}

fn mutate<T>(st: &AppState, f: impl FnOnce(&Quiver) -> anyhow::Result<T>) -> Res<T> {
    let _guard = st.op.lock().map_err(err)?;
    f(&q(st)).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn scan(app: AppHandle) -> Res<Inventory> {
    blocking(&app, |st| Ok(q(st).scan())).await
}

#[tauri::command]
async fn skill_detail(app: AppHandle, id: String) -> Res<SkillDetail> {
    blocking(&app, move |st| {
        q(st).detail(&id).map_err(|e| format!("{e:#}"))
    })
    .await
}

#[tauri::command]
async fn read_skill_file(app: AppHandle, id: String, path: String) -> Res<String> {
    blocking(&app, move |st| {
        q(st).read_file(&id, &path).map_err(|e| format!("{e:#}"))
    })
    .await
}

/// Group a conflicting skill's copies into versions and compare their files. Local only.
#[tauri::command]
async fn compare_copies(app: AppHandle, id: String) -> Res<CopyComparison> {
    blocking(&app, move |st| {
        q(st).compare_copies(&id).map_err(|e| format!("{e:#}"))
    })
    .await
}

/// Which versions equal the latest upstream folder on GitHub. Network, short timeouts;
/// failures come back as `status: "unavailable"`, never as a rejection.
#[tauri::command]
async fn compare_upstream(app: AppHandle, id: String) -> Res<UpstreamCheck> {
    blocking(&app, move |st| {
        q(st).compare_upstream(&id).map_err(|e| format!("{e:#}"))
    })
    .await
}

/// Side-by-side line diff of one file between two versions (picked by content hash).
#[tauri::command]
async fn compare_file(
    app: AppHandle,
    id: String,
    path: String,
    left_hash: String,
    right_hash: String,
) -> Res<FileDiff> {
    blocking(&app, move |st| {
        q(st)
            .compare_file(&id, &path, &left_hash, &right_hash)
            .map_err(|e| format!("{e:#}"))
    })
    .await
}

// ---------- Pinned skills (per-project) ----------

#[tauri::command]
async fn projects_list(app: AppHandle) -> Res<Vec<ProjectSummary>> {
    blocking(&app, |st| Ok(q(st).projects_list())).await
}

/// Register a project (its git root) so it is listed and skills show where they are pinned.
#[tauri::command]
async fn project_add(app: AppHandle, path: String) -> Res<ProjectSummary> {
    blocking(&app, move |st| {
        let _guard = st.op.lock().map_err(err)?;
        let mut quiver = st.quiver.write().map_err(err)?;
        quiver.project_add(&path).map_err(|e| format!("{e:#}"))
    })
    .await
}

/// Unregister a project. Never touches any file in it.
#[tauri::command]
async fn project_remove(app: AppHandle, path: String) -> Res<()> {
    blocking(&app, move |st| {
        let _guard = st.op.lock().map_err(err)?;
        let mut quiver = st.quiver.write().map_err(err)?;
        quiver.project_remove(&path).map_err(|e| format!("{e:#}"))
    })
    .await
}

#[tauri::command]
async fn project_detail(app: AppHandle, path: String) -> Res<ProjectDetail> {
    blocking(&app, move |st| {
        q(st).project_detail(&path).map_err(|e| format!("{e:#}"))
    })
    .await
}

#[tauri::command]
async fn pin_check_name(app: AppHandle, project: String, name: String) -> Res<NameCheck> {
    blocking(&app, move |st| Ok(q(st).pin_check_name(&project, &name))).await
}

#[tauri::command]
async fn pin_create(app: AppHandle, request: PinRequest) -> Res<ProjectDetail> {
    blocking(&app, move |st| mutate(st, |q| q.pin_create(&request))).await
}

/// Re-pin from the current shared copy (`git_ref` null) or from GitHub at a ref.
#[tauri::command]
async fn pin_update(
    app: AppHandle,
    project: String,
    name: String,
    git_ref: Option<String>,
) -> Res<ProjectDetail> {
    blocking(&app, move |st| {
        mutate(st, |q| q.pin_update(&project, &name, git_ref.as_deref()))
    })
    .await
}

#[tauri::command]
async fn pin_remove(app: AppHandle, project: String, name: String) -> Res<ProjectDetail> {
    blocking(&app, move |st| {
        mutate(st, |q| q.pin_remove(&project, &name))
    })
    .await
}

/// Recreate missing or wrong links and copies from the pinned folders.
#[tauri::command]
async fn pin_sync(app: AppHandle, project: String) -> Res<ProjectDetail> {
    blocking(&app, move |st| mutate(st, |q| q.pin_sync(&project))).await
}

/// The shared copy against the pin, with the pin's rewritten name/description undone.
#[tauri::command]
async fn pin_compare(app: AppHandle, project: String, name: String) -> Res<CopyComparison> {
    blocking(&app, move |st| {
        q(st)
            .pin_compare(&project, &name)
            .map_err(|e| format!("{e:#}"))
    })
    .await
}

#[tauri::command]
async fn pin_compare_file(
    app: AppHandle,
    project: String,
    name: String,
    path: String,
    left_hash: String,
    right_hash: String,
) -> Res<FileDiff> {
    blocking(&app, move |st| {
        q(st)
            .pin_compare_file(&project, &name, &path, &left_hash, &right_hash)
            .map_err(|e| format!("{e:#}"))
    })
    .await
}

#[tauri::command]
async fn set_link(app: AppHandle, id: String, agent_id: String, enabled: bool) -> Res<Inventory> {
    blocking(&app, move |st| {
        mutate(st, |q| q.set_link(&id, &agent_id, enabled))?;
        Ok(q(st).scan())
    })
    .await
}

#[tauri::command]
async fn set_link_all(app: AppHandle, id: String, enabled: bool) -> Res<Inventory> {
    blocking(&app, move |st| {
        let report = mutate(st, |q| q.set_link_all(&id, enabled))?;
        if report.ok.is_empty() && !report.errors.is_empty() {
            return Err(report.errors[0].message.clone());
        }
        Ok(q(st).scan())
    })
    .await
}

#[tauri::command]
async fn set_link_agent(
    app: AppHandle,
    agent_id: String,
    ids: Vec<String>,
    enabled: bool,
) -> Res<OpReport> {
    blocking(&app, move |st| {
        mutate(st, |q| Ok(q.set_link_agent(&agent_id, &ids, enabled)))
    })
    .await
}

#[tauri::command]
async fn adopt(app: AppHandle, id: String, from_path: Option<String>) -> Res<Inventory> {
    blocking(&app, move |st| {
        mutate(st, |q| {
            q.adopt(&id, from_path.as_deref().map(std::path::Path::new))
        })?;
        Ok(q(st).scan())
    })
    .await
}

#[tauri::command]
async fn remove_skill(app: AppHandle, id: String) -> Res<Inventory> {
    blocking(&app, move |st| {
        mutate(st, |q| q.remove(&id))?;
        Ok(q(st).scan())
    })
    .await
}

#[tauri::command]
async fn create_skill(app: AppHandle, id: String, description: String) -> Res<Inventory> {
    blocking(&app, move |st| {
        mutate(st, |q| q.create(&id, &description))?;
        Ok(q(st).scan())
    })
    .await
}

#[tauri::command]
async fn sync_plan(app: AppHandle) -> Res<SyncPlan> {
    blocking(&app, |st| Ok(q(st).sync_plan())).await
}

#[derive(serde::Deserialize)]
struct SyncOptions {
    link: bool,
    adopt: bool,
    prune: bool,
}

#[tauri::command]
async fn sync_apply(app: AppHandle, options: SyncOptions) -> Res<OpReport> {
    blocking(&app, move |st| {
        mutate(st, |q| {
            Ok(q.sync_apply(options.link, options.adopt, options.prune))
        })
    })
    .await
}

#[tauri::command]
async fn resolve_source(app: AppHandle, input: String) -> Res<ResolvedSource> {
    blocking(&app, move |st| {
        let session = q(st).resolve(&input).map_err(|e| format!("{e:#}"))?;
        let resolved = session.resolved.clone();
        let mut sessions = st.sessions.lock().map_err(err)?;
        // Keep the last few sessions only (they may hold temp clones).
        if sessions.len() > 8 {
            sessions.clear();
        }
        sessions.insert(resolved.token.clone(), Arc::new(session));
        Ok(resolved)
    })
    .await
}

#[tauri::command]
async fn install(app: AppHandle, request: InstallRequest) -> Res<OpReport> {
    blocking(&app, move |st| {
        let session = st
            .sessions
            .lock()
            .map_err(err)?
            .get(&request.token)
            .cloned()
            .ok_or("This source expired; resolve it again.")?;
        mutate(st, |q| {
            Ok(q.install(&session, &request.paths, &request.agents, request.overwrite))
        })
    })
    .await
}

#[tauri::command]
async fn check_updates(app: AppHandle, force: Option<bool>) -> Res<Vec<UpdateInfo>> {
    blocking(&app, move |st| {
        Ok(q(st).check_updates(force.unwrap_or(false)))
    })
    .await
}

#[tauri::command]
async fn update_skills(app: AppHandle, ids: Vec<String>, force: bool) -> Res<OpReport> {
    blocking(&app, move |st| mutate(st, |q| Ok(q.update(&ids, force)))).await
}

#[tauri::command]
async fn search(app: AppHandle, query: String) -> Res<Vec<SearchResult>> {
    blocking(&app, move |st| {
        q(st).search(&query).map_err(|e| format!("{e:#}"))
    })
    .await
}

#[tauri::command]
async fn get_settings(app: AppHandle) -> Res<Settings> {
    blocking(&app, |st| Ok(q(st).settings_view())).await
}

#[tauri::command]
async fn save_settings(app: AppHandle, settings: Settings) -> Res<Settings> {
    let view = blocking(&app, move |st| {
        let mut guard = st.quiver.write().map_err(err)?;
        // Projects change only through project_add / project_remove, so a settings
        // object that was loaded earlier can't undo a registration.
        let mut settings = settings;
        settings.projects = guard.settings.projects.clone();
        guard
            .save_settings(settings)
            .map_err(|e| format!("{e:#}"))?;
        Ok(guard.settings_view())
    })
    .await?;
    restart_watcher(&app);
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        universal_sync(&handle);
        let _ = handle.emit("quiver://changed", ());
    });
    Ok(view)
}

#[tauri::command]
async fn set_github_token(app: AppHandle, token: Option<String>) -> Res<Settings> {
    blocking(&app, move |st| {
        store::keychain_set(token.as_deref()).map_err(|e| format!("Keychain: {e:#}"))?;
        Ok(q(st).settings_view())
    })
    .await
}

// ---------- My Skills ----------

#[tauri::command]
async fn my_skills_status(app: AppHandle) -> Res<MySkillsStatus> {
    blocking(&app, move |st| Ok(q(st).my_skills_status())).await
}

#[tauri::command]
async fn my_skills_init(app: AppHandle) -> Res<MySkillsStatus> {
    let s = blocking(&app, move |st| mutate(st, |q| q.my_skills_init())).await?;
    restart_watcher(&app);
    Ok(s)
}

#[tauri::command]
async fn make_mine(app: AppHandle, id: String) -> Res<()> {
    let r = blocking(&app, move |st| mutate(st, |q| q.make_mine(&id))).await;
    restart_watcher(&app);
    r
}

#[tauri::command]
async fn my_skills_commit(app: AppHandle, message: String, ids: Vec<String>) -> Res<String> {
    blocking(&app, move |st| {
        mutate(st, |q| q.my_skills_commit(&message, &ids))
    })
    .await
}

#[tauri::command]
async fn my_skills_pull(app: AppHandle) -> Res<String> {
    blocking(&app, move |st| mutate(st, |q| q.my_skills_pull())).await
}

#[tauri::command]
async fn my_skills_push(app: AppHandle) -> Res<String> {
    blocking(&app, move |st| mutate(st, |q| q.my_skills_push())).await
}

#[tauri::command]
async fn list_editors(app: AppHandle) -> Res<Vec<EditorApp>> {
    blocking(&app, move |st| Ok(q(st).list_editors())).await
}

#[tauri::command]
async fn open_in_editor(app: AppHandle, id: String) -> Res<()> {
    blocking(&app, move |st| {
        q(st).open_in_editor(&id).map_err(|e| format!("{e:#}"))
    })
    .await
}

/// Find upstream sources for skills that have none (network; ~10–30 s for 100 skills).
#[tauri::command]
async fn find_sources(app: AppHandle, ids: Vec<String>) -> Res<SourceScan> {
    blocking(&app, move |st| Ok(q(st).find_sources(&ids))).await
}

#[tauri::command]
async fn track_source(app: AppHandle, id: String, source: String, skill_path: String) -> Res<()> {
    blocking(&app, move |st| {
        mutate(st, |q| q.track_source(&id, &source, &skill_path))
    })
    .await
}

/// The agent's app icon as a PNG data URL (cached), or None.
#[tauri::command]
async fn agent_icon(app: AppHandle, agent_id: String) -> Res<Option<String>> {
    let cache = app.path().app_cache_dir().map_err(err)?.join("icons");
    blocking(&app, move |st| {
        let q = q(st);
        let Some(bundle) = q
            .agents()
            .into_iter()
            .find(|a| a.id == agent_id)
            .and_then(|a| a.app_path)
        else {
            return Ok(None);
        };
        Ok(icon::app_icon_png(&bundle, &cache).map(|png| icon::data_url(&png)))
    })
    .await
}

/// Only paths inside the user's home may be revealed/opened.
fn guard_path(st: &AppState, path: &str) -> Res<PathBuf> {
    let p = PathBuf::from(path);
    let quiver = q(st);
    // Allowed: the home folder, plus registered projects (a repo can live outside home).
    let mut roots = vec![quiver.env.home.clone()];
    roots.extend(quiver.settings.projects.iter().map(PathBuf::from));
    let norm = fsutil::normalize(&p);
    if !roots
        .iter()
        .any(|r| fsutil::starts_with(&p, r) || fsutil::starts_with(&norm, &fsutil::normalize(r)))
    {
        return Err("path is outside your home folder and your projects".into());
    }
    Ok(p)
}

#[tauri::command]
async fn reveal(app: AppHandle, path: String) -> Res<()> {
    blocking(&app, move |st| {
        let p = guard_path(st, &path)?;
        let target = if p.exists() {
            p
        } else {
            p.parent().map(PathBuf::from).unwrap_or(p)
        };
        shell::reveal(&target)
    })
    .await
}

#[tauri::command]
async fn open_path(app: AppHandle, path: String) -> Res<()> {
    blocking(&app, move |st| {
        // Web links open in the default browser; files must live in the home folder.
        if path.starts_with("https://") || path.starts_with("http://") {
            return shell::open(path.as_ref());
        }
        let p = guard_path(st, &path)?;
        shell::open(p.as_os_str())
    })
    .await
}

/// (Re)watch every skills directory; emits `quiver://changed` (debounced).
/// Universal mode: keep every skill in every agent. Skips if another operation
/// is running (it will trigger a fresh watcher event when it finishes).
fn universal_sync(app: &AppHandle) {
    let st = app.state::<AppState>();
    let Ok(_guard) = st.op.try_lock() else { return };
    if let Some(report) = q(&st).auto_sync()
        && !report.ok.is_empty()
    {
        let _ = app.emit("quiver://synced", report.ok.len());
    }
}

fn restart_watcher(app: &AppHandle) {
    let st = app.state::<AppState>();
    let dirs = q(&st).watch_dirs();
    let handle = app.clone();
    let debouncer = new_debouncer(
        Duration::from_millis(400),
        move |res: DebounceEventResult| {
            // Ignore git's own bookkeeping inside the My Skills repo.
            let relevant = res.as_ref().is_ok_and(|events| {
                events
                    .iter()
                    .any(|e| !e.path.components().any(|c| c.as_os_str() == ".git"))
            });
            if relevant {
                universal_sync(&handle);
                let _ = handle.emit("quiver://changed", ());
            }
        },
    );
    let Ok(mut debouncer) = debouncer else { return };
    let canonical = q(&st).canonical_dir();
    let my_dir = q(&st).my_dir();
    for d in dirs {
        // Watch the parent when a dir doesn't exist yet so creation is noticed.
        let (target, mode) = if d.exists() {
            (
                d.clone(),
                if d == canonical || d == my_dir {
                    RecursiveMode::Recursive
                } else {
                    RecursiveMode::NonRecursive
                },
            )
        } else if let Some(p) = d.parent().filter(|p| p.exists()) {
            (p.to_path_buf(), RecursiveMode::NonRecursive)
        } else {
            continue;
        };
        let _ = debouncer.watcher().watch(&target, mode);
    }
    if let Ok(mut w) = st.watcher.lock() {
        *w = Some(debouncer);
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            quiver: RwLock::new(Quiver::system()),
            sessions: Mutex::new(HashMap::new()),
            op: Mutex::new(()),
            watcher: Mutex::new(None),
        })
        .setup(|app| {
            restart_watcher(app.handle());
            // Link skills into newly installed agents (if enabled) in the background.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let st = handle.state::<AppState>();
                let new = {
                    let _g = st.op.lock();
                    q(&st).handle_new_agents().unwrap_or_default()
                };
                universal_sync(&handle);
                if !new.is_empty() {
                    let _ = handle.emit("quiver://changed", ());
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan,
            skill_detail,
            read_skill_file,
            compare_copies,
            compare_upstream,
            compare_file,
            projects_list,
            project_add,
            project_remove,
            project_detail,
            pin_check_name,
            pin_create,
            pin_update,
            pin_remove,
            pin_sync,
            pin_compare,
            pin_compare_file,
            set_link,
            set_link_all,
            set_link_agent,
            adopt,
            remove_skill,
            create_skill,
            sync_plan,
            sync_apply,
            resolve_source,
            install,
            check_updates,
            update_skills,
            search,
            get_settings,
            save_settings,
            set_github_token,
            reveal,
            open_path,
            my_skills_status,
            my_skills_init,
            make_mine,
            my_skills_commit,
            my_skills_pull,
            my_skills_push,
            list_editors,
            open_in_editor,
            agent_icon,
            find_sources,
            track_source
        ])
        .run(tauri::generate_context!())
        .expect("error while running Quiver");
}
