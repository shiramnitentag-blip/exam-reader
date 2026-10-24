// Student mode: the exam the teacher made active, one screen per question.
import { useCallback, useEffect, useRef, useState } from 'react';
import { mediaSegments, sayOf, shown, type Exam, type Item } from '../model';
import { MediaList } from '../components/Media';
import { db, emptyAnswer, ensureSession, isAnswered, type Answer, type AnswerMode } from '../db';
import { speech, type Segment } from '../speech';
import { keepScreenOn, requestPersistentStorage } from '../device';
import { ReadButton, ReadableText, SpeakText, SpeedControl, segmentsFor } from '../components/Speak';
import { Recorder } from '../components/Recorder';
import { Dictation } from '../components/Dictation';
import { ChoiceOptions, optionSegments } from '../components/Choice';
import { Modal } from '../components/Modal';
import { PHRASES, questionPhrase } from './phrases';
import { loadPlace, savePlace, type ExamStatus } from './status';

type Screen = import('./status').SavedScreen;

/** All the sentences of an item that the voice reads, following its read mode and nikud. */
export function itemSegments(item: Item): Segment[] {
  const out: Segment[] = [];
  if (item.stem) out.push(...segmentsFor(shown(item.stem, item.useNikud), `${item.id}-stem`, item.lang, item.readMode, sayOf(item.stem)));
  out.push(...mediaSegments(item.media, 'stem', item.lang, item.useNikud, item.readMode));
  out.push(...segmentsFor(shown(item.text, item.useNikud), `${item.id}-text`, item.lang, item.readMode, sayOf(item.text)));
  out.push(...mediaSegments(item.media, 'text', item.lang, item.useNikud, item.readMode));
  if (item.kind === 'choice') optionSegments(item).forEach((s) => out.push(...s));
  return out;
}

