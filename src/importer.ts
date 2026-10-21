// Turning Claude's answer into an exam, and checking it.
import type { RawExam } from './claude';
import { itemHasNikud, mergeNikud, newId, normalizeSpaces, type Exam, type Item, type Txt } from './model';

const HAS_HEBREW = /[א-ת]/;

/** Builds an exam (not yet approved) from what Claude returned. */
export function rawToExam(
  raw: RawExam,
  opts: { title: string; sourceText?: string; wantNikud: boolean; hasPictures?: boolean },
): Exam {
  const passageIds = new Map<string, string>();
  const passages = raw.passages.map((p) => {
    const id = newId();
    passageIds.set(p.id, id);
    return { id, title: { text: p.title }, body: { text: p.text }, lang: p.lang };
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
      items.push({
        ...base,
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
        items.push({
          ...base,
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
    notes: [],
  };

  // For Word files we have the source text: check that every question appears in it word for word.
  if (opts.sourceText) {
    const source = normalizeSpaces(opts.sourceText);
    const found = (t: string) => !t.trim() || source.includes(normalizeSpaces(t));
    let missing = 0;
    for (const it of exam.items) {
      const ok = found(it.text.text) && (!it.stem || found(it.stem.text)) && it.options.every((o) => found(o.text));
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
  });
  exam.items.forEach((it) => {
    add(it.stem);
    add(it.text);
    it.options.forEach(add);
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
