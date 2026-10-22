// Reading aloud. Ready-made voice files (made in advance with the voice service, saved on the
// device) are played when they exist; otherwise the browser's built-in voice reads the text.
import { useSyncExternalStore } from 'react';
import { db } from './db';
import { SILENCE } from './tts/silence';

/** text: what is shown; say: what the voice reads, if different (the vocalized version, for exact pronunciation). */
export type Segment = { id: string; text: string; lang?: 'he' | 'en'; say?: string };
export type Speed = 'slow' | 'normal' | 'fast';

const RATES: Record<Speed, number> = { slow: 0.7, normal: 0.95, fast: 1.2 };
// Ready-made files are played faster or slower; no new files are needed for another speed.
const FILE_RATES: Record<Speed, number> = { slow: 0.75, normal: 1, fast: 1.25 };

const synth: SpeechSynthesis | undefined =
  typeof window !== 'undefined' ? window.speechSynthesis : undefined;

let voice: SpeechSynthesisVoice | null = null; // Hebrew
let englishVoice: SpeechSynthesisVoice | null = null;
let voicesChecked = false;

function pickVoice() {
  if (!synth) return;
  const voices = synth.getVoices();
  if (voices.length === 0) return;
  voicesChecked = true;
  const langOf = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace('_', '-');
  const hebrew = voices.filter((v) => langOf(v).startsWith('he'));
  voice =
    hebrew.find((v) => /carmit/i.test(v.name) && /enhanced|premium/i.test(v.name)) ??
    hebrew.find((v) => /carmit/i.test(v.name)) ??
    hebrew.find((v) => v.localService) ??
    hebrew[0] ??
    null;
  const english = voices.filter((v) => langOf(v).startsWith('en'));
  englishVoice =
    english.find((v) => langOf(v) === 'en-us' && v.localService) ??
    english.find((v) => langOf(v) === 'en-us') ??
    english.find((v) => v.localService) ??
    english[0] ??
    null;
  emit();
}

