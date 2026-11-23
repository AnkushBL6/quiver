import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { cx } from "../lib/ui";
import { Button } from "./ui";
import { Logo } from "./identity";

// ── Sheet: window-modal panel that drops from the top edge (AppKit sheet) ───

export function Sheet({
  open,
  onClose,
  children,
  width = 560,
  className,
  label,
  dismissable = true,
  maxHeight = "calc(100vh - 76px)",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  className?: string;
  label: string;
  dismissable?: boolean;
  maxHeight?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement | null;
    const t = requestAnimationFrame(() => {
      const el = panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current;
      el?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      // Sheets can stack (a confirm over a skill sheet) and host menus: only the topmost layer reacts.
      if (!panel.current || !isTopLayer(panel.current)) return;
      if (e.key === "Escape" && dismissable) {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && panel.current) {
        const f = panel.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])',
        );
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(t);
      window.removeEventListener("keydown", onKey, true);
      restore.current?.focus?.();
    };
  }, [open, onClose, dismissable]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[52px]">
      <div
        className="anim-fade absolute inset-0 bg-[var(--q-overlay)]"
        onMouseDown={() => dismissable && onClose()}
        aria-hidden
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cx(
          "anim-sheet relative flex flex-col overflow-hidden rounded-[12px] bg-elevated shadow-sheet focus-visible:outline-none",
          className,
        )}
        style={{ width: `min(${width}px, calc(100vw - 40px))`, maxHeight }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** True when `el` is the last modal dialog in the document and no menu is open over it. */
export function isTopLayer(el: HTMLElement) {
  if (document.querySelector("[data-popover]")) return false;
  const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
  return dialogs[dialogs.length - 1] === el;
}

// ── Popover / Menu ───────────────────────────────────────────────────────────

export function Popover({
  anchor,
  open,
  onClose,
  children,
  align = "start",
  className,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "start" | "end" | "center";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !ref.current) return;
    const r = anchor.current.getBoundingClientRect();
    const w = ref.current.offsetWidth;
    const h = ref.current.offsetHeight;
    let x = align === "start" ? r.left : align === "end" ? r.right - w : r.left + r.width / 2 - w / 2;
    x = Math.max(6, Math.min(x, window.innerWidth - w - 6));
    const up = r.bottom + h + 8 > window.innerHeight && r.top - h - 8 > 0;
    setPos({ x, y: up ? r.top - h - 4 : r.bottom + 4, up });
  }, [open, anchor, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", onClose);
    };
  }, [open, onClose, anchor]);

  useEffect(() => {
    if (!open) setPos(null);
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      data-popover
      className={cx(
        "fixed z-[60] min-w-[180px] rounded-[8px] bg-[var(--q-menu)] p-[5px] shadow-pop backdrop-blur-xl",
        pos && "anim-pop",
        className,
      )}
      style={{
        left: pos?.x ?? -9999,
        top: pos?.y ?? -9999,
        ["--origin" as string]: pos?.up ? "bottom" : "top",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  icon,
  children,
  onSelect,
  danger,
  disabled,
  hint,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        "flex h-[22px] w-full items-center gap-2 rounded-[4px] px-2 text-left text-[13px] disabled:opacity-40",
        danger ? "text-red hover:bg-accent hover:text-white" : "text-fg hover:bg-accent hover:text-white",
        "group",
      )}
    >
      {icon && <span className={cx("flex w-4 justify-center", danger ? "group-hover:text-white" : "text-fg-2 group-hover:text-white")}>{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="text-[11px] text-fg-3 group-hover:text-white/70">{hint}</span>}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="mx-2 my-[5px] h-px bg-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-0.5 pb-0.5 text-[11px] font-semibold text-fg-3">{children}</div>;
}

// ── Confirm dialog (promise based) ───────────────────────────────────────────

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
}

const ConfirmCtx = createContext<((o: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...o, resolve })),
    [],
  );
  const close = useCallback(
    (v: boolean) => {
      state?.resolve(v);
      setState(null);
    },
    [state],
  );
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Sheet open={!!state} onClose={() => close(false)} width={300} label={state?.title ?? "Confirm"}>
        {state && (
          <div className="flex flex-col items-center px-5 pt-5 pb-4 text-center">
            <div className="relative">
              <Logo size={52} />
              {state.destructive && (
                <span className="absolute -right-1 -bottom-1 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-elevated">
                  <AlertTriangle size={17} className="text-[var(--q-glyph-amber)]" fill="currentColor" stroke="var(--q-elevated)" strokeWidth={1.6} />
                </span>
              )}
            </div>
            <div className="mt-3 text-[13px] leading-snug font-semibold">{state.title}</div>
            {state.message && <div className="mt-1.5 text-[11.5px] leading-[1.45] text-fg-2">{state.message}</div>}
            <div className="mt-4 flex w-full gap-2">
              <Button size="lg" className="flex-1" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button
                data-autofocus
                size="lg"
                className="flex-1"
                variant={state.destructive ? "danger" : "primary"}
                onClick={() => close(true)}
              >
                {state.confirmLabel ?? "Continue"}
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const c = useContext(ConfirmCtx);
  if (!c) throw new Error("useConfirm outside ConfirmProvider");
  return c;
}
