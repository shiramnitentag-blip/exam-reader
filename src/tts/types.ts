// The voice layer: every voice service looks the same to the rest of the app.
// To add another service later, write one more provider with this shape and register it in index.ts.

export type VoiceLang = 'he' | 'en';

export type VoiceInfo = { id: string; name: string; lang: VoiceLang; gender?: string };

export interface TTSProvider {
  /** A short name for messages, e.g. "Azure". */
  readonly name: string;
  /** Turns one sentence into a sound file (MP3). */
  synthesize(text: string, voice: string, lang: VoiceLang): Promise<Blob>;
  /** Checks that the key and settings work; throws a TTSError with a Hebrew message if not. */
  testConnection(): Promise<void>;
  /** The voices this service offers for Hebrew and English. */
  listVoices(): Promise<VoiceInfo[]>;
}

/** An error with a message in plain Hebrew, and whether trying again later may help. */
export class TTSError extends Error {
  constructor(
    message: string,
    readonly retryAfterSec: number | null = null,
    readonly details = '',
  ) {
    super(message);
  }
}
