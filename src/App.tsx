import { useCallback, useEffect, useRef, useState } from 'react';
import { exam, type ExamItem, type Sentence } from './exam';
import { db, emptyAnswer, isAnswered, type Answer, type AnswerMode } from './db';
import { speech } from './speech';
import { keepScreenOn, requestPersistentStorage } from './device';
import { ReadButton, SpeakText, SpeedControl } from './components/Speak';
import { Recorder } from './components/Recorder';
import { Dictation } from './components/Dictation';
import { ChoiceOptions, optionSegments } from './components/Choice';

type Screen = { name: 'intro' } | { name: 'question'; index: number } | { name: 'finish' } | { name: 'done' };

const items = exam.items;

function loadScreen(): Screen {
  try {
    const raw = localStorage.getItem('screen');
    if (raw) return JSON.parse(raw) as Screen;
  } catch {
    /* ignore */
  }
  return { name: 'intro' };
}

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [screen, setScreenState] = useState<Screen>(loadScreen);
  const [showPassage, setShowPassage] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [saveError, setSaveError] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const answersRef = useRef(answers);
  const mainRef = useRef<HTMLElement>(null);

  // Load saved answers from the device.
  useEffect(() => {
    Promise.all([db.getAllAnswers(), db.getMeta<boolean>('submitted')])
      .then(([list, submitted]) => {
        const map: Record<string, Answer> = {};
        list.forEach((a) => (map[a.questionId] = a));
        answersRef.current = map;
        setAnswers(map);
        if (submitted) setScreenState({ name: 'done' });
      })
      .catch(() => setSaveError(true))
      .finally(() => setLoaded(true));
  }, []);

  const setScreen = useCallback((s: Screen) => {
    speech.stop();
    setShowPassage(false);
    setScreenState(s);
    try {
      localStorage.setItem('screen', JSON.stringify(s));
    } catch {
      /* ignore */
    }
    mainRef.current?.scrollTo({ top: 0 });
  }, []);

  // Keep the screen on while the exam is in progress.
  useEffect(() => {
    keepScreenOn(screen.name === 'question' || screen.name === 'finish');
  }, [screen.name]);

  const update = useCallback((questionId: string, fn: (a: Answer) => Answer) => {
    const prev = answersRef.current[questionId] ?? emptyAnswer(questionId);
    const next = { ...fn(prev), questionId, updatedAt: Date.now() };
    answersRef.current = { ...answersRef.current, [questionId]: next };
    setAnswers(answersRef.current);
    db.putAnswer(next)
      .then(() => setSaveError(false))
      .catch(() => setSaveError(true));
  }, []);

  if (!loaded) return <div className="app loading" />;

  const goQuestion = (index: number) => setScreen({ name: 'question', index });

  let header: React.ReactNode = null;
  let body: React.ReactNode = null;

  if (screen.name === 'intro') {
    const started = Object.keys(answers).length > 0;
    header = <Header title={exam.title} />;
    body = (
      <div className="page narrow">
        <SpeakText as="h1" className="title" sentences={[{ id: 'exam-title', text: exam.title }]} />
        <div className="card">
          <SpeakText sentences={exam.instructions} className="big-text" />
          <ReadButton segments={exam.instructions} className="wide" />
        </div>
        {!speech.supported || !speech.hasHebrewVoice() ? (
          <div className="notice">לֹא נִמְצָא קוֹל עִבְרִי בַּמַּכְשִׁיר הַזֶּה.</div>
        ) : null}
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
      </div>
    );
  } else if (screen.name === 'question') {
    const index = Math.min(Math.max(screen.index, 0), items.length - 1);
    const item = items[index];
    const answer = answers[item.id] ?? emptyAnswer(item.id);
    const upd = (fn: (a: Answer) => Answer) => update(item.id, fn);
    header = <Header title={item.title} onInstructions={() => setScreen({ name: 'intro' })} />;
    body = showPassage ? (
      <PassageView onBack={() => { speech.stop(); setShowPassage(false); }} />
    ) : (
      <QuestionView
        key={item.id}
        item={item}
        answer={answer}
        update={upd}
        onPassage={() => {
          speech.stop();
          setShowPassage(true);
          mainRef.current?.scrollTo({ top: 0 });
        }}
      />
    );
  } else if (screen.name === 'finish') {
    header = <Header title="לִפְנֵי הַהַגָּשָׁה" />;
    body = (
      <FinishView
        answers={answers}
        onGo={goQuestion}
        onSubmit={() => setConfirmSubmit(true)}
      />
    );
  } else {
    header = <Header title={exam.title} />;
    body = (
      <DoneView
        onReset={async () => {
          await db.clearAll();
          answersRef.current = {};
          setAnswers({});
          setScreen({ name: 'intro' });
        }}
      />
    );
  }

  const showNav = screen.name === 'question' || screen.name === 'finish';
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
            await db.setMeta('submitted', true).catch(() => setSaveError(true));
            await db.setMeta('submittedAt', Date.now()).catch(() => {});
            keepScreenOn(false);
            setScreen({ name: 'done' });
          }}
        />
      )}
    </div>
  );
}

function Header({ title, onInstructions }: { title: string; onInstructions?: () => void }) {
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
      </div>
    </header>
  );
}

