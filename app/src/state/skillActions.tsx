import { useCallback } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "../lib/api";
import type { Skill } from "../lib/types";
import { listNames, plural } from "../lib/ui";
import { useConfirm } from "../components/overlay";
import { useActions, useData } from "./store";

/** Skill-level commands shared by the Library, My Skills, the skill sheet, Updates and the command palette. */
export function useSkillActions() {
  const { inventory, settings, editors, mySkills, updates } = useData();
  const { run, rescan, refreshMySkills, checkUpdates, setInventory } = useActions();
  const confirm = useConfirm();

  const editorName = settings?.editor ?? editors?.[0]?.name ?? "Editor";
  const mineDir = mySkills?.displayDir ?? settings?.mySkillsDir ?? "~/Skills";

  const remove = useCallback(
    async (skill: Skill) => {
      if (skill.readOnly) {
        toast(`${skill.name} comes from a plugin`, { description: "Uninstall the plugin in its agent to remove it." });
        return false;
      }
      const links = skill.locations.filter((l) => l.kind === "link").length;
      const copies = skill.locations.filter((l) => l.kind === "directory" || l.kind === "canonical").length;
      const agents = skill.presence.filter((p) => p.presence !== "absent" && p.presence !== "broken").length;
      const ok = await confirm({
        title: `Move “${skill.name}” to the Trash?`,
        message: (
          <>
            {skill.origin === "mine"
              ? `Its folder in ${mineDir} moves to the Trash and the deletion shows up as a change to commit. `
              : copies
                ? `${plural(copies, "folder")} will move to the Trash${links ? ` and ${plural(links, "link")} will be removed` : ""}. `
                : ""}
            {agents ? `${plural(agents, "agent")} will stop seeing it. ` : ""}You can put it back from the Trash.
          </>
        ),
        confirmLabel: "Move to Trash",
        destructive: true,
      });
      if (!ok) return false;
      const done = await run(() => api.removeSkill(skill.id), `Moved ${skill.name} to the Trash`);
      if (done) void refreshMySkills();
      return done;
    },
    [confirm, run, refreshMySkills, mineDir],
  );

  const makeMine = useCallback(
    async (skill: Skill) => {
      const upstream = skill.source && (skill.source.kind === "github" || skill.source.kind === "git") ? skill.source.source : null;
      const ok = await confirm({
        title: `Make “${skill.name}” yours?`,
        message: (
          <>
            It moves into {mineDir}, where you can edit it and keep it under version control.
            {upstream ? ` It will stop receiving updates from ${upstream}.` : ""} Every agent keeps seeing it.
          </>
        ),
        confirmLabel: "Make It Mine",
      });
      if (!ok) return false;
      try {
        await api.makeMine(skill.id);
        await Promise.all([rescan({ quiet: true }), refreshMySkills()]);
        toast.success(`${skill.name} is now in ${mineDir}`);
        return true;
      } catch (e) {
        toast.error(`Couldn't move ${skill.name}`, { description: errorMessage(e) });
        return false;
      }
    },
    [confirm, rescan, refreshMySkills, mineDir],
  );

  const openInEditor = useCallback((skill: Skill) => {
    void api.openInEditor(skill.id).catch((e) => toast.error(`Couldn't open ${skill.name}`, { description: errorMessage(e) }));
  }, []);

  const reveal = useCallback((path: string) => {
    void api.reveal(path).catch((e) => toast.error(errorMessage(e)));
  }, []);

  const byId = useCallback((id: string) => inventory?.skills.find((s) => s.id === id) ?? null, [inventory]);
  const nameOf = useCallback((id: string) => inventory?.skills.find((s) => s.id === id)?.name ?? id, [inventory]);

  /**
   * Update skills that have an update available. Clean ones update straight away; skills edited since
   * install need one confirmation because updating overwrites the edits. `onBusy` reports progress per batch.
   */
  const update = useCallback(
    async (ids: string[], onBusy?: (ids: string[], busy: boolean) => void) => {
      const avail = (updates ?? []).filter((u) => u.status === "available" && ids.includes(u.id));
      const clean = avail.filter((u) => !u.locallyModified).map((u) => u.id);
      const edited = avail.filter((u) => u.locallyModified).map((u) => u.id);
      const batch = async (list: string[], force: boolean) => {
        onBusy?.(list, true);
        try {
          const r = await api.updateSkills(list, force);
          if (r.ok.length) toast.success(r.ok.length === 1 ? `Updated ${nameOf(r.ok[0])}` : `Updated ${r.ok.length} skills`);
          for (const e of r.errors) toast.error(`Couldn't update ${nameOf(e.id)}`, { description: e.message });
        } catch (e) {
          toast.error("Update failed", { description: errorMessage(e) });
        } finally {
          onBusy?.(list, false);
        }
      };
      if (clean.length) await batch(clean, false);
      if (edited.length) {
        const one = edited.length === 1;
        const ok = await confirm({
          title: one ? `Overwrite your changes to “${nameOf(edited[0])}”?` : `Overwrite local edits in ${plural(edited.length, "skill")}?`,
          message: one
            ? "You edited this skill after installing it. Updating replaces your edits with the latest version from upstream."
            : `${listNames(edited.map(nameOf))} were edited after installing. Updating replaces those edits with the upstream version.`,
          confirmLabel: one ? "Update Anyway" : "Overwrite",
          destructive: true,
        });
        if (ok) await batch(edited, true);
      }
      await Promise.all([checkUpdates(false), rescan({ quiet: true })]);
    },
    [updates, confirm, checkUpdates, rescan, nameOf],
  );

  /** Link skills into every active agent; skills only in one agent's folder are adopted into the shared store first. */
  const shareWithAll = useCallback(
    async (skills: Skill[]) => {
      const failures: string[] = [];
      let inv = null;
      for (const s of skills) {
        try {
          inv = await api.setLinkAll(s.id, true);
        } catch (e) {
          failures.push(`${s.name}: ${errorMessage(e)}`);
        }
      }
      if (inv) setInventory(inv);
      const done = skills.length - failures.length;
      if (failures.length) {
        toast.error(done ? `${failures.length} of ${skills.length} couldn't be shared` : `Couldn't share ${skills.length === 1 ? skills[0].name : "these skills"}`, {
          description: failures.slice(0, 3).join("\n") + (failures.length > 3 ? `\n…and ${failures.length - 3} more` : ""),
        });
      }
      if (done) toast.success(done === 1 && skills.length === 1 ? `Every agent can now use ${skills[0].name}` : `Shared ${plural(done, "skill")} with every agent`);
      return failures.length === 0;
    },
    [setInventory],
  );

  return { remove, makeMine, openInEditor, reveal, update, shareWithAll, editorName, mineDir, byId };
}
