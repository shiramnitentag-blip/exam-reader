import { OPTION_LETTERS, type ChoiceItem } from '../exam';
import { speech, useSpeaking, type Segment } from '../speech';
import type { Answer } from '../db';

export function optionSegments(item: ChoiceItem): Segment[] {
  return item.options.map((o, i) => ({ id: o.id, text: `${OPTION_LETTERS[i]}. ${o.text}` }));
}

/** Multiple choice: each option is a big card. Tap the card to choose, tap 🔊 to hear it. */
export function ChoiceOptions({
  item,
  answer,
  update,
}: {
  item: ChoiceItem;
  answer: Answer;
  update: (fn: (a: Answer) => Answer) => void;
}) {
  const current = useSpeaking();
  const segs = optionSegments(item);

  return (
    <div className="options" role="radiogroup">
      {item.options.map((opt, i) => {
        const selected = answer.choice === i;
        const reading = current === opt.id;
        return (
          <div
            key={opt.id}
            role="radio"
            aria-checked={selected}
            tabIndex={0}
            className={`option ${selected ? 'selected' : ''} ${reading ? 'reading' : ''}`}
            onClick={() => update((a) => ({ ...a, choice: i }))}
          >
            <span className="option-letter">{selected ? '✓' : OPTION_LETTERS[i]}</span>
            <span className="option-text">{opt.text}</span>
            <button
              className={`option-speak ${reading ? 'active' : ''}`}
              aria-label="להשמיע את האפשרות"
              onClick={(e) => {
                e.stopPropagation();
                if (reading) speech.stop();
                else speech.speak([segs[i]]);
              }}
            >
              {reading ? '⏹' : '🔊'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
