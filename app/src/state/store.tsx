import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api, errorMessage, onChanged } from "../lib/api";
import type { EditorApp, Inventory, MySkillsStatus, Presence, ProjectSummary, Settings, UpdateInfo } from "../lib/types";
import { PRESENCE, presenceFor, visibleAgents, type LibraryFilter, type View } from "../lib/ui";

// ── Data ─────────────────────────────────────────────────────────────────────

export interface DataState {
  inventory: Inventory | null;
  loadError: string | null;
  scanning: boolean;
  settings: Settings | null;
  updates: UpdateInfo[] | null;
  checkingUpdates: boolean;
  /** Optimistic presence per `${skillId}\0${agentId}`. */
  overrides: Map<string, Presence>;
  /** The user's own skills folder (git status). Null until first load. */
  mySkills: MySkillsStatus | null;
  editors: EditorApp[] | null;
  /** Registered projects (for the Projects section and its sidebar badge). Null until first load. */
  projects: ProjectSummary[] | null;
}

export interface Actions {
  rescan: (opts?: { quiet?: boolean }) => Promise<void>;
  setInventory: (inv: Inventory) => void;
  toggleLink: (skillId: string, agentId: string, enabled: boolean) => Promise<void>;
  toggleAll: (skillId: string, enabled: boolean) => Promise<void>;
  bulkAgent: (agentId: string, skillIds: string[], enabled: boolean) => Promise<void>;
  checkUpdates: (force?: boolean) => Promise<UpdateInfo[] | null>;
  saveSettings: (next: Settings) => Promise<void>;
  setSettings: (s: Settings) => void;
  /** Run a mutating command that returns an Inventory, with toast on error. */
  run: (fn: () => Promise<Inventory>, success?: string) => Promise<boolean>;
  refreshMySkills: () => Promise<MySkillsStatus | null>;
  setMySkills: (s: MySkillsStatus) => void;
  loadEditors: () => Promise<void>;
  refreshProjects: () => Promise<ProjectSummary[] | null>;
  setProjects: (p: ProjectSummary[]) => void;
}

export const overrideKey = (skillId: string, agentId: string) => `${skillId}\u0000${agentId}`;

const DataCtx = createContext<DataState | null>(null);
const ActionsCtx = createContext<Actions | null>(null);

// ── Navigation ───────────────────────────────────────────────────────────────

export interface NavState {
  view: View;
  filter: LibraryFilter;
  /** Narrow the Library to skills this agent sees (from Agents, Matrix or the palette). */
  agentFilter: string | null;
  /** The skill whose sheet is open (Library and My Skills) or the open project's path (Projects), mirrored in the URL. */
  selectedId: string | null;
  /** Search text handed to the next view (Library → Discover). */
  query: string;
}

export interface InstallState {
  open: boolean;
  input: string;
  autoResolve: boolean;
  /** Preselect only these candidate ids (from Discover). */
  only: string[] | null;
}

export interface PinSheetState {
  open: boolean;
  /** Skill to preselect. */
  skill: string | null;
  /** Project (root path) to pin into; null = ask. */
  project: string | null;
}

interface NavApi {
  nav: NavState;
  go: (view: View, patch?: Partial<Omit<NavState, "view">>) => void;
  select: (id: string | null) => void;
  install: InstallState;
  openInstall: (opts?: { input?: string; autoResolve?: boolean; only?: string[] | null }) => void;
  closeInstall: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  newSkillOpen: boolean;
  setNewSkillOpen: (open: boolean) => void;
  pinSheet: PinSheetState;
  openPinSheet: (opts?: { skill?: string | null; project?: string | null }) => void;
  closePinSheet: () => void;
  /** The pin that was just created: its card is highlighted for a moment. */
  flash: { project: string; pin: string } | null;
  setFlash: (f: { project: string; pin: string } | null) => void;
}

const NavCtx = createContext<NavApi | null>(null);

const VIEWS: View[] = ["library", "mine", "matrix", "agents", "updates", "discover", "health", "projects", "settings"];
/** Views with something open that lives in the URL: a skill sheet (Library, My Skills) or a project page (Projects). */
export const SELECTABLE: View[] = ["library", "mine", "projects"];

