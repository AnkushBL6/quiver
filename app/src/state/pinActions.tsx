import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage, pickProjectFolder } from "../lib/api";
import type { Pin, PinRequest, ProjectDetail, ProjectSummary } from "../lib/types";
import { plural, trashName } from "../lib/ui";
import { useConfirm } from "../components/overlay";
import { useActions, useData, useNav } from "./store";

// ── Project details, shared between the page and the sheets that change them ─
// A mutation returns the new ProjectDetail; publishing it updates an open project page at once,
// without waiting for the next scan.

const cache = new Map<string, ProjectDetail>();
const subscribers = new Set<(d: ProjectDetail) => void>();

export function publishProject(d: ProjectDetail) {
  cache.set(d.path, d);
  subscribers.forEach((f) => f(d));
}

/** The detail of one project (pins, other skills), kept fresh across scans. Null while loading. */
export function useProjectDetail(path: string | null) {
  const { inventory } = useData();
  const scannedAt = inventory?.scannedAtMs;
  const [detail, setDetail] = useState<ProjectDetail | null>(() => (path ? (cache.get(path) ?? null) : null));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(path ? (cache.get(path) ?? null) : null);
    setError(null);
  }, [path]);

  useEffect(() => {
    const on = (d: ProjectDetail) => {
      if (d.path === path) setDetail(d);
    };
    subscribers.add(on);
    return () => void subscribers.delete(on);
  }, [path]);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    api
      .projectDetail(path)
      .then((d) => {
        if (!alive) return;
        cache.set(d.path, d);
        setDetail(d);
        setError(null);
      })
      .catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [path, scannedAt]);

  return { detail: detail && detail.path === path ? detail : null, error };
}

// ── Commands ─────────────────────────────────────────────────────────────────

/** Project and pin commands shared by the Projects section, the pin sheets and the command palette. */
export function usePinActions() {
  const { projects } = useData();
  const { rescan } = useActions();
  const { go, setFlash, closePinSheet } = useNav();
  const confirm = useConfirm();

  /** Pins change what every skill says about where it is pinned, so rescan too (it also reloads the project list). */
  const changed = useCallback((d: ProjectDetail) => {
    publishProject(d);
    void rescan({ quiet: true });
  }, [rescan]);

  /** Add a project from a path, or from the folder picker when none is given. Opens its page. */
  const addProject = useCallback(
    async (path?: string): Promise<ProjectSummary | null> => {
      try {
        const chosen = path ?? (await pickProjectFolder((projects ?? []).map((p) => p.path)));
        if (!chosen) return null;
        const known = projects?.some((p) => p.path === chosen || p.displayPath === chosen);
        const added = await api.projectAdd(chosen);
        await rescan({ quiet: true });
        go("projects", { selectedId: added.path });
        if (!known) toast.success(`Added ${added.name}`, { description: added.pinCount ? `${added.pinCount} pinned ${added.pinCount === 1 ? "skill" : "skills"} found.` : undefined });
        return added;
      } catch (e) {
        toast.error("Couldn't add the project", { description: errorMessage(e) });
        return null;
      }
    },
    [projects, rescan, go],
  );

  const removeProject = useCallback(
    async (project: ProjectSummary): Promise<boolean> => {
      const ok = await confirm({
        title: `Remove “${project.name}” from Quiver?`,
        message: (
          <>
            Quiver stops listing it. Nothing in the folder changes: pinned skills, links and the pin file stay exactly as they are, and you can add the project again any time.
          </>
        ),
        confirmLabel: "Remove",
      });
      if (!ok) return false;
      try {
        await api.projectRemove(project.path);
        go("projects", { selectedId: null });
        await rescan({ quiet: true });
        toast(`Removed ${project.name} from Quiver`);
        return true;
      } catch (e) {
        toast.error("Couldn't remove the project", { description: errorMessage(e) });
        return false;
      }
    },
    [confirm, go, rescan],
  );

  const removePin = useCallback(
    async (project: ProjectSummary, pin: Pin): Promise<boolean> => {
      const links = pin.agents.filter((a) => a.kind !== "native").length;
      const ok = await confirm({
        title: `Remove the pin “${pin.name}”?`,
        message: (
          <>
            The pinned folder in {project.name} moves to the {trashName}
            {links ? ` and ${plural(links, pin.mode === "copy" ? "copy" : "link", pin.mode === "copy" ? "copies" : "links")} will be removed` : ""}. The shared {pin.skill} and your other projects aren't affected.
          </>
        ),
        confirmLabel: "Remove Pin",
        destructive: true,
      });
      if (!ok) return false;
      try {
        changed(await api.pinRemove(project.path, pin.name));
        toast.success(`Removed ${pin.name} from ${project.name}`, { description: `Moved to the ${trashName}.` });
        return true;
      } catch (e) {
        toast.error(`Couldn't remove ${pin.name}`, { description: errorMessage(e) });
        return false;
      }
    },
    [confirm, changed],
  );

  const repairLinks = useCallback(
    async (project: ProjectSummary): Promise<boolean> => {
      try {
        changed(await api.pinSync(project.path));
        toast.success("Links repaired", { description: `Everything in ${project.name} points at the pinned folders again.` });
        return true;
      } catch (e) {
        toast.error("Couldn't repair the links", { description: errorMessage(e) });
        return false;
      }
    },
    [changed],
  );

  /** `gitRef` null = from the current shared copy. */
  const updatePin = useCallback(
    async (project: ProjectSummary, pin: Pin, gitRef: string | null): Promise<boolean> => {
      try {
        changed(await api.pinUpdate(project.path, pin.name, gitRef));
        toast.success(`Updated ${pin.name}`, {
          description: gitRef ? `Now pinned to ${gitRef}.` : `Now the same as the shared ${pin.skill}.`,
        });
        return true;
      } catch (e) {
        toast.error(`Couldn't update ${pin.name}`, { description: errorMessage(e) });
        return false;
      }
    },
    [changed],
  );

  /** Create a pin. Throws the plain-language message so the sheet can show it inline. */
  const createPin = useCallback(
    async (request: PinRequest, projectName: string): Promise<void> => {
      const detail = await api.pinCreate(request);
      changed(detail);
      closePinSheet();
      setFlash({ project: detail.path, pin: request.name });
      go("projects", { selectedId: detail.path });
      toast.success(`Pinned ${request.skill} in ${projectName}`, { description: `Use /${request.name} in Claude Code`, duration: 6000 });
    },
    [changed, closePinSheet, setFlash, go],
  );

  return { addProject, removeProject, removePin, repairLinks, updatePin, createPin, changed };
}
