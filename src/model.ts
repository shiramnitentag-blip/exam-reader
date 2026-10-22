// The exam format used everywhere in the app (student screens, teacher review, storage).
import type { Segment } from './speech';

export type Lang = 'he' | 'en';
export type ReadMode = 'normal' | 'spell' | 'none';
export type ItemKind = 'open' | 'choice';

/** A piece of text: the original wording, and optionally a vocalized (nikud) version of it. */
export type Txt = { text: string; nikud?: string };

export type Block = { id: string; text: Txt; lang: Lang };

/** A table from the exam: column titles and rows, each cell word for word. */
export type Table = { id: string; caption?: Txt; headers: Txt[]; rows: Txt[][] };

/** Where a table or picture appears: after the shared text (stem) or after the question itself. */
export type MediaPlace = 'stem' | 'text';

export type Media =
  | { kind: 'table'; id: string; place: MediaPlace; table: Table }
  | {
      kind: 'image';
      id: string;
      place: MediaPlace;
      imageId?: string; // a picture saved on the device (IndexedDB)
      src?: string; // a picture that ships with the app (the sample exam)
      caption?: Txt; // text under the picture in the source, e.g. "מקור: ..." (read aloud)
    };

export type Passage = { id: string; title: Txt; body: Txt; lang: Lang; media?: Media[]; missingFigures?: string[] };

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
  media?: Media[]; // tables and pictures, in order
  missingFigures?: string[]; // pictures Claude saw in a PDF/photo (their captions), not yet cut out
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

// Characters that look different but mean the same (Hebrew vs. typewriter quote marks).
const SAME_CHAR: Record<string, string> = { '״': '"', '“': '"', '”': '"', '„': '"', '׳': "'", '‘': "'", '’': "'" };

/** The letters of a text without nikud, with equivalent quote marks made the same. */
export function baseForm(s: string): string {
  return stripNikud(s.normalize('NFD')).replace(/[״“”„׳‘’]/g, (c) => SAME_CHAR[c]);
}

/** True if the vocalized text has exactly the same letters and words as the original. */
export function sameWords(original: string, vocalized: string): boolean {
  return normalizeSpaces(baseForm(original)) === normalizeSpaces(baseForm(vocalized));
}

const NIKUD_ONE = /[֑-ׇ]/;
const MATRES = /[וי]/; // letters that may be written or left out as vowels (ktiv male / haser)
const HOLAM = 'ֹ';
const KUBUTZ = 'ֻ';
const DAGESH = 'ּ';

/** A word as letters, each with the marks that follow it. */
function clusters(word: string): { ch: string; marks: string }[] {
  const out: { ch: string; marks: string }[] = [];
  for (const c of word.normalize('NFD')) {
    if (NIKUD_ONE.test(c) && out.length) out[out.length - 1].marks += c;
    else if (!NIKUD_ONE.test(c)) out.push({ ch: c, marks: '' });
  }
  return out;
}

/**
 * Puts the nikud of Claude's word onto the original word, letter by letter, keeping the
 * original letters. Claude often vocalizes in "ktiv haser" (שֹׁרֶשׁ for שורש): a vowel letter
 * ו or י that only one side has is allowed, and the vowel moves onto the ו (שׁוֹרֶשׁ).
 * Returns null if the words differ in any other way.
 */
