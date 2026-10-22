import { speech, useSpeaking } from '../speech';
import type { Answer } from '../db';

/** "Write with your voice": a big text box she fills using the iPad keyboard's microphone. */
export function Dictation({
  answer,
  update,
  lang = 'he',
}: {
  answer: Answer;
  update: (fn: (a: Answer) => Answer) => void;
  lang?: 'he' | 'en';
}) {
  const segId = `typed-${answer.itemId}`;
  const reading = useSpeaking() === segId;
  const hasText = answer.text.trim().length > 0;

  return (
    <div className="dictation">
      <div className="dictation-help">
        <span className="help-icon" aria-hidden>
          🎤
        </span>
        <span>
          לְחָצִי עַל הַתֵּבָה. בַּמִּקְלֶדֶת, לְחָצִי עַל <b>הַמִּיקְרוֹפוֹן</b> (לְיַד מַקַּשׁ הָרֶוַח) וְדַבְּרִי.
        </span>
      </div>
      <textarea
        className={`dictation-box ${reading ? 'reading' : ''}`}
        dir={lang === 'en' ? 'ltr' : 'rtl'}
        lang={lang}
        value={answer.text}
        placeholder="כָּאן תּוֹפִיעַ הַתְּשׁוּבָה שֶׁלָּךְ…"
        onChange={(e) => {
          const text = e.target.value;
          update((a) => ({ ...a, text }));
        }}
      />
      <div className="dictation-footer">
        <button
          className={`btn btn-read ${reading ? 'active' : ''}`}
          disabled={!hasText}
          onClick={() => (reading ? speech.stop() : speech.speak([{ id: segId, text: answer.text, lang }], { builtInOnly: true }) /* new text, no ready-made file */)}
        >
          <span className="icon" aria-hidden>
            {reading ? '⏹' : '🔊'}
          </span>
          {reading ? 'עֲצִירָה' : 'הַקְרִיאִי לִי מָה כָּתַבְתִּי'}
        </button>
        {hasText && <span className="saved-mark">✓ נִשְׁמַר</span>}
      </div>
    </div>
  );
}
