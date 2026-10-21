// Teacher mode: exam list, settings, upload, review.
import { useCallback, useEffect, useState } from 'react';
import { db } from '../db';
import type { Exam } from '../model';
import { sampleExam, SAMPLE_ID } from '../sampleExam';
import { Modal } from '../components/Modal';
import { Settings } from './Settings';
import { Upload } from './Upload';
import { Review } from './Review';

type View = { name: 'home' } | { name: 'settings' } | { name: 'upload' } | { name: 'review'; examId: string };

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

  const reload = useCallback(async () => {
    const [list, active, key] = await Promise.all([db.listExams(), getActiveExamId(), db.getMeta<string>('apiKey')]);
    setExams([sampleExam, ...list]);
    setActiveId(active);
    setHasKey(!!key);
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
                  <div className="exam-card-actions">
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
                            await db.clearAnswers(ex.id);
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
