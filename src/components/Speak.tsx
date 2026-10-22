import { useRef } from 'react';
import { speech, useSpeaking, useSpeed, type Segment, type Speed } from '../speech';
import { sentenceSegments, voiceFor, type Lang, type ReadMode } from '../model';

/** Sentences the student can tap: tapping one reads only that sentence. */
export function SpeakText({
  sentences,
  className = '',
  as: Tag = 'p',
}: {
  sentences: Segment[];
  className?: string;
  as?: 'p' | 'h1' | 'h2' | 'div';
}) {
  const current = useSpeaking();
  return (
    <Tag className={`speak-text ${className}`}>
      {sentences.map((s) => (
        <span
          key={s.id}
          role="button"
          tabIndex={0}
          className={`sentence${current === s.id ? ' reading' : ''}`}
          onClick={() => (current === s.id ? speech.stop() : speech.speak([s]))}
        >
          {s.text}
        </span>
      ))}
    </Tag>
  );
}

/** The big "read to me" button. Pressing again while reading stops. */
export function ReadButton({
  segments,
  label = 'הַקְרִיאִי',
  className = '',
}: {
  segments: Segment[];
  label?: string;
  className?: string;
}) {
  const current = useSpeaking();
  const active = current !== null && segments.some((s) => s.id === current);
  if (segments.length === 0) {
    return (
      <div className={`no-read ${className}`}>
        <span aria-hidden>🔇</span> בְּלִי הַקְרָאָה
      </div>
    );
  }
  return (
    <button
      className={`btn btn-read ${active ? 'active' : ''} ${className}`}
      onClick={() => (active ? speech.stop() : speech.speak(segments))}
    >
      <span className="icon" aria-hidden>
        {active ? '⏹' : '🔊'}
      </span>
      {active ? 'עֲצִירָה' : label}
    </button>
  );
}

const SPEEDS: { key: Speed; label: string }[] = [
  { key: 'slow', label: 'אִטִּי' },
  { key: 'normal', label: 'רָגִיל' },
  { key: 'fast', label: 'מָהִיר' },
];

export function SpeedControl() {
  const speed = useSpeed();
  return (
    <div className="speed" role="group" aria-label="מהירות הקראה">
      <span className="speed-icon" aria-hidden>
        🐢
      </span>
      {SPEEDS.map((s) => (
        <button
          key={s.key}
          className={`speed-btn ${speed === s.key ? 'on' : ''}`}
          aria-pressed={speed === s.key}
          onClick={() => speech.setSpeed(s.key)}
        >
          {s.label}
        </button>
      ))}
      <span className="speed-icon" aria-hidden>
        🐇
      </span>
    </div>
  );
}

/** Everything the voice says for a text, in order, according to the read mode. */
export function segmentsFor(text: string, idPrefix: string, lang: Lang, mode: ReadMode, say?: string): Segment[] {
  return sentenceSegments(text, idPrefix, lang, say)
    .flat()
    .flatMap((s) => voiceFor(s, mode));
}

/** Any exam text: paragraphs of tappable sentences. Tapping a sentence reads only it. */
export function ReadableText({
  text,
  idPrefix,
  lang,
  mode = 'normal',
  className = '',
  say,
}: {
  text: string;
  idPrefix: string;
  lang: Lang;
  mode?: ReadMode;
  className?: string;
  say?: string; // the vocalized version, for the voice
}) {
  const current = useSpeaking();
  const paras = sentenceSegments(text, idPrefix, lang, say);
  const press = useRef<{ timer: number; fired: boolean } | null>(null);

  // A long press on a word reads only that word.
  const wordDown = (seg: Segment, i: number, word: string, sayWord: string | undefined) => {
    if (press.current) clearTimeout(press.current.timer);
    const state = { timer: 0, fired: false };
    state.timer = window.setTimeout(() => {
      state.fired = true;
      speech.speak([{ id: `${seg.id}-w${i}`, text: word, lang, say: sayWord }]);
    }, 450);
    press.current = state;
  };
  const wordUp = () => {
    if (press.current && !press.current.fired) {
      clearTimeout(press.current.timer);
      press.current = null;
    }
  };

  return (
    <div className={`readable ${className}`} dir={lang === 'en' ? 'ltr' : 'rtl'} lang={lang}>
      {paras.map((p, i) => (
        <p key={i} className="speak-text">
          {p.map((seg) => {
            if (mode === 'none')
              return (
                <span key={seg.id} className="sentence plain">
                  {seg.text}
                </span>
              );
            const words = seg.text.split(/(\s+)/);
            const sayWords = seg.say?.split(/(\s+)/);
            const sameCount = sayWords?.length === words.length;
            return (
              <span
                key={seg.id}
                role="button"
                tabIndex={0}
                className={`sentence${current === seg.id ? ' reading' : ''}`}
                onClick={() => {
                  if (press.current?.fired) {
                    press.current = null; // that was a long press on a word
                    return;
                  }
                  if (current === seg.id) speech.stop();
                  else speech.speak(voiceFor(seg, mode));
                }}
              >
                {words.map((w, wi) =>
                  /^\s+$/.test(w) || !w ? (
                    w
                  ) : (
                    <span
                      key={wi}
                      className={`word${current === `${seg.id}-w${wi}` ? ' reading-word' : ''}`}
                      onPointerDown={() => wordDown(seg, wi, w, sameCount ? sayWords![wi] : undefined)}
                      onPointerUp={wordUp}
                      onPointerLeave={wordUp}
                      onPointerCancel={wordUp}
                    >
                      {w}
                    </span>
                  ),
                )}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}
