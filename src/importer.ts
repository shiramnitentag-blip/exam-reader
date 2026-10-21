// Turning Claude's answer into an exam, and checking it.
import type { RawExam } from './claude';
import { newId, normalizeSpaces, sameWords, type Exam, type Item, type Txt } from './model';

const HAS_HEBREW = /[א-ת]/;

/** Builds an exam (not yet approved) from what Claude returned. */
export function rawToExam(raw: RawExam, opts: { title: string; sourceText?: string; wantNikud: boolean }): Exam {
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
      exam.notes!.push(`${missing} שאלות לא נמצאו מילה במילה בקובץ המקורי. הן מסומנות ב-⚠️. בדקי אותן מול המקור.`);
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

/**
 * Stores the nikud Claude returned — only where the letters and words stayed exactly the same.
 * Returns how many texts were rejected.
 */
export function applyNikud(exam: Exam, result: Record<string, string>): number {
  let rejected = 0;
  for (const t of hebrewTexts(exam)) {
    const voc = result[t.id];
    if (voc && sameWords(t.text, voc)) t.target.nikud = voc;
    else rejected++;
  }
  // Nikud on by default, except where it might give away the answer.
  for (const it of exam.items) it.useNikud = it.lang === 'he' && !it.reveals && !!it.text.nikud;
  if (rejected > 0)
    exam.notes = [
      ...(exam.notes ?? []),
      `ב-${rejected} קטעים הניקוד לא נוסף, כי Claude שינה בהם מילים. הטקסט המקורי נשאר.`,
    ];
  return rejected;
}
