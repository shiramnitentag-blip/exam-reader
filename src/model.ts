// The exam format used everywhere in the app (student screens, teacher review, storage).
import type { Segment } from './speech';

export type Lang = 'he' | 'en';
export type ReadMode = 'normal' | 'spell' | 'none';
export type ItemKind = 'open' | 'choice';

/** A piece of text: the original wording, and optionally a vocalized (nikud) version of it. */
export type Txt = { text: string; nikud?: string };

export type Block = { id: string; text: Txt; lang: Lang };

export type Passage = { id: string; title: Txt; body: Txt; lang: Lang };

/** One screen for the student: a question, or one sub-question (1א, 1ב…). */
export type Item = {
  id: string;
  label: string; // shown in the bottom bar, e.g. "1א"
  kind: ItemKind;
  stem?: Txt; // the parent question's text, for sub-questions
  text: Txt;
  options: Txt[]; // multiple choice only
  lang: Lang;
  passageId: string | null;
  reveals: boolean; // reading or nikud might give away the answer
  revealReason?: string;
  useNikud: boolean;
  readMode: ReadMode;
  sourceWarning?: boolean; // the text was not found word-for-word in the Word file
};

export type Exam = {
  id: string;
  title: string;
  createdAt: number;
  approved: boolean;
  builtin?: boolean;
  instructions: Block[];
  passages: Passage[];
  items: Item[];
  notes?: string[]; // messages for the teacher from processing (e.g. nikud removed)
};

export const OPTION_LETTERS: Record<Lang, string[]> = {
  he: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'],
  en: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
};

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ---------- nikud helpers ----------

const NIKUD_RE = /[֑-ׇ]/g; // Hebrew points and cantillation marks (incl. maqaf)

export function stripNikud(s: string): string {
  return s.replace(NIKUD_RE, '');
}

export function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** True if the vocalized text has exactly the same letters and words as the original. */
export function sameWords(original: string, vocalized: string): boolean {
  return normalizeSpaces(stripNikud(original)) === normalizeSpaces(stripNikud(vocalized));
}

/** The text the student sees and hears. */
export function shown(t: Txt | undefined, useNikud: boolean): string {
  if (!t) return '';
  return useNikud && t.nikud ? t.nikud : t.text;
}

export function itemHasNikud(item: Item): boolean {
  return !!(item.text.nikud || item.stem?.nikud || item.options.some((o) => o.nikud));
}

/** Split a vocalized text at the position matching `pos` in the original (counting letters only). */
export function splitNikudAt(original: string, vocalized: string, pos: number): [string, string] | null {
  if (stripNikud(vocalized) !== original) return null;
  let count = 0;
  for (let i = 0; i <= vocalized.length; i++) {
    if (count === pos) {
      // keep the marks that belong to the previous letter
      let j = i;
      while (j < vocalized.length && /[֑-ׇ]/.test(vocalized[j])) j++;
      return [vocalized.slice(0, j), vocalized.slice(j)];
    }
    if (i < vocalized.length && !/[֑-ׇ]/.test(vocalized[i])) count++;
  }
  return null;
}

// ---------- splitting text into tappable sentences ----------

/** Paragraphs → sentences. Each sentence keeps its punctuation. */
export function paragraphs(text: string): string[][] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.match(/[^.!?:;]+[.!?:;]*["'”׳״)\]]*\s*|[.!?:;]+\s*/g) ?? [p]).map((s) => s.trim()).filter(Boolean));
}

export function sentenceSegments(text: string, idPrefix: string, lang: Lang): Segment[][] {
  return paragraphs(text).map((p, pi) => p.map((s, si) => ({ id: `${idPrefix}-${pi}-${si}`, text: s, lang })));
}

// ---------- letter-by-letter spelling ----------

const HEBREW_LETTERS: Record<string, string> = {
  א: 'אָלֶף', ב: 'בֵּית', ג: 'גִּימֶל', ד: 'דָּלֶת', ה: 'הֵא', ו: 'וָו', ז: 'זַיִן', ח: 'חֵית', ט: 'טֵית',
  י: 'יוֹד', כ: 'כַּף', ך: 'כַּף סוֹפִית', ל: 'לָמֶד', מ: 'מֵם', ם: 'מֵם סוֹפִית', נ: 'נוּן', ן: 'נוּן סוֹפִית',
  ס: 'סָמֶךְ', ע: 'עַיִן', פ: 'פֵּא', ף: 'פֵּא סוֹפִית', צ: 'צָדִי', ץ: 'צָדִי סוֹפִית', ק: 'קוֹף', ר: 'רֵישׁ',
  ש: 'שִׁין', ת: 'תָּו',
};

/** Turn a sentence into something the voice reads letter by letter (word by word, with pauses). */
export function spellWords(sentence: string): string[] {
  const words = stripNikud(sentence).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    const letters: string[] = [];
    for (const ch of w) {
      if (HEBREW_LETTERS[ch]) letters.push(HEBREW_LETTERS[ch]);
      else if (/[A-Za-z]/.test(ch)) letters.push(ch.toUpperCase());
      else if (/[0-9]/.test(ch)) letters.push(ch);
    }
    if (letters.length) out.push(letters.join(', ') + '.');
  }
  return out;
}

/** Segments the voice should read for one sentence, according to the read mode. */
export function voiceFor(seg: Segment, mode: ReadMode): Segment[] {
  if (mode === 'none') return [];
  if (mode === 'spell') {
    return spellWords(seg.text).map((t) => ({ id: seg.id, text: t, lang: seg.lang }));
  }
  return [seg];
}
