// Keep the screen on during the exam, and ask the browser not to erase our saved data.

type WakeLockSentinelLike = { release: () => Promise<void>; released?: boolean };

let sentinel: WakeLockSentinelLike | null = null;
let wanted = false;

async function acquire() {
  if (!wanted || document.visibilityState !== 'visible') return;
  const wl = (navigator as Navigator & {
    wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> };
  }).wakeLock;
  if (!wl) return;
  if (sentinel && !sentinel.released) return;
  try {
    sentinel = await wl.request('screen');
  } catch {
    // Not allowed right now (e.g. low battery). We try again next time the page is shown.
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void acquire();
});

export function keepScreenOn(on: boolean) {
  wanted = on;
  if (on) void acquire();
  else if (sentinel) {
    void sentinel.release().catch(() => {});
    sentinel = null;
  }
}

export async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    /* not supported */
  }
}
