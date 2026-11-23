import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { FileArchive } from "lucide-react";
import { onFileDrop } from "./lib/api";
import { hasMod } from "./lib/ui";
import { StoreProvider, useActions, useData, useNav } from "./state/store";
import { ConfirmProvider } from "./components/overlay";
import { SIDEBAR_ORDER, Sidebar } from "./components/Sidebar";
import { CommandPalette } from "./components/CommandPalette";
import { Button, EmptyState } from "./components/ui";
import { LibraryView } from "./views/Library";
import { MatrixView } from "./views/Matrix";
import { AgentsView } from "./views/Agents";
import { UpdatesView } from "./views/Updates";
import { DiscoverView } from "./views/Discover";
import { HealthView } from "./views/Health";
import { SettingsView } from "./views/Settings";
import { InstallSheet } from "./views/InstallSheet";
import { Onboarding } from "./views/Onboarding";
import { MySkillsView } from "./views/MySkills";
import { NewSkillSheet } from "./views/NewSkillSheet";

export default function App() {
  return (
    <StoreProvider>
      <ConfirmProvider>
        <Shell />
        <Toaster
          position="bottom-center"
          theme="system"
          gap={6}
          offset={16}
          visibleToasts={3}
          duration={2600}
          toastOptions={{
            unstyled: true,
            classNames: {
              toast:
                "flex w-auto max-w-[420px] items-start gap-2 rounded-[10px] bg-[var(--q-menu)] px-3 py-2 text-[12px] leading-snug text-fg shadow-pop backdrop-blur-xl whitespace-pre-line",
              title: "font-medium",
              description: "text-[11.5px] text-fg-2",
              icon: "mt-[1px] shrink-0 [&_svg]:h-[14px] [&_svg]:w-[14px]",
              success: "[&_[data-icon]]:text-green",
              error: "[&_[data-icon]]:text-red",
            },
          }}
        />
      </ConfirmProvider>
    </StoreProvider>
  );
}

function Shell() {
  const { nav, go, openInstall, setPaletteOpen, paletteOpen, install, setNewSkillOpen } = useNav();
  const { rescan } = useActions();
  const { loadError, inventory } = useData();
  const [dragging, setDragging] = useState(false);

  // Global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!hasMod(e) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;
      if (k === "n") {
        e.preventDefault();
        if (e.shiftKey) openInstall();
        else setNewSkillOpen(true);
      } else if (k === "r" && !e.shiftKey) {
        e.preventDefault();
        void rescan();
      } else if (e.key === ",") {
        e.preventDefault();
        go("settings");
      } else if (/^[1-9]$/.test(e.key) && SIDEBAR_ORDER[Number(e.key) - 1]) {
        e.preventDefault();
        go(SIDEBAR_ORDER[Number(e.key) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, openInstall, rescan, setPaletteOpen, paletteOpen, setNewSkillOpen]);

  // Unfocused window: selection highlights turn gray, like AppKit.
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => root.classList.toggle("inactive", !document.hasFocus());
    sync();
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
    };
  }, []);

  // Drag a folder or .zip onto the window (Tauri only).
  useEffect(
    () =>
      onFileDrop({
        over: setDragging,
        drop: (paths) => openInstall({ input: paths[0], autoResolve: true }),
      }),
    [openInstall],
  );

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden border-l border-[rgba(0,0,0,0.12)] bg-surface dark:border-[rgba(0,0,0,0.5)]">
        {loadError && !inventory ? (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState title="Couldn't scan your skills" action={<Button onClick={() => void rescan()}>Try again</Button>}>
              {loadError}
            </EmptyState>
          </div>
        ) : (
          <div key={nav.view} className="min-h-0 flex-1">
            {nav.view === "library" && <LibraryView />}
            {nav.view === "mine" && <MySkillsView />}
            {nav.view === "matrix" && <MatrixView />}
            {nav.view === "agents" && <AgentsView />}
            {nav.view === "updates" && <UpdatesView />}
            {nav.view === "discover" && <DiscoverView />}
            {nav.view === "health" && <HealthView />}
            {nav.view === "settings" && <SettingsView />}
          </div>
        )}
        {dragging && !install.open && (
          <div className="anim-fade pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-[12px] border-[3px] border-accent bg-[color-mix(in_srgb,var(--q-surface)_90%,transparent)]">
            <div className="text-center">
              <FileArchive size={28} strokeWidth={1.4} className="mx-auto text-fg-3" />
              <div className="mt-2 text-[15px] font-semibold">Drop to Install</div>
              <div className="text-[12px] text-fg-2">A skill folder, a folder of skills, or a .zip</div>
            </div>
          </div>
        )}
      </main>
      <InstallSheet />
      <NewSkillSheet />
      <CommandPalette />
      <Onboarding />
    </div>
  );
}
