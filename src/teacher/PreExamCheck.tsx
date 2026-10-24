// "Check before the exam": everything the exam needs, each with ✓ or ✗.
// (No battery row: Safari on the iPad does not tell the battery level.)
import { useEffect, useState } from 'react';
import type { Exam } from '../model';
import { db } from '../db';
import { speech } from '../speech';
import { loadTTSSettings, providerFor } from '../tts';
import { missingJobs } from '../tts/prepare';
import { checkMicrophone, freeSpaceMB, LOW_SPACE_MB, protectStorage } from '../checks';

type State = 'ok' | 'bad' | 'warn' | 'wait';
type Row = { key: string; title: string; state: State; detail?: string; action?: { label: string; run: () => void } };

const ICON: Record<State, string> = { ok: '✅', bad: '❌', warn: '⚠️', wait: '⏳' };

export function PreExamCheck({
  exam,
  isActive,
  onClose,
  onPrepare,
  onMakeActive,
}: {
  exam: Exam;
  isActive: boolean;
  onClose: () => void;
  onPrepare: () => void;
  onMakeActive: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [run, setRun] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const list: Row[] = [
      { key: 'approved', title: 'הַמִּבְחָן אֻשַּׁר', state: 'wait' },
      { key: 'active', title: 'זֶה הַמִּבְחָן שֶׁהַתַּלְמִידָה תִּרְאֶה', state: 'wait' },
      { key: 'audio', title: 'כָּל קִבְצֵי הַקּוֹל קַיָּמִים', state: 'wait' },
      { key: 'mic', title: 'הַמִּיקְרוֹפוֹן מְאֻשָּׁר', state: 'wait' },
      { key: 'space', title: 'יֵשׁ מַסְפִּיק מָקוֹם פָּנוּי', state: 'wait' },
      { key: 'old', title: 'אֵין תְּשׁוּבוֹת יְשָׁנוֹת בַּמִּבְחָן', state: 'wait' },
      { key: 'name', title: 'שֵׁם הַתַּלְמִידָה מֻגְדָּר', state: 'wait' },
      { key: 'keep', title: 'הַנְּתוּנִים מֻגָּנִים מִמְּחִיקָה', state: 'wait' },
    ];
    setRows(list);
    const set = (key: string, r: Partial<Row>) => {
      if (cancelled) return;
      setRows((rs) => rs.map((x) => (x.key === key ? { ...x, ...r } : x)));
    };

    set('approved', exam.approved ? { state: 'ok' } : { state: 'bad', detail: 'צָרִיךְ לְאַשֵּׁר בְּמָסַךְ "בְּדִיקָה וַעֲרִיכָה"' });
    set(
      'active',
      isActive ? { state: 'ok' } : { state: 'bad', detail: 'מִבְחָן אַחֵר פָּעִיל עַכְשָׁו', action: exam.approved ? { label: 'לַהֲפֹךְ לְפָעִיל', run: onMakeActive } : undefined },
    );

    void (async () => {
      const s = await loadTTSSettings();
      if (!providerFor(s)) {
        set('audio', { state: 'warn', detail: 'אֵין חִבּוּר ל-Azure: יֻקְרָא בַּקּוֹל הַמּוּבְנֶה שֶׁל הָאַיְפֶּד' });
      } else {
        const missing = await missingJobs(exam, s);
        set(
          'audio',
          missing.length === 0
            ? { state: 'ok' }
            : { state: 'bad', detail: `חֲסֵרִים ${missing.length} קְבָצִים`, action: { label: '🎧 הֲכָנָה לַמִּבְחָן', run: onPrepare } },
        );
      }
      if (!speech.hasHebrewVoice()) set('audio', { state: 'bad', detail: 'אֵין קוֹל עִבְרִי מוּבְנֶה בָּאַיְפֶּד, לְמִקְרֶה שֶׁקֹּבֶץ חָסֵר' });
    })().catch(() => set('audio', { state: 'bad', detail: 'הַבְּדִיקָה נִכְשְׁלָה' }));

    void checkMicrophone().then((m) => set('mic', { state: m.ok ? 'ok' : 'bad', detail: m.ok ? undefined : m.detail }));

    void freeSpaceMB().then((f) =>
      set(
        'space',
        !f
          ? { state: 'warn', detail: 'הָאַיְפֶּד לֹא מְדַוֵּחַ. בִּדְקִי בַּהַגְדָּרוֹת ← כְּלָלִי ← אִחְסוּן' }
          : f.freeMB >= LOW_SPACE_MB
            ? { state: 'ok', detail: mb(f.freeMB) + ' פְּנוּיִים' }
            : { state: 'bad', detail: `רַק ${mb(f.freeMB)} פְּנוּיִים. כְּדַאי לְפַנּוֹת מָקוֹם אוֹ לִמְחֹק תְּשׁוּבוֹת יְשָׁנוֹת.` },
      ),
    );

    void Promise.all([db.getAnswers(exam.id), db.getMeta<boolean>(`submitted:${exam.id}`)])
      .then(([answers, submitted]) =>
        set(
          'old',
          answers.length === 0 && !submitted
            ? { state: 'ok' }
            : { state: 'warn', detail: `${submitted ? 'הַמִּבְחָן כְּבָר הֻגַּשׁ. ' : ''}יֵשׁ ${answers.length} תְּשׁוּבוֹת (אוּלַי מִנִּסָּיוֹן). אֶפְשָׁר לִמְחֹק בְּמָסַךְ "תְּשׁוּבוֹת".` },
        ),
      )
      .catch(() => set('old', { state: 'warn', detail: 'הַבְּדִיקָה נִכְשְׁלָה' }));

    void db
      .getMeta<string>('studentName')
      .then((n) => set('name', n?.trim() ? { state: 'ok', detail: n } : { state: 'warn', detail: 'אֶפְשָׁר לְהוֹסִיף בַּהַגְדָּרוֹת (יוֹפִיעַ בַּתְּשׁוּבוֹת)' }))
      .catch(() => set('name', { state: 'warn' }));

    void protectStorage().then((p) =>
      set('keep', p ? { state: 'ok' } : { state: 'warn', detail: 'כְּדַאי לְהוֹסִיף אֶת הָאַפְּלִיקַצְיָה לְמָסַךְ הַבַּיִת (שִׁתּוּף ← "הוֹסָפָה לְמָסַךְ הַבַּיִת")' }),
    );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam.id, isActive, run]);

  const done = rows.length > 0 && rows.every((r) => r.state !== 'wait');
  const bad = rows.filter((r) => r.state === 'bad').length;

  return (
    <div className="modal-backdrop">
      <div className="modal check-modal">
        <h2 className="section-title">🩺 בְּדִיקָה לִפְנֵי מִבְחָן: "{exam.title}"</h2>
        <ul className="pec-list">
          {rows.map((r) => (
            <li key={r.key} className={`pec-row is-${r.state}`}>
              <span className="pec-icon" aria-hidden>
                {ICON[r.state]}
              </span>
              <span className="pec-text">
                <b>{r.title}</b>
                {r.detail && <span className="pec-detail">{r.detail}</span>}
              </span>
              {r.action && (
                <button className="btn btn-small" onClick={r.action.run}>
                  {r.action.label}
                </button>
              )}
            </li>
          ))}
        </ul>
        {done && (
          <div className={`notice ${bad ? 'error' : 'ok'} big-text`}>
            {bad ? `❌ יֵשׁ ${bad} דְּבָרִים לְתַקֵּן לִפְנֵי הַמִּבְחָן.` : '✅ הַכֹּל מוּכָן לַמִּבְחָן.'}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-big" onClick={() => setRun((n) => n + 1)} disabled={!done}>
            🔄 לִבְדֹּק שׁוּב
          </button>
          <button className="btn btn-primary btn-big" onClick={onClose}>
            סְגִירָה
          </button>
        </div>
      </div>
    </div>
  );
}

/** "925 MB" kept left-to-right inside Hebrew text. */
export const mb = (n: number) => `\u2066${n >= 1000 ? `${(n / 1000).toFixed(1)} GB` : `${n} MB`}\u2069`;
