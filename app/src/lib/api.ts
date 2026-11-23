// Typed wrapper around the Tauri commands documented in app/API.md.
// Inside Tauri it uses `invoke`/`listen`; in a plain browser it falls back to
// the in-memory mock backend (src/lib/mock.ts), which the website and demo use.

import type {
  CopyComparison,
  EditorApp,
  FileDiff,
  FileEntry,
  MySkillsStatus,
  NameCheck,
  PinRequest,
  ProjectDetail,
  ProjectSummary,
  SourceScan,
  InstallRequest,
  Inventory,
  OpReport,
  ResolvedSource,
  SearchResult,
  Settings,
  SkillDetail,
  SyncOptions,
  SyncPlan,
  UpdateInfo,
  UpstreamCheck,
} from "./types";

export type { FileEntry };

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Args = Record<string, unknown> | undefined;

let mockModule: Promise<typeof import("./mock")> | null = null;
function loadMock() {
  mockModule ??= import("./mock");
  return mockModule;
}

async function call<T>(cmd: string, args?: Args): Promise<T> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      return await invoke<T>(cmd, args);
    } catch (e) {
      throw errorMessage(e);
    }
  }
  const mock = await loadMock();
  try {
    return (await mock.handle(cmd, args ?? {})) as T;
  } catch (e) {
    throw errorMessage(e);
  }
}

/** Commands reject with a string. Normalise anything else to one. */
export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export const api = {
  scan: () => call<Inventory>("scan"),
  skillDetail: (id: string) => call<SkillDetail>("skill_detail", { id }),
  readSkillFile: (id: string, path: string) => call<string>("read_skill_file", { id, path }),
  /** Conflicting copies grouped into versions, with per-file status. Local only. */
  compareCopies: (id: string) => call<CopyComparison>("compare_copies", { id }),
  /** Which versions equal the latest upstream folder on GitHub. Network; resolves (never rejects) when offline. */
  compareUpstream: (id: string) => call<UpstreamCheck>("compare_upstream", { id }),
  /** Line diff of one file between two versions (by `contentHash`). */
  compareFile: (id: string, path: string, leftHash: string, rightHash: string) =>
    call<FileDiff>("compare_file", { id, path, leftHash, rightHash }),
  setLink: (id: string, agentId: string, enabled: boolean) =>
    call<Inventory>("set_link", { id, agentId, enabled }),
  setLinkAll: (id: string, enabled: boolean) => call<Inventory>("set_link_all", { id, enabled }),
  setLinkAgent: (agentId: string, ids: string[], enabled: boolean) =>
    call<OpReport>("set_link_agent", { agentId, ids, enabled }),
  adopt: (id: string, fromPath?: string) =>
    call<Inventory>("adopt", fromPath ? { id, fromPath } : { id }),
  removeSkill: (id: string) => call<Inventory>("remove_skill", { id }),
  /** Creates ~/Skills/<id> (initialising the repo if needed) and links it per settings. Rescan afterwards. */
  createSkill: (id: string, description: string) => call<Inventory | null>("create_skill", { id, description }),
  syncPlan: () => call<SyncPlan>("sync_plan"),
  syncApply: (options: SyncOptions) => call<OpReport>("sync_apply", { options }),
  resolveSource: (input: string) => call<ResolvedSource>("resolve_source", { input }),
  install: (request: InstallRequest) => call<OpReport>("install", { request }),
  checkUpdates: (force = false) => call<UpdateInfo[]>("check_updates", { force }),
  updateSkills: (ids: string[], force: boolean) => call<OpReport>("update_skills", { ids, force }),
  search: (query: string) => call<SearchResult[]>("search", { query }),
  getSettings: () => call<Settings>("get_settings"),
  saveSettings: (settings: Settings) => call<Settings>("save_settings", { settings }),
  setGithubToken: (token: string | null) => call<Settings>("set_github_token", { token }),
  reveal: (path: string) => call<void>("reveal", { path }),
  openPath: (path: string) => call<void>("open_path", { path }),
  // My Skills
  mySkillsStatus: () => call<MySkillsStatus>("my_skills_status"),
  mySkillsInit: () => call<MySkillsStatus>("my_skills_init"),
  makeMine: (id: string) => call<null>("make_mine", { id }),
  mySkillsCommit: (message: string, ids: string[]) => call<string>("my_skills_commit", { message, ids }),
  mySkillsPull: () => call<string>("my_skills_pull"),
  mySkillsPush: () => call<string>("my_skills_push"),
  openInEditor: (id: string) => call<null>("open_in_editor", { id }),
  listEditors: () => call<EditorApp[]>("list_editors"),
  agentIcon: (agentId: string) => call<string | null>("agent_icon", { agentId }),
  findSources: (ids: string[]) => call<SourceScan>("find_sources", { ids }),
  trackSource: (id: string, source: string, skillPath: string) => call<null>("track_source", { id, source, skillPath }),
  // Projects and pinned skills
  projectsList: () => call<ProjectSummary[]>("projects_list"),
  projectAdd: (path: string) => call<ProjectSummary>("project_add", { path }),
  /** Unregisters only; never touches files. */
  projectRemove: (path: string) => call<null>("project_remove", { path }),
  projectDetail: (path: string) => call<ProjectDetail>("project_detail", { path }),
  pinCheckName: (project: string, name: string) => call<NameCheck>("pin_check_name", { project, name }),
  pinCreate: (request: PinRequest) => call<ProjectDetail>("pin_create", { request }),
  /** `gitRef` null re-pins from the current shared copy. */
  pinUpdate: (project: string, name: string, gitRef: string | null) => call<ProjectDetail>("pin_update", { project, name, gitRef }),
  pinRemove: (project: string, name: string) => call<ProjectDetail>("pin_remove", { project, name }),
  /** Recreates missing or wrong links and copies from the pin folder. Never changes pin content. */
  pinSync: (project: string) => call<ProjectDetail>("pin_sync", { project }),
  /** The shared copy (version 1) against the pinned copy (version 2). */
  pinCompare: (project: string, name: string) => call<CopyComparison>("pin_compare", { project, name }),
  pinCompareFile: (project: string, name: string, path: string, leftHash: string, rightHash: string) =>
    call<FileDiff>("pin_compare_file", { project, name, path, leftHash, rightHash }),
};

