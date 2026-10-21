// Student mode: the exam the teacher made active, one screen per question.
import { useCallback, useEffect, useRef, useState } from 'react';
import { shown, type Exam, type Item } from '../model';
import { db, emptyAnswer, isAnswered, type Answer, type AnswerMode } from '../db';
import { speech, type Segment } from '../speech';
import { keepScreenOn, requestPersistentStorage } from '../device';
import { ReadButton, ReadableText, SpeakText, SpeedControl, segmentsFor } from '../components/Speak';
import { Recorder } from '../components/Recorder';
import { Dictation } from '../components/Dictation';
import { ChoiceOptions, optionSegments } from '../components/Choice';
import { Modal } from '../components/Modal';

type Screen = { name: 'intro' } | { name: 'question'; index: number } | { name: 'finish' } | { name: 'done' };

function loadScreen(examId: string): Screen {
  try {
    const raw = localStorage.getItem(`screen:${examId}`);
    if (raw) return JSON.parse(raw) as Screen;
  } catch {
    /* ignore */
  }
  return { name: 'intro' };
}

/** All the sentences of an item that the voice reads, following its read mode and nikud. */
export function itemSegments(item: Item): Segment[] {
  const out: Segment[] = [];
  if (item.stem) out.push(...segmentsFor(shown(item.stem, item.useNikud), `${item.id}-stem`, item.lang, item.readMode));
  out.push(...segmentsFor(shown(item.text, item.useNikud), `${item.id}-text`, item.lang, item.readMode));
  if (item.kind === 'choice') optionSegments(item).forEach((s) => out.push(...s));
  return out;
}

export function StudentApp({ exam, onTeacher }: { exam: Exam; onTeacher: () => void }) {
  const items = exam.items;
  const [loaded, setLoaded] = useState(false);
  const [screen, setScreenState] = useState<Screen>(() => loadScreen(exam.id));
  const [showPassage, setShowPassage] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [saveError, setSaveError] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const answersRef = useRef(answers);
  const mainRef = useRef<HTMLElement>(null);

  // Load this exam's saved answers from the device.
  useEffect(() => {
    Promise.all([db.getAnswers(exam.id), db.getMeta<boolean>(`submitted:${exam.id}`)])
      .then(([list, submitted]) => {
        const map: Record<string, Answer> = {};
        list.forEach((a) => (map[a.itemId] = a));
        answersRef.current = map;
        setAnswers(map);
        if (submitted) setScreenState({ name: 'done' });
      })
      .catch(() => setSaveError(true))
      .finally(() => setLoaded(true));
  }, [exam.id]);

  const setScreen = useCallback(
    (s: Screen) => {
      speech.stop();
      setShowPassage(false);
      setScreenState(s);
      try {
        localStorage.setItem(`screen:${exam.id}`, JSON.stringify(s));
      } catch {
        /* ignore */
      }
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
    header = <Header title={exam.title} onTeacher={onTeacher} />;
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
              keepScreenOn(true);
              goQuestion(0);
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
    header = <Header title={exam.title} onTeacher={onTeacher} />;
    body = <DoneView />;
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
          text="לְהַגִּישׁ אֶת הַמִּבְחָן? אַחֲרֵי הַהַגָּשָׁה אִי אֶפְשָׁר לְשַׁנּוֹת."
          yes="כֵּן, לְהַגִּישׁ"
          no="עוֹד לֹא"
          onNo={() => setConfirmSubmit(false)}
          onYes={async () => {
            setConfirmSubmit(false);
            await db.setMeta(`submitted:${exam.id}`, true).catch(() => setSaveError(true));
            await db.setMeta(`submittedAt:${exam.id}`, Date.now()).catch(() => {});
            keepScreenOn(false);
            setScreen({ name: 'done' });
          }}
        />
      )}
    </div>
  );
}

export function Header({
  title,
  onInstructions,
  onTeacher,
}: {
  title: string;
  onInstructions?: () => void;
  onTeacher?: () => void;
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
        {onTeacher && (
          <button className="btn btn-small teacher-entry" onClick={onTeacher} aria-label="מצב מורה">
            🔒
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
  const segs = [...segmentsFor(title, `${p.id}-title`, p.lang, 'normal'), ...segmentsFor(body, `${p.id}-body`, p.lang, 'normal')];
  return (
    <div className="page narrow">
      <button className="btn btn-back" onClick={onBack}>
        → חֲזָרָה לַשְּׁאֵלָה
      </button>
      <div className="card passage">
        {title && <ReadableText text={title} idPrefix={`${p.id}-title`} lang={p.lang} className="passage-title" />}
        <ReadableText text={body} idPrefix={`${p.id}-body`} lang={p.lang} className="big-text" />
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
            lang={item.lang}
            mode={item.readMode}
            className="stem"
          />
        )}
        <ReadableText
          text={shown(item.text, item.useNikud)}
          idPrefix={`${item.id}-text`}
          lang={item.lang}
          mode={item.readMode}
          className="big-text prompt"
        />
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
      ? [{ id: 'sum-0', text: 'עָנִית עַל כָּל הַשְּׁאֵלוֹת.' }]
      : [
          { id: 'sum-0', text: 'לֹא עָנִית עַל:' },
          ...missing.map((it, i) => ({ id: `sum-m${i}`, text: `שְׁאֵלָה ${it.label}.` })),
        ];
  if (flagged.length > 0) {
    summary.push({ id: 'sum-f', text: 'סִמַּנְתְּ לַחְזֹר אֶל:' });
    flagged.forEach((it, i) => summary.push({ id: `sum-f${i}`, text: `שְׁאֵלָה ${it.label}.` }));
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

function DoneView() {
  const msg: Segment[] = [
    { id: 'done-0', text: 'הַמִּבְחָן הוּגַשׁ.' },
    { id: 'done-1', text: 'כָּל הַכָּבוֹד!' },
  ];
  return (
    <div className="page narrow center">
      <div className="done-icon">🎉</div>
      <SpeakText as="h1" className="title" sentences={msg} />
      <ReadButton segments={msg} />
    </div>
  );
}
