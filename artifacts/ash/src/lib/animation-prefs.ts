import { useSyncExternalStore } from "react";

export type AnimationPrefs = {
  background: boolean;
  cursor: boolean;
  effects: boolean;
};

const STORAGE_KEY = "nadburn:anim-prefs:v1";

const DEFAULTS: AnimationPrefs = {
  background: true,
  cursor: true,
  effects: true,
};

function readFromStorage(): AnimationPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      background: typeof parsed.background === "boolean" ? parsed.background : DEFAULTS.background,
      cursor: typeof parsed.cursor === "boolean" ? parsed.cursor : DEFAULTS.cursor,
      effects: typeof parsed.effects === "boolean" ? parsed.effects : DEFAULTS.effects,
    };
  } catch {
    return DEFAULTS;
  }
}

let current: AnimationPrefs = readFromStorage();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function applySideEffects(prefs: AnimationPrefs) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  // Class-gated CSS: when the cursor is off, we want the system cursor back.
  // index.css scopes its `cursor: none` rule to `html.custom-cursor-on`.
  html.classList.toggle("custom-cursor-on", prefs.cursor);
}

applySideEffects(current);

export function getAnimationPrefs(): AnimationPrefs {
  return current;
}

export function setAnimationPref<K extends keyof AnimationPrefs>(
  key: K,
  value: AnimationPrefs[K],
) {
  current = { ...current, [key]: value };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    } catch {
      // localStorage can throw in private mode / disabled — silently degrade.
    }
  }
  applySideEffects(current);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return current;
}

function getServerSnapshot() {
  return DEFAULTS;
}

export function useAnimationPrefs(): AnimationPrefs {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
