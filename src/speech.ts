// Text-to-speech using the browser's built-in speechSynthesis (temporary;
// a higher-quality voice comes in a later stage).
import { useSyncExternalStore } from 'react';

export type Segment = { id: string; text: string; lang?: 'he' | 'en' };
export type Speed = 'slow' | 'normal' | 'fast';

const RATES: Record<Speed, number> = { slow: 0.7, normal: 0.95, fast: 1.2 };

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

let token = 0;
// Keep a reference so the utterance is not garbage-collected mid-speech (Chrome bug).
let activeUtterance: SpeechSynthesisUtterance | null = null;

export const speech = {
  supported: !!synth,

  /** Read a list of segments one after another, highlighting each. */
  speak(segments: Segment[]) {
    if (!synth) return;
    const wasBusy = synth.speaking || synth.pending;
    this.stop();
    const my = ++token;
    let i = 0;
    const next = () => {
      if (my !== token) return;
      if (i >= segments.length) {
        activeUtterance = null;
        setCurrent(null);
        return;
      }
      const seg = segments[i++];
      const u = new SpeechSynthesisUtterance(seg.text);
      if (seg.lang === 'en') {
        u.lang = 'en-US';
        if (englishVoice) u.voice = englishVoice;
      } else {
        u.lang = 'he-IL';
        if (voice) u.voice = voice;
      }
      u.rate = RATES[speed];
      u.onend = () => next();
      u.onerror = () => next();
      activeUtterance = u;
      setCurrent(seg.id);
      synth.speak(u);
    };
    // Safari sometimes drops an utterance that is queued right after cancel().
    if (wasBusy) setTimeout(next, 80);
    else next();
  },

  stop() {
    token++;
    activeUtterance = null;
    if (synth && (synth.speaking || synth.pending)) synth.cancel();
    if (currentId !== null) setCurrent(null);
  },

  getSpeed: () => speed,
  setSpeed(s: Speed) {
    speed = s;
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
