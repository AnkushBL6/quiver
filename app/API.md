# Quiver IPC contract (Tauri commands)

Invoked with `invoke(name, args)` from `@tauri-apps/api/core`. Args are camelCase.
All mutating commands return a fresh `Inventory` or an `OpReport`. Errors reject with a string message.

| Command | Args | Returns | Notes |
|---|---|---|---|
| `scan` | – | `Inventory` | Full rescan of canonical store + every agent dir. Fast (<100ms typical). |
| `skill_detail` | `{ id }` | `SkillDetail` | SKILL.md, frontmatter, file tree. |
| `read_skill_file` | `{ id, path }` | `string` | Text file inside the skill (max 1 MB). |
| `set_link` | `{ id, agentId, enabled }` | `Inventory` | Link/unlink one skill for one agent. Unmanaged skills are adopted first. |
| `set_link_all` | `{ id, enabled }` | `Inventory` | Link to / unlink from every detected, enabled agent. |
| `adopt` | `{ id, fromPath? }` | `Inventory` | "Make universal": move into ~/.agents/skills, replace copies with links. `fromPath` picks the winner on conflict. |
| `remove_skill` | `{ id }` | `Inventory` | Moves canonical dir + agent copies to the Trash (Recycle Bin on Windows), deletes links. |
| `create_skill` | `{ id, description }` | `Inventory` | Scaffold a new skill in My Skills (`~/Skills/<id>`, git-initialised on first use), link the canonical entry to it and out to the default agents. |
| `my_skills_status` | – | `MySkillsStatus` | Folder, git branch/remote/ahead/behind, uncommitted changes, last commit, `problem` if the folder overlaps an agent folder. |
| `my_skills_init` | – | `MySkillsStatus` | Create the folder (README, .gitignore) and `git init`. Idempotent. |
| `make_mine` | `{ id }` | – | "Make it mine": move/copy the skill into My Skills, drop upstream tracking (lock entry), remember `forkedFrom`. Unmanaged skills are adopted first. |
| `my_skills_commit` | `{ message, ids }` | `string` | Short hash. `ids` empty = commit everything. |
| `my_skills_pull` / `my_skills_push` | – | `string` | `git pull --ff-only` / `git push` (sets upstream on first push). Never prompts. |
| `list_editors` | – | `EditorApp[]` | Installed editors, preferred first. |
| `open_in_editor` | `{ id }` | – | Opens the skill folder in `settings.editor` or the first editor found. |
| `find_sources` | `{ ids }` | `SourceScan` | For skills with no source (`ids` empty = all `local`): finds the upstream GitHub repo and verifies it by git tree hash. `confidence`: `exact` (folder identical), `skillMd` (SKILL.md identical), `name` (same name, content differs). `known` = a repo you already install from. Network, 10–30 s. |
| `track_source` | `{ id, source, skillPath }` | – | Record the upstream so the skill gets update checks. Content untouched; if it differs from upstream, the next check offers an update. |
| `agent_icon` | `{ agentId }` | `string \| null` | PNG data URL of the agent's app icon (cached). |
| `sync_plan` | – | `SyncPlan` | What "Sync everything" would do. |
| `sync_apply` | `{ options: SyncOptions }` | `OpReport` | |
| `resolve_source` | `{ input }` | `ResolvedSource` | `owner/repo`, `owner/repo/path`, GitHub URL (tree/blob), any git URL, local folder, .zip, or a skills.sh id `owner/repo/skill`. Network. |
| `install` | `{ request: InstallRequest }` | `OpReport` | |
| `check_updates` | `{ force? }` | `UpdateInfo[]` | Cached for the check interval unless `force`. |
| `update_skills` | `{ ids, force }` | `OpReport` | `force` overwrites local modifications. |
| `search` | `{ query }` | `SearchResult[]` | skills.sh directory search. |
| `get_settings` / `save_settings` | – / `{ settings }` | `Settings` | |
| `set_github_token` | `{ token: string \| null }` | `Settings` | Stored in the macOS Keychain or Windows Credential Manager. |
| `reveal` | `{ path }` | – | Reveal in Finder (File Explorer on Windows). |
| `open_path` | `{ path }` | – | Open in default app/editor. |

Skills carry `origin`: `mine` (in My Skills), `installed` (remote source), `local` (in the store, no remote), `unmanaged` (only in agent folders) or `plugin`; plus `gitChanges` (mine only) and `forkedFrom`.

Event `quiver://changed` (no payload) fires (debounced 400ms) when any watched skills directory changes → UI should re-run `scan`.
