// Cutting a picture (graph, map, cartoon, photo) out of a page of the source file.
import { useEffect, useRef, useState } from 'react';
import { db } from '../db';
import type { MediaPlace } from '../model';
import { openSource, type SourcePage } from './sourcePages';

export type CropTarget = { kind: 'item' | 'passage'; id: string; label: string; hasStem: boolean; caption?: string };
export type CropResult = { blob: Blob; width: number; height: number; target: CropTarget; place: MediaPlace; caption: string };

const VIEW_W = 1400; // the big page is drawn this wide (pixels), then shown to fit the screen
const CUT_W = 2400; // pages are drawn this wide when cutting, for a sharp picture
const MAX_OUT = 2000; // the saved picture is at most this many pixels on its long side

type Rect = { x: number; y: number; w: number; h: number }; // 0..1, relative to the page

export function CropTool({
  examId,
  targets,
  initialTarget,
  onSave,
  onClose,
}: {
  examId: string;
  targets: CropTarget[];
  initialTarget?: string;
  onSave: (r: CropResult) => Promise<void>;
  onClose: () => void;
}) {
  const [pages, setPages] = useState<SourcePage[] | null>(null);
  const [error, setError] = useState('');
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [pageNo, setPageNo] = useState(0);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [targetId, setTargetId] = useState(initialTarget ?? targets[0]?.id ?? '');
  const target = targets.find((t) => t.id === targetId);
  const [place, setPlace] = useState<MediaPlace>('text');
  const [caption, setCaption] = useState(target?.caption ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  // Open the source file and make small pictures of its pages.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const src = await db.getSource(examId);
      if (!src) throw new Error('no-source');
      const p = await openSource(src);
      if (cancelled) return;
      setPages(p);
      const urls: string[] = [];
      for (const pg of p) {
        const c = await pg.render(160);
        urls.push(c instanceof HTMLCanvasElement ? c.toDataURL('image/jpeg', 0.7) : c.src);
        if (cancelled) return;
        setThumbs([...urls]);
      }
    })().catch((e) =>
      setError(
        e instanceof Error && e.message === 'no-source'
          ? 'אֵין קֹבֶץ מָקוֹר לַמִּבְחָן הַזֶּה. אֶפְשָׁר לְהוֹסִיף תְּמוּנָה מֵהָאַיְפֶּד.'
          : 'לֹא הִצְלַחְתִּי לִפְתֹּחַ אֶת קֹבֶץ הַמָּקוֹר. נַסִּי לִסְגֹּר וְלִפְתֹּחַ אֶת הָאַפְּלִיקַצְיָה.',
      ),
    );
    return () => {
      cancelled = true;
    };
  }, [examId]);

  // The selected page, big.
  useEffect(() => {
    if (!pages?.[pageNo]) return;
    let cancelled = false;
    setPageUrl(null);
    setRect(null);
    pages[pageNo]
      .render(VIEW_W)
      .then((c) => {
        if (!cancelled) setPageUrl(c instanceof HTMLCanvasElement ? c.toDataURL('image/jpeg', 0.85) : c.src);
      })
      .catch(() => setError('לֹא הִצְלַחְתִּי לְהַצִּיג אֶת הָעַמּוּד.'));
    return () => {
      cancelled = true;
    };
  }, [pages, pageNo]);

  useEffect(() => {
    setCaption(target?.caption ?? '');
    if (!target?.hasStem) setPlace('text');
  }, [targetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const point = (e: React.PointerEvent) => {
    const b = surface.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)),
      y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)),
    };
  };

  async function cut() {
    if (!rect || !pages || !target) return;
    setSaving(true);
    try {
      const page = await pages[pageNo].render(CUT_W);
      const W = page instanceof HTMLCanvasElement ? page.width : page.naturalWidth;
      const H = page instanceof HTMLCanvasElement ? page.height : page.naturalHeight;
      const sx = Math.round(rect.x * W);
      const sy = Math.round(rect.y * H);
      const sw = Math.max(1, Math.round(rect.w * W));
      const sh = Math.max(1, Math.round(rect.h * H));
      const scale = Math.min(1, MAX_OUT / Math.max(sw, sh));
      const out = document.createElement('canvas');
      out.width = Math.round(sw * scale);
      out.height = Math.round(sh * scale);
      const ctx = out.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(page, sx, sy, sw, sh, 0, 0, out.width, out.height);
      const blob: Blob = await new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', 0.92));
      await onSave({ blob, width: out.width, height: out.height, target, place, caption: caption.trim() });
      setSaved(`הַתְּמוּנָה נִשְׁמְרָה (${target.label}). אֶפְשָׁר לַחְתֹּךְ עוֹד תְּמוּנָה, אוֹ לִסְגֹּר.`);
      setRect(null);
      setCaption('');
    } catch {
      setError('לֹא הִצְלַחְתִּי לַחְתֹּךְ אֶת הַתְּמוּנָה.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="crop-tool" role="dialog" aria-modal="true">
      <header className="header">
        <div className="header-title">✂️ תְּמוּנָה מֵהַמָּקוֹר</div>
        <div className="header-tools">
          <button className="btn btn-small" onClick={onClose}>
            ✕ סְגִירָה
          </button>
        </div>
      </header>
      <div className="crop-body">
        {error && <div className="notice error">❌ {error}</div>}
        {!pages && !error && <div className="help">⏳ פּוֹתַחַת אֶת הַקֹּבֶץ…</div>}
        {pages && (
          <div className="crop-layout">
            <div className="crop-pages">
              {pages.length > 1 && (
                <div className="crop-nav">
                  <button className="btn btn-small" disabled={pageNo === 0} onClick={() => setPageNo((n) => Math.max(0, n - 1))}>
                    → הַקּוֹדֵם
                  </button>
                  <span className="crop-page-no">
                    עַמּוּד {pageNo + 1} מִתּוֹךְ {pages.length}
                  </span>
                  <button
                    className="btn btn-small"
                    disabled={pageNo === pages.length - 1}
                    onClick={() => setPageNo((n) => Math.min(pages.length - 1, n + 1))}
                  >
                    הַבָּא ←
                  </button>
                </div>
              )}
              {pages.length > 1 && (
                <div className="crop-thumbs">
                  {pages.map((_, i) => (
                    <button key={i} className={`crop-thumb ${i === pageNo ? 'on' : ''}`} onClick={() => setPageNo(i)}>
                      {thumbs[i] ? <img src={thumbs[i]} alt="" /> : <span>⏳</span>}
                      <span>עַמּוּד {i + 1}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="crop-main">
              <p className="help">סַמְּנִי בָּאֶצְבַּע מַלְבֵּן סְבִיב הַתְּמוּנָה: גְּרָרִי מִפִּנָּה לְפִנָּה.</p>
              <div className="crop-stage">
                {pageUrl ? (
                  <div
                    ref={surface}
                    className="crop-surface"
                    onPointerDown={(e) => {
                      try {
              (e.currentTarget as Element).setPointerCapture?.(e.pointerId); // keep following the finger
            } catch {
              /* not possible for this pointer; the gesture still works inside the area */
            }
                      const p = point(e);
                      drag.current = p;
                      setRect({ x: p.x, y: p.y, w: 0, h: 0 });
                      setSaved('');
                    }}
                    onPointerMove={(e) => {
                      const s = drag.current;
                      if (!s) return;
                      const p = point(e);
                      setRect({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
                    }}
                    onPointerUp={() => {
                      drag.current = null;
                      setRect((r) => (r && r.w > 0.02 && r.h > 0.02 ? r : null));
                    }}
                  >
                    <img src={pageUrl} alt="" draggable={false} />
                    {rect && (
                      <div
                        className="crop-rect"
                        style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
                      />
                    )}
                  </div>
                ) : (
                  <div className="help">⏳</div>
                )}
              </div>
            </div>
            <div className="crop-form">
              <div className="crop-controls">
                <label className="field-label" htmlFor="crop-target">
                  לְאֵיזוֹ שְׁאֵלָה?
                </label>
                <select id="crop-target" className="select" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                      {t.caption !== undefined ? ' 📍' : ''}
                    </option>
                  ))}
                </select>
                {target?.hasStem && (
                  <select className="select" value={place} onChange={(e) => setPlace(e.target.value as MediaPlace)} aria-label="מיקום">
                    <option value="stem">אַחֲרֵי הַטֶּקְסְט הַמְּשֻׁתָּף</option>
                    <option value="text">אַחֲרֵי הַשְּׁאֵלָה</option>
                  </select>
                )}
                <input
                  className="text-input"
                  value={caption}
                  placeholder="כִּיתוּב מִתַּחַת לַתְּמוּנָה, כְּמוֹ בַּמָּקוֹר (לֹא חוֹבָה)"
                  onChange={(e) => setCaption(e.target.value)}
                />
                <button className="btn btn-primary" disabled={!rect || saving || !target} onClick={cut}>
                  {saving ? '⏳ שׁוֹמֶרֶת…' : '✂️ לַחְתֹּךְ וְלִשְׁמֹר'}
                </button>
              </div>
              {saved && <div className="notice ok">✅ {saved}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
