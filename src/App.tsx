// Top level: the opening screen always comes first; the exam from there; teacher mode only through the PIN.
import { useCallback, useEffect, useState } from 'react';
import { db } from './db';
import type { Exam } from './model';
import { sampleExam, SAMPLE_ID } from './sampleExam';
import { StudentApp } from './student/StudentApp';
import { Home } from './student/Home';
import { examStatus, type ExamStatus } from './student/status';
import { PinScreen } from './teacher/PinScreen';
import { TeacherApp, getActiveExamId } from './teacher/TeacherApp';
import { speech } from './speech';
import { loadTTSSettings } from './tts';

type Mode = 'home' | 'exam' | 'pin' | 'teacher';

/** The exam the student sees: the active one, only if the teacher approved it. */
async function loadActiveExam(): Promise<Exam | null> {
  const id = await getActiveExamId();
  if (id === SAMPLE_ID) return sampleExam;
  const exam = await db.getExam(id);
  return exam && exam.approved ? exam : null;
}

export default function App() {
  const [mode, setMode] = useState<Mode>('home');
  const [exam, setExam] = useState<Exam | null | undefined>(undefined);
  const [status, setStatus] = useState<ExamStatus>('none');

  /** Reads the active exam and where she stands in it (after start, teacher mode, or the exam). */
  const refresh = useCallback(() => {
    // Which voices the ready-made files were made with (set by the teacher).
    loadTTSSettings()
      .then((t) => speech.setFileVoices({ he: t.voiceHe, en: t.voiceEn }))
      .catch(() => {});
    loadActiveExam()
      .catch(() => sampleExam) // storage not available: at least the sample works
      .then(async (ex) => {
        const st = await examStatus(ex).catch((): ExamStatus => (ex ? 'new' : 'none'));
        setStatus(st);
        setExam(ex);
      });
  }, []);

  useEffect(refresh, [refresh]);

  const toHome = () => {
    speech.stop();
    refresh();
    setMode('home');
  };

  if (mode === 'pin') return <PinScreen onSuccess={() => setMode('teacher')} onCancel={toHome} />;

  if (mode === 'teacher') return <TeacherApp onExit={toHome} />;

  if (exam === undefined) return <div className="boot-msg">טוֹעֶנֶת…</div>;

  if (mode === 'exam' && exam && (status === 'new' || status === 'progress'))
    return <StudentApp key={exam.id} exam={exam} entry={status} onHome={toHome} />;

  return (
    <Home
      exam={exam}
      status={exam ? status : 'none'}
      onStart={() => {
        speech.stop();
        setMode('exam');
      }}
      onTeacher={() => {
        speech.stop();
        setMode('pin');
      }}
    />
  );
}