export function StudentApp({
  exam,
  entry,
  onHome,
}: {
  exam: Exam;
  /** 'new': start from the instructions; 'progress': go on exactly where she stopped. */
  entry: Exclude<ExamStatus, 'none' | 'submitted'>;
  onHome: () => void;
}) {
  const items = exam.items;
  const [loaded, setLoaded] = useState(false);
  const [screen, setScreenState] = useState<Screen>({ name: 'intro' });
  const lastQuestion = useRef(0);
  const [showPassage, setShowPassage] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [saveError, setSaveError] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const answersRef = useRef(answers);
  const mainRef = useRef<HTMLElement>(null);

  // Load this exam's saved answers from the device.
  useEffect(() => {
    Promise.all([db.getAnswers(exam.id), db.getMeta<boolean>(`submitted:${exam.id}`), loadPlace(exam.id)])
      .then(([list, submitted, place]) => {
        const map: Record<string, Answer> = {};
        list.forEach((a) => (map[a.itemId] = a));
        answersRef.current = map;
        setAnswers(map);
        lastQuestion.current = Math.min(place.lastQuestion, Math.max(0, items.length - 1));
        if (submitted) setScreenState({ name: 'done' });
        else if (entry === 'progress') {
          // Exactly where she stopped: the question (or the review before submitting) she was on.
          const s = place.screen;
          setScreenState(s && (s.name === 'question' || s.name === 'finish') ? s : { name: 'question', index: lastQuestion.current });
        } else setScreenState(exam.instructions.length > 0 ? { name: 'intro' } : { name: 'question', index: 0 });
      })
      .catch(() => setSaveError(true))
      .finally(() => setLoaded(true));
  }, [exam.id]);

  const setScreen = useCallback(
    (s: Screen) => {
      speech.stop();
      setShowPassage(false);
      setScreenState(s);
      if (s.name === 'question') lastQuestion.current = s.index;
      savePlace(exam.id, s);
      mainRef.current?.scrollTo({ top: 0 });
    },
    [exam.id],
  );

  // Keep the screen on while the exam is in progress.
  useEffect(() => {
    keepScreenOn(screen.name === 'question' || screen.name === 'finish');
    return () => keepScreenOn(false);
  }, [screen.name]);

  const update = useCallback(
    (itemId: string, fn: (a: Answer) => Answer) => {
      const prev = answersRef.current[itemId] ?? emptyAnswer(exam.id, itemId);
      const next = { ...fn(prev), examId: exam.id, itemId, updatedAt: Date.now() };
      answersRef.current = { ...answersRef.current, [itemId]: next };
      setAnswers(answersRef.current);
      void ensureSession(exam.id).catch(() => {}); // records her name with the exam (once)
      db.putAnswer(next)
        .then(() => setSaveError(false))
        .catch(() => setSaveError(true));
    },
    [exam.id],
  );

  if (!loaded) return <div className="boot-msg">טוֹעֶנֶת…</div>;

  const goQuestion = (index: number) => setScreen({ name: 'question', index });

  let header: React.ReactNode = null;
  let body: React.ReactNode = null;

  if (screen.name === 'intro' || items.length === 0) {
    const started = Object.keys(answers).length > 0;
    const introSegs = exam.instructions.flatMap((b) => segmentsFor(shown(b.text, true), b.id, b.lang, 'normal'));
    header = <Header title={exam.title} onHome={onHome} />;
    body = (
      <div className="page narrow">
        <SpeakText as="h1" className="title" sentences={[{ id: 'exam-title', text: exam.title }]} />
        {exam.instructions.length > 0 && (
          <div className="card">
            {exam.instructions.map((b) => (
              <ReadableText key={b.id} text={shown(b.text, true)} idPrefix={b.id} lang={b.lang} className="big-text" />
            ))}
            <ReadButton segments={introSegs} className="wide" />
          </div>
        )}
        {!speech.supported || !speech.hasHebrewVoice() ? (
          <div className="notice">לֹא נִמְצָא קוֹל עִבְרִי בַּמַּכְשִׁיר הַזֶּה.</div>
        ) : null}
        {items.length > 0 && (
          <button
            className="btn btn-primary btn-huge"
            onClick={() => {
              void requestPersistentStorage();
              void ensureSession(exam.id).catch(() => {});
              keepScreenOn(true);
              goQuestion(started ? lastQuestion.current : 0);
            }}
          >
            {started ? 'לְהַמְשִׁיךְ' : 'לְהַתְחִיל'} ←
          </button>
        )}
      </div>
    );
  } else if (screen.name === 'question') {
    const index = Math.min(Math.max(screen.index, 0), items.length - 1);
    const item = items[index];
    const answer = answers[item.id] ?? emptyAnswer(exam.id, item.id);
    const passage = exam.passages.find((p) => p.id === item.passageId);
    const upd = (fn: (a: Answer) => Answer) => update(item.id, fn);
    header = <Header title={`שְׁאֵלָה ${item.label}`} onInstructions={() => setScreen({ name: 'intro' })} />;
    body =
      showPassage && passage ? (
        <PassageView
          exam={exam}
          passageId={passage.id}
          onBack={() => {
            speech.stop();
            setShowPassage(false);
          }}
        />
      ) : (
        <QuestionView
          key={item.id}
          item={item}
          answer={answer}
          update={upd}
          onPassage={
            passage
              ? () => {
                  speech.stop();
                  setShowPassage(true);
                  mainRef.current?.scrollTo({ top: 0 });
                }
              : undefined
          }
        />
      );
  } else if (screen.name === 'finish') {
    header = <Header title="לִפְנֵי הַהַגָּשָׁה" />;
    body = <FinishView items={items} answers={answers} onGo={goQuestion} onSubmit={() => setConfirmSubmit(true)} />;
  } else {
    header = <Header title={exam.title} />;
    body = <DoneView onHome={onHome} />;
  }

  const showNav = (screen.name === 'question' || screen.name === 'finish') && items.length > 0;
  const currentIndex = screen.name === 'question' ? screen.index : items.length;

  return (
    <div className="app">
      {header}
      {saveError && <div className="banner-error">⚠️ בְּעָיָה בִּשְׁמִירָה. קִרְאִי לַמּוֹרָה.</div>}
      <main ref={mainRef} className="main">
        {body}
      </main>
      {showNav && (
        <BottomBar
          items={items}
          answers={answers}
          currentIndex={currentIndex}
          onGo={(i) => (i >= items.length ? setScreen({ name: 'finish' }) : goQuestion(i))}
        />
      )}
      {confirmSubmit && (
        <Modal
          text={PHRASES.confirmSubmit}
          yes="כֵּן, לְהַגִּישׁ"
          no="עוֹד לֹא"
          onNo={() => setConfirmSubmit(false)}
          onYes={async () => {
            setConfirmSubmit(false);
            // The success screen and its voice start right inside the tap (the iPad allows sound only then).
            setScreen({ name: 'done' });
            speech.speak(DONE_SEGMENTS);
            keepScreenOn(false);
            try {
              await db.setMeta(`submitted:${exam.id}`, true);
              await db.setMeta(`submittedAt:${exam.id}`, Date.now()).catch(() => {});
            } catch {
              // Not saved: back to the page before submitting, with the warning, so she can try again.
              setSaveError(true);
              setScreen({ name: 'finish' });
            }
          }}
        />
      )}
    </div>
  );
}

export function Header({
  title,
  onInstructions,
  onHome,
}: {
  title: string;
  onInstructions?: () => void;
  onHome?: () => void;
}) {
  return (
    <header className="header">
      <div className="header-title">{title}</div>
      <div className="header-tools">
        {onInstructions && (
          <button className="btn btn-small" onClick={onInstructions}>
            📄 הַנְחָיוֹת
          </button>
        )}
        <SpeedControl />
        {onHome && (
          <button className="btn btn-small home-entry" onClick={onHome}>
            🏠 מָסָךְ רָאשִׁי
          </button>
        )}
      </div>
    </header>
  );
}

