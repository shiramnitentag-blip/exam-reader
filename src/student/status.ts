// Where the student stands in the active exam, worked out from what is saved on the device.
import { db } from '../db';
import type { Exam } from '../model';

export type ExamStatus = 'none' | 'new' | 'progress' | 'submitted';

export type SavedScreen = { name: 'intro' } | { name: 'question'; index: number } | { name: 'finish' } | { name: 'done' };

/** The screen she was on and the last question she saw: kept in two places (quick memory and the database). */
export async function loadPlace(examId: string): Promise<{ screen: SavedScreen | null; lastQuestion: number }> {
  let screen: SavedScreen | null = null;
  let last: number | null = null;
  try {
    const raw = localStorage.getItem(`screen:${examId}`);
    if (raw) screen = JSON.parse(raw) as SavedScreen;
    const l = localStorage.getItem(`lastq:${examId}`);
    if (l !== null) last = Number(l);
  } catch {
    /* quick memory not available */
  }
  if (!screen) screen = (await db.getMeta<SavedScreen>(`screen:${examId}`).catch(() => undefined)) ?? null;
  if (last === null || Number.isNaN(last)) last = (await db.getMeta<number>(`lastq:${examId}`).catch(() => undefined)) ?? null;
  if (last === null && screen?.name === 'question') last = screen.index;
  return { screen, lastQuestion: last ?? 0 };
}

export function savePlace(examId: string, screen: SavedScreen) {
  try {
    localStorage.setItem(`screen:${examId}`, JSON.stringify(screen));
    if (screen.name === 'question') localStorage.setItem(`lastq:${examId}`, String(screen.index));
  } catch {
    /* ignore */
  }
  void db.setMeta(`screen:${examId}`, screen).catch(() => {});
  if (screen.name === 'question') void db.setMeta(`lastq:${examId}`, screen.index).catch(() => {});
}

export function forgetPlace(examId: string) {
  try {
    localStorage.removeItem(`screen:${examId}`);
    localStorage.removeItem(`lastq:${examId}`);
  } catch {
    /* ignore */
  }
}

export async function examStatus(exam: Exam | null): Promise<ExamStatus> {
  if (!exam) return 'none';
  const [submitted, answers, session, place] = await Promise.all([
    db.getMeta<boolean>(`submitted:${exam.id}`),
    db.getAnswers(exam.id),
    db.getMeta(`session:${exam.id}`),
    loadPlace(exam.id),
  ]);
  if (submitted) return 'submitted';
  const moved = place.screen && place.screen.name !== 'intro' && place.screen.name !== 'done';
  return answers.length > 0 || session || moved ? 'progress' : 'new';
}

/** Teacher: open a submitted exam again, so the student can go on (back to the page before submitting). */
export async function reopenExam(examId: string) {
  await db.deleteMeta(`submitted:${examId}`);
  await db.deleteMeta(`submittedAt:${examId}`);
  savePlace(examId, { name: 'finish' });
}
