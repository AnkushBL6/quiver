# Quiver IPC contract (Tauri commands)

Invoked with `invoke(name, args)` from `@tauri-apps/api/core`. Args are camelCase.
All mutating commands return a fresh `Inventory` or an `OpReport`. Errors reject with a string message.

| Command | Args | Returns | Notes |
|---|---|---|---|
| `scan` | – | `Inventory` | Full rescan of canonical store + every agent dir. Fast (<100ms typical). |
| `skill_detail` | `{ id }` | `SkillDetail` | SKILL.md, frontmatter, file tree. |
| `read_skill_file` | `{ id, path }` | `string` | Text file inside the skill (max 1 MB). |
| `compare_copies` | `{ id }` | `CopyComparison` | Conflicting copies of one skill, grouped into `versions` by content (shared copy first; ids `v1`, `v2`…). Per version: `locations`, `agentIds`, `modifiedMs`, `fileCount`, `newest` (strictly the most recently modified), `editedSinceInstall` (`true` differs from the install record, `false` unchanged, `null` no record). Per file across versions: `status` `same` / `changed` / `partial` (missing from some), `content` `text` / `binary` / `tooLarge`, and one `variants` entry per version (`null` where absent; equal `digest` = identical bytes). `suggested` is the `[left, right]` pair to show first. Local only, fast; `upstreamSource` says whether `compare_upstream` can run. |
| `compare_upstream` | `{ id }` | `UpstreamCheck` | Which versions equal the latest upstream folder on GitHub (`matchingHashes`, by `contentHash`). One tree request with short timeouts. Never rejects for network trouble: `status` is `checked`, `noSource` (not installed from GitHub) or `unavailable` (offline, rate limited, gone upstream; see `message`). Call it after `compare_copies` and merge the result in; the comparison never waits on it. |
| `compare_file` | `{ id, path, leftHash, rightHash }` | `FileDiff` | Line diff of one file between two versions, picked by `contentHash` (stable across rescans; rejects if a copy changed since). `blocks` of side-by-side rows: `kind` `equal` / `insert` / `delete` / `replace`, 1-based `leftNo` / `rightNo`, line text, and `leftMarks` / `rightMarks` (changed spans as `[start, end)` UTF-16 offsets; empty = the whole line). Runs of 3+ unchanged lines beyond 3 lines of context come as `collapsed` blocks that still carry their rows. Binary, non-UTF-8 and files over 512 KB come back with `content` `binary` / `tooLarge`, sizes, and no blocks. A file missing on one side is all inserts or all deletes. `eolOnly`: only line endings differ. |
| `projects_list` | – | `ProjectSummary[]` | The registered projects (`settings.projects`), each with `pinCount` and `problemCount` (pins whose state isn't `ok`). Missing folders come back with `exists: false`. Reads each project's `quiver-pins.json` and hashes its pins: cheap, no network. |
| `project_add` | `{ path }` | `ProjectSummary` | Registers the project root (the git root of `path`, else `path`), deduplicated. Refuses the home folder and anything inside the shared store or an agent's global skills folder. |
| `project_remove` | `{ path }` | – | Unregisters only. Never touches any file in the project. |
| `project_detail` | `{ path }` | `ProjectDetail` | The summary plus `pins` (state, `changedFiles`, `problems`, per-agent `agents` links, `sharedChanged`, `nameClash`), `otherSkills` (skill folders in `.agents/skills` and agent project folders that aren't pins; `source` from `skills-lock.json` when present) and `lockFile`. `path` need not be registered. |
| `pin_check_name` | `{ project, name }` | `NameCheck` | `ok: false` with a plain-language `message` when the name breaks `^[a-z0-9]+(-[a-z0-9]+)*$` (max 64), exists in any agent's global skills folder (the message explains that Claude Code ranks personal skills above project ones), or is already a pin or folder in the project. |
| `pin_create` | `{ request: PinRequest }` | `ProjectDetail` | Writes `<root>/.agents/skills/<name>/`, a relative symlink (mode `symlink`) or a full copy (mode `copy`) in each chosen agent's project folder, and `<root>/quiver-pins.json`, last. Staged and rolled back on error. `gitRef` null pins the shared copy; otherwise the ref (tag, branch or SHA) is resolved to a commit via the GitHub API and the skill is downloaded at that commit (network; needs a GitHub source on the skill). Empty `agents` = enabled, detected agents. Never changes the shared store, agent global folders or the global lock. |
| `pin_update` | `{ project, name, gitRef }` | `ProjectDetail` | `gitRef: null` re-pins from the current shared copy; a string re-pins from the skill's GitHub source at that ref. A pin whose files were edited goes to the Trash. |
| `pin_remove` | `{ project, name }` | `ProjectDetail` | Moves the pin folder and its copies to the Trash (Recycle Bin on Windows), removes links that lead to it and the lock entry; deletes `quiver-pins.json` when no pins are left. |
| `pin_sync` | `{ project }` | `ProjectDetail` | Recreates missing or wrong links and copies from the pinned folders. Never changes pin content or the lock. |
| `pin_compare` | `{ project, name }` | `CopyComparison` | `v1` = the shared copy (`shared: true`), `v2` = the pinned folder (`shared: false`, `locations[0].path` = the pin folder, `kind: "directory"`, `agentIds: []`). The pin's rewritten `name`/`description` lines are compared as if un-rewritten, so they never show as a difference (a real change to the description still does). Rejects when the shared copy isn't on this machine. Local only. |
| `pin_compare_file` | `{ project, name, path, leftHash, rightHash }` | `FileDiff` | Like `compare_file`: the two `contentHash`es come from `pin_compare` (either order); rejects when either side changed since. |
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

**Pinned skills.** A pin is a fixed copy of a skill committed in a project, under its own name (`<skill>-pinned` by default) because Claude Code ranks personal skills above project ones. `Pin.state`: `ok`, `modified` (content differs from the lock; see `changedFiles`, relative to the pin folder), `missing` (folder gone) or `links` (content fine, an agent's link or copy is missing or wrong; see `agents[].problem`). `sharedChanged` (`true` / `false` / `null` = no shared copy) and `nameClash` (agent ids with a global skill of the pin's name) are informational: they never change `state`. `Pin.agents[].kind` is `native` (the agent reads `.agents/skills` itself), `symlink` or `copy`. Hashes (`quiver-pin-v1`) are the same on every OS: files are hashed with CRLF folded to LF when they are UTF-8 text. `Skill.pinnedIn` lists where a skill is pinned, from the registered projects' lock files. `AgentInfo.projectDir` is where the agent reads a repo's own skills (`null` = no project folder). `save_settings` ignores `projects`: only `project_add` / `project_remove` change it.

Skills carry `origin`: `mine` (in My Skills), `installed` (remote source), `local` (in the store, no remote), `unmanaged` (only in agent folders) or `plugin`; plus `gitChanges` (mine only) and `forkedFrom`.

Event `quiver://changed` (no payload) fires (debounced 400ms) when any watched skills directory changes → UI should re-run `scan`.