function PassageView({ exam, passageId, onBack }: { exam: Exam; passageId: string; onBack: () => void }) {
  const p = exam.passages.find((x) => x.id === passageId)!;
  const title = shown(p.title, true);
  const body = shown(p.body, true);
  const segs = [
    ...segmentsFor(title, `${p.id}-title`, p.lang, 'normal'),
    ...segmentsFor(body, `${p.id}-body`, p.lang, 'normal'),
    ...mediaSegments(p.media, 'all', p.lang, true, 'normal'),
  ];
  return (
    <div className="page narrow">
      <button className="btn btn-back" onClick={onBack}>
        → חֲזָרָה לַשְּׁאֵלָה
      </button>
      <div className="card passage">
        {title && <ReadableText text={title} idPrefix={`${p.id}-title`} lang={p.lang} className="passage-title" />}
        <ReadableText text={body} idPrefix={`${p.id}-body`} lang={p.lang} className="big-text" />
        <MediaList media={p.media} place="all" lang={p.lang} useNikud mode="normal" />
        <ReadButton segments={segs} className="wide" />
      </div>
      <button className="btn btn-back" onClick={onBack}>
        → חֲזָרָה לַשְּׁאֵלָה
      </button>
    </div>
  );
}

function QuestionView({
  item,
  answer,
  update,
  onPassage,
}: {
  item: Item;
  answer: Answer;
  update: (fn: (a: Answer) => Answer) => void;
  onPassage?: () => void;
}) {
  const readAll = itemSegments(item);

  // Load this question's voice files into memory, so reading starts right away.
  useEffect(() => {
    speech.preload(readAll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  return (
    <div className={`question-layout ${item.kind}`}>
      <section className="card question-card">
        {onPassage && (
          <button className="btn btn-passage" onClick={onPassage}>
            📖 לַקֶּטַע
          </button>
        )}
        {item.stem && (
          <ReadableText
            text={shown(item.stem, item.useNikud)}
            idPrefix={`${item.id}-stem`}
            say={sayOf(item.stem)}
            lang={item.lang}
            mode={item.readMode}
            className="stem"
          />
        )}
        <MediaList media={item.media} place="stem" lang={item.lang} useNikud={item.useNikud} mode={item.readMode} />
        <ReadableText
          text={shown(item.text, item.useNikud)}
          idPrefix={`${item.id}-text`}
          say={sayOf(item.text)}
          lang={item.lang}
          mode={item.readMode}
          className="big-text prompt"
        />
        <MediaList media={item.media} place="text" lang={item.lang} useNikud={item.useNikud} mode={item.readMode} />
        <ReadButton
          segments={readAll}
          label={item.kind === 'choice' ? 'הַקְרִיאִי הַכֹּל' : 'הַקְרִיאִי'}
          className="wide"
        />
      </section>

      <section className="answer-area">
        {item.kind === 'choice' ? (
          <ChoiceOptions item={item} answer={answer} update={update} />
        ) : (
          <>
            <ModeToggle mode={answer.mode} onChange={(mode) => update((a) => ({ ...a, mode }))} />
            {answer.mode === 'record' ? (
              <Recorder answer={answer} update={update} />
            ) : (
              <Dictation answer={answer} update={update} lang={item.lang} />
            )}
            {answer.mode === 'record' && answer.text.trim() && (
              <div className="other-answer">✍️ יֵשׁ לָךְ גַּם תְּשׁוּבָה כְּתוּבָה.</div>
            )}
            {answer.mode === 'text' && answer.clipIds.length > 0 && (
              <div className="other-answer">🎙️ יֵשׁ לָךְ גַּם הַקְלָטָה.</div>
            )}
          </>
        )}
        <button
          className={`btn btn-flag ${answer.flagged ? 'on' : ''}`}
          aria-pressed={answer.flagged}
          onClick={() => update((a) => ({ ...a, flagged: !a.flagged }))}
        >
          🚩 {answer.flagged ? 'סִמַּנְתְּ לַחְזֹר' : 'לַחְזֹר לְכָאן אַחַר כָּךְ'}
        </button>
      </section>
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: AnswerMode; onChange: (m: AnswerMode) => void }) {
  return (
    <div className="mode-toggle" role="tablist">
      <button
        role="tab"
        aria-selected={mode === 'record'}
        className={mode === 'record' ? 'on' : ''}
        onClick={() => {
          speech.stop();
          onChange('record');
        }}
      >
        🎙️ הַקְלָטָה
      </button>
      <button
        role="tab"
        aria-selected={mode === 'text'}
        className={mode === 'text' ? 'on' : ''}
        onClick={() => {
          speech.stop();
          onChange('text');
        }}
      >
        ✍️ לִכְתֹּב בְּקוֹל
      </button>
    </div>
  );
}

function BottomBar({
  items,
  answers,
  currentIndex,
  onGo,
}: {
  items: Item[];
  answers: Record<string, Answer>;
  currentIndex: number;
  onGo: (i: number) => void;
}) {
  const atFinish = currentIndex >= items.length;
  return (
    <nav className="bottom-bar">
      <button className="btn nav-btn" disabled={currentIndex === 0} onClick={() => onGo(currentIndex - 1)}>
        → הַקּוֹדֵם
      </button>
      <div className="chips">
        {items.map((it, i) => {
          const a = answers[it.id];
          const answered = isAnswered(a);
          return (
            <button
              key={it.id}
              className={`chip ${answered ? 'answered' : 'empty'} ${a?.flagged ? 'flagged' : ''} ${i === currentIndex ? 'current' : ''}`}
              onClick={() => onGo(i)}
              aria-label={`שאלה ${it.label}`}
            >
              <span className="chip-label">{it.label}</span>
              <span className="chip-mark" aria-hidden>
                {a?.flagged ? '🚩' : answered ? '✓' : ''}
              </span>
            </button>
          );
        })}
        <button className={`chip finish-chip ${atFinish ? 'current' : ''}`} onClick={() => onGo(items.length)}>
          סִיּוּם
        </button>
      </div>
      <button className="btn nav-btn btn-primary" disabled={atFinish} onClick={() => onGo(currentIndex + 1)}>
        {currentIndex === items.length - 1 ? 'לְסִיּוּם' : 'הַבָּא'} ←
      </button>
    </nav>
  );
}

function FinishView({
  items,
  answers,
  onGo,
  onSubmit,
}: {
  items: Item[];
  answers: Record<string, Answer>;
  onGo: (i: number) => void;
  onSubmit: () => void;
}) {
  const missing = items.filter((it) => !isAnswered(answers[it.id]));
  const flagged = items.filter((it) => answers[it.id]?.flagged);

  const summary: Segment[] =
    missing.length === 0
      ? [{ id: 'sum-0', text: PHRASES.allAnswered }]
      : [
          { id: 'sum-0', text: PHRASES.notAnswered },
          ...missing.map((it, i) => ({ id: `sum-m${i}`, text: questionPhrase(it.label) })),
        ];
  if (flagged.length > 0) {
    summary.push({ id: 'sum-f', text: PHRASES.flagged });
    flagged.forEach((it, i) => summary.push({ id: `sum-f${i}`, text: questionPhrase(it.label) }));
  }

  return (
    <div className="page narrow">
      <div className="card">
        <SpeakText sentences={summary.slice(0, 1)} className="big-text" />
        {missing.length > 0 && (
          <div className="finish-list">
            {missing.map((it) => (
              <button key={it.id} className="finish-item missing" onClick={() => onGo(items.indexOf(it))}>
                <span>שְׁאֵלָה {it.label}</span>
                <span className="go">לַעֲבֹר ←</span>
              </button>
            ))}
          </div>
        )}
        {flagged.length > 0 && (
          <>
            <p className="big-text">🚩 סִמַּנְתְּ לַחְזֹר אֶל:</p>
            <div className="finish-list">
              {flagged.map((it) => (
                <button key={it.id} className="finish-item flagged" onClick={() => onGo(items.indexOf(it))}>
                  <span>שְׁאֵלָה {it.label}</span>
                  <span className="go">לַעֲבֹר ←</span>
                </button>
              ))}
            </div>
          </>
        )}
        <ReadButton segments={summary} className="wide" />
      </div>
      <button className="btn btn-primary btn-huge" onClick={onSubmit}>
        📤 לְהַגִּישׁ
      </button>
    </div>
  );
}

const DONE_SEGMENTS: Segment[] = [
  { id: 'done-0', text: PHRASES.submittedOk },
  { id: 'done-1', text: PHRASES.wellDone },
];

/** After submitting: read aloud at once (started from the "submit" tap), then back to the opening screen. */
function DoneView({ onHome }: { onHome: () => void }) {
  return (
    <div className="page narrow center">
      <div className="done-icon">🎉</div>
      <SpeakText as="h1" className="title" sentences={DONE_SEGMENTS} />
      <ReadButton segments={DONE_SEGMENTS} />
      <button
        className="btn btn-primary btn-huge"
        onClick={() => {
          speech.stop();
          onHome();
        }}
      >
        🏠 חֲזָרָה לַמָּסָךְ הָרָאשִׁי
      </button>
    </div>
  );
}
