// Top level: student mode by default; teacher mode only through the PIN.
import { useCallback, useEffect, useState } from 'react';
import { db } from './db';
import type { Exam } from './model';
import { sampleExam, SAMPLE_ID } from './sampleExam';
import { StudentApp, Header } from './student/StudentApp';
import { PinScreen } from './teacher/PinScreen';
import { TeacherApp, getActiveExamId } from './teacher/TeacherApp';
import { speech } from './speech';

type Mode = 'student' | 'pin' | 'teacher';

/** The exam the student sees: the active one, only if the teacher approved it. */
async function loadActiveExam(): Promise<Exam | null> {
  const id = await getActiveExamId();
  if (id === SAMPLE_ID) return sampleExam;
  const exam = await db.getExam(id);
  return exam && exam.approved ? exam : null;
}

export default function App() {
  const [mode, setMode] = useState<Mode>('student');
  const [exam, setExam] = useState<Exam | null | undefined>(undefined);

  const refresh = useCallback(() => {
    loadActiveExam()
      .then(setExam)
      .catch(() => setExam(sampleExam)); // storage not available: at least the sample works
  }, []);

  useEffect(refresh, [refresh]);

  const toTeacher = () => {
    speech.stop();
    setMode('pin');
  };

  if (mode === 'pin') return <PinScreen onSuccess={() => setMode('teacher')} onCancel={() => setMode('student')} />;

  if (mode === 'teacher')
    return (
      <TeacherApp
        onExit={() => {
          speech.stop();
          refresh();
          setMode('student');
        }}
      />
    );

  if (exam === undefined) return <div className="boot-msg">טוֹעֶנֶת…</div>;

  if (exam === null)
    return (
      <div className="app">
        <Header title="מִבְחָן בְּקוֹל" onTeacher={toTeacher} />
        <main className="main">
          <div className="page narrow center">
            <div className="done-icon">⏳</div>
            <h1 className="title">הַמִּבְחָן עוֹד לֹא מוּכָן.</h1>
            <p className="big-text">קִרְאִי לַמּוֹרָה.</p>
          </div>
        </main>
      </div>
    );

  return <StudentApp key={exam.id} exam={exam} onTeacher={toTeacher} />;
}
