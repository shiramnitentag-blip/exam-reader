import { OPTION_LETTERS, sayOf, shown, stripNikud, voiceFor, type Item } from '../model';
import { speech, useSpeaking, type Segment } from '../speech';
import type { Answer } from '../db';

/** What the voice says for each option ("א. ..."), following the item's read mode. */
export function optionSegments(item: Item): Segment[][] {
  const letters = OPTION_LETTERS[item.lang];
  return item.options.map((o, i) => {
    const id = `${item.id}-opt-${i}`;
    const text = shown(o, item.useNikud);
    if (item.readMode === 'spell') {
      // Say the option letter normally, then spell the option.
      return [
        { id, text: `${letters[i]}.`, lang: item.lang },
        ...voiceFor({ id, text: stripNikud(text), lang: item.lang }, 'spell'),
      ];
    }
    return voiceFor({ id, text: `${letters[i]}. ${text}`, lang: item.lang, say: `${letters[i]}. ${sayOf(o)}` }, item.readMode);
  });
}

/** Multiple choice: each option is a big card. Tap the card to choose, tap 🔊 to hear it. */
export function ChoiceOptions({
  item,
  answer,
  update,
}: {
  item: Item;
  answer: Answer;
  update: (fn: (a: Answer) => Answer) => void;
}) {
  const current = useSpeaking();
  const segs = optionSegments(item);
  const letters = OPTION_LETTERS[item.lang];
  const canRead = item.readMode !== 'none';

  return (
    <div className="options" role="radiogroup" dir={item.lang === 'en' ? 'ltr' : 'rtl'} lang={item.lang}>
      {item.options.map((opt, i) => {
        const id = `${item.id}-opt-${i}`;
        const selected = answer.choice === i;
        const reading = current === id;
        return (
          <div
            key={i}
            role="radio"
            aria-checked={selected}
            tabIndex={0}
            className={`option ${selected ? 'selected' : ''} ${reading ? 'reading' : ''}`}
            onClick={() => update((a) => ({ ...a, choice: i }))}
          >
            <span className="option-letter">{selected ? '✓' : letters[i]}</span>
            <span className="option-text">{shown(opt, item.useNikud)}</span>
            {canRead && (
              <button
                className={`option-speak ${reading ? 'active' : ''}`}
                aria-label="להשמיע את האפשרות"
                onClick={(e) => {
                  e.stopPropagation();
                  if (reading) speech.stop();
                  else speech.speak(segs[i]);
                }}
              >
                {reading ? '⏹' : '🔊'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