export function fitMarks(orig: string, voc: string): string | null {
  const o = clusters(orig).map((c) => c.ch);
  const v = clusters(voc);
  const key = (c: string) => SAME_CHAR[c] ?? c;
  const n = o.length;
  const m = v.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let a = n - 1; a >= 0; a--)
    for (let b = m - 1; b >= 0; b--)
      L[a][b] = key(o[a]) === key(v[b].ch) ? L[a + 1][b + 1] + 1 : Math.max(L[a + 1][b], L[a][b + 1]);
  const out: { ch: string; marks: string }[] = [];
  let a = 0;
  let b = 0;
  while (a < n || b < m) {
    if (a < n && b < m && key(o[a]) === key(v[b].ch)) {
      out.push({ ch: o[a++], marks: v[b++].marks });
    } else if (a < n && (b >= m || L[a + 1][b] >= L[a][b + 1])) {
      // a letter only the original has: allowed only for a vowel letter ו / י
      const ch = o[a++];
      if (!MATRES.test(ch)) return null;
      const prev = out[out.length - 1];
      if (ch === 'ו' && prev?.marks.includes(HOLAM)) {
        prev.marks = prev.marks.replace(HOLAM, '');
        out.push({ ch, marks: HOLAM }); // וֹ
      } else if (ch === 'ו' && prev?.marks.includes(KUBUTZ)) {
        prev.marks = prev.marks.replace(KUBUTZ, '');
        out.push({ ch, marks: DAGESH }); // וּ
      } else out.push({ ch, marks: '' });
    } else {
      // a letter only Claude's version has: allowed only for a vowel letter, and it is left out
      if (!MATRES.test(v[b++].ch)) return null;
    }
  }
  return out.map((c) => c.ch + c.marks).join('').normalize('NFC');
}

/**
 * Takes nikud from Claude's version word by word. A word Claude changed keeps its original
 * form (without new nikud), so one changed word no longer cancels the nikud of a whole text.
 * Spaces and line breaks always come from the original.
 */
export function mergeNikud(original: string, vocalized: string): { text: string; matched: number; total: number } {
  const parts = original.split(/(\s+)/); // words at even indexes, spaces at odd ones
  const wordIdx: number[] = [];
  parts.forEach((p, i) => {
    if (i % 2 === 0 && p) wordIdx.push(i);
  });
  // Words are paired by their letters without ו / י, so a ktiv-haser spelling still pairs up.
  const skeleton = (w: string) => baseForm(w).replace(/[וי]/g, '');
  const origKeys = wordIdx.map((i) => skeleton(parts[i]));
  const vocWords = vocalized.split(/\s+/).filter(Boolean);
  const vocKeys = vocWords.map(skeleton);
  const n = origKeys.length;
  const m = vocKeys.length;

  // Pair up identical words in order (longest common subsequence; texts are nearly the same).
  const pairs: [number, number][] = [];
  if (n * m <= 4_000_000) {
    const w = m + 1;
    const L = new Uint16Array((n + 1) * w);
    for (let a = n - 1; a >= 0; a--)
      for (let b = m - 1; b >= 0; b--)
        L[a * w + b] = origKeys[a] === vocKeys[b] ? L[(a + 1) * w + b + 1] + 1 : Math.max(L[(a + 1) * w + b], L[a * w + b + 1]);
    let a = 0;
    let b = 0;
    while (a < n && b < m) {
      if (origKeys[a] === vocKeys[b]) pairs.push([a++, b++]);
      else if (L[(a + 1) * w + b] >= L[a * w + b + 1]) a++;
      else b++;
    }
  } else {
    for (let a = 0, b = 0; a < n && b < m; ) {
      if (origKeys[a] === vocKeys[b]) pairs.push([a++, b++]);
      else a++, b++;
    }
  }
  let matched = 0;
  for (const [a, b] of pairs) {
    const orig = parts[wordIdx[a]];
    if (NIKUD_ONE.test(orig)) {
      matched++; // already vocalized in the original: kept exactly as it is
      continue;
    }
    const fitted = fitMarks(orig, vocWords[b]);
    if (fitted !== null) {
      parts[wordIdx[a]] = fitted;
      matched++;
    }
  }
  return { text: parts.join(''), matched, total: n };
}

/** Hebrew words that have no vowel marks at all (to show the teacher what is missing). */
export function wordsWithoutNikud(s: string): number {
  return s.split(/\s+/).filter((w) => /[\u05D0-\u05EA]/.test(w) && !NIKUD_ONE.test(w)).length;
}

/** The text the student sees and hears. */
export function shown(t: Txt | undefined, useNikud: boolean): string {
  if (!t) return '';
  return useNikud && t.nikud ? t.nikud : t.text;
}

