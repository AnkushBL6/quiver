import { useCallback, useEffect, useState, type RefObject } from "react";
import { hasMod } from "./ui";

/** ⌘F / Ctrl+F focuses the given search field. */
export function useSearchShortcut(ref: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (hasMod(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        if (document.querySelector('[role="dialog"]')) return;
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** A UI preference persisted in localStorage under `quiver.<key>`. */
export function usePersistent<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`quiver.${key}`);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T) => {
      setV(next);
      try {
        localStorage.setItem(`quiver.${key}`, JSON.stringify(next));
      } catch {
        /* private mode */
      }
    },
    [key],
  );
  return [v, set];
}
