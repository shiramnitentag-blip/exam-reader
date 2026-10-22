// In the review screen: tap a vocalized word to see other ways to vocalize it, and pick one.
import { createContext, useContext, useState } from 'react';
import { db } from '../db';
import { hebrewError, nikudOptions } from '../claude';
import { fitMarks, stripNikud } from '../model';

/** Lets the review screen know a word's nikud was changed (to remake that sentence's voice file). */
export const NikudPicked = createContext<() => void>(() => {});

type Opt = { nikud: string; meaning: string };
const cache = new Map<string, Opt[]>(); // "word|sentence" → options, while the app is open

export function WordPicker({
  vocalized,
  onChange,
}: {
  vocalized: string; // the vocalized version of a text
  onChange: (vocalized: string) => void;
}) {
  const picked = useContext(NikudPicked);
  const [open, setOpen] = useState<number | null>(null);
  const [opts, setOpts] = useState<Opt[] | null>(null);
  const [error, setError] = useState('');

  const parts = vocalized.split(/(\s+)/); // words at even places, spaces at odd ones

  async function show(i: number) {
    setOpen(i);
    setOpts(null);
    setError('');
    const word = parts[i].replace(/^[^א-ת]+|[^֑-ת]+$/g, ''); // without punctuation around it
    const key = `${word}|${vocalized}`;
    if (cache.has(key)) {
      setOpts(cache.get(key)!);
      return;
    }
    const apiKey = await db.getMeta<string>('apiKey');
    if (!apiKey) {
      setError('אֵין מַפְתֵּחַ Claude בַּהַגְדָּרוֹת.');
      return;
    }
    try {
      const list = await nikudOptions(apiKey, stripNikud(word), vocalized.slice(0, 600));
      cache.set(key, list);
      setOpts(list);
    } catch (e) {
      setError(hebrewError(e));
    }
  }

  function choose(i: number, option: string) {
    const current = parts[i];
    // Keep the punctuation around the word, and the exam's own letters (ktiv male stays).
    const lead = current.match(/^[^א-ת]*/)![0];
    const trail = current.match(/[^֑-ת]*$/)![0];
    // The vocalized words always keep the exam's letters, so the letters come from the word itself.
    const plain = stripNikud(current.slice(lead.length, current.length - trail.length));
    const fitted = fitMarks(plain, option);
    if (fitted === null) {
      setError('הָאֶפְשָׁרוּת הַזֹּאת מְשַׁנָּה אוֹתִיּוֹת, וְלָכֵן אִי אֶפְשָׁר לִבְחֹר בָּהּ.');
      return;
    }
    const next = [...parts];
    next[i] = lead + fitted + trail;
    onChange(next.join(''));
    picked();
    setOpen(null);
  }

  return (
    <div className="word-picker">
      <div className="field-label small">לִבְחִירַת נִקּוּד אַחֵר: נִגְעִי בְּמִלָּה</div>
      <div className="word-picker-words" dir="rtl">
        {parts.map((w, i) =>
          i % 2 === 1 || !/[א-ת]/.test(w) ? (
            <span key={i}>{w}</span>
          ) : (
            <button key={i} className={`wp-word ${open === i ? 'on' : ''}`} onClick={() => (open === i ? setOpen(null) : void show(i))}>
              {w}
            </button>
          ),
        )}
      </div>
      {open !== null && (
        <div className="wp-options">
          {!opts && !error && <span className="help">⏳ מְחַפֶּשֶׂת אֶפְשָׁרֻיּוֹת…</span>}
          {opts?.map((o, k) => (
            <button key={k} className="btn btn-small wp-option" onClick={() => choose(open, o.nikud)}>
              <b>{o.nikud}</b>
              <span className="help">{o.meaning}</span>
            </button>
          ))}
          {opts && opts.length === 0 && <span className="help">לֹא נִמְצְאוּ אֶפְשָׁרֻיּוֹת אֲחֵרוֹת.</span>}
          {error && <span className="warn">{error}</span>}
          <button className="btn btn-small" onClick={() => setOpen(null)}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