/** Subscribe to `quiver://changed`. Returns an unsubscribe function. */
export function onChanged(cb: () => void): () => void {
  if (!isTauri) {
    let off = () => {};
    let cancelled = false;
    void loadMock().then((m) => {
      if (!cancelled) off = m.onMockChanged(cb);
    });
    return () => {
      cancelled = true;
      off();
    };
  }
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  void import("@tauri-apps/api/event").then(({ listen }) =>
    listen("quiver://changed", () => cb()).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    }),
  );
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/** Native drag-and-drop of files/folders onto the window (Tauri only; no-op in the browser). */
export function onFileDrop(handlers: {
  over: (active: boolean) => void;
  drop: (paths: string[]) => void;
}): () => void {
  if (!isTauri) return () => {};
  let unlisten: (() => void) | null = null;
  let cancelled = false;
  void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") handlers.over(true);
        else if (p.type === "leave") handlers.over(false);
        else if (p.type === "drop") {
          handlers.over(false);
          if (p.paths.length) handlers.drop(p.paths);
        }
      })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      }),
  );
  return () => {
    cancelled = true;
    unlisten?.();
  };
}

/** Native folder picker for the My Skills folder. In the browser it returns a demo path. */
export async function pickDirectory(title: string): Promise<string | null> {
  if (!isTauri) return "~/Code/skills";
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ directory: true, multiple: false, title });
  return typeof res === "string" ? res : null;
}

/** Native open panel. In the browser it returns a plausible demo path. */
export async function pickSource(kind: "folder" | "zip"): Promise<string | null> {
  if (!isTauri) {
    return kind === "folder" ? "~/Downloads/team-skills" : "~/Downloads/release-notes-skill.zip";
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res =
    kind === "folder"
      ? await open({ directory: true, multiple: false, title: "Choose a skill folder" })
      : await open({
          directory: false,
          multiple: false,
          title: "Choose a .zip",
          filters: [{ name: "Zip archive", extensions: ["zip"] }],
        });
  return typeof res === "string" ? res : null;
}

/**
 * Native folder picker for a project. In the browser it returns a sample project that isn't added yet
 * (`taken` = paths already registered), so the demo flow works.
 */
const SAMPLE_PROJECTS = ["~/code/acme-web", "~/code/docs-site", "~/code/api-gateway", "~/code/mobile-app"];
export async function pickProjectFolder(taken: string[] = []): Promise<string | null> {
  if (!isTauri) {
    const norm = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
    const used = new Set(taken.map(norm));
    return SAMPLE_PROJECTS.find((p) => !used.has(p)) ?? SAMPLE_PROJECTS[0];
  }
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ directory: true, multiple: false, title: "Choose a project folder" });
  return typeof res === "string" ? res : null;
}
