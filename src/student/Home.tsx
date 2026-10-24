// The opening screen: always shown when the app starts. One big button, by the state of the active exam.
import type { Exam } from '../model';
import type { Segment } from '../speech';
import { ReadButton, SpeakText } from '../components/Speak';
import { PHRASES } from './phrases';
import type { ExamStatus } from './status';

/** What the voice reads on the opening screen (the same sentences that are shown; all are in PHRASES,
 * so "prepare for exam" makes voice files for them). */
export function homeSegments(exam: Exam | null, status: ExamStatus): Segment[] {
  if (!exam || status === 'none')
    return [
      { id: 'home-0', text: PHRASES.noExam },
      { id: 'home-1', text: PHRASES.callTeacher },
    ];
  const title: Segment = { id: 'exam-title', text: exam.title };
  if (status === 'submitted') return [title, { id: 'home-1', text: PHRASES.submitted }];
  return [title, { id: 'home-1', text: status === 'progress' ? PHRASES.continueHint : PHRASES.startHint }];
}

export function Home({
  exam,
  status,
  onStart,
  onTeacher,
}: {
  exam: Exam | null;
  status: ExamStatus;
  onStart: () => void;
  onTeacher: () => void;
}) {
  const segs = homeSegments(exam, status);
  const [first, ...rest] = segs;

  return (
    <div className="app">
      <header className="header home-header">
        <div className="header-title">מִבְחָן בְּקוֹל</div>
        <div className="header-tools">
          <button className="btn btn-small teacher-entry gear" onClick={onTeacher} aria-label="מצב מורה">
            ⚙️
          </button>
        </div>
      </header>
      <main className="main">
        <div className="page narrow center home">
          <div className="home-icon" aria-hidden>
            {status === 'submitted' ? '✅' : status === 'none' ? '⏳' : '📝'}
          </div>
          <SpeakText as="h1" className="title" sentences={[first]} />
          <SpeakText as="p" className="big-text home-hint" sentences={rest} />

          {status === 'new' && (
            <button className="btn btn-primary btn-huge home-btn" onClick={onStart}>
              ▶️ לְהַתְחִיל מִבְחָן
            </button>
          )}
          {status === 'progress' && (
            <button className="btn btn-primary btn-huge home-btn" onClick={onStart}>
              ▶️ לְהַמְשִׁיךְ מִבְחָן
            </button>
          )}
          {status === 'submitted' && (
            <button className="btn btn-huge home-btn done" disabled aria-disabled>
              ✅ הַמִּבְחָן הוּגַשׁ
            </button>
          )}
          {status === 'none' && (
            <button className="btn btn-huge home-btn done" disabled aria-disabled>
              אֵין מִבְחָן פָּעִיל כָּרֶגַע
            </button>
          )}

          <ReadButton segments={segs} className="wide" />
        </div>
      </main>
    </div>
  );
}
