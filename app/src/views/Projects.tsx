// Projects: repos that keep their own pinned copies of skills. The list of projects, or one project's page.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronRight, Folder, FolderGit2, Plus } from "lucide-react";
import { isTauri } from "../lib/api";
import type { ProjectSummary } from "../lib/types";
import { cx, plural } from "../lib/ui";
import { useData, useNav } from "../state/store";
import { usePinActions } from "../state/pinActions";
import { Tag } from "../components/SkillGrid";
import { Button, EmptyState, Skeleton, Toolbar, ToolbarTitle } from "../components/ui";
import { BranchTag, ProjectPage } from "./ProjectPage";

export function ProjectsView() {
  const { projects } = useData();
  const { nav, go } = useNav();
  const open = nav.selectedId ? projects?.find((p) => p.path === nav.selectedId) : undefined;

  // A link to a project that isn't registered (any more): back to the list.
  useEffect(() => {
    if (projects && nav.selectedId && !open) go("projects", { selectedId: null });
  }, [projects, nav.selectedId, open, go]);

  if (open) return <ProjectPage key={open.path} summary={open} />;
  return <ProjectList />;
}

function ProjectList() {
  const { projects } = useData();
  const { go } = useNav();
  const { addProject } = usePinActions();
  const [adding, setAdding] = useState(false);
  const sorted = useMemo(() => [...(projects ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [projects]);
  const problems = sorted.reduce((n, p) => n + p.problemCount, 0);

  const add = async () => {
    setAdding(true);
    await addProject();
    setAdding(false);
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-[var(--q-canvas)]">
      <Toolbar className="bg-surface">
        <ToolbarTitle sub={projects ? (sorted.length ? [plural(sorted.length, "project"), problems ? `${plural(problems, "pin")} need${problems === 1 ? "s" : ""} attention` : null].filter(Boolean).join(" · ") : " ") : " "}>
          Projects
        </ToolbarTitle>
        <div data-tauri-drag-region className="flex-1" />
        <Button size="lg" icon={<Plus size={14} strokeWidth={2.2} />} loading={adding} onClick={() => void add()}>
          Add Project…
        </Button>
      </Toolbar>

      <div className="scroll min-h-0 flex-1">
        {!projects ? (
          <div className="mx-auto grid max-w-[940px] gap-3 px-6 pt-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-[104px] rounded-[10px]" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState
            className="pt-24"
            wide
            icon={<FolderGit2 />}
            title="Pin Skills to a Project"
            action={
              <Button size="lg" variant="primary" icon={<Plus size={14} strokeWidth={2.2} />} loading={adding} onClick={() => void add()}>
                Add Project…
              </Button>
            }
          >
            Pin a skill to a repo so a release branch keeps the exact version it was tested with, while your other projects keep using the shared one.
            {isTauri && <span className="mt-2 block text-fg-3">You can also drop a project folder on this window.</span>}
          </EmptyState>
        ) : (
          <div className="mx-auto max-w-[940px] px-6 pt-5 pb-10">
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gridAutoRows: "1fr" }}>
              {sorted.map((p) => (
                <ProjectCard key={p.path} project={p} onOpen={() => go("projects", { selectedId: p.path })} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectCard({ project: p, onOpen }: { project: ProjectSummary; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-card
      aria-label={`${p.name}, ${p.displayPath}, ${plural(p.pinCount, "pinned skill")}${p.problemCount ? `, ${plural(p.problemCount, "pin")} need attention` : ""}`}
      className="skill-card group flex min-h-[104px] w-full min-w-0 flex-col rounded-[10px] px-4 pt-3.5 pb-3 text-left"
    >
      <span className="flex w-full min-w-0 items-start gap-2.5">
        <span
          aria-hidden
          className="mt-[1px] inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[7px] text-fg-2"
          style={{ background: "var(--q-tile)", boxShadow: "var(--q-tile-ring)" }}
        >
          <Folder size={15} strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] leading-[18px] font-semibold tracking-[-0.01em]">{p.name}</span>
          <span className="block truncate font-mono text-[11.5px] leading-[16px] text-fg-3" title={p.path}>
            {p.displayPath}
          </span>
        </span>
        <ChevronRight size={14} strokeWidth={2.4} className="mt-[3px] shrink-0 text-fg-3 transition-transform duration-150 group-hover:translate-x-0.5" />
      </span>
      <span className="mt-auto flex w-full min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 pt-3.5">
        <BranchTag project={p} />
        <span className={cx("px-0.5 text-[12px]", p.pinCount ? "text-fg-2" : "text-fg-3")}>{p.pinCount ? plural(p.pinCount, "pinned skill") : "No pins yet"}</span>
        {!p.exists ? (
          <Tag tone="red" icon={<AlertTriangle size={11.5} strokeWidth={2.3} />}>
            Folder missing
          </Tag>
        ) : p.problemCount > 0 ? (
          <Tag tone="amber" icon={<AlertTriangle size={11.5} strokeWidth={2.3} />}>
            {plural(p.problemCount, "pin")} need{p.problemCount === 1 ? "s" : ""} attention
          </Tag>
        ) : null}
      </span>
    </button>
  );
}
