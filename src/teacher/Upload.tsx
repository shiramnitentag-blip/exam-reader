import { useEffect, useRef, useState } from 'react';
import { db } from '../db';
import { extractExam, hebrewError, type Progress, type SourceInput } from '../claude';
import { blobToBase64, fileKind, prepareImage, readDocx, type PreparedImage } from '../files';
import { vocalizeTexts, fallbackNote } from '../nikud';
import { applyNikud, attachDocxPictures, finishNikud, hebrewTexts, rawToExam } from '../importer';
import { keepScreenOn } from '../device';

type Step = { key: string; label: string; state: 'wait' | 'run' | 'done' | 'error'; detail?: string };

export function Upload({
  onBack,
  onSettings,
  onDone,
}: {
  onBack: () => void;
  onSettings: () => void;
  onDone: (examId: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [doc, setDoc] = useState<File | null>(null);
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [wantNikud, setWantNikud] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [error, setError] = useState('');
  const [pickError, setPickError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const startRef = useRef(0);
  const [, setTick] = useState(0);

  useEffect(() => {
    db.getMeta<string>('apiKey').then((k) => setApiKey(k ?? ''));
  }, []);

  // Tick every second while working, so the elapsed time updates.
  const running = !!steps && steps.some((s) => s.state === 'run');
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setPickError('');
    const files = Array.from(list);
    const first = files[0];
    const kind = fileKind(first);
    if (kind === 'docx' || kind === 'pdf') {
      setDoc(first);
      setImages([]);
      return;
    }
    if (kind !== 'image') {
      setPickError('אֶפְשָׁר לְהַעֲלוֹת רַק קֹבֶץ Word (docx), PDF, אוֹ תְּמוּנוֹת.');
      return;
    }
    setDoc(null);
    setPreparing(true);
    try {
      const prepared: PreparedImage[] = [];
      for (const f of files) {
        if (fileKind(f) !== 'image') continue;
        prepared.push(await prepareImage(f));
      }
      setImages((prev) => [...prev, ...prepared]);
    } catch {
      setPickError('לֹא הִצְלַחְתִּי לִפְתֹּחַ אֶת הַתְּמוּנָה. נַסִּי תְּמוּנָה אַחֶרֶת.');
    } finally {
      setPreparing(false);
    }
  }

  function moveImage(i: number, d: -1 | 1) {
    setImages((prev) => {
      const next = [...prev];
      const j = i + d;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function setStep(key: string, patch: Partial<Step>) {
    setSteps((prev) => prev && prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  function progressText(p: Progress, what: string) {
    if (p.phase === 'thinking') return 'Claude קוֹרֵא…';
    return `${what}: ${p.found}`;
  }

  async function run() {
    if (!apiKey) return;
    setError('');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    startRef.current = Date.now();
    const list: Step[] = [
      { key: 'prep', label: 'מְכִינָה אֶת הַקֹּבֶץ', state: 'run' },
      { key: 'read', label: 'Claude קוֹרֵא אֶת הַמִּבְחָן', state: 'wait' },
      ...(wantNikud ? [{ key: 'nikud', label: 'מוֹסִיפָה נִקּוּד (דִּיקְטָה)', state: 'wait' as const }] : []),
      { key: 'save', label: 'שׁוֹמֶרֶת', state: 'wait' },
    ];
    setSteps(list);
    keepScreenOn(true); // the iPad must not sleep in the middle
    let current = 'prep';
    try {
      let input: SourceInput;
      let sourceText: string | undefined;
      let docxImages = 0;
      let unreadable = 0;
      let pictures: PreparedImage[] = []; // pictures from the Word file
      let source: { pdf?: Blob; pages?: Blob[] } = {};
      if (doc && fileKind(doc) === 'docx') {
        const d = await readDocx(doc);
        if (!d.plainText.trim() && d.images.length === 0) throw new Error('empty-docx');
        sourceText = d.plainText;
        docxImages = d.images.length;
        unreadable = d.unreadable;
        pictures = d.images;
        source = { pages: d.images.map((i) => i.blob) };
        input = { kind: 'text', text: d.text, images: d.images.map((i) => ({ base64: i.base64, mediaType: i.mediaType })) };
        if (docxImages > 0) setStep('prep', { detail: `טֶקְסְט + ${docxImages} תְּמוּנוֹת` });
      } else if (doc) {
        input = { kind: 'pdf', base64: await blobToBase64(doc) };
        source = { pdf: doc };
      } else {
        input = { kind: 'images', images: images.map((i) => ({ base64: i.base64, mediaType: i.mediaType })) };
        source = { pages: images.map((i) => i.blob) };
      }
      setStep('prep', { state: 'done' });

      current = 'read';
      setStep('read', { state: 'run' });
      const raw = await extractExam(
        apiKey,
        input,
        (p) => setStep('read', { detail: progressText(p, 'שְׁאֵלוֹת שֶׁנִּמְצְאוּ') }),
        ctrl.signal,
      );
      if (raw.questions.length === 0) throw new Error('no-questions');
      const exam = rawToExam(raw, { title, sourceText, wantNikud, hasPictures: docxImages > 0 });
      if (unreadable > 0)
        exam.notes!.push(
          `בַּקֹּבֶץ יֵשׁ ${unreadable} צִיּוּרִים שֶׁלֹּא הִצְלַחְתִּי לִקְרֹא. אִם יֵשׁ בָּהֶם טֶקְסְט שֶׁל הַמִּבְחָן, עֲדִיף לְהַעֲלוֹת אֶת הַמִּבְחָן כְּ-PDF.`,
        );
      setStep('read', { state: 'done', detail: `נִמְצְאוּ ${exam.items.length} שְׁאֵלוֹת` });

      if (wantNikud) {
        current = 'nikud';
        setStep('nikud', { state: 'run' });
        const texts = hebrewTexts(exam).map(({ id, text }) => ({ id, text }));
        if (texts.length > 0) {
          const total = texts.length;
          const run = await vocalizeTexts(apiKey, texts, (detail) => setStep('nikud', { detail }), ctrl.signal);
          const r = applyNikud(exam, run.result);
          finishNikud(exam, r.partial, r.failedIds.length);
          const note = fallbackNote(run);
          if (note) exam.notes = [note, ...(exam.notes ?? [])];
          const ok = total - r.failedIds.length;
          setStep('nikud', {
            state: 'done',
            detail: (ok === total ? 'הַכֹּל מְנֻקָּד' : `${ok} מִתּוֹךְ ${total} קְטָעִים`) + (note ? ' · שִׁיטָה חֲלוּפִית (Claude)' : ''),
          });
        } else setStep('nikud', { state: 'done', detail: 'אֵין טֶקְסְט בְּעִבְרִית' });
      }

      current = 'save';
      setStep('save', { state: 'run' });
      // Pictures from the Word file go to the question they belong to; the source file is kept,
      // so the teacher can cut out pictures from it later.
      await attachDocxPictures(exam, pictures);
      await db.putSource({ examId: exam.id, ...source });
      await db.putExam(exam);
      setStep('save', { state: 'done' });
      keepScreenOn(false);
      onDone(exam.id);
    } catch (e) {
      keepScreenOn(false);
      setStep(current, { state: 'error' });
      if (ctrl.signal.aborted) {
        setSteps(null);
        return;
      }
      const msg =
        e instanceof Error && e.message === 'empty-docx'
          ? 'קֹבֶץ הַ-Word רֵיק, אוֹ שֶׁהַטֶּקְסְט בּוֹ הוּא תְּמוּנָה. נַסִּי לְהַעֲלוֹת אוֹתוֹ כְּ-PDF אוֹ לְצַלֵּם אוֹתוֹ.'
          : e instanceof Error && e.message === 'no-questions'
            ? 'Claude לֹא מָצָא שְׁאֵלוֹת בַּקֹּבֶץ. בִּדְקִי שֶׁזֶּה הַקֹּבֶץ הַנָּכוֹן, וְשֶׁהַצִּלּוּם בָּרוּר.'
            : e instanceof Error && /mammoth|zip|central directory/i.test(e.message)
              ? 'לֹא הִצְלַחְתִּי לִקְרֹא אֶת קֹבֶץ הַ-Word. נַסִּי לִשְׁמֹר אוֹתוֹ מֵחָדָשׁ כְּ-docx, אוֹ לְהַעֲלוֹת PDF.'
              : hebrewError(e);
      setError(msg);
    }
  }

  const elapsed = Math.round((Date.now() - startRef.current) / 1000);
  const ready = (!!doc || images.length > 0) && !preparing;

  // ---------- processing screen ----------
  if (steps) {
    const failed = steps.some((s) => s.state === 'error');
    return (
      <div className="app teacher">
        <header className="header">
          <div className="header-title">⏳ מְעַבֶּדֶת אֶת הַמִּבְחָן</div>
        </header>
        <main className="main">
          <div className="page narrow">
            <div className="card">
              <ol className="steps">
                {steps.map((s) => (
                  <li key={s.key} className={`step ${s.state}`}>
                    <span className="step-icon">
                      {s.state === 'done' ? '✅' : s.state === 'run' ? <span className="spinner" /> : s.state === 'error' ? '❌' : '⚪'}
                    </span>
                    <span className="step-label">{s.label}</span>
                    {s.detail && <span className="step-detail">{s.detail}</span>}
                  </li>
                ))}
              </ol>
              {running && (
                <p className="help">
                  עָבְרוּ {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} דַּקּוֹת. מִבְחָן אָרֹךְ יָכוֹל לָקַחַת כַּמָּה
                  דַּקּוֹת. אַל תִּסְגְּרִי אֶת הָאַפְּלִיקַצְיָה.
                </p>
              )}
              {failed && error && <div className="notice error">❌ {error}</div>}
              <div className="row-actions">
                {running && (
                  <button className="btn" onClick={() => abortRef.current?.abort()}>
                    ✋ בִּטּוּל
                  </button>
                )}
                {failed && (
                  <>
                    <button className="btn btn-primary" onClick={run}>
                      🔄 לְנַסּוֹת שׁוּב
                    </button>
                    <button className="btn" onClick={() => setSteps(null)}>
                      → חֲזָרָה
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ---------- choosing files ----------
  return (
    <div className="app teacher">
      <header className="header">
        <div className="header-title">➕ מִבְחָן חָדָשׁ</div>
        <div className="header-tools">
          <button className="btn btn-small" onClick={onBack}>
            → חֲזָרָה
          </button>
        </div>
      </header>
      <main className="main">
        <div className="page narrow">
          {apiKey === '' && (
            <div className="notice">
              צָרִיךְ קֹדֶם לְהַכְנִיס מַפְתֵּחַ Claude.{' '}
              <button className="link-btn" onClick={onSettings}>
                לַהַגְדָּרוֹת
              </button>
            </div>
          )}
          <div className="card">
            <label className="field-label" htmlFor="exam-title">
              שֵׁם הַמִּבְחָן (לֹא חוֹבָה)
            </label>
            <input
              id="exam-title"
              className="text-input"
              value={title}
              placeholder="לְמָשָׁל: מִבְחָן בְּסִפְרוּת, כִּתָּה ט׳"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="card">
            <h2 className="section-title">מֵאֵיפֹה הַמִּבְחָן?</h2>
            <div className="pick-grid">
              <label className="pick-btn">
                <span className="pick-icon">📄</span>
                קֹבֶץ Word אוֹ PDF
                <input
                  type="file"
                  accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => {
                    void addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
              <label className="pick-btn">
                <span className="pick-icon">📷</span>
                לְצַלֵּם עַמּוּד
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={(e) => {
                    void addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
              <label className="pick-btn">
                <span className="pick-icon">🖼️</span>
                מֵהַתְּמוּנוֹת
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    void addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {pickError && <div className="notice error">{pickError}</div>}
            {preparing && <div className="help">⏳ מְכִינָה אֶת הַתְּמוּנוֹת…</div>}

            {doc && (
              <div className="picked-file">
                <span>{fileKind(doc) === 'pdf' ? '📕' : '📘'}</span>
                <span className="picked-name" dir="auto">
                  {doc.name}
                </span>
                <button className="btn btn-small" onClick={() => setDoc(null)}>
                  ✕ הֲסָרָה
                </button>
              </div>
            )}
            {images.length > 0 && (
              <>
                <p className="help">הָעַמּוּדִים לְפִי הַסֵּדֶר. אֶפְשָׁר לְהוֹסִיף עוֹד צִלּוּמִים, וּלְשַׁנּוֹת סֵדֶר בַּחִצִּים.</p>
                <div className="thumbs">
                  {images.map((img, i) => (
                    <div key={img.previewUrl} className="thumb">
                      <img src={img.previewUrl} alt={`עמוד ${i + 1}`} />
                      <div className="thumb-num">עַמּוּד {i + 1}</div>
                      <div className="thumb-actions">
                        <button className="btn btn-icon" onClick={() => moveImage(i, -1)} disabled={i === 0} aria-label="להקדים">
                          →
                        </button>
                        <button
                          className="btn btn-icon"
                          onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                          aria-label="להסיר"
                        >
                          ✕
                        </button>
                        <button
                          className="btn btn-icon"
                          onClick={() => moveImage(i, 1)}
                          disabled={i === images.length - 1}
                          aria-label="לאחר"
                        >
                          ←
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="card">
            <label className="check-row">
              <input type="checkbox" checked={wantNikud} onChange={(e) => setWantNikud(e.target.checked)} />
              <span>
                <b>לְהוֹסִיף נִקּוּד</b>
                <br />
                <span className="help">
                  הַנַּקְדָן שֶׁל דִּיקְטָה יְנַקֵּד אֶת הַטֶּקְסְט בְּעִבְרִית (וְאִם הוּא לֹא זָמִין, Claude). הַטֶּקְסְט נִשְׁלָח לְדִיקְטָה לְשֵׁם כָּךְ. בִּשְׁאֵלוֹת שֶׁעֲלוּלוֹת לַחְשֹׂף
                  תְּשׁוּבָה, הַנִּקּוּד יִהְיֶה כָּבוּי.
                </span>
              </span>
            </label>
          </div>

          <button className="btn btn-primary btn-huge" disabled={!ready || !apiKey} onClick={run}>
            ✨ לְעַבֵּד אֶת הַמִּבְחָן
          </button>
        </div>
      </main>
    </div>
  );
}
