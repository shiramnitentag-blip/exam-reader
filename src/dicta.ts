// Dicta's Nakdan (automatic Hebrew nikud). Dicta has no documented API; the request format here
// follows the open-source library dicta-nakdan by Moshe Malka (MIT, github.com/moshejs/dicta-nakdan).
// If Dicta does not answer (error, timeout, or the browser blocks it), the caller falls back to Claude.

const ENDPOINT = 'https://nakdan-2-0.loadbalancer.dicta.org.il/api';

export class DictaError extends Error {
  /** true when Dicta could not be reached at all (network, blocked by the browser, timeout, server error). */
  readonly down: boolean;
  constructor(message: string, down: boolean) {
    super(message);
    this.name = 'DictaError';
    this.down = down;
  }
}

export type DictaWord = { word: string; sep: boolean; options: string[] };

type RawWord = { word: string; sep?: boolean; options?: unknown[] };

const isRaw = (x: unknown): x is RawWord => typeof x === 'object' && x !== null && typeof (x as RawWord).word === 'string';

async function post(text: string, contentType: string, signal: AbortSignal): Promise<Response> {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: JSON.stringify({ task: 'nakdan', genre: 'modern', data: text, addmorph: false, keepqq: false }),
    signal,
  });
}

/** After Dicta could not be reached, don't try again for a while (so each text doesn't wait for a timeout). */
let downUntil = 0;
export const dictaSeemsDown = () => Date.now() < downUntil;

/** Sends one text to Dicta; returns its words, each with the possible vocalizations (best first). */
export async function dictaWords(text: string, opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<DictaWord[]> {
  if (dictaSeemsDown()) throw new DictaError('דִּיקְטָה לֹא הֵגִיבָה לִפְנֵי רֶגַע', true);
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, opts.timeoutMs ?? 20000);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const fail = (msg: string, down: boolean) => {
    if (down) downUntil = Date.now() + 5 * 60_000;
    return new DictaError(msg, down);
  };
  try {
    let res: Response;
    try {
      res = await post(text, 'application/json', ctrl.signal);
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      if (timedOut) throw fail('דִּיקְטָה לֹא עָנְתָה בַּזְּמַן', true);
      // Maybe the browser blocked the request (CORS). A plain-text request needs no permission check.
      try {
        res = await post(text, 'text/plain;charset=UTF-8', ctrl.signal);
      } catch {
        if (opts.signal?.aborted) throw e;
        throw fail(timedOut ? 'דִּיקְטָה לֹא עָנְתָה בַּזְּמַן' : 'אֵין חִבּוּר לְדִיקְטָה', true);
      }
    }
    if (!res.ok) throw fail(`דִּיקְטָה הֶחְזִירָה שְׁגִיאָה ${res.status}`, res.status >= 500 || res.status === 429);
    let raw: unknown;
    try {
      raw = await res.json();
    } catch {
      throw fail(timedOut ? 'דִּיקְטָה לֹא עָנְתָה בַּזְּמַן' : 'תְּשׁוּבָה לֹא צְפוּיָה מִדִּיקְטָה', timedOut);
    }
    if (!Array.isArray(raw) || !raw.every(isRaw)) throw fail('תְּשׁוּבָה לֹא צְפוּיָה מִדִּיקְטָה', false);
    return raw.map((r) => ({
      word: r.word,
      sep: r.sep === true,
      // Dicta marks where a prefix ends with "|" (בְּ|בֵית); it is not part of the word.
      options: r.sep || !Array.isArray(r.options) ? [] : r.options.filter((o): o is string => typeof o === 'string').map((o) => o.replace(/\|/g, '')),
    }));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/** The text with Dicta's first choice for every word (spaces and punctuation as Dicta returned them). */
export function dictaText(words: DictaWord[]): string {
  return words.map((w) => (w.sep || w.options.length === 0 ? w.word : w.options[0])).join('');
}
