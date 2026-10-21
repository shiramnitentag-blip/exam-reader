// The student's answers, gathered for the teacher (screen, PDF, Word, ZIP).
import { db, isAnswered, type Answer, type Recording, type Session } from './db';
import { OPTION_LETTERS, type Exam, type Item } from './model';
import { sampleExam } from './sampleExam';

export type Clip = { id: string; durationSec: number; mimeType: string };
export type ReportItem = { item: Item; answer?: Answer; clips: Clip[]; answered: boolean };
export type Status = 'submitted' | 'progress';

export type Summary = { exam: Exam; studentName: string; status: Status; date: number };
export type Report = Summary & { items: ReportItem[] };

async function summaryOf(exam: Exam, answers: Answer[]): Promise<Summary | null> {
  const [submitted, submittedAt, session, nameNow] = await Promise.all([
    db.getMeta<boolean>(`submitted:${exam.id}`),
    db.getMeta<number>(`submittedAt:${exam.id}`),
    db.getMeta<Session>(`session:${exam.id}`),
    db.getMeta<string>('studentName'),
  ]);
  if (!submitted && answers.length === 0) return null;
  const last = Math.max(0, ...answers.map((a) => a.updatedAt));
  return {
    exam,
    studentName: session?.studentName || nameNow || '',
    status: submitted ? 'submitted' : 'progress',
    date: (submitted && submittedAt) || last || session?.startedAt || Date.now(),
  };
}

/** Exams the student has started or submitted, newest first. */
export async function answeredExams(): Promise<Summary[]> {
  const exams = [sampleExam, ...(await db.listExams())];
  const out: Summary[] = [];
  for (const exam of exams) {
    const s = await summaryOf(exam, await db.getAnswers(exam.id));
    if (s) out.push(s);
  }
  return out.sort((a, b) => b.date - a.date);
}

export async function loadReport(examId: string): Promise<Report | null> {
  const exam = examId === sampleExam.id ? sampleExam : await db.getExam(examId);
  if (!exam) return null;
  const answers = await db.getAnswers(examId);
  const s = await summaryOf(exam, answers);
  if (!s) return null;
  const byItem = new Map(answers.map((a) => [a.itemId, a]));
  const items: ReportItem[] = [];
  for (const item of exam.items) {
    const answer = byItem.get(item.id);
    const recs = await Promise.all((answer?.clipIds ?? []).map((id) => db.getRecording(id)));
    const clips = recs
      .filter((r): r is Recording => !!r)
      .map((r) => ({ id: r.id, durationSec: r.durationSec, mimeType: r.mimeType }));
    items.push({ item, answer, clips, answered: isAnswered(answer) });
  }
  return { ...s, items };
}

// ---------- wording shared by the screen, the PDF and the Word file ----------

export function formatDate(t: number): string {
  return new Date(t).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

export function formatDuration(sec: number): string {
  const s = Math.max(1, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function statusText(s: Status) {
  return s === 'submitted' ? 'הוגש' : 'בתהליך';
}

/** "יש הקלטה, משך 1:25 דקות" (all the parts of the answer together). */
export function recordingLine(clips: Clip[]): string {
  const total = clips.reduce((sum, c) => sum + c.durationSec, 0);
  const parts = clips.length > 1 ? ` (${clips.length} חלקים)` : '';
  return `יש הקלטה, משך ${formatDuration(total)} דקות${parts}`;
}

export function optionLetter(item: Item, i: number) {
  return OPTION_LETTERS[item.lang][i] ?? String(i + 1);
}

/** For file names: "3ב" → "3-ב". */
export function labelForFile(label: string): string {
  return label
    .replace(/([0-9])([^0-9\s-])/g, '$1-$2')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-');
}

export function extensionFor(mime: string): string {
  if (mime.includes('mp4') || mime.includes('aac')) return 'm4a';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('wav')) return 'wav';
  return 'audio';
}
