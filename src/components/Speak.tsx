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
export function segmentsFor(text: string, idPrefix: string, lang: Lang, mode: ReadMode): Segment[] {
  return sentenceSegments(text, idPrefix, lang)
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
}: {
  text: string;
  idPrefix: string;
  lang: Lang;
  mode?: ReadMode;
  className?: string;
}) {
  const current = useSpeaking();
  const paras = sentenceSegments(text, idPrefix, lang);
  return (
    <div className={`readable ${className}`} dir={lang === 'en' ? 'ltr' : 'rtl'} lang={lang}>
      {paras.map((p, i) => (
        <p key={i} className="speak-text">
          {p.map((seg) =>
            mode === 'none' ? (
              <span key={seg.id} className="sentence plain">
                {seg.text}
              </span>
            ) : (
              <span
                key={seg.id}
                role="button"
                tabIndex={0}
                className={`sentence${current === seg.id ? ' reading' : ''}`}
                onClick={() => (current === seg.id ? speech.stop() : speech.speak(voiceFor(seg, mode)))}
              >
                {seg.text}
              </span>
            ),
          )}
        </p>
      ))}
    </div>
  );
}
