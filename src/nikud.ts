// Adding nikud: Dicta first; texts Dicta could not do go to Claude (the fallback method).
import { addNikud, nikudOptions, type Progress } from './claude';
import { DictaError, dictaText, dictaWords } from './dicta';
import { mergeNikud, stripNikud } from './model';

export type NikudRun = {
  /** id → vocalized text */
  result: Record<string, string>;
  byDicta: number;
  byClaude: number;
  /** Why Dicta was not used for everything (shown to the teacher), if it was not. */
  dictaProblem?: string;
};

const usable = (text: string, voc: string | undefined) => !!voc && mergeNikud(text, voc).matched > 0;

export async function vocalizeTexts(
  apiKey: string,
  texts: { id: string; text: string }[],
  onDetail: (detail: string) => void,
  signal?: AbortSignal,
): Promise<NikudRun> {
  const run: NikudRun = { result: {}, byDicta: 0, byClaude: 0 };
  const total = texts.length;

  // 1. Dicta, a few texts at a time. If Dicta can't be reached, stop asking it.
  let done = 0;
  let down: string | undefined;
  let other: string | undefined;
  const queue = [...texts];
  onDetail('דִּיקְטָה מְנַקֶּדֶת…');
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let t = queue.shift(); t && !down; t = queue.shift()) {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        try {
          const voc = dictaText(await dictaWords(t.text, { signal }));
          if (usable(t.text, voc)) {
            run.result[t.id] = voc;
            run.byDicta++;
          }
        } catch (e) {
          if (signal?.aborted) throw e;
          if (e instanceof DictaError && e.down) down = e.message;
          else other = e instanceof Error ? e.message : String(e);
        }
        done++;
        onDetail(`דִּיקְטָה: ${done} מִתּוֹךְ ${total} קְטָעִים`);
      }
    }),
  );

  // 2. Claude for the rest (and one more try for texts that still came back unusable).
  let rest = texts.filter((t) => !(t.id in run.result));
  if (rest.length > 0) {
    run.dictaProblem = down ?? other ?? 'דִּיקְטָה לֹא הִצְלִיחָה לְנַקֵּד חֵלֶק מֵהַקְּטָעִים';
    for (let attempt = 0; attempt < 2 && rest.length > 0; attempt++) {
      const n = rest.length;
      onDetail(attempt === 0 ? `Claude מְנַקֵּד ${n} קְטָעִים (שִׁיטָה חֲלוּפִית)` : `מְנַסָּה שׁוּב ${n} קְטָעִים`);
      const res = await addNikud(
        apiKey,
        rest,
        (p: Progress) => attempt === 0 && onDetail(p.phase === 'thinking' ? 'Claude קוֹרֵא… (שִׁיטָה חֲלוּפִית)' : `Claude: ${p.found} מִתּוֹךְ ${n} קְטָעִים`),
        signal,
      );
      for (const t of rest)
        if (usable(t.text, res[t.id])) {
          run.result[t.id] = res[t.id];
          run.byClaude++;
        }
      rest = rest.filter((t) => !(t.id in run.result));
    }
  }
  return run;
}

/** A short note for the teacher when (part of) the nikud was done by Claude instead of Dicta. */
export function fallbackNote(run: NikudRun): string | null {
  if (run.byClaude === 0) return null;
  const part = run.byDicta > 0 ? `${run.byClaude} קְטָעִים נֻקְּדוּ` : 'הַנִּקּוּד נַעֲשָׂה';
  return `${part} בַּשִּׁיטָה הַחֲלוּפִית (Claude), כִּי ${run.dictaProblem ?? 'דִּיקְטָה לֹא הָיְתָה זְמִינָה'}.`;
}

export type WordOption = { nikud: string; meaning: string };

/**
 * Other ways to vocalize one word in its sentence: from Dicta (it returns them per word), or from
 * Claude if Dicta is not available. `nth` = which appearance of the word in the sentence.
 */
export async function wordOptions(
  apiKey: string | undefined,
  word: string,
  sentence: string,
  nth: number,
): Promise<{ options: WordOption[]; fallback: boolean }> {
  const plainSentence = stripNikud(sentence);
  try {
    const words = await dictaWords(plainSentence, { timeoutMs: 12000 });
    const same = words.filter((w) => !w.sep && stripNikud(w.word) === word);
    const hit = same[nth] ?? same[0];
    if (hit && hit.options.length > 0) {
      const seen = new Set<string>();
      const options = hit.options.filter((o) => !seen.has(o) && seen.add(o)).slice(0, 8);
      return { options: options.map((nikud) => ({ nikud, meaning: '' })), fallback: false };
    }
  } catch {
    /* Dicta not available: Claude below */
  }
  if (!apiKey) throw new Error('no-key');
  return { options: await nikudOptions(apiKey, word, plainSentence.slice(0, 600)), fallback: true };
}
