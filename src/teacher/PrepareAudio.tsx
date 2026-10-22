// "Prepare for exam": make all the voice files in advance, so the exam is read with the good voice
// even without internet.
import { useEffect, useRef, useState } from 'react';
import type { Exam } from '../model';
import { keepScreenOn } from '../device';
import { loadTTSSettings, providerFor, type TTSSettings } from '../tts';
import { speech } from '../speech';
import { examJobs, examSegments, missingJobs, prepareAudio, type AudioJob, type PrepareProgress } from '../tts/prepare';

type State =
  | { kind: 'loading' }
  | { kind: 'no-settings' }
  | { kind: 'ready-to-start'; total: number; missing: AudioJob[] }
  | { kind: 'working'; progress: PrepareProgress }
  | { kind: 'done' }
  | { kind: 'failed'; failed: { job: AudioJob; error: string }[]; total: number };

export function PrepareAudio({ exam, onClose, onSettings }: { exam: Exam; onClose: () => void; onSettings: () => void }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const settings = useRef<TTSSettings | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [check1, setCheck1] = useState<'' | 'playing' | 'ok' | 'bad'>('');

  /** Plays one sentence the way the student hears it, and tells which voice was used. */
  async function testPlay() {
    const seg = examSegments(exam).find((x) => x.text.trim().length > 15) ?? examSegments(exam)[0];
    if (!seg) return;
    setCheck1('playing');
    const r = await speech.speak([seg]);
    setCheck1(r.files > 0 ? 'ok' : 'bad');
  }

  async function check() {
    const s = await loadTTSSettings();
    settings.current = s;
    if (!providerFor(s)) {
      setState({ kind: 'no-settings' });
      return;
    }
    const missing = await missingJobs(exam, s);
    const total = examJobs(exam, s).length;
    setState(missing.length === 0 ? { kind: 'done' } : { kind: 'ready-to-start', total, missing });
  }

  useEffect(() => {
    void check();
    return () => {
      abort.current?.abort();
      speech.stop();
      keepScreenOn(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam.id]);

  async function run(jobs: AudioJob[]) {
    const s = settings.current!;
    const ctrl = new AbortController();
    abort.current = ctrl;
    keepScreenOn(true); // the iPad must not sleep in the middle
    setState({ kind: 'working', progress: { done: 0, total: jobs.length } });
    try {
      const res = await prepareAudio(jobs, s, (progress) => setState({ kind: 'working', progress }), ctrl.signal);
      if (ctrl.signal.aborted) {
        await check();
        return;
      }
      // Only "ready" if every file is really saved.
      const stillMissing = await missingJobs(exam, s);
      if (stillMissing.length === 0) setState({ kind: 'done' });
      else
        setState({
          kind: 'failed',
          total: examJobs(exam, s).length,
          failed: stillMissing.map((job) => res.failed.find((f) => f.job.key === job.key) ?? { job, error: 'לֹא נִשְׁמַר' }),
        });
    } catch (e) {
      setState({ kind: 'failed', total: jobs.length, failed: jobs.map((job) => ({ job, error: e instanceof Error ? e.message : String(e) })) });
    } finally {
      keepScreenOn(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal prepare-modal">
        <h2 className="section-title">🎧 הֲכָנָה לַמִּבְחָן: "{exam.title}"</h2>

        {state.kind === 'loading' && <p className="help">⏳ בּוֹדֶקֶת…</p>}

        {state.kind === 'no-settings' && (
          <>
            <div className="notice">כְּדֵי לְהָכִין קְבָצֵי קוֹל צָרִיךְ קֹדֶם לְהַכְנִיס מַפְתֵּחַ וְאֵזוֹר שֶׁל Azure בַּהַגְדָּרוֹת.</div>
            <div className="modal-actions">
              <button className="btn btn-primary btn-big" onClick={onSettings}>
                ⚙️ לַהַגְדָּרוֹת
              </button>
              <button className="btn btn-big" onClick={onClose}>
                סְגִירָה
              </button>
            </div>
          </>
        )}

        {state.kind === 'ready-to-start' && (
          <>
            <p className="big-text">
              צָרִיךְ לְהָכִין {state.missing.length} קִבְצֵי קוֹל
              {state.total > state.missing.length ? ` (${state.total - state.missing.length} כְּבָר מוּכָנִים)` : ''}.
            </p>
            <p className="help">
              בַּחֶשְׁבּוֹן הַחִינָמִי שֶׁל Azure זֶה לוֹקֵחַ בְּעֵרֶךְ דַּקָּה לְכָל 20 מִשְׁפָּטִים. צָרִיךְ אִינְטֶרְנֶט, וְאָסוּר לִסְגֹּר אֶת
              הָאַפְּלִיקַצְיָה בַּזְּמַן הַזֶּה.
            </p>
            <div className="modal-actions">
              <button className="btn btn-primary btn-big" onClick={() => run(state.missing)}>
                ▶️ לְהַתְחִיל
              </button>
              <button className="btn btn-big" onClick={onClose}>
                לֹא עַכְשָׁו
              </button>
            </div>
          </>
        )}

        {state.kind === 'working' && (
          <>
            <div className="progress">
              <div className="progress-bar" style={{ width: `${Math.round((state.progress.done / Math.max(1, state.progress.total)) * 100)}%` }} />
            </div>
            <p className="big-text">
              {state.progress.done} מִתּוֹךְ {state.progress.total}
            </p>
            {state.progress.waiting && <p className="help">⏸️ {state.progress.waiting}</p>}
            <div className="modal-actions">
              <button className="btn btn-big" onClick={() => abort.current?.abort()}>
                ✋ לַעֲצֹר
              </button>
            </div>
          </>
        )}

        {state.kind === 'done' && (
          <>
            <div className="notice ok big-text">✅ מוּכָן לַמִּבְחָן בְּלִי אִינְטֶרְנֶט.</div>
            <p className="help">כָּל קִבְצֵי הַקּוֹל שְׁמוּרִים בָּאַיְפֶּד.</p>
            {check1 === 'ok' && <div className="notice ok">✅ הַקֹּבֶץ הַשָּׁמוּר הֻשְׁמַע.</div>}
            {check1 === 'bad' && (
              <div className="notice error">
                ❌ הַקֹּבֶץ הַשָּׁמוּר לֹא הֻשְׁמַע, וְנִשְׁמַע הַקּוֹל הַמּוּבְנֶה שֶׁל הָאַיְפֶּד בִּמְקוֹמוֹ.
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-big" onClick={() => void testPlay()} disabled={check1 === 'playing'}>
                {check1 === 'playing' ? '🔊 מַשְׁמִיעָה…' : '▶️ בְּדִיקַת הַשְׁמָעָה'}
              </button>
              <button className="btn btn-primary btn-big" onClick={onClose}>
                סְגִירָה
              </button>
            </div>
          </>
        )}

        {state.kind === 'failed' && (
          <>
            <div className="notice error">
              ❌ {state.failed.length} מִתּוֹךְ {state.total} קְבָצִים לֹא נִשְׁמְרוּ. הַמִּבְחָן עוֹד לֹא מוּכָן לַעֲבוֹדָה בְּלִי אִינְטֶרְנֶט (בַּמִּשְׁפָּטִים
              הָאֵלֶּה יִשָּׁמַע הַקּוֹל הַמּוּבְנֶה שֶׁל הָאַיְפֶּד).
            </div>
            <ul className="failed-list">
              {state.failed.slice(0, 12).map((f) => (
                <li key={f.job.key}>
                  <span dir="auto">"{f.job.text.slice(0, 50)}{f.job.text.length > 50 ? '…' : ''}"</span>
                  <span className="help"> — {f.error}</span>
                </li>
              ))}
              {state.failed.length > 12 && <li className="help">וְעוֹד {state.failed.length - 12}…</li>}
            </ul>
            <div className="modal-actions">
              <button className="btn btn-primary btn-big" onClick={() => run(state.failed.map((f) => f.job))}>
                🔄 לְנַסּוֹת שׁוּב
              </button>
              <button className="btn btn-big" onClick={onClose}>
                סְגִירָה
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
