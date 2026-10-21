// Keep the screen on during the exam, and ask the browser not to erase our saved data.
import keepAwakeVideo from './keep-awake.mp4'; // tiny silent video, inlined into the code

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

// On iPad the Wake Lock request is sometimes ignored (for example in an app opened from the
// home screen, before iPadOS 18.4). As a backup, a tiny silent, muted, invisible video plays in
// a loop: iPad does not turn the screen off while a video is playing.
const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

let video: HTMLVideoElement | null = null;

function playVideo() {
  if (!isIOS || !wanted) return;
  if (!video) {
    const v = document.createElement('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('aria-hidden', 'true');
    v.src = keepAwakeVideo;
    v.style.cssText =
      'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1';
    // If iPad pauses it (for example while recording), start it again.
    v.addEventListener('pause', () => {
      if (wanted) window.setTimeout(playVideo, 1000);
    });
    document.body.appendChild(v);
    video = v;
  }
  if (video.paused) void video.play().catch(() => {});
}

function wake() {
  void acquire();
  playVideo();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') wake();
});
// Any tap is a chance to restart the screen-on helpers if the system stopped them.
document.addEventListener(
  'pointerdown',
  () => {
    if (wanted) wake();
  },
  { capture: true, passive: true },
);

export function keepScreenOn(on: boolean) {
  wanted = on;
  if (on) {
    wake();
    return;
  }
  if (sentinel) {
    void sentinel.release().catch(() => {});
    sentinel = null;
  }
  video?.pause();
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