function readHash(): Partial<NavState> {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const view = VIEWS.includes(parts[0] as View) ? (parts[0] as View) : undefined;
  if (!view) return {};
  return { view, selectedId: SELECTABLE.includes(view) && parts[1] ? parts[1] : null };
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function StoreProvider({ children }: { children: ReactNode }) {
  const [inventory, setInventoryState] = useState<Inventory | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [updates, setUpdates] = useState<UpdateInfo[] | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [overrides, setOverrides] = useState<Map<string, Presence>>(() => new Map());
  const [mySkills, setMySkills] = useState<MySkillsStatus | null>(null);
  const [editors, setEditors] = useState<EditorApp[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);

  const refreshProjects = useCallback(async () => {
    try {
      const list = await api.projectsList();
      setProjects(list);
      return list;
    } catch {
      // Show the empty state rather than loading forever; adding a project reports the real problem.
      setProjects((prev) => prev ?? []);
      return null;
    }
  }, []);

  const refreshMySkills = useCallback(async () => {
    try {
      const s = await api.mySkillsStatus();
      setMySkills(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  const loadEditors = useCallback(async () => {
    try {
      setEditors(await api.listEditors());
    } catch {
      setEditors([]);
    }
  }, []);

  const invRef = useRef<Inventory | null>(null);
  const inflight = useRef(0);
  const sawConcurrency = useRef(false);
  const tokens = useRef(new Map<string, number>());
  const seq = useRef(0);

  const setInventory = useCallback((inv: Inventory) => {
    invRef.current = inv;
    setInventoryState(inv);
  }, []);

  const rescan = useCallback(
    async (opts?: { quiet?: boolean }) => {
      setScanning(true);
      void refreshMySkills();
      void refreshProjects();
      try {
        const inv = await api.scan();
        setInventory(inv);
        setLoadError(null);
      } catch (e) {
        const msg = errorMessage(e);
        if (!invRef.current) setLoadError(msg);
        if (!opts?.quiet) toast.error("Scan failed", { description: msg });
      } finally {
        setScanning(false);
      }
    },
    [setInventory, refreshMySkills, refreshProjects],
  );

  /** Track overlapping mutations: responses can arrive out of order, so rescan once they all settle. */
  const begin = () => {
    inflight.current++;
    if (inflight.current > 1) sawConcurrency.current = true;
  };
  const end = () => {
    inflight.current--;
    if (inflight.current === 0 && sawConcurrency.current) {
      sawConcurrency.current = false;
      void rescan({ quiet: true });
    }
  };

  const optimisticOn = (agentId: string): Presence => {
    const a = invRef.current?.agents.find((x) => x.id === agentId);
    if (a?.readsCanonical) return "native";
    return a?.linkMode === "copy" ? "copied" : "linked";
  };

  const setOverride = (keys: [string, Presence][]) => {
    const toks: [string, number][] = keys.map(([k]) => [k, ++seq.current]);
    toks.forEach(([k, t]) => tokens.current.set(k, t));
    setOverrides((m) => {
      const n = new Map(m);
      for (const [k, p] of keys) n.set(k, p);
      return n;
    });
    return () => {
      // Only clear keys no newer toggle has claimed. Done outside the updater:
      // StrictMode runs updaters twice, so they must stay pure.
      const mine = toks.filter(([k, t]) => tokens.current.get(k) === t).map(([k]) => k);
      for (const k of mine) tokens.current.delete(k);
      if (!mine.length) return;
      setOverrides((m) => {
        const n = new Map(m);
        for (const k of mine) n.delete(k);
        return n;
      });
    };
  };

  const toggleLink = useCallback(
    async (skillId: string, agentId: string, enabled: boolean) => {
      const clear = setOverride([[overrideKey(skillId, agentId), enabled ? optimisticOn(agentId) : "absent"]]);
      begin();
      try {
        setInventory(await api.setLink(skillId, agentId, enabled));
      } catch (e) {
        toast.error(enabled ? `Couldn't link ${skillId}` : `Couldn't unlink ${skillId}`, { description: errorMessage(e) });
      } finally {
        clear();
        end();
      }
    },
    [setInventory],
  );

  const toggleAll = useCallback(
    async (skillId: string, enabled: boolean) => {
      const inv = invRef.current;
      const skill = inv?.skills.find((s) => s.id === skillId);
      if (!inv || !skill) return;
      const keys: [string, Presence][] = [];
      for (const a of visibleAgents(inv.agents)) {
        const p = presenceFor(skill, a.id);
        if (!PRESENCE[p].toggleable || a.readsCanonical) continue;
        keys.push([overrideKey(skillId, a.id), enabled ? optimisticOn(a.id) : "absent"]);
      }
      const clear = setOverride(keys);
      begin();
      try {
        setInventory(await api.setLinkAll(skillId, enabled));
      } catch (e) {
        toast.error(`Couldn't update ${skillId}`, { description: errorMessage(e) });
      } finally {
        clear();
        end();
      }
    },
    [setInventory],
  );

  const bulkAgent = useCallback(
    async (agentId: string, skillIds: string[], enabled: boolean) => {
      if (!skillIds.length) return;
      const on = optimisticOn(agentId);
      const clear = setOverride(skillIds.map((id) => [overrideKey(id, agentId), enabled ? on : "absent"]));
      begin();
      const failures: string[] = [];
      try {
        // One backend call for the whole column, then one rescan.
        const report = await api.setLinkAgent(agentId, skillIds, enabled);
        for (const m of report.errors) failures.push(`${m.id}: ${m.message}`);
      } catch (e) {
        failures.push(errorMessage(e));
      }
      try {
        setInventory(await api.scan());
      } catch {
        /* the change event will rescan */
      }
      clear();
      sawConcurrency.current = true;
      end();
      if (failures.length) {
        toast.error(`${failures.length} of ${skillIds.length} couldn't be ${enabled ? "linked" : "unlinked"}`, {
          description: failures.slice(0, 3).join("\n") + (failures.length > 3 ? `\n…and ${failures.length - 3} more` : ""),
        });
      } else {
        const name = invRef.current?.agents.find((a) => a.id === agentId)?.name ?? agentId;
        toast.success(`${enabled ? "Linked" : "Unlinked"} ${skillIds.length} skill${skillIds.length === 1 ? "" : "s"} ${enabled ? "to" : "from"} ${name}`);
      }
    },
    [setInventory],
  );

  const checkUpdates = useCallback(async (force = false) => {
    setCheckingUpdates(true);
    try {
      const u = await api.checkUpdates(force);
      setUpdates(u);
      return u;
    } catch (e) {
      toast.error("Couldn't check for updates", { description: errorMessage(e) });
      return null;
    } finally {
      setCheckingUpdates(false);
    }
  }, []);

  const saveSettings = useCallback(
    async (next: Settings) => {
      setSettings(next);
      try {
        setSettings(await api.saveSettings(next));
        await rescan({ quiet: true });
      } catch (e) {
        toast.error("Couldn't save settings", { description: errorMessage(e) });
        try {
          setSettings(await api.getSettings());
        } catch {
          /* keep optimistic */
        }
      }
    },
    [rescan],
  );

  const run = useCallback(
    async (fn: () => Promise<Inventory>, success?: string) => {
      try {
        setInventory(await fn());
        if (success) toast.success(success);
        return true;
      } catch (e) {
        toast.error("Something went wrong", { description: errorMessage(e) });
        return false;
      }
    },
    [setInventory],
  );

  // Boot
  useEffect(() => {
    void rescan({ quiet: true });
    void loadEditors();
    api
      .getSettings()
      .then((s) => {
        setSettings(s);
        if (s.autoCheckUpdates) void checkUpdates(false);
      })
      .catch((e) => toast.error("Couldn't load settings", { description: errorMessage(e) }));
  }, [rescan, checkUpdates, loadEditors]);

  // Debounced re-scan on filesystem changes.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = onChanged(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (inflight.current === 0) void rescan({ quiet: true });
      }, 250);
    });
    return () => {
      clearTimeout(t);
      off();
    };
  }, [rescan]);

  // Periodic update checks.
  useEffect(() => {
    if (!settings?.autoCheckUpdates) return;
    const ms = Math.max(1, settings.checkIntervalHours) * 3600_000;
    const id = setInterval(() => void checkUpdates(false), ms);
    return () => clearInterval(id);
  }, [settings?.autoCheckUpdates, settings?.checkIntervalHours, checkUpdates]);

  const data = useMemo<DataState>(
    () => ({ inventory, loadError, scanning, settings, updates, checkingUpdates, overrides, mySkills, editors, projects }),
    [inventory, loadError, scanning, settings, updates, checkingUpdates, overrides, mySkills, editors, projects],
  );
  const actions = useMemo<Actions>(
    () => ({
      rescan,
      setInventory,
      toggleLink,
      toggleAll,
      bulkAgent,
      checkUpdates,
      saveSettings,
      setSettings,
      run,
      refreshMySkills,
      setMySkills,
      loadEditors,
      refreshProjects,
      setProjects,
    }),
    [rescan, setInventory, toggleLink, toggleAll, bulkAgent, checkUpdates, saveSettings, run, refreshMySkills, loadEditors, refreshProjects],
  );

  // Navigation
  const [nav, setNav] = useState<NavState>(() => ({
    view: "library",
    filter: "all",
    agentFilter: null,
    selectedId: null,
    query: "",
    ...readHash(),
  }));
  const [install, setInstall] = useState<InstallState>({ open: false, input: "", autoResolve: false, only: null });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newSkillOpen, setNewSkillOpen] = useState(false);
  const [pinSheet, setPinSheet] = useState<PinSheetState>({ open: false, skill: null, project: null });
  const [flash, setFlash] = useState<{ project: string; pin: string } | null>(null);

  useEffect(() => {
    const target = `#/${nav.view}${SELECTABLE.includes(nav.view) && nav.selectedId ? "/" + encodeURIComponent(nav.selectedId) : ""}`;
    if (location.hash !== target) history.replaceState(null, "", target);
  }, [nav.view, nav.selectedId]);

  useEffect(() => {
    const onHash = () => setNav((n) => ({ ...n, ...readHash() }));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navApi = useMemo<NavApi>(
    () => ({
      nav,
      // Switching sections closes whatever was open in the old one (a skill sheet, a project page).
      go: (view, patch) =>
        setNav((n) => ({ ...n, query: "", ...(view !== n.view && !(patch && "selectedId" in patch) ? { selectedId: null } : {}), ...patch, view })),
      select: (id) => setNav((n) => ({ ...n, selectedId: id })),
      install,
      openInstall: (opts) =>
        setInstall({ open: true, input: opts?.input ?? "", autoResolve: !!opts?.autoResolve, only: opts?.only ?? null }),
      closeInstall: () => setInstall((s) => ({ ...s, open: false })),
      paletteOpen,
      setPaletteOpen,
      newSkillOpen,
      setNewSkillOpen,
      pinSheet,
      openPinSheet: (opts) => setPinSheet({ open: true, skill: opts?.skill ?? null, project: opts?.project ?? null }),
      closePinSheet: () => setPinSheet((s) => ({ ...s, open: false })),
      flash,
      setFlash,
    }),
    [nav, install, paletteOpen, newSkillOpen, pinSheet, flash],
  );

  return (
    <ActionsCtx.Provider value={actions}>
      <DataCtx.Provider value={data}>
        <NavCtx.Provider value={navApi}>{children}</NavCtx.Provider>
      </DataCtx.Provider>
    </ActionsCtx.Provider>
  );
}

export function useData() {
  const v = useContext(DataCtx);
  if (!v) throw new Error("useData outside StoreProvider");
  return v;
}
export function useActions() {
  const v = useContext(ActionsCtx);
  if (!v) throw new Error("useActions outside StoreProvider");
  return v;
}
export function useNav() {
  const v = useContext(NavCtx);
  if (!v) throw new Error("useNav outside StoreProvider");
  return v;
}

/** Presence with optimistic overrides applied. */
export function effectivePresence(overrides: Map<string, Presence>, skill: { id: string; presence: { agentId: string; presence: Presence }[] }, agentId: string): Presence {
  return overrides.get(overrideKey(skill.id, agentId)) ?? skill.presence.find((p) => p.agentId === agentId)?.presence ?? "absent";
}
