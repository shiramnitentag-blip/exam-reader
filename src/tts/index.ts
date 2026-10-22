// Which voice service to use, and its settings (kept only on this device).
import { db } from '../db';
import { AzureProvider } from './azure';
import type { TTSProvider, VoiceLang } from './types';

export type TTSSettings = {
  provider: 'azure';
  azureKey: string;
  azureRegion: string;
  voiceHe: string;
  voiceEn: string;
};

export const DEFAULT_TTS: TTSSettings = {
  provider: 'azure',
  azureKey: '',
  azureRegion: '',
  voiceHe: 'he-IL-HilaNeural',
  voiceEn: 'en-US-JennyNeural',
};

export async function loadTTSSettings(): Promise<TTSSettings> {
  const s = await db.getMeta<Partial<TTSSettings>>('tts');
  return { ...DEFAULT_TTS, ...(s ?? {}) };
}

export async function saveTTSSettings(s: TTSSettings) {
  await db.setMeta('tts', s);
}

/** The voice service, or null if it is not set up yet. */
export function providerFor(s: TTSSettings): TTSProvider | null {
  if (s.provider === 'azure' && s.azureKey.trim() && s.azureRegion.trim()) return new AzureProvider(s.azureKey.trim(), s.azureRegion);
  return null;
}

export function voiceFor(s: Pick<TTSSettings, 'voiceHe' | 'voiceEn'>, lang: VoiceLang) {
  return lang === 'en' ? s.voiceEn : s.voiceHe;
}

/** The name a ready-made voice file is saved under: the voice and the exact words spoken. */
export function audioKey(voice: string, text: string) {
  return `${voice}|${text}`;
}

export { TTSError } from './types';
export type { TTSProvider, VoiceInfo, VoiceLang } from './types';
