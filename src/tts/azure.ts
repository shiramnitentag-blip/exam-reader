// Azure Neural TTS through its REST service, with SSML. The key stays on the device.
import { TTSError, type TTSProvider, type VoiceInfo, type VoiceLang } from './types';

const LOCALE: Record<VoiceLang, string> = { he: 'he-IL', en: 'en-US' };
// Good quality and small files; plays on every iPad.
const FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function ssml(text: string, voice: string, lang: VoiceLang): string {
  const locale = LOCALE[lang];
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}"><voice name="${escapeXml(voice)}">${escapeXml(text)}</voice></speak>`;
}

export class AzureProvider implements TTSProvider {
  readonly name = 'Azure';
  constructor(
    private key: string,
    private region: string,
  ) {}

  private base() {
    return `https://${encodeURIComponent(this.region.trim().toLowerCase())}.tts.speech.microsoft.com`;
  }

  private async fail(res: Response): Promise<never> {
    let details = '';
    try {
      details = (await res.text()).slice(0, 200);
    } catch {
      /* no body */
    }
    const retry = Number(res.headers.get('retry-after'));
    const after = Number.isFinite(retry) && retry > 0 ? retry : null;
    if (res.status === 401 || res.status === 403)
      throw new TTSError('מַפְתֵּחַ Azure לֹא נָכוֹן, אוֹ שֶׁהָאֵזוֹר (region) לֹא מַתְאִים לַמַּפְתֵּחַ.', null, details);
    if (res.status === 429) throw new TTSError('יוֹתֵר מִדַּי בַּקָּשׁוֹת ל-Azure בְּבַת אַחַת. מְחַכָּה וּמְנַסָּה שׁוּב…', after ?? 15, details);
    if (res.status === 400) throw new TTSError('Azure לֹא קִבֵּל אֶת הַבַּקָּשָׁה (אוּלַי שֵׁם הַקּוֹל לֹא נָכוֹן).', null, details);
    if (res.status >= 500) throw new TTSError('הַשֵּׁרוּת שֶׁל Azure לֹא זָמִין כָּרֶגַע. נַסִּי שׁוּב מְאֻחָר יוֹתֵר.', after ?? 10, details);
    throw new TTSError(`שְׁגִיאָה מִ-Azure (${res.status}).`, null, details);
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch {
      throw new TTSError('אֵין חִבּוּר ל-Azure. בִּדְקִי אֶת הָאִינְטֶרְנֶט, וְאֶת שֵׁם הָאֵזוֹר (region).', 5);
    }
    if (!res.ok) await this.fail(res);
    return res;
  }

  async synthesize(text: string, voice: string, lang: VoiceLang): Promise<Blob> {
    const res = await this.call(`${this.base()}/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': FORMAT,
      },
      body: ssml(text, voice, lang),
    });
    const blob = await res.blob();
    if (blob.size < 100) throw new TTSError('Azure הֶחֱזִיר קֹבֶץ קוֹל רֵיק.');
    return new Blob([blob], { type: 'audio/mpeg' });
  }

  async listVoices(): Promise<VoiceInfo[]> {
    const res = await this.call(`${this.base()}/cognitiveservices/voices/list`, {
      headers: { 'Ocp-Apim-Subscription-Key': this.key },
    });
    const list = (await res.json()) as { ShortName: string; Locale: string; LocalName?: string; DisplayName?: string; Gender?: string }[];
    return list
      .filter((v) => v.Locale === 'he-IL' || v.Locale.startsWith('en-'))
      .map((v) => ({
        id: v.ShortName,
        name: `${v.LocalName || v.DisplayName || v.ShortName} (${v.Locale})`,
        lang: v.Locale === 'he-IL' ? ('he' as const) : ('en' as const),
        gender: v.Gender,
      }));
  }

  async testConnection(): Promise<void> {
    await this.listVoices();
  }
}
