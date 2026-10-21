import { useEffect, useState } from 'react';
import { db } from '../db';
import { hebrewError, testConnection } from '../claude';
import { PinScreen } from './PinScreen';
import { setPin } from './pin';

/** API key (kept only on this device) and PIN change. */
export function Settings({ onBack }: { onBack: () => void }) {
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState('');
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<{ kind: 'idle' | 'testing' | 'ok' | 'error'; text?: string }>({ kind: 'idle' });
  const [pinStep, setPinStep] = useState<'none' | 'verify' | 'new'>('none');
  const [newPin, setNewPin] = useState('');
  const [pinMsg, setPinMsg] = useState('');

  useEffect(() => {
    db.getMeta<string>('apiKey').then((k) => {
      setKey(k ?? '');
      setSaved(k ?? '');
    });
  }, []);

  async function save() {
    const k = key.trim();
    if (k) await db.setMeta('apiKey', k);
    else await db.deleteMeta('apiKey');
    setKey(k);
    setSaved(k);
  }

  async function test() {
    await save();
    if (!key.trim()) {
      setStatus({ kind: 'error', text: 'קֹדֶם הַדְבִּיקִי מַפְתֵּחַ.' });
      return;
    }
    setStatus({ kind: 'testing' });
    try {
      await testConnection(key.trim());
      setStatus({ kind: 'ok', text: 'הַחִבּוּר עוֹבֵד! אֶפְשָׁר לְהַעֲלוֹת מִבְחָנִים.' });
    } catch (e) {
      setStatus({ kind: 'error', text: hebrewError(e) });
    }
  }

  if (pinStep === 'verify')
    return <PinScreen onSuccess={() => setPinStep('new')} onCancel={() => setPinStep('none')} />;

  return (
    <div className="app teacher">
      <header className="header">
        <div className="header-title">⚙️ הַגְדָּרוֹת</div>
        <div className="header-tools">
          <button className="btn btn-small" onClick={onBack}>
            → חֲזָרָה
          </button>
        </div>
      </header>
      <main className="main">
        <div className="page narrow">
          <div className="card">
            <h2 className="section-title">מַפְתֵּחַ Claude API</h2>
            <p className="help">
              הַמַּפְתֵּחַ נִשְׁמָר רַק בַּמַּכְשִׁיר הַזֶּה. הוּא לֹא נִשְׁלָח לְשׁוּם מָקוֹם חוּץ מִ-Claude, וְלֹא נִשְׁמָר בַּקּוֹד אוֹ
              בְּ-GitHub.
            </p>
            <div className="key-row">
              <input
                className="text-input key-input"
                dir="ltr"
                type={show ? 'text' : 'password'}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="sk-ant-..."
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setStatus({ kind: 'idle' });
                }}
              />
              <button className="btn btn-small" onClick={() => setShow((s) => !s)}>
                {show ? '🙈 לְהַסְתִּיר' : '👁️ לְהַצִּיג'}
              </button>
            </div>
            <div className="row-actions">
              <button className="btn btn-primary" onClick={test} disabled={status.kind === 'testing'}>
                {status.kind === 'testing' ? '⏳ בּוֹדֶקֶת…' : '🔌 בְּדִיקַת חִבּוּר'}
              </button>
              {key !== saved && (
                <button className="btn" onClick={save}>
                  💾 שְׁמִירָה
                </button>
              )}
              {saved && key === saved && status.kind === 'idle' && <span className="saved-mark">✓ שָׁמוּר</span>}
            </div>
            {status.kind === 'ok' && <div className="notice ok">✅ {status.text}</div>}
            {status.kind === 'error' && <div className="notice error">❌ {status.text}</div>}
          </div>

          <div className="card">
            <h2 className="section-title">קוֹד מוֹרָה</h2>
            {pinStep === 'new' ? (
              <>
                <p className="help">הַקִּישִׁי קוֹד חָדָשׁ שֶׁל 4 סְפָרוֹת:</p>
                <div className="key-row">
                  <input
                    className="text-input pin-input"
                    dir="ltr"
                    inputMode="numeric"
                    maxLength={4}
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  />
                  <button
                    className="btn btn-primary"
                    disabled={newPin.length !== 4}
                    onClick={async () => {
                      await setPin(newPin);
                      setNewPin('');
                      setPinStep('none');
                      setPinMsg('הַקּוֹד הֻחְלַף.');
                    }}
                  >
                    💾 שְׁמִירָה
                  </button>
                </div>
              </>
            ) : (
              <button className="btn" onClick={() => setPinStep('verify')}>
                🔑 הַחְלָפַת קוֹד
              </button>
            )}
            {pinMsg && <div className="notice ok">✅ {pinMsg}</div>}
          </div>
        </div>
      </main>
    </div>
  );
}