/** Every piece of text in a list of tables and pictures. */
export function mediaTexts(media: Media[] | undefined): Txt[] {
  const out: Txt[] = [];
  for (const m of media ?? []) {
    if (m.kind === 'image') {
      if (m.caption) out.push(m.caption);
    } else {
      if (m.table.caption) out.push(m.table.caption);
      out.push(...m.table.headers, ...m.table.rows.flat());
    }
  }
  return out;
}

export function itemHasNikud(item: Item): boolean {
  return !!(
    item.text.nikud ||
    item.stem?.nikud ||
    item.options.some((o) => o.nikud) ||
    mediaTexts(item.media).some((t) => t.nikud)
  );
}

export function newTable(): Table {
  return { id: newId(), headers: [{ text: '' }, { text: '' }], rows: [[{ text: '' }, { text: '' }]] };
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
    .map(splitSentences);
}

/**
 * A sentence ends at . ! ? : ; only when a space or the end of the line comes next,
 * so numbers like 16.5 or 10:30 stay whole.
 */
function splitSentences(p: string): string[] {
  const out: string[] = [];
  const end = /[.!?:;]+["'”׳״)\]]*(?=\s|$)/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = end.exec(p))) {
    const stop = m.index + m[0].length;
    out.push(p.slice(start, stop).trim());
    start = stop;
  }
  out.push(p.slice(start).trim());
  return out.filter(Boolean);
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

// ---------- reading tables and pictures aloud ----------

const HE_ORDINALS = ['רִאשׁוֹנָה', 'שְׁנִיָּה', 'שְׁלִישִׁית', 'רְבִיעִית', 'חֲמִישִׁית', 'שִׁשִּׁית', 'שְׁבִיעִית', 'שְׁמִינִית', 'תְּשִׁיעִית', 'עֲשִׂירִית'];

export function rowName(i: number, lang: Lang): string {
  if (lang === 'en') return `Row ${i + 1}.`;
  return HE_ORDINALS[i] ? `שׁוּרָה ${HE_ORDINALS[i]}.` : `שׁוּרָה ${i + 1}.`;
}

export const cellId = (t: Table, r: number, c: number) => `${t.id}-r${r}-c${c}`;
export const headerId = (t: Table, c: number) => `${t.id}-h${c}`;

/**
 * A table is read row by row, with the column title before each value:
 * "שורה ראשונה. שנה: 1948. אירוע: ...".
 */
export function tableSegments(t: Table, lang: Lang, useNikud: boolean, mode: ReadMode): Segment[] {
  if (mode === 'none') return [];
  const out: Segment[] = [];
  if (t.caption && shown(t.caption, useNikud).trim())
    out.push(...sentenceSegments(shown(t.caption, useNikud), `${t.id}-cap`, lang).flat().flatMap((s) => voiceFor(s, mode)));
  t.rows.forEach((row, r) => {
    out.push({ id: `${t.id}-r${r}`, text: rowName(r, lang), lang });
    row.forEach((cell, c) => {
      const value = shown(cell, useNikud).trim();
      if (!value) return;
      const id = cellId(t, r, c);
      const header = shown(t.headers[c], useNikud).trim();
      if (mode === 'normal') out.push({ id, text: header ? `${header}: ${value}.` : value, lang });
      else {
        // letter by letter: the column title is said normally, then the value is spelled
        if (header) out.push({ id, text: `${header}:`, lang });
        out.push(...voiceFor({ id, text: value, lang }, mode));
      }
    });
  });
  return out;
}

/** What the voice says for the tables and picture captions in one place of a question. */
export function mediaSegments(media: Media[] | undefined, place: MediaPlace | 'all', lang: Lang, useNikud: boolean, mode: ReadMode): Segment[] {
  const out: Segment[] = [];
  for (const m of media ?? []) {
    if (place !== 'all' && m.place !== place) continue;
    if (m.kind === 'table') out.push(...tableSegments(m.table, lang, useNikud, mode));
    else if (m.caption && mode !== 'none') {
      // Pictures are not described; only the caption under them is read, as plain text.
      out.push(...sentenceSegments(shown(m.caption, useNikud), `${m.id}-cap`, lang).flat().flatMap((s) => voiceFor(s, mode)));
    }
  }
  return out;
}
