// "Answers" in teacher mode: which exams were answered, and everything the student answered.
import { useEffect, useState } from 'react';
import { db } from '../db';
import { Modal } from '../components/Modal';
import {
  answeredExams,
  formatDate,
  formatDuration,
  loadReport,
  mediaLines,
  optionLetter,
  recordingLine,
  statusText,
  type Report,
  type ReportItem,
  type Summary,
} from '../report';
import { buildDocx, buildRecordingsZip, deliver } from '../export';
import { buildPdf } from '../pdf';
import { speech } from '../speech';
import { MediaList } from '../components/Media';

export function AnswersList({ onBack, onOpen }: { onBack: () => void; onOpen: (examId: string) => void }) {
  const [list, setList] = useState<Summary[] | null>(null);

  useEffect(() => {
    answeredExams()
      .then(setList)
      .catch(() => setList([]));
  }, []);

  return (
    <div className="app teacher">
      <header className="header">
        <div className="header-title">📥 תְּשׁוּבוֹת</div>
        <div className="header-tools">
          <button className="btn btn-small" onClick={onBack}>
            → חֲזָרָה
          </button>
        </div>
      </header>
      <main className="main">
        <div className="page narrow">
          {list === null && <div className="help">טוֹעֶנֶת…</div>}
          {list?.length === 0 && (
            <div className="card">
              <p className="big-text">עוֹד אֵין תְּשׁוּבוֹת.</p>
              <p className="help">כְּשֶׁהַתַּלְמִידָה תַּתְחִיל מִבְחָן, הוּא יוֹפִיעַ כָּאן.</p>
            </div>
          )}
          <div className="exam-list">
            {list?.map((s) => (
              <button key={s.exam.id} className="card exam-card answers-row" onClick={() => onOpen(s.exam.id)}>
                <div className="exam-card-head">
                  <div className="exam-card-title">{s.exam.title}</div>
                  <span className={`badge ${s.status === 'submitted' ? 'green' : 'yellow'}`}>
                    {s.status === 'submitted' ? '✅ הוּגַשׁ' : '⏳ בְּתַהֲלִיךְ'}
                  </span>
                </div>
                <div className="exam-card-meta">
                  {s.studentName ? `👧 ${s.studentName} · ` : ''}
                  {formatDate(s.date)}
                </div>
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

type Making = { state: 'idle' | 'making' | 'ready' | 'none' | 'error'; file?: File; msg?: string };

export function AnswersDetail({ examId, onBack }: { examId: string; onBack: () => void }) {
  const [report, setReport] = useState<Report | null | undefined>(undefined);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [pdf, setPdf] = useState<Making>({ state: 'idle' });
  const [docx, setDocx] = useState<Making>({ state: 'idle' });
  const [zip, setZip] = useState<Making>({ state: 'idle' });
  const [confirmStep, setConfirmStep] = useState<0 | 1 | 2>(0);
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    speech.stop();
    let made: string[] = [];
    let cancelled = false;
    (async () => {
      const r = await loadReport(examId);
      if (cancelled) return;
      setReport(r);
      if (!r) return;
      // Recordings ready to play.
      const map: Record<string, string> = {};
      for (const it of r.items)
        for (const c of it.clips) {
          const blob = await db.getRecordingBlob(c.id);
          if (blob) map[c.id] = URL.createObjectURL(blob);
        }
      made = Object.values(map);
      if (!cancelled) setUrls(map);
    })().catch(() => setReport(null));
    return () => {
      cancelled = true;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [examId]);

  if (report === undefined) return <div className="boot-msg">טוֹעֶנֶת…</div>;

  const header = (
    <header className="header no-print">
      <div className="header-title">📥 {report?.exam.title ?? 'תְּשׁוּבוֹת'}</div>
      <div className="header-tools">
        <button className="btn btn-small" onClick={onBack}>
          → לָרְשִׁימָה
        </button>
      </div>
    </header>
  );

  if (!report || deleted)
    return (
      <div className="app teacher">
        {header}
        <main className="main">
          <div className="page narrow">
            <div className="notice ok">{deleted ? '✅ הַתְּשׁוּבוֹת וְהַהַקְלָטוֹת שֶׁל הַמִּבְחָן נִמְחֲקוּ.' : 'אֵין תְּשׁוּבוֹת לַמִּבְחָן הַזֶּה.'}</div>
          </div>
        </main>
      </div>
    );

  const answeredCount = report.items.filter((i) => i.answered).length;
  const clipCount = report.items.reduce((n, i) => n + i.clips.length, 0);

  async function makePdf() {
    setPdf({ state: 'making' });
    try {
      setPdf({ state: 'ready', file: await buildPdf(report!) });
    } catch (e) {
      setPdf({ state: 'error', msg: e instanceof Error ? e.message : String(e) });
    }
  }
  async function makeDocx() {
    setDocx({ state: 'making' });
    try {
      setDocx({ state: 'ready', file: await buildDocx(report!) });
    } catch (e) {
      setDocx({ state: 'error', msg: e instanceof Error ? e.message : String(e) });
    }
  }
  async function makeZip() {
    setZip({ state: 'making' });
    try {
      const f = await buildRecordingsZip(report!);
      setZip(f ? { state: 'ready', file: f } : { state: 'none' });
    } catch (e) {
      setZip({ state: 'error', msg: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="app teacher answers-app">
      {header}
      <main className="main no-print">
        <div className="page review">
          <div className="card">
            <div className="answers-meta">
              <div>
                <b>תַּלְמִידָה:</b> {report.studentName || <span className="help">(לֹא הוּגְדַּר שֵׁם בַּהַגְדָּרוֹת)</span>}
              </div>
              <div>
                <b>תַּאֲרִיךְ:</b> {formatDate(report.date)}
              </div>
              <div>
                <b>מַצָּב:</b>{' '}
                <span className={`badge ${report.status === 'submitted' ? 'green' : 'yellow'}`}>
                  {report.status === 'submitted' ? '✅ הוּגַשׁ' : '⏳ בְּתַהֲלִיךְ'}
                </span>
              </div>
              <div>
                <b>נַעֲנוּ:</b> {answeredCount} מִתּוֹךְ {report.items.length}
              </div>
            </div>

            <h2 className="section-title">יִצּוּא</h2>
            <div className="export-row">
              {pdf.state === 'ready' && pdf.file ? (
                <button className="btn btn-primary" onClick={() => void deliver(pdf.file!)}>
                  📤 לִשְׁמֹר / לִשְׁלֹחַ קֹבֶץ PDF
                </button>
              ) : (
                <button className="btn" onClick={makePdf} disabled={pdf.state === 'making'}>
                  {pdf.state === 'making' ? '⏳ מְכִינָה…' : '📕 PDF'}
                </button>
              )}

              {docx.state === 'ready' && docx.file ? (
                <button className="btn btn-primary" onClick={() => void deliver(docx.file!)}>
                  📤 לִשְׁמֹר / לִשְׁלֹחַ קֹבֶץ Word
                </button>
              ) : (
                <button className="btn" onClick={makeDocx} disabled={docx.state === 'making'}>
                  {docx.state === 'making' ? '⏳ מְכִינָה…' : '📄 Word'}
                </button>
              )}

              {zip.state === 'ready' && zip.file ? (
                <button className="btn btn-primary" onClick={() => void deliver(zip.file!)}>
                  📤 לִשְׁמֹר / לִשְׁלֹחַ הַקְלָטוֹת (ZIP)
                </button>
              ) : (
                <button className="btn" onClick={makeZip} disabled={zip.state === 'making' || clipCount === 0}>
                  {zip.state === 'making' ? '⏳ מְכִינָה…' : clipCount === 0 ? '🎧 אֵין הַקְלָטוֹת' : `🎧 הַקְלָטוֹת (${clipCount})`}
                </button>
              )}
            </div>
            <p className="help">
              לוֹחֲצִים פַּעַם אַחַת כְּדֵי לְהָכִין אֶת הַקֹּבֶץ, וּפַעַם שְׁנִיָּה כְּדֵי לִשְׁמֹר אוֹתוֹ בַּקְּבָצִים אוֹ לִשְׁלֹחַ אוֹתוֹ.
            </p>
            <button className="btn btn-small" onClick={() => window.print()}>
              🖨️ הַדְפָּסָה יְשִׁירָה
            </button>
            {(pdf.state === 'error' || docx.state === 'error' || zip.state === 'error') && (
              <div className="notice error">❌ לֹא הִצְלַחְתִּי לְהָכִין אֶת הַקֹּבֶץ. {pdf.msg ?? docx.msg ?? zip.msg}</div>
            )}
          </div>

          <section>
            {report.items.map((ri) => (
              <AnswerCard key={ri.item.id} ri={ri} urls={urls} />
            ))}
          </section>

          <div className="card danger-zone">
            <h2 className="section-title">🧹 נִקּוּי</h2>
            <p className="help">מוֹחֵק אֶת הַתְּשׁוּבוֹת וְאֶת הַהַקְלָטוֹת שֶׁל הַמִּבְחָן הַזֶּה מֵהָאַיְפֶּד, כְּדֵי לְפַנּוֹת מָקוֹם. כְּדַאי לְיַצֵּא לִפְנֵי כֵן.</p>
            <button className="btn btn-danger-outline" onClick={() => setConfirmStep(1)}>
              🗑️ מְחִיקַת הַתְּשׁוּבוֹת שֶׁל מִבְחָן זֶה
            </button>
          </div>
        </div>
      </main>

      <PrintSheet report={report} />

      {confirmStep === 1 && (
        <Modal
          text={`לִמְחֹק אֶת כָּל הַתְּשׁוּבוֹת וְהַהַקְלָטוֹת שֶׁל "${report.exam.title}"?`}
          yes="כֵּן, לְהַמְשִׁיךְ"
          no="בִּטּוּל"
          danger
          onNo={() => setConfirmStep(0)}
          onYes={() => setConfirmStep(2)}
        />
      )}
      {confirmStep === 2 && (
        <Modal
          text="בָּטוּחָה? אַחֲרֵי הַמְּחִיקָה אִי אֶפְשָׁר לְשַׁחְזֵר אֶת הַתְּשׁוּבוֹת וְאֶת הַהַקְלָטוֹת."
          yes="כֵּן, לִמְחֹק לְצָמִיתוּת"
          no="לֹא, לְהַשְׁאִיר"
          danger
          onNo={() => setConfirmStep(0)}
          onYes={async () => {
            setConfirmStep(0);
            await db.deleteExamData(examId);
            try {
              localStorage.removeItem(`screen:${examId}`);
            } catch {
              /* ignore */
            }
            setDeleted(true);
          }}
        />
      )}
    </div>
  );
}

function AnswerCard({ ri, urls }: { ri: ReportItem; urls: Record<string, string> }) {
  const { item, answer, clips, answered } = ri;
  const dir = item.lang === 'en' ? 'ltr' : 'rtl';
  return (
    <div className={`card answer-card ${answered ? '' : 'unanswered'}`}>
      <div className="answer-head">
        <span className="answer-label">שְׁאֵלָה {item.label}</span>
        {!answered && <span className="badge red">לֹא נַעֲנְתָה</span>}
        {answer?.flagged && <span className="badge yellow">🚩 סִמְּנָה לַחְזֹר</span>}
      </div>
      <div className="question-text" dir={dir}>
        {item.stem?.text.trim() && <p className="stem-text">{item.stem.text}</p>}
        {item.text.text.split('\n').map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
      <MediaList media={item.media} place="all" lang={item.lang} useNikud={false} mode="none" />
      {item.kind === 'choice' && (
        <ol className="answer-options" dir={dir}>
          {item.options.map((o, i) => (
            <li key={i} className={answer?.choice === i ? 'chosen' : ''}>
              <span className="opt-letter">{optionLetter(item, i)}</span> {o.text}
              {answer?.choice === i && <span className="chosen-mark"> ✓ נִבְחֲרָה</span>}
            </li>
          ))}
        </ol>
      )}
      {answer?.text.trim() && (
        <div className="written-answer">
          <div className="field-label">✍️ הַתְּשׁוּבָה בִּכְתָב</div>
          <div className="written-text" dir={dir}>
            {answer.text}
          </div>
        </div>
      )}
      {clips.length > 0 && (
        <div className="recordings">
          <div className="field-label">🎙️ {recordingLine(clips)}</div>
          {clips.map((c, i) => (
            <div key={c.id} className="recording-row">
              {clips.length > 1 && <span className="help">חֵלֶק {i + 1}</span>}
              {urls[c.id] ? <audio controls preload="metadata" src={urls[c.id]} /> : <span className="help">טוֹעֶנֶת…</span>}
              <span className="help">{formatDuration(c.durationSec)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The page that is printed (or saved as PDF). Hidden on screen. */
function PrintSheet({ report }: { report: Report }) {
  return (
    <div className="print-sheet" dir="rtl">
      <h1>{report.exam.title}</h1>
      <div className="print-meta">
        {report.studentName && <span>שם התלמידה: {report.studentName}</span>}
        <span>תאריך: {formatDate(report.date)}</span>
        <span>{statusText(report.status)}</span>
      </div>
      {report.items.map(({ item, answer, clips, answered }) => {
        const dir = item.lang === 'en' ? 'ltr' : 'rtl';
        return (
          <section key={item.id} className="print-q">
            <h2>שאלה {item.label}</h2>
            <div dir={dir}>
              {item.stem?.text.trim() && <p className="print-stem">{item.stem.text}</p>}
              {item.text.text.split('\n').map((l, i) => (
                <p key={i}>{l}</p>
              ))}
              {mediaLines(item).map((l, i) => (
                <p key={`m${i}`} className="print-stem">
                  {l}
                </p>
              ))}
            </div>
            {item.kind === 'choice' && (
              <ul className="print-options" dir={dir}>
                {item.options.map((o, i) => (
                  <li key={i} className={answer?.choice === i ? 'chosen' : ''}>
                    {optionLetter(item, i)}. {o.text}
                    {answer?.choice === i && <b> ← נבחרה</b>}
                  </li>
                ))}
              </ul>
            )}
            {!answered && <p className="print-missing">לא נענתה</p>}
            {answer?.text.trim() && (
              <div className="print-answer">
                <b>התשובה בכתב:</b>
                <div dir={dir}>{answer.text}</div>
              </div>
            )}
            {clips.length > 0 && <p className="print-rec">{recordingLine(clips)}</p>}
          </section>
        );
      })}
    </div>
  );
}
