// Review screen: the teacher checks and fixes everything before the student sees the exam.
import { useEffect, useRef, useState } from 'react';
import { db } from '../db';
import { addNikud, hebrewError } from '../claude';
import {
  itemHasNikud,
  mergeNikud,
  wordsWithoutNikud,
  newId,
  sameWords,
  splitNikudAt,
  type Exam,
  type Item,
  type Lang,
  type ReadMode,
  type Txt,
} from '../model';
import { speech, useSpeaking } from '../speech';
import { itemSegments } from '../student/StudentApp';
import { segmentsFor } from '../components/Speak';
import { Modal } from '../components/Modal';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function Review({
  examId,
  activeId,
  onMakeActive,
  onBack,
}: {
  examId: string;
  activeId: string;
  onMakeActive: (id: string) => Promise<void>;
  onBack: () => void;
}) {
  const [exam, setExam] = useState<Exam | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [justApproved, setJustApproved] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const latest = useRef<Exam | null>(null);

  useEffect(() => {
    db.getExam(examId).then((e) => {
      if (e) {
        latest.current = e;
        setExam(e);
      }
    });
    return () => {
      // Save right away when leaving the screen.
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        if (latest.current) void db.putExam(latest.current);
      }
      speech.stop();
    };
  }, [examId]);

  if (!exam) return <div className="boot-msg">טוֹעֶנֶת…</div>;

  function persist(next: Exam) {
    latest.current = next;
    setExam(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void db.putExam(next);
    }, 400);
  }

  /** Any change sends the exam back to draft: the teacher approves again. */
  function change(fn: (e: Exam) => void) {
    const next = clone(exam!);
    fn(next);
    next.approved = false;
    setJustApproved(false);
    setProblems([]);
    persist(next);
  }

  const setItem = (i: number, fn: (it: Item) => void) => change((e) => fn(e.items[i]));

  function move(i: number, d: -1 | 1) {
    change((e) => {
      const j = i + d;
      if (j < 0 || j >= e.items.length) return;
      [e.items[i], e.items[j]] = [e.items[j], e.items[i]];
    });
  }

  function split(i: number, pos: number) {
    change((e) => {
      const it = e.items[i];
      const text = it.text.text;
      const a = text.slice(0, pos).trim();
      const b = text.slice(pos).trim();
      if (!a || !b) return;
      let na: string | undefined;
      let nb: string | undefined;
      if (it.text.nikud) {
        const parts = splitNikudAt(text, it.text.nikud, pos);
        if (parts) {
          na = parts[0].trim();
          nb = parts[1].trim();
        }
      }
      const first: Item = { ...clone(it), text: { text: a, nikud: na }, options: [], kind: 'open' };
      const second: Item = { ...clone(it), id: newId(), label: `${it.label}-2`, text: { text: b, nikud: nb } };
      e.items.splice(i, 1, first, second);
    });
  }

  function mergeNext(i: number) {
    change((e) => {
      const a = e.items[i];
      const b = e.items[i + 1];
      if (!b) return;
      const join = (x?: string, y?: string) => (x !== undefined && y !== undefined ? `${x}\n${y}` : undefined);
      const merged: Item = {
        ...a,
        text: { text: `${a.text.text}\n${b.text.text}`, nikud: join(a.text.nikud, b.text.nikud) },
        options: [...a.options, ...b.options],
        kind: a.kind === 'choice' || b.kind === 'choice' ? 'choice' : 'open',
        reveals: a.reveals || b.reveals,
        revealReason: a.revealReason || b.revealReason,
        stem: a.stem ?? b.stem,
        sourceWarning: a.sourceWarning || b.sourceWarning,
      };
      merged.useNikud = merged.useNikud && !!merged.text.nikud;
      e.items.splice(i, 2, merged);
    });
  }

  function approve() {
    const list: string[] = [];
    if (exam!.items.length === 0) list.push('אֵין שְׁאֵלוֹת בַּמִּבְחָן.');
    exam!.items.forEach((it) => {
      if (!it.text.text.trim() && !it.stem?.text.trim()) list.push(`שְׁאֵלָה ${it.label}: אֵין טֶקְסְט.`);
      if (it.kind === 'choice' && it.options.filter((o) => o.text.trim()).length < 2)
        list.push(`שְׁאֵלָה ${it.label}: שְׁאֵלָה אֲמֶרִיקָאִית צְרִיכָה לְפָחוֹת 2 אֶפְשָׁרֻיּוֹת.`);
    });
    setProblems(list);
    if (list.length > 0) return;
    const next = clone(exam!);
    next.approved = true;
    // Empty options are not shown to the student.
    next.items.forEach((it) => (it.options = it.options.filter((o) => o.text.trim())));
    persist(next);
    setJustApproved(true);
  }

  // The header button checks too; problems and the result are shown in the box at the bottom.
  function approveFromTop() {
    approve();
    window.setTimeout(() => document.querySelector('.approve-box')?.scrollIntoView({ behavior: 'smooth' }), 50);
  }

  const flaggedCount = exam.items.filter((it) => it.reveals).length;
  const isActive = exam.id === activeId;

  return (
    <div className="app teacher">
      <header className="header">
        <div className="header-title">🔍 בְּדִיקַת מִבְחָן</div>
        <div className="header-tools">
          {!exam.approved && (
            <button className="btn btn-small btn-primary" onClick={approveFromTop}>
              ✅ אִשּׁוּר
            </button>
          )}
          <button className="btn btn-small" onClick={onBack}>
            → לָרְשִׁימָה
          </button>
        </div>
      </header>
      <main className="main">
        <div className="page review">
          <div className="card">
            <label className="field-label" htmlFor="rev-title">
              שֵׁם הַמִּבְחָן
            </label>
            <input
              id="rev-title"
              className="text-input"
              value={exam.title}
              onChange={(ev) => change((e) => (e.title = ev.target.value))}
            />
            {exam.approved ? (
              <div className="notice ok">✅ הַמִּבְחָן מְאֻשָּׁר. {isActive ? 'הוּא הַמִּבְחָן הַפָּעִיל.' : 'הוּא עוֹד לֹא הַמִּבְחָן הַפָּעִיל.'}</div>
            ) : (
              <div className="notice">
                📝 טְיוּטָה: הַתַּלְמִידָה לֹא תִּרְאֶה אֶת הַמִּבְחָן עַד שֶׁתְּאַשְּׁרִי אוֹתוֹ (כַּפְתּוֹר "אִשּׁוּר" לְמַטָּה). כָּל שִׁנּוּי
                מַחְזִיר אֶת הַמִּבְחָן לִטְיוּטָה.
              </div>
            )}
            {flaggedCount > 0 && (
              <div className="notice flag-note">
                🟡 {flaggedCount} שְׁאֵלוֹת מְסֻמָּנוֹת בְּצָהֹב: הַקְרָאָה אוֹ נִקּוּד עֲלוּלִים לַחְשֹׂף בָּהֶן אֶת הַתְּשׁוּבָה. בִּדְקִי אֶת הַהַגְדָּרוֹת
                שֶׁלָּהֶן.
              </div>
            )}
            {(exam.notes ?? []).map((n, i) => (
              <div key={i} className="notice">
                ⚠️ {n}
              </div>
            ))}
          </div>

          {exam.instructions.length > 0 && (
            <section>
              <h2 className="section-title">הַנְחָיוֹת כְּלָלִיּוֹת</h2>
              {exam.instructions.map((b, bi) => (
                <div key={b.id} className="card review-card">
                  <div className="card-tools">
                    <PlayButton id={`rev-${b.id}`} segs={() => segmentsFor(b.text.nikud ?? b.text.text, `rev-${b.id}`, b.lang, 'normal')} />
                    <LangSelect value={b.lang} onChange={(l) => change((e) => (e.instructions[bi].lang = l))} />
                    <button
                      className="btn btn-small btn-danger-outline"
                      onClick={() => change((e) => e.instructions.splice(bi, 1))}
                    >
                      🗑️
                    </button>
                  </div>
                  <TxtEditor value={b.text} lang={b.lang} onChange={(t) => change((e) => (e.instructions[bi].text = t))} />
                </div>
              ))}
            </section>
          )}

          {exam.passages.length > 0 && (
            <section>
              <h2 className="section-title">קִטְעֵי קְרִיאָה</h2>
              {exam.passages.map((p, pi) => (
                <div key={p.id} className="card review-card">
                  <div className="card-tools">
                    <PlayButton
                      id={`rev-${p.id}`}
                      segs={() => [
                        ...segmentsFor(p.title.nikud ?? p.title.text, `rev-${p.id}`, p.lang, 'normal'),
                        ...segmentsFor(p.body.nikud ?? p.body.text, `rev-${p.id}`, p.lang, 'normal'),
                      ]}
                    />
                    <LangSelect value={p.lang} onChange={(l) => change((e) => (e.passages[pi].lang = l))} />
                  </div>
                  <TxtEditor label="כּוֹתֶרֶת" value={p.title} lang={p.lang} onChange={(t) => change((e) => (e.passages[pi].title = t))} />
                  <TxtEditor label="הַקֶּטַע" value={p.body} lang={p.lang} big onChange={(t) => change((e) => (e.passages[pi].body = t))} />
                </div>
              ))}
            </section>
          )}

          <section>
            <h2 className="section-title">שְׁאֵלוֹת ({exam.items.length})</h2>
            {exam.items.map((it, i) => (
              <ItemCard
                key={it.id}
                item={it}
                index={i}
                total={exam.items.length}
                passages={exam.passages.map((p) => ({ id: p.id, title: p.title.text || `קֶטַע ${exam.passages.indexOf(p) + 1}` }))}
                onChange={(fn) => setItem(i, fn)}
                onMove={(d) => move(i, d)}
                onSplit={(pos) => split(i, pos)}
                onMergeNext={() => mergeNext(i)}
                onDelete={() => setConfirmDelete(i)}
              />
            ))}
          </section>

          <div className="card approve-box">
            {problems.length > 0 && (
              <div className="notice error">
                {problems.map((p, i) => (
                  <div key={i}>❌ {p}</div>
                ))}
              </div>
            )}
            {exam.approved ? (
              <>
                <div className="notice ok">✅ הַמִּבְחָן מְאֻשָּׁר וְזָמִין לַתַּלְמִידָה.</div>
                {!isActive && (
                  <button className="btn btn-primary btn-huge" onClick={() => onMakeActive(exam.id)}>
                    ⭐ לְהַפְכּוֹ לַמִּבְחָן הַפָּעִיל
                  </button>
                )}
                {isActive && justApproved && <div className="help">זֶה הַמִּבְחָן שֶׁהַתַּלְמִידָה תִּרְאֶה.</div>}
              </>
            ) : (
              <button className="btn btn-primary btn-huge" onClick={approve}>
                ✅ אִשּׁוּר: הַמִּבְחָן זָמִין לַתַּלְמִידָה
              </button>
            )}
          </div>
        </div>
      </main>
      {confirmDelete !== null && (
        <Modal
          text={`לִמְחֹק אֶת שְׁאֵלָה ${exam.items[confirmDelete]?.label}?`}
          yes="כֵּן, לִמְחֹק"
          no="בִּטּוּל"
          danger
          onNo={() => setConfirmDelete(null)}
          onYes={() => {
            const i = confirmDelete;
            setConfirmDelete(null);
            change((e) => e.items.splice(i, 1));
          }}
        />
      )}
    </div>
  );
}

