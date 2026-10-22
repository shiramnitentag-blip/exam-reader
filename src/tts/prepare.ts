// "Prepare for exam": make a voice file for everything the student can hear, and save it on the device.
import { db } from '../db';
import { cellId, headerId, sayOf, shown, voiceFor, type Exam, type Item, type Table } from '../model';
import { spokenText, type Segment } from '../speech';
import { segmentsFor } from '../components/Speak';
import { itemSegments } from '../student/StudentApp';
import { PHRASES, questionPhrase } from '../student/phrases';
import { audioKey, providerFor, voiceFor as voiceOf, type TTSSettings } from './index';
import { TTSError, type VoiceLang } from './types';

/** Every table cell and column title can also be tapped alone. */
function cellSegments(t: Table, item: Pick<Item, 'lang' | 'useNikud' | 'readMode'>): Segment[] {
  const out: Segment[] = [];
  const one = (id: string, txt: { text: string; nikud?: string }) => {
    const text = shown(txt, item.useNikud);
    if (text.trim()) out.push(...voiceFor({ id, text, lang: item.lang, say: txt.nikud }, item.readMode));
  };
  t.headers.forEach((h, c) => one(headerId(t, c), h));
  t.rows.forEach((row, r) => row.forEach((cell, c) => one(cellId(t, r, c), cell)));
  return out;
}

/** Everything the student can hear in this exam: sentences, options, table cells and fixed phrases. */
export function examSegments(exam: Exam): Segment[] {
  const out: Segment[] = [{ id: 'exam-title', text: exam.title }];
  for (const b of exam.instructions) out.push(...segmentsFor(shown(b.text, true), b.id, b.lang, 'normal'));
  for (const p of exam.passages) {
    out.push(...segmentsFor(shown(p.title, true), `${p.id}-title`, p.lang, 'normal'));
    out.push(...segmentsFor(shown(p.body, true), `${p.id}-body`, p.lang, 'normal'));
    const asItem = { lang: p.lang, useNikud: true, readMode: 'normal' as const };
    for (const m of p.media ?? []) {
      if (m.kind === 'table') out.push(...cellSegments(m.table, asItem));
      else if (m.caption) out.push(...segmentsFor(shown(m.caption, true), `${m.id}-cap`, p.lang, 'normal'));
    }
  }
  for (const it of exam.items) {
    out.push(...itemSegments(it));
    for (const m of it.media ?? []) if (m.kind === 'table') out.push(...cellSegments(m.table, it));
    out.push({ id: `q-${it.id}`, text: questionPhrase(it.label) });
  }
  for (const text of Object.values(PHRASES)) out.push({ id: 'phrase', text });
  return out;
}

export type AudioJob = { key: string; text: string; voice: string; lang: VoiceLang };

/** The files this exam needs (each different sentence once). */
export function examJobs(exam: Exam, s: Pick<TTSSettings, 'voiceHe' | 'voiceEn'>): AudioJob[] {
  const jobs = new Map<string, AudioJob>();
  for (const seg of examSegments(exam)) {
    const text = spokenText(seg);
    if (!text.trim()) continue;
    const lang: VoiceLang = seg.lang === 'en' ? 'en' : 'he';
    const voice = voiceOf(s, lang);
    const key = audioKey(voice, text);
    if (!jobs.has(key)) jobs.set(key, { key, text, voice, lang });
  }
  return [...jobs.values()];
}

/** How many of the exam's files are missing on this device. */
export async function missingJobs(exam: Exam, s: TTSSettings): Promise<AudioJob[]> {
  const jobs = examJobs(exam, s);
  const have = await db.hasAudio(jobs.map((j) => j.key));
  return jobs.filter((j) => !have.has(j.key));
}

export type PrepareProgress = { done: number; total: number; waiting?: string };
export type PrepareResult = { total: number; failed: { job: AudioJob; error: string }[] };

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });

/**
 * Makes and saves the files that are missing. A few at a time; when the service asks to slow down
 * (the free plan allows about 20 per minute), it waits and tries again.
 */
export async function prepareAudio(
  jobs: AudioJob[],
  s: TTSSettings,
  onProgress: (p: PrepareProgress) => void,
  signal?: AbortSignal,
): Promise<PrepareResult> {
  const provider = providerFor(s);
  if (!provider) throw new TTSError('צָרִיךְ קֹדֶם לְהַכְנִיס מַפְתֵּחַ וְאֵזוֹר שֶׁל Azure בַּהַגְדָּרוֹת.');
  const failed: PrepareResult['failed'] = [];
  let done = 0;
  let next = 0;
  onProgress({ done, total: jobs.length });

  const worker = async () => {
    while (next < jobs.length && !signal?.aborted) {
      const job = jobs[next++];
      let tries = 0;
      for (;;) {
        try {
          const blob = await provider.synthesize(job.text, job.voice, job.lang);
          await db.putAudio(job.key, blob);
          break;
        } catch (e) {
          const err = e instanceof TTSError ? e : new TTSError(e instanceof Error ? e.message : String(e));
          tries++;
          if (err.retryAfterSec !== null && tries <= 6 && !signal?.aborted) {
            onProgress({ done, total: jobs.length, waiting: err.message });
            await sleep(err.retryAfterSec * 1000, signal);
            continue;
          }
          failed.push({ job, error: err.message });
          break;
        }
      }
      done++;
      onProgress({ done, total: jobs.length });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { total: jobs.length, failed };
}