function allPassageSentences(): Sentence[] {
  return [exam.passage.title, ...exam.passage.paragraphs.flat()];
}

function PassageView({ onBack }: { onBack: () => void }) {
  return (
    <div className="page narrow">
      <button className="btn btn-back" onClick={onBack}>
        → חֲזָרָה לַשְּׁאֵלָה
      </button>
      <div className="card passage">
        <SpeakText as="h2" className="passage-title" sentences={[exam.passage.title]} />
        {exam.passage.paragraphs.map((p, i) => (
          <SpeakText key={i} sentences={p} className="big-text" />
        ))}
        <ReadButton segments={allPassageSentences()} className="wide" />
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
  item: ExamItem;
  answer: Answer;
  update: (fn: (a: Answer) => Answer) => void;
  onPassage: () => void;
}) {
  const readAll =
    item.kind === 'open' ? [...item.stem, ...item.prompt] : [...item.stem, ...optionSegments(item)];

  return (
    <div className={`question-layout ${item.kind}`}>
      <section className="card question-card">
        {item.hasPassage && (
          <button className="btn btn-passage" onClick={onPassage}>
            📖 לַקֶּטַע
          </button>
        )}
        {item.kind === 'open' ? (
          <>
            <SpeakText sentences={item.stem} className="stem" />
            <SpeakText sentences={item.prompt} className="big-text prompt" />
          </>
        ) : (
          <SpeakText sentences={item.stem} className="big-text prompt" />
        )}
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
              <Dictation answer={answer} update={update} />
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

function statusOf(a: Answer | undefined): 'empty' | 'answered' {
  return isAnswered(a) ? 'answered' : 'empty';
}

function BottomBar({
  answers,
  currentIndex,
  onGo,
}: {
  answers: Record<string, Answer>;
  currentIndex: number;
  onGo: (i: number) => void;
}) {
  const atFinish = currentIndex >= items.length;
  return (
    <nav className="bottom-bar">
      <button
        className="btn nav-btn"
        disabled={currentIndex === 0}
        onClick={() => onGo(currentIndex - 1)}
      >
        → הַקּוֹדֵם
      </button>
      <div className="chips">
        {items.map((it, i) => {
          const a = answers[it.id];
          const st = statusOf(a);
          return (
            <button
              key={it.id}
              className={`chip ${st} ${a?.flagged ? 'flagged' : ''} ${i === currentIndex ? 'current' : ''}`}
              onClick={() => onGo(i)}
              aria-label={`שאלה ${it.label}`}
            >
              <span className="chip-label">{it.label}</span>
              <span className="chip-mark" aria-hidden>
                {a?.flagged ? '🚩' : st === 'answered' ? '✓' : ''}
              </span>
            </button>
          );
        })}
        <button className={`chip finish-chip ${atFinish ? 'current' : ''}`} onClick={() => onGo(items.length)}>
          סִיּוּם
        </button>
      </div>
      <button
        className="btn nav-btn btn-primary"
        disabled={atFinish}
        onClick={() => onGo(currentIndex + 1)}
      >
        {currentIndex === items.length - 1 ? 'לְסִיּוּם' : 'הַבָּא'} ←
      </button>
    </nav>
  );
}

function FinishView({
  answers,
  onGo,
  onSubmit,
}: {
  answers: Record<string, Answer>;
  onGo: (i: number) => void;
  onSubmit: () => void;
}) {
  const missing = items.filter((it) => !isAnswered(answers[it.id]));
  const flagged = items.filter((it) => answers[it.id]?.flagged);

  const summary: Sentence[] =
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

function DoneView({ onReset }: { onReset: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const msg: Sentence[] = [
    { id: 'done-0', text: 'הַמִּבְחָן הוּגַשׁ.' },
    { id: 'done-1', text: 'כָּל הַכָּבוֹד!' },
  ];
  return (
    <div className="page narrow center">
      <div className="done-icon">🎉</div>
      <SpeakText as="h1" className="title" sentences={msg} />
      <ReadButton segments={msg} />
      <button className="btn btn-small reset" onClick={() => setConfirm(true)}>
        מִבְחָן חָדָשׁ (לִבְדִיקָה)
      </button>
      {confirm && (
        <Modal
          text="לִמְחֹק אֶת כָּל הַתְּשׁוּבוֹת וּלְהַתְחִיל מֵחָדָשׁ?"
          yes="כֵּן, לִמְחֹק"
          no="לֹא"
          onNo={() => setConfirm(false)}
          onYes={() => {
            setConfirm(false);
            onReset();
          }}
        />
      )}
    </div>
  );
}

function Modal({
  text,
  yes,
  no,
  onYes,
  onNo,
}: {
  text: string;
  yes: string;
  no: string;
  onYes: () => void;
  onNo: () => void;
}) {
  const seg = [{ id: 'modal-text', text }];
  return (
    <div className="modal-backdrop" onClick={onNo}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <SpeakText sentences={seg} className="big-text" />
        <div className="modal-actions">
          <button className="btn btn-primary btn-big" onClick={onYes}>
            {yes}
          </button>
          <button className="btn btn-big" onClick={onNo}>
            {no}
          </button>
        </div>
      </div>
    </div>
  );
}