// ---------- pieces ----------

function PlayButton({ id, segs }: { id: string; segs: () => ReturnType<typeof segmentsFor> }) {
  const current = useSpeaking();
  const [myIds, setMyIds] = useState<string[]>([]);
  const active = current !== null && myIds.includes(current);
  return (
    <button
      className={`btn btn-small ${active ? 'active' : ''}`}
      onClick={() => {
        if (active) {
          speech.stop();
          return;
        }
        const s = segs();
        setMyIds(s.map((x) => x.id));
        speech.speak(s);
      }}
      aria-label={`השמעה ${id}`}
    >
      {active ? '⏹ עֲצִירָה' : '▶️ הַשְׁמָעָה'}
    </button>
  );
}

function LangSelect({ value, onChange }: { value: Lang; onChange: (l: Lang) => void }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as Lang)} aria-label="שפה">
      <option value="he">עִבְרִית</option>
      <option value="en">English</option>
    </select>
  );
}

function rowsFor(text: string, min: number) {
  return Math.max(min, Math.min(14, Math.ceil(text.length / 60) + (text.match(/\n/g)?.length ?? 0)));
}

/** Edits a text and, if it has one, its vocalized version. */
function TxtEditor({
  value,
  onChange,
  lang,
  label,
  big = false,
  textRef,
}: {
  value: Txt;
  onChange: (t: Txt) => void;
  lang: Lang;
  label?: string;
  big?: boolean;
  textRef?: React.Ref<HTMLTextAreaElement>;
}) {
  const dir = lang === 'en' ? 'ltr' : 'rtl';
  const mismatch = value.nikud !== undefined && !sameWords(value.text, value.nikud);
  return (
    <div className="txt-editor">
      {label && <div className="field-label">{label}</div>}
      <textarea
        ref={textRef}
        className="edit-area"
        dir={dir}
        rows={rowsFor(value.text, big ? 5 : 2)}
        value={value.text}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
      />
      {value.nikud !== undefined && (
        <>
          <div className="field-label small">מְנֻקָּד</div>
          <textarea
            className="edit-area nikud"
            dir={dir}
            rows={rowsFor(value.nikud, big ? 5 : 2)}
            value={value.nikud}
            onChange={(e) => onChange({ ...value, nikud: e.target.value })}
          />
          {mismatch && <div className="warn">⚠️ הַמִּלִּים בַּגִּרְסָה הַמְּנֻקֶּדֶת שׁוֹנוֹת מֵהַמָּקוֹר. בִּדְקִי.</div>}
          {!mismatch && wordsWithoutNikud(value.nikud) > 0 && (
            <div className="help">{wordsWithoutNikud(value.nikud)} מִלִּים בְּלִי נִקּוּד</div>
          )}
        </>
      )}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`segmented ${disabled ? 'disabled' : ''}`} role="group">
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? 'on' : ''}
          aria-pressed={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const READ_MODES: { value: ReadMode; label: string }[] = [
  { value: 'normal', label: '🔊 הַקְרָאָה רְגִילָה' },
  { value: 'spell', label: '🔤 אִיּוּת אוֹת-אוֹת' },
  { value: 'none', label: '🔇 בְּלִי הַקְרָאָה' },
];

function ItemCard({
  item,
  index,
  total,
  passages,
  onChange,
  onMove,
  onSplit,
  onMergeNext,
  onDelete,
}: {
  item: Item;
  index: number;
  total: number;
  passages: { id: string; title: string }[];
  onChange: (fn: (it: Item) => void) => void;
  onMove: (d: -1 | 1) => void;
  onSplit: (pos: number) => void;
  onMergeNext: () => void;
  onDelete: () => void;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [splitHint, setSplitHint] = useState(false);
  const hasNikud = itemHasNikud(item);
  const [nikudState, setNikudState] = useState<{ busy: boolean; msg?: string; error?: boolean }>({ busy: false });

  /** Asks Claude to vocalize just this question (its shared text, the question and the options). */
  async function vocalize() {
    const apiKey = await db.getMeta<string>('apiKey');
    if (!apiKey) {
      setNikudState({ busy: false, error: true, msg: 'אֵין מַפְתֵּחַ Claude. הַכְנִיסִי אוֹתוֹ בַּהַגְדָּרוֹת.' });
      return;
    }
    setNikudState({ busy: true });
    const texts: { id: string; text: string }[] = [];
    if (item.stem) texts.push({ id: 'stem', text: item.stem.text });
    texts.push({ id: 'text', text: item.text.text });
    item.options.forEach((o, i) => texts.push({ id: `o${i}`, text: o.text }));
    try {
      const res = await addNikud(apiKey, texts.filter((t) => t.text.trim()), () => {});
      let missing = 0;
      const fit = (id: string, t: Txt) => {
        const voc = res[id];
        const m = voc ? mergeNikud(t.text, voc) : null;
        if (!m || m.matched === 0) return t;
        missing += m.total - m.matched;
        return { ...t, nikud: m.text };
      };
      onChange((it) => {
        if (it.stem) it.stem = fit('stem', it.stem);
        it.text = fit('text', it.text);
        it.options = it.options.map((o, i) => fit(`o${i}`, o));
        it.useNikud = itemHasNikud(it);
      });
      setNikudState({ busy: false, msg: missing ? `נֻקַּד. ${missing} מִלִּים נִשְׁאֲרוּ בְּלִי נִקּוּד.` : 'נֻקַּד ✓' });
    } catch (e) {
      setNikudState({ busy: false, error: true, msg: hebrewError(e) });
    }
  }
  const dir = item.lang === 'en' ? 'ltr' : 'rtl';

  return (
    <div className={`card review-card item-card ${item.reveals ? 'flagged' : ''}`}>
      <div className="card-tools">
        <input
          className="text-input label-input"
          value={item.label}
          aria-label="מספר השאלה"
          onChange={(e) => onChange((it) => (it.label = e.target.value))}
        />
        <PlayButton id={item.id} segs={() => itemSegments(item)} />
        <Segmented
          value={item.kind}
          options={[
            { value: 'open', label: 'פְּתוּחָה' },
            { value: 'choice', label: 'אֲמֶרִיקָאִית' },
          ]}
          onChange={(k) =>
            onChange((it) => {
              it.kind = k;
              if (k === 'choice' && it.options.length === 0) it.options = [{ text: '' }, { text: '' }];
            })
          }
        />
        <LangSelect value={item.lang} onChange={(l) => onChange((it) => (it.lang = l))} />
        <select
          className="select"
          value={item.passageId ?? ''}
          aria-label="קטע קריאה"
          onChange={(e) => onChange((it) => (it.passageId = e.target.value || null))}
        >
          <option value="">בְּלִי קֶטַע</option>
          {passages.map((p) => (
            <option key={p.id} value={p.id}>
              📖 {p.title}
            </option>
          ))}
        </select>
      </div>

      {item.reveals && (
        <div className="flag-banner">
          🟡 <b>עֲלוּלָה לַחְשֹׂף תְּשׁוּבָה.</b> {item.revealReason ?? ''} כְּדַאי לִשְׁקֹל "אִיּוּת אוֹת-אוֹת" אוֹ "בְּלִי הַקְרָאָה".
        </div>
      )}
      {item.sourceWarning && <div className="warn">⚠️ הַטֶּקְסְט לֹא נִמְצָא מִלָּה בְּמִלָּה בַּקֹּבֶץ הַמְּקוֹרִי. בִּדְקִי אוֹתוֹ.</div>}

      <div className="settings-row">
        <span className="setting-name">נִקּוּד:</span>
        <Segmented
          value={item.useNikud && hasNikud ? 'on' : 'off'}
          disabled={!hasNikud}
          options={[
            { value: 'on', label: 'כֵּן' },
            { value: 'off', label: 'לֹא' },
          ]}
          onChange={(v) => onChange((it) => (it.useNikud = v === 'on'))}
        />
        {!hasNikud && <span className="help">(אֵין נִקּוּד לַשְּׁאֵלָה הַזֹּאת)</span>}
        {item.lang === 'he' && (
          <button className="btn btn-small" onClick={vocalize} disabled={nikudState.busy}>
            {nikudState.busy ? '⏳ מְנַקֶּדֶת…' : hasNikud ? '✨ לְנַקֵּד שׁוּב' : '✨ לְנַקֵּד'}
          </button>
        )}
        {nikudState.msg && <span className={nikudState.error ? 'warn' : 'help'}>{nikudState.msg}</span>}
      </div>
      <div className="settings-row">
        <span className="setting-name">הַקְרָאָה:</span>
        <Segmented value={item.readMode} options={READ_MODES} onChange={(m) => onChange((it) => (it.readMode = m))} />
      </div>
      <label className="check-row small">
        <input type="checkbox" checked={item.reveals} onChange={(e) => onChange((it) => (it.reveals = e.target.checked))} />
        <span>סִמּוּן: שְׁאֵלָה שֶׁעֲלוּלָה לַחְשֹׂף תְּשׁוּבָה</span>
      </label>

      {item.stem && (
        <TxtEditor
          label="טֶקְסְט מְשֻׁתָּף (לִפְנֵי הַסָּעִיף)"
          value={item.stem}
          lang={item.lang}
          onChange={(t) => onChange((it) => (it.stem = t))}
        />
      )}
      <TxtEditor
        label="הַשְּׁאֵלָה"
        value={item.text}
        lang={item.lang}
        textRef={textRef}
        onChange={(t) => onChange((it) => (it.text = t))}
      />

      {item.kind === 'choice' && (
        <div className="options-editor" dir={dir}>
          <div className="field-label">אֶפְשָׁרֻיּוֹת</div>
          {item.options.map((o, oi) => (
            <div key={oi} className="option-edit-row">
              <span className="option-num">{oi + 1}</span>
              <TxtEditor
                value={o}
                lang={item.lang}
                onChange={(t) => onChange((it) => (it.options[oi] = t))}
              />
              <button
                className="btn btn-icon"
                aria-label="להסיר אפשרות"
                onClick={() => onChange((it) => it.options.splice(oi, 1))}
              >
                ✕
              </button>
            </div>
          ))}
          <button className="btn btn-small" onClick={() => onChange((it) => it.options.push({ text: '' }))}>
            ➕ אֶפְשָׁרוּת
          </button>
        </div>
      )}

      {splitHint && <div className="help">שִׂימִי אֶת הַסַּמָּן בְּתוֹךְ הַשְּׁאֵלָה, בַּמָּקוֹם שֶׁבּוֹ לַחְתֹּךְ, וּלְחָצִי שׁוּב עַל "פִּצּוּל".</div>}
      <div className="card-actions">
        <button className="btn btn-small" onClick={() => onMove(-1)} disabled={index === 0}>
          ⬆️ לְמַעְלָה
        </button>
        <button className="btn btn-small" onClick={() => onMove(1)} disabled={index === total - 1}>
          ⬇️ לְמַטָּה
        </button>
        <button
          className="btn btn-small"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const ta = textRef.current;
            const pos = ta ? ta.selectionStart : 0;
            const text = item.text.text;
            if (!ta || pos <= 0 || pos >= text.length || !text.slice(0, pos).trim() || !text.slice(pos).trim()) {
              setSplitHint(true);
              ta?.focus();
              return;
            }
            setSplitHint(false);
            onSplit(pos);
          }}
        >
          ✂️ פִּצּוּל
        </button>
        <button className="btn btn-small" onClick={onMergeNext} disabled={index === total - 1}>
          🔗 אִחוּד עִם הַבָּאָה
        </button>
        <button className="btn btn-small btn-danger-outline" onClick={onDelete}>
          🗑️ מְחִיקָה
        </button>
      </div>
    </div>
  );
}
