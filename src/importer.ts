// Turning Claude's answer into an exam, and checking it.
import type { RawExam, RawFigure, RawTable } from './claude';
import { db } from './db';
import type { PreparedImage } from './files';
import {
  itemHasNikud,
  mediaTexts,
  mergeNikud,
  newId,
  normalizeSpaces,
  type Exam,
  type Item,
  type Media,
  type MediaPlace,
  type Txt,
} from './model';

const HAS_HEBREW = /[א-ת]/;

/** Marks a picture from the Word file (number n) until it is saved on the device. */
export const DOCX_IMAGE = 'docx:';

const ownerKey = (s: string) => s.replace(/[\s.,:'"׳״()\-]/g, '');

/**
 * Finds where each table and picture belongs (Claude says it in "owner": "p1", "3" or "3.ב").
 * Returns a lookup for a passage id, a question number, or a question number + letter.
 */
function groupByOwner(raw: RawExam) {
  const targets: string[] = [
    ...raw.passages.map((p) => p.id),
    ...raw.questions.flatMap((q) => [q.number, ...q.subquestions.map((s) => `${q.number}${s.letter}`)]),
  ];
  const keys = new Set(targets.map(ownerKey));
  const questionKeys = raw.questions.map((q) => ownerKey(q.number)).sort((a, b) => b.length - a.length);
  const where = (owner: string): string => {
    const k = ownerKey(owner);
    if (keys.has(k)) return k;
    // "3ג" when there is no ג: the question it starts with
    const q = questionKeys.find((qk) => qk && k.startsWith(qk));
    if (q) return q;
    return ownerKey(raw.questions[0]?.number ?? ''); // unknown: the first question
  };
  const tables = new Map<string, RawTable[]>();
  const figures = new Map<string, RawFigure[]>();
  for (const t of raw.tables ?? []) tables.set(where(t.owner), [...(tables.get(where(t.owner)) ?? []), t]);
  for (const f of raw.figures ?? []) figures.set(where(f.owner), [...(figures.get(where(f.owner)) ?? []), f]);
  return (target: string) => ({ tables: tables.get(ownerKey(target)) ?? [], figures: figures.get(ownerKey(target)) ?? [] });
}

/** Tables and pictures Claude found, as media of one place. Pictures without a file are returned apart. */
function toMedia(tables: RawTable[], figures: RawFigure[], place: MediaPlace): { media: Media[]; missing: string[] } {
  const media: Media[] = tables.map((t) => ({
    kind: 'table' as const,
    id: newId(),
    place,
    table: {
      id: newId(),
      caption: t.caption.trim() ? { text: t.caption } : undefined,
      headers: t.headers.map((h) => ({ text: h })),
      rows: t.rows.map((r) => r.map((c) => ({ text: c }))),
    },
  }));
  const missing: string[] = [];
  for (const f of figures) {
    if (f.image > 0)
      media.push({
        kind: 'image',
        id: newId(),
        place,
        imageId: `${DOCX_IMAGE}${f.image}`,
        caption: f.caption.trim() ? { text: f.caption } : undefined,
      });
    else missing.push(f.caption);
  }
  return { media, missing };
}

/** Builds an exam (not yet approved) from what Claude returned. */
export function rawToExam(
  raw: RawExam,
  opts: { title: string; sourceText?: string; wantNikud: boolean; hasPictures?: boolean },
): Exam {
  const of = groupByOwner(raw);
  const passageIds = new Map<string, string>();
  const passages = raw.passages.map((p) => {
    const id = newId();
    passageIds.set(p.id, id);
    const own = of(p.id);
    const m = toMedia(own.tables, own.figures, 'text');
    return {
      id,
      title: { text: p.title },
      body: { text: p.text },
      lang: p.lang,
      media: m.media,
      missingFigures: m.missing.length ? m.missing : undefined,
    };
  });

  const items: Item[] = [];
  for (const q of raw.questions) {
    const passageId = q.passage_id ? (passageIds.get(q.passage_id) ?? null) : null;
    const base = {
      passageId,
      useNikud: false,
      readMode: 'normal' as const,
    };
    if (q.subquestions.length === 0) {
      const own = of(q.number);
      const m = toMedia(own.tables, own.figures, 'text');
      items.push({
        ...base,
        media: m.media,
        missingFigures: m.missing.length ? m.missing : undefined,
        id: newId(),
        label: q.number,
        kind: q.type,
        text: { text: q.text },
        options: q.options.map((o) => ({ text: o })),
        lang: q.lang,
        reveals: q.reveals_answer,
        revealReason: q.reveal_reason || undefined,
      });
    } else {
      for (const s of q.subquestions) {
        // The parent's tables and pictures appear with every sub-question, after the shared text.
        const parent = of(q.number);
        const mine = of(`${q.number}${s.letter}`);
        const shared = toMedia(parent.tables, parent.figures, 'stem');
        const own = toMedia(mine.tables, mine.figures, 'text');
        const missing = [...(s === q.subquestions[0] ? shared.missing : []), ...own.missing];
        items.push({
          ...base,
          media: [...shared.media, ...own.media],
          missingFigures: missing.length ? missing : undefined,
          id: newId(),
          label: `${q.number}${s.letter}`,
          kind: s.type,
          stem: q.text.trim() ? { text: q.text } : undefined,
          text: { text: s.text },
          options: s.options.map((o) => ({ text: o })),
          lang: s.lang,
          reveals: s.reveals_answer || q.reveals_answer,
          revealReason: s.reveal_reason || q.reveal_reason || undefined,
        });
      }
    }
  }

  const exam: Exam = {
    id: newId(),
    title: opts.title.trim() || raw.title || 'מבחן חדש',
    createdAt: Date.now(),
    approved: false,
    instructions: raw.instructions.map((b) => ({ id: newId(), text: { text: b.text }, lang: b.lang })),
    passages,
    items,
    notes: raw.simpleFormat
      ? ['הַפַּעַם הַטַּבְלָאוֹת הִגִּיעוּ כְּטֶקְסְט, וּתְמוּנוֹת לֹא שֻׁיְּכוּ. אֶפְשָׁר לְהוֹסִיף טַבְלָה וּתְמוּנָה בְּכָל שְׁאֵלָה (➕ טַבְלָה, 🖼️ תְּמוּנָה).']
      : [],
  };

  // For Word files we have the source text: check that every question appears in it word for word.
  if (opts.sourceText) {
    const source = normalizeSpaces(opts.sourceText);
    const found = (t: string) => !t.trim() || source.includes(normalizeSpaces(t));
    let missing = 0;
    for (const it of exam.items) {
      const ok =
        found(it.text.text) &&
        (!it.stem || found(it.stem.text)) &&
        it.options.every((o) => found(o.text)) &&
        mediaTexts((it.media ?? []).filter((m) => m.kind === 'table')).every((t) => found(t.text));
      if (!ok) {
        it.sourceWarning = true;
        missing++;
      }
    }
    if (missing > 0)
      exam.notes!.push(
        opts.hasPictures
          ? `${missing} שאלות לא נמצאו מילה במילה בטקסט של קובץ הוורד. הן מסומנות ב-⚠️. חלקן אולי הגיעו מתמונות שבקובץ (את אלה אי אפשר לבדוק אוטומטית). בדקי אותן מול המקור.`
          : `${missing} שאלות לא נמצאו מילה במילה בקובץ המקורי. הן מסומנות ב-⚠️. בדקי אותן מול המקור.`,
      );
  }
  return exam;
}

/** Every Hebrew text in the exam, with a way to store its vocalized version. */
export function hebrewTexts(exam: Exam): { id: string; text: string; target: Txt }[] {
  const out: { id: string; text: string; target: Txt }[] = [];
  let n = 0;
  const add = (t: Txt | undefined) => {
    if (t && HAS_HEBREW.test(t.text)) out.push({ id: `t${n++}`, text: t.text, target: t });
  };
  exam.instructions.forEach((b) => add(b.text));
  exam.passages.forEach((p) => {
    add(p.title);
    add(p.body);
    mediaTexts(p.media).forEach(add);
  });
  exam.items.forEach((it) => {
    add(it.stem);
    add(it.text);
    it.options.forEach(add);
    mediaTexts(it.media).forEach(add);
  });
  return out;
}

export type NikudResult = { done: number; partial: number; failedIds: string[] };

/**
 * Stores the nikud Claude returned, word by word: a word Claude changed stays as written
 * (without nikud), the rest of the text gets its nikud. Texts with no usable nikud at all
 * are returned in failedIds, so they can be sent again.
 */
export function applyNikud(exam: Exam, result: Record<string, string>, onlyIds?: Set<string>): NikudResult {
  const res: NikudResult = { done: 0, partial: 0, failedIds: [] };
  for (const t of hebrewTexts(exam)) {
    if (onlyIds && !onlyIds.has(t.id)) continue;
    const voc = result[t.id];
    const merged = voc ? mergeNikud(t.text, voc) : null;
    if (!merged || merged.matched === 0) {
      res.failedIds.push(t.id);
      continue;
    }
    t.target.nikud = merged.text;
    if (merged.matched < merged.total) res.partial++;
    else res.done++;
  }
  return res;
}

/** After nikud: on by default, except where it might give away the answer. Adds notes for the teacher. */
export function finishNikud(exam: Exam, partial: number, failed: number) {
  for (const it of exam.items) it.useNikud = it.lang === 'he' && !it.reveals && itemHasNikud(it);
  const notes: string[] = [];
  if (partial > 0)
    notes.push(`ב-${partial} קטעים חלק מהמילים נשארו בלי ניקוד, כי Claude כתב אותן אחרת מהמקור. אפשר ללחוץ "לנקד שוב" בשאלה.`);
  if (failed > 0) notes.push(`${failed} קטעים נשארו בלי ניקוד. אפשר ללחוץ "לנקד שוב" בשאלה.`);
  const flagged = exam.items.filter((it) => it.reveals && it.lang === 'he').length;
  if (flagged > 0) notes.push(`ב-${flagged} שאלות הניקוד כבוי בכוונה, כי הן עלולות לחשוף תשובה (מסומנות בצהוב). אפשר להדליק אותו ידנית.`);
  exam.notes = [...(exam.notes ?? []), ...notes];
}

/**
 * Saves the Word file's pictures that Claude placed in questions (as "docx:n") on the device,
 * and lists in the notes the pictures Claude saw in a PDF or photo, to cut out by hand.
 */
export async function attachDocxPictures(exam: Exam, pictures: PreparedImage[]) {
  const saved = new Map<number, string>();
  const fix = async (media: Media[] | undefined): Promise<Media[] | undefined> => {
    if (!media) return media;
    const out: Media[] = [];
    for (const m of media) {
      if (m.kind !== 'image' || !m.imageId?.startsWith(DOCX_IMAGE)) {
        out.push(m);
        continue;
      }
      const n = Number(m.imageId.slice(DOCX_IMAGE.length));
      const pic = pictures[n - 1];
      if (!pic) continue; // Claude pointed at a picture that does not exist
      let id = saved.get(n);
      if (!id) {
        id = newId();
        await db.putImage({ id, examId: exam.id, blob: pic.blob, width: pic.width, height: pic.height });
        saved.set(n, id);
      }
      out.push({ ...m, imageId: id });
    }
    return out;
  };
  for (const p of exam.passages) p.media = await fix(p.media);
  for (const it of exam.items) it.media = await fix(it.media);

  const missing =
    exam.items.reduce((n, it) => n + (it.missingFigures?.length ?? 0), 0) +
    exam.passages.reduce((n, p) => n + (p.missingFigures?.length ?? 0), 0);
  if (missing > 0)
    exam.notes = [
      ...(exam.notes ?? []),
      `במקור יש ${missing} תמונות (גרף, מפה, ציור). הן מסומנות ב-📍 בשאלות. לחצי "✂️ תמונה מהמקור" כדי לסמן ולחתוך אותן.`,
    ];
}
