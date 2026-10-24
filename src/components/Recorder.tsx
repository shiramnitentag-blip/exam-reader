import { useEffect, useRef, useState } from 'react';
import { db, type Answer } from '../db';
import { speech } from '../speech';

type Action = 'new' | 'replace' | 'append';
type Status = 'idle' | 'starting' | 'recording' | 'saving';

const MIME_CANDIDATES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];

function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatTime(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Recorder({
  answer,
  update,
}: {
  answer: Answer;
  update: (fn: (a: Answer) => Answer) => void;
}) {
  const [status, setStatus] = useState<Status>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [totalSec, setTotalSec] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null); // the recording in progress
  const stopReasonRef = useRef<string | null>(null);

  const [urls, setUrls] = useState<string[]>([]);

  const recRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  // One audio element, reused. Safari only lets audio start right inside a tap,
  // so the recordings are loaded ahead of time and playback starts immediately.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playTokenRef = useRef(0);

  const supported =
    typeof window !== 'undefined' &&
    'MediaRecorder' in window &&
    !!navigator.mediaDevices?.getUserMedia;

  const clipKey = answer.clipIds.join(',');

  // Load the saved answer: its length, and the audio ready to play.
  useEffect(() => {
    let cancelled = false;
    let made: string[] = [];
    (async () => {
      const recs = await Promise.all(answer.clipIds.map((id) => db.getRecording(id)));
      const blobs = await Promise.all(answer.clipIds.map((id) => db.getRecordingBlob(id)));
      if (cancelled) return;
      // A recording that has no sound at all (the app closed in its first second) is removed.
      const empty = answer.clipIds.filter((id, i) => !blobs[i] && id !== activeIdRef.current);
      if (empty.length > 0) update((a) => ({ ...a, clipIds: a.clipIds.filter((c) => !empty.includes(c)) }));
      setTotalSec(recs.reduce((sum, r) => sum + (r?.durationSec ?? 0), 0));
      made = blobs.filter((b): b is Blob => !!b).map((b) => URL.createObjectURL(b));
      setUrls(made);
    })().catch(() => {});
    return () => {
      cancelled = true;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipKey, savedCount]);

  // If she leaves the question while recording, finish and save the recording.
  useEffect(() => {
    return () => {
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
      stopPlayback();
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopPlayback() {
    playTokenRef.current++;
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    setPlaying(false);
  }

  async function start(action: Action) {
    setError(null);
    setNotice(null);
    stopReasonRef.current = null;
    speech.stop();
    stopPlayback();
    setStatus('starting');

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setStatus('idle');
      setError('צָרִיךְ לְאַשֵּׁר גִּישָׁה לַמִּיקְרוֹפוֹן.');
      return;
    }

    const mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m));
    let mr: MediaRecorder;
    try {
      mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setStatus('idle');
      setError('הַהַקְלָטָה לֹא עוֹבֶדֶת בַּמַּכְשִׁיר הַזֶּה.');
      return;
    }

    const id = newId();
    const mimeType = mr.mimeType || mime || 'audio/mp4';
    const createdAt = Date.now();
    const pieces: Blob[] = [];
    let index = 0;
    const meta = (durationSec: number) => ({
      id,
      examId: answer.examId,
      questionId: answer.itemId,
      mimeType,
      createdAt,
      durationSec,
    });
    let writes: Promise<unknown> = db.putRecording(meta(0));
    let writeFailed = false;
    activeIdRef.current = id;
    const previous = answer.clipIds;

    // Link the new recording to the answer right away, so nothing is lost if the app closes.
    // For "record again", the old parts stay until the new one is saved.
    update((a) => ({ ...a, clipIds: [...a.clipIds, id] }));

    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        pieces.push(e.data);
        const i = index++;
        const sec = (Date.now() - createdAt) / 1000;
        // Each second is saved at once, with the length so far: if the app closes, the answer is
        // kept up to that moment.
        writes = writes
          .then(() => db.putChunk(id, i, e.data))
          .then(() => db.putRecording(meta(sec)))
          .catch(() => {
            writeFailed = true;
          });
      }
    };

    // Stop (and save) when she leaves the app, the screen turns off, or another app takes the mic.
    const stopFor = (reason: string) => {
      if (mr.state === 'inactive') return;
      stopReasonRef.current = reason;
      try {
        mr.stop();
      } catch {
        /* already stopped */
      }
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') stopFor('hidden');
    };
    const onPageHide = () => stopFor('hidden');
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    stream.getAudioTracks().forEach((t) => (t.onended = () => stopFor('mic')));
    mr.onerror = () => stopFor('error');

    mr.onstop = async () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
      stream.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      recRef.current = null;
      setStatus('saving');
      const durationSec = (Date.now() - createdAt) / 1000;
      try {
        await writes;
        const blob = new Blob(pieces, { type: mimeType });
        if (blob.size === 0) {
          update((a) => ({ ...a, clipIds: a.clipIds.filter((c) => c !== id) }));
          setError('הַהַקְלָטָה רֵיקָה. נַסִּי שׁוּב.');
        } else {
          try {
            await db.putRecording({ ...meta(durationSec), blob });
            // The recording is now saved in one piece: its one-second pieces can go.
            await db.deleteChunks(id).catch(() => {});
          } catch (e) {
            // Not saved in one piece (maybe no space): the one-second pieces still hold it.
            if (writeFailed) throw e;
            await db.putRecording(meta(durationSec)).catch(() => {});
          }
          if (action === 'replace') {
            update((a) => ({ ...a, clipIds: a.clipIds.filter((c) => !previous.includes(c)) }));
          }
          setSavedCount((n) => n + 1);
          const reason = stopReasonRef.current;
          if (reason === 'hidden') setNotice('הַהַקְלָטָה נֶעֶצְרָה כְּשֶׁיָּצָאת מֵהָאַפְּלִיקַצְיָה. מָה שֶׁהֻקְלַט עַד אָז נִשְׁמַר.');
          else if (reason === 'mic' || reason === 'error') setNotice('הַהַקְלָטָה נֶעֶצְרָה. מָה שֶׁהֻקְלַט עַד אָז נִשְׁמַר.');
        }
      } catch (e) {
        const full = e instanceof DOMException && e.name === 'QuotaExceededError';
        setError(full ? 'אֵין מַסְפִּיק מָקוֹם בָּאַיְפֶּד. קִרְאִי לַמּוֹרָה.' : 'הָיְתָה בְּעָיָה בִּשְׁמִירָה. קִרְאִי לַמּוֹרָה.');
      }
      activeIdRef.current = null;
      setStatus('idle');
    };

    recRef.current = mr;
    mr.start(1000); // a piece every second, each saved immediately
    setElapsed(0);
    setStatus('recording');
    timerRef.current = window.setInterval(() => setElapsed((Date.now() - createdAt) / 1000), 250);
  }

  function stop() {
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
  }

  function play() {
    if (playing) {
      stopPlayback();
      return;
    }
    speech.stop();
    stopPlayback();
    if (urls.length === 0) return;
    const my = ++playTokenRef.current;
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    setPlaying(true);
    let i = 0;
    const next = () => {
      if (my !== playTokenRef.current) return;
      if (i >= urls.length) {
        stopPlayback();
        return;
      }
      audio.onended = next;
      audio.onerror = next;
      audio.src = urls[i++];
      audio.play().catch(() => stopPlayback());
    };
    next();
  }

  if (!supported) {
    return (
      <div className="notice">
        הַהַקְלָטָה לֹא עוֹבֶדֶת כָּאן. אֶפְשָׁר לִבְחֹר "לִכְתֹּב בְּקוֹל".
      </div>
    );
  }

  const hasClips = answer.clipIds.length > 0;
  const recording = status === 'recording';
  const busy = status === 'starting' || status === 'saving';

  return (
    <div className="recorder">
      {(recording || !hasClips || busy) && (
        <>
          <button
            className={`rec-btn ${recording ? 'recording' : ''}`}
            onClick={() => (recording ? stop() : start('new'))}
            disabled={busy}
            aria-label={recording ? 'לעצור הקלטה' : 'להתחיל הקלטה'}
          >
            <span className={recording ? 'rec-square' : 'rec-dot'} />
          </button>
          <div className="rec-caption">
            {recording ? (
              <>
                <span className="rec-time">{formatTime(elapsed)}</span> לְחָצִי כְּדֵי לַעֲצֹר
              </>
            ) : busy ? (
              'רֶגַע…'
            ) : (
              'לְחָצִי כְּדֵי לְהַקְלִיט'
            )}
          </div>
        </>
      )}

      {hasClips && !recording && !busy && (
        <>
          <div className="rec-saved">
            ✅ הַתְּשׁוּבָה נִשְׁמְרָה
            <span className="rec-len">
              {answer.clipIds.length > 1 ? ` · ${answer.clipIds.length} חֲלָקִים` : ''} · {formatTime(totalSec)}
            </span>
          </div>
          <div className="rec-actions">
            <button className={`btn btn-big ${playing ? 'active' : ''}`} onClick={play}>
              <span className="icon">{playing ? '⏹' : '▶️'}</span>
              {playing ? 'עֲצִירָה' : 'לְהַשְׁמִיעַ'}
            </button>
            <button className="btn btn-big" onClick={() => start('replace')}>
              <span className="icon">🔄</span>
              לְהַקְלִיט מֵחָדָשׁ
            </button>
            <button className="btn btn-big" onClick={() => start('append')}>
              <span className="icon">➕</span>
              לְהוֹסִיף לַתְּשׁוּבָה
            </button>
          </div>
        </>
      )}

      {notice && <div className="notice">{notice}</div>}
      {error && <div className="notice error">{error}</div>}
    </div>
  );
}
