import { speech, useSpeaking, useSpeed, type Segment, type Speed } from '../speech';

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
