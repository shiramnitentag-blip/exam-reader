// Teacher mode: exam list, settings, upload, review.
import { useCallback, useEffect, useState } from 'react';
import { db } from '../db';
import type { Exam } from '../model';
import { sampleExam, SAMPLE_ID } from '../sampleExam';
import { Modal } from '../components/Modal';
import { Settings } from './Settings';
import { Upload } from './Upload';
import { Review } from './Review';
import { AnswersDetail, AnswersList } from './Answers';
import { PrepareAudio } from './PrepareAudio';
import { mb, PreExamCheck } from './PreExamCheck';
import { freeSpaceMB, LOW_SPACE_MB } from '../checks';
import { loadTTSSettings, providerFor } from '../tts';
import { missingJobs } from '../tts/prepare';

type View =
  | { name: 'home' }
  | { name: 'settings' }
  | { name: 'upload' }
  | { name: 'review'; examId: string }
  | { name: 'answers' }
  | { name: 'answer'; examId: string };

export async function getActiveExamId(): Promise<string> {
  return (await db.getMeta<string>('activeExamId')) ?? SAMPLE_ID;
}

export function TeacherApp({ onExit }: { onExit: () => void }) {
  const [view, setView] = useState<View>({ name: 'home' });
  const [exams, setExams] = useState<Exam[]>([sampleExam]);
  const [activeId, setActiveId] = useState<string>(SAMPLE_ID);
  const [hasKey, setHasKey] = useState(true);
  const [confirm, setConfirm] = useState<null | { text: string; yes: string; action: () => Promise<void> }>(null);
  const [message, setMessage] = useState('');
  const [preparing, setPreparing] = useState<Exam | null>(null);
  const [checking, setChecking] = useState<Exam | null>(null);
  const [lowSpace, setLowSpace] = useState<number | null>(null); // MB free, when it is low
  // For each exam: how many voice files are missing (null = voice service not set up).
  const [audio, setAudio] = useState<Record<string, number | null>>({});

  const reload = useCallback(async () => {
    const [list, active, key] = await Promise.all([db.listExams(), getActiveExamId(), db.getMeta<string>('apiKey')]);
    const all = [sampleExam, ...list];
    setExams(all);
    setActiveId(active);
    setHasKey(!!key);
    const space = await freeSpaceMB();
    setLowSpace(space && space.freeMB < LOW_SPACE_MB ? space.freeMB : null);
    const tts = await loadTTSSettings();
    const status: Record<string, number | null> = {};
    for (const ex of all) status[ex.id] = providerFor(tts) ? (await missingJobs(ex, tts)).length : null;
    setAudio(status);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, view.name]);

  async function makeActive(id: string) {
    await db.setMeta('activeExamId', id);
    setActiveId(id);
    setMessage('הַמִּבְחָן הוּגְדַּר כְּפָעִיל. זֶה הַמִּבְחָן שֶׁהַתַּלְמִידָה תִּרְאֶה.');
  }

  if (view.name === 'settings') return <Settings onBack={() => setView({ name: 'home' })} />;
  if (view.name === 'answers')
    return <AnswersList onBack={() => setView({ name: 'home' })} onOpen={(id) => setView({ name: 'answer', examId: id })} />;
  if (view.name === 'answer') return <AnswersDetail examId={view.examId} onBack={() => setView({ name: 'answers' })} />;
  if (view.name === 'upload')
    return (
      <Upload
        onBack={() => setView({ name: 'home' })}
        onSettings={() => setView({ name: 'settings' })}
        onDone={(id) => setView({ name: 'review', examId: id })}
      />
    );
  if (view.name === 'review')
    return (
      <Review
        examId={view.examId}
        activeId={activeId}
        onMakeActive={makeActive}
        onBack={() => setView({ name: 'home' })}
      />
    );

  return (
    <div className="app teacher">
      <header className="header">
        <div className="header-title">👩‍🏫 מַצַּב מוֹרָה</div>
        <div className="header-tools">
          <button className="btn btn-small" onClick={() => setView({ name: 'answers' })}>
            📥 תְּשׁוּבוֹת
          </button>
          <button className="btn btn-small" onClick={() => setView({ name: 'settings' })}>
            ⚙️ הַגְדָּרוֹת
          </button>
          <button className="btn btn-small" onClick={onExit}>
            🚪 יְצִיאָה לְמַצַּב תַּלְמִידָה
          </button>
        </div>
      </header>
      <main className="main">
        <div className="page narrow">
          {!hasKey && (
            <div className="notice">
              כְּדֵי לְהַעֲלוֹת מִבְחָן צָרִיךְ מַפְתֵּחַ Claude.{' '}
              <button className="link-btn" onClick={() => setView({ name: 'settings' })}>
                לַהַגְדָּרוֹת
              </button>
            </div>
          )}
          {lowSpace !== null && (
            <div className="notice error">
              ⚠️ נִשְׁאַר מְעַט מָקוֹם פָּנוּי בָּאַיְפֶּד (בְּעֵרֶךְ {mb(lowSpace)}). הַקְלָטוֹת עֲלוּלוֹת לֹא לְהִשָּׁמֵר. כְּדַאי לִמְחֹק תְּשׁוּבוֹת יְשָׁנוֹת
              (אַחֲרֵי שֶׁשָּׁמַרְתְּ אוֹתָן) אוֹ לְפַנּוֹת מָקוֹם בָּאַיְפֶּד.
            </div>
          )}
          {message && (
            <div className="notice ok" onClick={() => setMessage('')}>
              ✅ {message}
            </div>
          )}
          <button className="btn btn-primary btn-huge" onClick={() => setView({ name: 'upload' })}>
            ➕ מִבְחָן חָדָשׁ
          </button>

          <h2 className="section-title">הַמִּבְחָנִים</h2>
          <div className="exam-list">
            {exams.map((ex) => {
              const isActive = ex.id === activeId;
              return (
                <div key={ex.id} className={`card exam-card ${isActive ? 'active' : ''}`}>
                  <div className="exam-card-head">
                    <div className="exam-card-title">{ex.title}</div>
                    <div className="badges">
                      {isActive && <span className="badge green">⭐ פָּעִיל</span>}
                      {ex.approved ? (
                        <span className="badge">✅ מְאֻשָּׁר</span>
                      ) : (
                        <span className="badge yellow">📝 טְיוּטָה, צָרִיךְ אִשּׁוּר</span>
                      )}
                    </div>
                  </div>
                  <div className="exam-card-meta">
                    {ex.items.length} שְׁאֵלוֹת
                    {ex.builtin ? ' · מִבְחָן לְדֻגְמָה' : ` · ${new Date(ex.createdAt).toLocaleDateString('he-IL')}`}
                  </div>
                  {audio[ex.id] !== undefined && audio[ex.id] !== null && (
                    <div className="audio-status">
                      {audio[ex.id] === 0 ? '🎧 מוּכָן לַמִּבְחָן בְּלִי אִינְטֶרְנֶט' : `🎧 חֲסֵרִים ${audio[ex.id]} קִבְצֵי קוֹל`}
                    </div>
                  )}
                  <div className="exam-card-actions">
                    <button className={`btn btn-small ${isActive ? 'btn-primary' : ''}`} onClick={() => setChecking(ex)}>
                      🩺 בְּדִיקָה לִפְנֵי מִבְחָן
                    </button>
                    <button className="btn btn-small" onClick={() => setPreparing(ex)}>
                      🎧 הֲכָנָה לַמִּבְחָן
                    </button>
                    {!ex.builtin && (
                      <button className="btn btn-small" onClick={() => setView({ name: 'review', examId: ex.id })}>
                        🔍 בְּדִיקָה וַעֲרִיכָה
                      </button>
                    )}
                    {!isActive && ex.approved && (
                      <button className="btn btn-small btn-primary" onClick={() => makeActive(ex.id)}>
                        ⭐ לְהַפְכּוֹ לְפָעִיל
                      </button>
                    )}
                    <button
                      className="btn btn-small"
                      onClick={() =>
                        setConfirm({
                          text: `לִמְחֹק אֶת הַתְּשׁוּבוֹת שֶׁל הַתַּלְמִידָה בַּמִּבְחָן "${ex.title}", כְּדֵי שֶׁתּוּכַל לְהִבָּחֵן בּוֹ מֵחָדָשׁ?`,
                          yes: 'כֵּן, לְאַפֵּס',
                          action: async () => {
                            await db.deleteExamData(ex.id);
                            try {
                              localStorage.removeItem(`screen:${ex.id}`);
                            } catch {
                              /* ignore */
                            }
                            setMessage('הַתְּשׁוּבוֹת נִמְחֲקוּ.');
                          },
                        })
                      }
                    >
                      🔄 אִפּוּס תְּשׁוּבוֹת
                    </button>
                    {!ex.builtin && (
                      <button
                        className="btn btn-small btn-danger-outline"
                        onClick={() =>
                          setConfirm({
                            text: `לִמְחֹק אֶת הַמִּבְחָן "${ex.title}" וְאֶת הַתְּשׁוּבוֹת שֶׁלּוֹ? אִי אֶפְשָׁר לְבַטֵּל.`,
                            yes: 'כֵּן, לִמְחֹק',
                            action: async () => {
                              await db.deleteExam(ex.id);
                              if (isActive) await db.setMeta('activeExamId', SAMPLE_ID);
                              await reload();
                            },
                          })
                        }
                      >
                        🗑️ מְחִיקָה
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>
      {preparing && (
        <PrepareAudio
          exam={preparing}
          onClose={() => {
            setPreparing(null);
            void reload();
          }}
          onSettings={() => {
            setPreparing(null);
            setView({ name: 'settings' });
          }}
        />
      )}
      {checking && (
        <PreExamCheck
          exam={checking}
          isActive={checking.id === activeId}
          onClose={() => {
            setChecking(null);
            void reload();
          }}
          onPrepare={() => {
            setPreparing(checking);
            setChecking(null);
          }}
          onMakeActive={() => void makeActive(checking.id)}
        />
      )}
      {confirm && (
        <Modal
          text={confirm.text}
          yes={confirm.yes}
          no="בִּטּוּל"
          danger
          onNo={() => setConfirm(null)}
          onYes={async () => {
            const c = confirm;
            setConfirm(null);
            await c.action();
          }}
        />
      )}
    </div>
  );
}
