// App updates are manual. The installed version stays until the teacher taps "update now" in the
// settings; the student side never changes version by itself (see sw-guard in vite.config.ts).
import { useSyncExternalStore } from 'react';

declare const __APP_BUILD_ID__: string;
const BASE = import.meta.env.BASE_URL; // "/exam-reader/"

type State = { kind: 'none' } | { kind: 'available'; build: string } | { kind: 'updating' } | { kind: 'failed' };
let state: State = { kind: 'none' };
const listeners = new Set<() => void>();
const set = (s: State) => {
  state = s;
  listeners.forEach((l) => l());
};

export function startUpdates() {
  if (!('serviceWorker' in navigator)) return;
  // Keep the address the app is installed with: it carries the approval of the running version.
  // Not installed yet, or installed before manual updates: register this version, approved.
  const current = navigator.serviceWorker.controller?.scriptURL;
  const url =
    current && new URL(current).searchParams.has('g')
      ? current
      : `${BASE}sw.js?g=1&approved=${encodeURIComponent(__APP_BUILD_ID__)}`;
  void navigator.serviceWorker.register(url, { scope: BASE }).catch(() => {});
}

/** Asks the server which version it has (settings screen only, when online). */
export async function checkForUpdate() {
  if (!navigator.onLine || state.kind === 'updating') return;
  try {
    const res = await fetch(`${BASE}version.json?t=${Date.now()}`, { cache: 'no-store' });
    const v = (await res.json()) as { build?: string };
    if (v.build && v.build !== __APP_BUILD_ID__) set({ kind: 'available', build: v.build });
  } catch {
    /* offline or no answer: try next time */
  }
}

/** Installs the new version the teacher approved, then reloads the app. */
export async function installUpdate() {
  if (state.kind !== 'available' || !('serviceWorker' in navigator)) return;
  const build = state.build;
  set({ kind: 'updating' });
  const timer = window.setTimeout(() => set({ kind: 'failed' }), 60_000);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.clearTimeout(timer);
    location.reload();
  });
  try {
    await navigator.serviceWorker.register(`${BASE}sw.js?g=1&approved=${encodeURIComponent(build)}`, { scope: BASE });
  } catch {
    window.clearTimeout(timer);
    set({ kind: 'failed' });
  }
}

export function useUpdateState(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
