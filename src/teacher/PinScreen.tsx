import { useEffect, useState } from 'react';
import { checkPin, hasPin, setPin } from './pin';

/** Number pad for the teacher's PIN. The first time, it asks her to choose one (twice). */
export function PinScreen({
  onSuccess,
  onCancel,
  purpose = 'מַצַּב מוֹרָה',
}: {
  onSuccess: () => void;
  onCancel: () => void;
  /** What the code opens, shown in the title (teacher mode, or starting the exam). */
  purpose?: string;
}) {
  const [mode, setMode] = useState<'loading' | 'create' | 'confirm' | 'enter'>('loading');
  const [digits, setDigits] = useState('');
  const [first, setFirst] = useState('');
  const [error, setError] = useState('');
  const [fails, setFails] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    hasPin()
      .then((h) => setMode(h ? 'enter' : 'create'))
      .catch(() => setMode('enter'));
  }, []);

  useEffect(() => {
    if (lockedUntil <= Date.now()) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [lockedUntil]);

  const locked = lockedUntil > now;

  async function complete(pin: string) {
    if (mode === 'create') {
      setFirst(pin);
      setDigits('');
      setMode('confirm');
      return;
    }
    if (mode === 'confirm') {
      if (pin !== first) {
        setError('הַקּוֹדִים לֹא זֵהִים. נַסִּי שׁוּב.');
        setFirst('');
        setDigits('');
        setMode('create');
        return;
      }
      await setPin(pin);
      onSuccess();
      return;
    }
    if (await checkPin(pin)) {
      onSuccess();
      return;
    }
    const n = fails + 1;
    setFails(n);
    setDigits('');
    if (n >= 5) {
      setLockedUntil(Date.now() + 30_000);
      setNow(Date.now());
      setFails(0);
      setError('יוֹתֵר מִדַּי נִסְיוֹנוֹת. חַכִּי 30 שְׁנִיּוֹת.');
    } else {
      setError('קוֹד שָׁגוּי.');
    }
  }

  function press(d: string) {
    if (locked || mode === 'loading') return;
    setError('');
    const next = (digits + d).slice(0, 4);
    setDigits(next);
    if (next.length === 4) void complete(next);
  }

  const title =
    mode === 'loading'
      ? '…'
      : mode === 'create'
      ? 'בַּחֲרִי קוֹד שֶׁל 4 סְפָרוֹת לְמַצַּב מוֹרָה'
      : mode === 'confirm'
        ? 'הַקִּישִׁי אֶת הַקּוֹד שׁוּב, לְאִשּׁוּר'
        : `${purpose}: הַקִּישִׁי קוֹד מוֹרָה`;

  return (
    <div className="pin-screen">
      <div className="pin-box">
        <div className="pin-title">🔒 {title}</div>
        {mode === 'create' && (
          <div className="pin-hint">שִׁמְרִי אֶת הַקּוֹד. בְּלִי הַקּוֹד אִי אֶפְשָׁר לְהִכָּנֵס לְמַצַּב מוֹרָה.</div>
        )}
        <div className="pin-dots" dir="ltr">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`pin-dot ${i < digits.length ? 'on' : ''}`} />
          ))}
        </div>
        <div className="pin-error" role="alert">
          {locked ? `חַכִּי ${Math.ceil((lockedUntil - now) / 1000)} שְׁנִיּוֹת` : error}
        </div>
        <div className="pin-pad" dir="ltr">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} className="pin-key" onClick={() => press(d)} disabled={locked}>
              {d}
            </button>
          ))}
          <button className="pin-key pin-small" onClick={onCancel}>
            בִּטּוּל
          </button>
          <button className="pin-key" onClick={() => press('0')} disabled={locked}>
            0
          </button>
          <button
            className="pin-key pin-small"
            onClick={() => setDigits((s) => s.slice(0, -1))}
            aria-label="מחיקה"
          >
            ⌫
          </button>
        </div>
      </div>
    </div>
  );
}
