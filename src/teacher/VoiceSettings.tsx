// Teacher settings for the reading voice (Azure). Everything is kept only on this device.
import { useEffect, useState } from 'react';
import { DEFAULT_TTS, loadTTSSettings, providerFor, saveTTSSettings, TTSError, type TTSSettings, type VoiceInfo } from '../tts';
import { SILENCE } from '../tts/silence';
import { speech } from '../speech';

const REGIONS = ['westeurope', 'northeurope', 'swedencentral', 'uksouth', 'francecentral', 'eastus', 'eastus2', 'westus2', 'centralindia'];

const FALLBACK_VOICES: VoiceInfo[] = [
  { id: 'he-IL-HilaNeural', name: 'הילה (he-IL)', lang: 'he' },
  { id: 'he-IL-AvriNeural', name: 'אברי (he-IL)', lang: 'he' },
  { id: 'en-US-JennyNeural', name: 'Jenny (en-US)', lang: 'en' },
  { id: 'en-US-GuyNeural', name: 'Guy (en-US)', lang: 'en' },
  { id: 'en-US-AriaNeural', name: 'Aria (en-US)', lang: 'en' },
];

const SAMPLE = {
  he: 'שָׁלוֹם! זֶה הַקּוֹל שֶׁיַּקְרִיא אֶת הַמִּבְחָן.',
  en: 'Hello! This is the voice that will read the exam.',
};

function errorText(e: unknown) {
  if (e instanceof TTSError) return e.message + (e.details ? `\n(פְּרָטִים: ${e.details})` : '');
  return e instanceof Error ? e.message : String(e);
}

export function VoiceSettings() {
  const [s, setS] = useState<TTSSettings>(DEFAULT_TTS);
  const [loaded, setLoaded] = useState(false);
  const [show, setShow] = useState(false);
  const [voices, setVoices] = useState<VoiceInfo[]>(FALLBACK_VOICES);
  const [status, setStatus] = useState<{ kind: 'idle' | 'testing' | 'ok' | 'error'; text?: string }>({ kind: 'idle' });
  const [sample, setSample] = useState<{ lang: 'he' | 'en'; busy: boolean; error?: string } | null>(null);

  useEffect(() => {
    loadTTSSettings().then((t) => {
      setS(t);
      setLoaded(true);
    });
  }, []);

  async function save(next: TTSSettings) {
    setS(next);
    await saveTTSSettings(next);
    speech.setFileVoices({ he: next.voiceHe, en: next.voiceEn });
  }

  async function test() {
    const next = { ...s, azureKey: s.azureKey.trim(), azureRegion: s.azureRegion.trim().toLowerCase() };
    await save(next);
    const p = providerFor(next);
    if (!p) {
      setStatus({ kind: 'error', text: 'צָרִיךְ גַּם מַפְתֵּחַ וְגַם אֵזוֹר (region).' });
      return;
    }
    setStatus({ kind: 'testing' });
    try {
      const list = await p.listVoices();
      if (list.length) setVoices(list);
      setStatus({ kind: 'ok', text: 'הַחִבּוּר ל-Azure עוֹבֵד!' });
    } catch (e) {
      setStatus({ kind: 'error', text: errorText(e) });
    }
  }

  async function playSample(lang: 'he' | 'en') {
    // The iPad plays sound only from a tap: start the player now (with silence), fill it after.
    const audio = new Audio(SILENCE);
    void audio.play().catch(() => {});
    const p = providerFor(s);
    if (!p) {
      setSample({ lang, busy: false, error: 'צָרִיךְ קֹדֶם לִבְדֹּק אֶת הַחִבּוּר.' });
      return;
    }
    setSample({ lang, busy: true });
    try {
      const blob = await p.synthesize(SAMPLE[lang], lang === 'he' ? s.voiceHe : s.voiceEn, lang);
      audio.src = URL.createObjectURL(blob);
      await audio.play();
      setSample(null);
    } catch (e) {
      setSample({ lang, busy: false, error: errorText(e) });
    }
  }

  if (!loaded) return null;
  const he = voices.filter((v) => v.lang === 'he');
  const en = voices.filter((v) => v.lang === 'en');

  return (
    <div className="card">
      <h2 className="section-title">🔊 קוֹל הַהַקְרָאָה (Azure)</h2>
      <p className="help">
        קוֹל אֵיכוּתִי מִ-Microsoft Azure. הַמַּפְתֵּחַ נִשְׁמָר רַק בַּמַּכְשִׁיר הַזֶּה. בְּלִי מַפְתֵּחַ, הָאַפְּלִיקַצְיָה מַקְרִיאָה בַּקּוֹל
        הַמּוּבְנֶה שֶׁל הָאַיְפֶּד.
      </p>
      <label className="field-label" htmlFor="az-key">
        מַפְתֵּחַ (Key)
      </label>
      <div className="key-row">
        <input
          id="az-key"
          className="text-input key-input"
          dir="ltr"
          type={show ? 'text' : 'password'}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={s.azureKey}
          onChange={(e) => {
            setS({ ...s, azureKey: e.target.value });
            setStatus({ kind: 'idle' });
          }}
        />
        <button className="btn btn-small" onClick={() => setShow((x) => !x)}>
          {show ? '🙈' : '👁️'}
        </button>
      </div>
      <label className="field-label" htmlFor="az-region">
        אֵזוֹר (Region)
      </label>
      <input
        id="az-region"
        className="text-input"
        dir="ltr"
        list="az-regions"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="westeurope"
        value={s.azureRegion}
        onChange={(e) => {
          setS({ ...s, azureRegion: e.target.value });
          setStatus({ kind: 'idle' });
        }}
      />
      <datalist id="az-regions">
        {REGIONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <div className="row-actions">
        <button className="btn btn-primary" onClick={test} disabled={status.kind === 'testing'}>
          {status.kind === 'testing' ? '⏳ בּוֹדֶקֶת…' : '🔌 בְּדִיקַת חִבּוּר'}
        </button>
      </div>
      {status.kind === 'ok' && <div className="notice ok">✅ {status.text}</div>}
      {status.kind === 'error' && <div className="notice error pre">❌ {status.text}</div>}

      <h3 className="field-label">קוֹל בְּעִבְרִית</h3>
      <div className="key-row">
        <select className="select" value={s.voiceHe} onChange={(e) => void save({ ...s, voiceHe: e.target.value })}>
          {!he.some((v) => v.id === s.voiceHe) && <option value={s.voiceHe}>{s.voiceHe}</option>}
          {he.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <button className="btn btn-small" onClick={() => playSample('he')} disabled={sample?.busy}>
          {sample?.busy && sample.lang === 'he' ? '⏳' : '▶️'} דֻּגְמָה
        </button>
      </div>
      <h3 className="field-label">קוֹל בְּאַנְגְּלִית</h3>
      <div className="key-row">
        <select className="select" value={s.voiceEn} onChange={(e) => void save({ ...s, voiceEn: e.target.value })}>
          {!en.some((v) => v.id === s.voiceEn) && <option value={s.voiceEn}>{s.voiceEn}</option>}
          {en.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <button className="btn btn-small" onClick={() => playSample('en')} disabled={sample?.busy}>
          {sample?.busy && sample.lang === 'en' ? '⏳' : '▶️'} Sample
        </button>
      </div>
      {sample?.error && <div className="notice error pre">❌ {sample.error}</div>}
      <p className="help">אַחֲרֵי הַחְלָפַת קוֹל צָרִיךְ לִלְחֹץ שׁוּב "הֲכָנָה לַמִּבְחָן" בְּכָל מִבְחָן.</p>
    </div>
  );
}