// ---- tiny store so React can show which segment is being read ----
let currentId: string | null = null;
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function setCurrent(id: string | null) {
  currentId = id;
  emit();
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

let speed: Speed = 'normal';
try {
  const saved = localStorage.getItem('speed');
  if (saved === 'slow' || saved === 'normal' || saved === 'fast') speed = saved;
} catch {
  /* storage may be unavailable */
}

/**
 * The text the voice actually says. The Hebrew voice reads marks such as " and ' as English
 * words, so in Hebrew they are left out (only from the sound; the screen shows the original).
 * Acronyms (צה"ל) and quotes ("הים") read fine without them.
 */
export function spokenText(seg: Segment): string {
  const text = seg.say ?? seg.text;
  if (seg.lang === 'en') return text;
  return holamMale(text)
    .replace(/["'`‘’“”„׳״]/g, '') // quotes, geresh, gershayim
    .replace(/[*•_#|~^]/g, ' ') // symbols the voice would name
    .replace(/(\D)\/|\/(\D)/g, '$1 $2') // a slash between words (ו/או), but not in numbers (3/4)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * For the voice only: a ו that is just the "o" vowel (וֹ after a letter with no vowel of its own)
 * is written the classic way, with the holam on the letter before it: תּוֹרָה → תֹּרָה.
 * Azure's Hebrew voice reads "וֹ" as "vo" (תּוֹרָה sounded like "tovra"). A ו that is a real
 * consonant (מִצְוֹת, after a vowel) is not changed.
 */
export function holamMale(text: string): string {
  return text.normalize('NFD').replace(/([א-ת])([\u05BC\u05BF\u05C1\u05C2]*)ו\u05B9/g, '$1$2\u05B9').normalize('NFC');
}

let token = 0;
// Keep a reference so the utterance is not garbage-collected mid-speech (Chrome bug).
let activeUtterance: SpeechSynthesisUtterance | null = null;

// ---------- ready-made voice files ----------

/** Which voices the ready-made files were made with (from the teacher's settings). */
let fileVoices: { he: string; en: string } | null = null;
const urls = new Map<string, string>(); // file name → address in memory, for instant playback
let player: HTMLAudioElement | null = null;

const fileKey = (seg: Segment) =>
  fileVoices ? `${seg.lang === 'en' ? fileVoices.en : fileVoices.he}|${spokenText(seg)}` : null;

function getPlayer() {
  if (!player) {
    player = new Audio();
    player.preload = 'auto';
  }
  return player;
}

/**
 * The iPad lets a page play sound only after a tap; playing silence inside the tap unlocks the
 * player for the files that follow. Resolves when the silence has finished.
 */
function unlock(): Promise<void> {
  const p = getPlayer();
  if (p.dataset.unlocked) return Promise.resolve();
  p.src = SILENCE;
  return p.play().then(
    () =>
      new Promise<void>((resolve) => {
        p.dataset.unlocked = '1';
        p.onended = () => resolve();
        setTimeout(resolve, 200);
      }),
    () => {},
  );
}

async function fileUrl(seg: Segment): Promise<string | null> {
  const key = fileKey(seg);
  if (!key) return null;
  const known = urls.get(key);
  if (known) return known;
  try {
    const blob = await db.getAudio(key);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.set(key, url);
    if (urls.size > 400) {
      // keep memory small: forget the oldest
      const [first] = urls.keys();
      URL.revokeObjectURL(urls.get(first)!);
      urls.delete(first);
    }
    return url;
  } catch {
    return null;
  }
}

/** Plays a file; resolves true when it played to the end (or was stopped), false if it could not play. */
function playFile(url: string, my: number): Promise<boolean> {
  return new Promise((resolve) => {
    const p = getPlayer();
    let started = false;
    const finish = (ok: boolean) => {
      clearTimeout(watchdog);
      p.onended = null;
      p.onerror = null;
      p.onpause = null;
      p.onplaying = null;
      resolve(ok);
    };
    // If the sound has not started after a few seconds, give up and use the built-in voice.
    const watchdog = setTimeout(() => {
      if (!started) {
        p.pause();
        finish(false);
      }
    }, 4000);
    p.onplaying = () => {
      started = true;
    };
    p.onended = () => finish(true);
    p.onerror = () => {
      if (my !== token) return finish(true);
      bad.add(url);
      finish(false);
    };
    p.onpause = () => {
      if (my !== token) finish(true); // stopped
    };
    p.src = url;
    p.defaultPlaybackRate = FILE_RATES[speed]; // Safari resets the rate when a new file loads
    p.playbackRate = FILE_RATES[speed];
    p.play().catch(() => {
      if (my !== token) return finish(true);
      finish(false);
    });
  });
}
let synthUnlocked = false;
const bad = new Set<string>(); // files that failed to play: use the built-in voice for them

function playSynth(seg: Segment, my: number): Promise<void> {
  return new Promise((resolve) => {
    if (!synth || my !== token) return resolve();
    const u = new SpeechSynthesisUtterance(spokenText(seg));
    if (seg.lang === 'en') {
      u.lang = 'en-US';
      if (englishVoice) u.voice = englishVoice;
    } else {
      u.lang = 'he-IL';
      if (voice) u.voice = voice;
    }
    u.rate = RATES[speed];
    u.onend = () => resolve();
    u.onerror = () => resolve();
    activeUtterance = u;
    synth.speak(u);
  });
}

export const speech = {
  supported: !!synth,

  /** Tells the reader which voices the ready-made files were made with. */
  setFileVoices(v: { he: string; en: string } | null) {
    fileVoices = v;
  },

  /** Loads the files of these sentences into memory ahead of time, so playback starts at once. */
  preload(segments: Segment[]) {
    void Promise.all(segments.map((s) => fileUrl(s)));
  },

  /** Read a list of segments one after another, highlighting each. */
  speak(segments: Segment[], opts: { builtInOnly?: boolean } = {}): Promise<{ files: number; builtIn: number }> {
    const count = { files: 0, builtIn: 0 };
    // Without ready-made files, only the built-in voice is used (and it starts inside the tap).
    if (!fileVoices) opts = { ...opts, builtInOnly: true };
    const wasBusy = !!synth && (synth.speaking || synth.pending);
    this.stop();
    const my = ++token;
    // The built-in voice must also start from a tap on the iPad: say "nothing" now, so it can
    // speak later if a file is missing.
    if (synth && !wasBusy && !opts.builtInOnly && !synthUnlocked) {
      synthUnlocked = true;
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      synth.speak(u);
    }
    // Sound must start inside the tap: play the first file at once if it is already in memory,
    // otherwise unlock the player with silence first.
    const firstKey = segments[0] && !opts.builtInOnly ? fileKey(segments[0]) : null;
    const firstUrl = firstKey ? urls.get(firstKey) : undefined;
    const firstPlay = firstUrl ? (setCurrent(segments[0].id), playFile(firstUrl, my)) : null;
    const unlocked = !firstPlay && !opts.builtInOnly ? unlock() : Promise.resolve();
    return (async () => {
      // Safari sometimes drops an utterance that is queued right after cancel().
      if (wasBusy) await new Promise((r) => setTimeout(r, 80));
      await unlocked;
      for (const [i, seg] of segments.entries()) {
        if (my !== token) return count;
        if (i === 0 && firstPlay) {
          if (await firstPlay) {
            count.files++;
            continue;
          }
          if (my !== token) return count;
          count.builtIn++;
          await playSynth(seg, my);
          continue;
        }
        const url = opts.builtInOnly ? null : await fileUrl(seg);
        if (my !== token) return count;
        setCurrent(seg.id);
        const played = url && !bad.has(url) ? await playFile(url, my) : false;
        if (played) count.files++;
        else if (my === token) {
          count.builtIn++;
          await playSynth(seg, my);
        }
      }
      if (my === token) {
        activeUtterance = null;
        setCurrent(null);
      }
      return count;
    })();
  },

  stop() {
    token++;
    activeUtterance = null;
    if (synth && (synth.speaking || synth.pending)) synth.cancel();
    if (player && !player.paused) player.pause();
    if (currentId !== null) setCurrent(null);
  },

  getSpeed: () => speed,
  setSpeed(s: Speed) {
    speed = s;
    if (player) {
      player.defaultPlaybackRate = FILE_RATES[s];
      player.playbackRate = FILE_RATES[s];
    }
    try {
      localStorage.setItem('speed', s);
    } catch {
      /* ignore */
    }
    emit();
  },

  hasHebrewVoice: () => !voicesChecked || voice !== null,
};

export function useSpeaking(): string | null {
  return useSyncExternalStore(subscribe, () => currentId);
}

export function useSpeed(): Speed {
  return useSyncExternalStore(subscribe, () => speed);
}

/** True if any of the given segment ids is being read right now. */
export function useSpeakingAny(ids: string[]): boolean {
  const cur = useSpeaking();
  return cur !== null && ids.includes(cur);
}

// Look for a Hebrew voice. This must stay at the end of the file: on iPad the voices
// are ready immediately, and pickVoice() uses the store defined above.
if (synth) {
  pickVoice();
  synth.addEventListener?.('voiceschanged', pickVoice);
}
