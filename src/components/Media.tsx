// Tables and pictures inside questions and passages.
import { useEffect, useRef, useState } from 'react';
import { db } from '../db';
import {
  cellId,
  headerId,
  shown,
  voiceFor,
  type Lang,
  type Media,
  type MediaPlace,
  type ReadMode,
  type Table,
} from '../model';
import { speech, useSpeaking } from '../speech';
import { ReadableText } from './Speak';

/** The address of a picture: saved on the device, or shipped with the app. */
export function useImageUrl(m: { imageId?: string; src?: string }): string | null {
  const [url, setUrl] = useState<string | null>(m.src ?? null);
  useEffect(() => {
    if (m.src) {
      setUrl(m.src);
      return;
    }
    if (!m.imageId) return;
    let made: string | null = null;
    let cancelled = false;
    db.getImage(m.imageId)
      .then((img) => {
        if (cancelled || !img) return;
        made = URL.createObjectURL(img.blob);
        setUrl(made);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [m.imageId, m.src]);
  return url;
}

/** The tables and pictures of one place in a question (after the shared text, or after the question). */
export function MediaList({
  media,
  place,
  lang,
  useNikud,
  mode,
  idPrefix,
}: {
  media?: Media[];
  place: MediaPlace | 'all';
  lang: Lang;
  useNikud: boolean;
  mode: ReadMode;
  idPrefix?: string;
}) {
  const list = (media ?? []).filter((m) => place === 'all' || m.place === place);
  if (list.length === 0) return null;
  return (
    <>
      {list.map((m) =>
        m.kind === 'table' ? (
          <TableView key={m.id} table={m.table} lang={lang} useNikud={useNikud} mode={mode} />
        ) : (
          <Figure key={m.id} media={m} lang={lang} useNikud={useNikud} mode={mode} idPrefix={idPrefix} />
        ),
      )}
    </>
  );
}

/** A real table: big, right to left, scrolls sideways if it is wide. Tapping a cell reads only it. */
export function TableView({
  table,
  lang,
  useNikud,
  mode,
  interactive = true,
}: {
  table: Table;
  lang: Lang;
  useNikud: boolean;
  mode: ReadMode;
  interactive?: boolean;
}) {
  const current = useSpeaking();
  const canRead = interactive && mode !== 'none';
  const hasHeaders = table.headers.some((h) => h.text.trim());
  const tap = (id: string, text: string) => {
    if (!canRead || !text.trim()) return;
    if (current === id) speech.stop();
    else speech.speak(voiceFor({ id, text, lang }, mode));
  };
  const caption = table.caption ? shown(table.caption, useNikud) : '';

  return (
    <div className="table-block">
      {caption && <ReadableText text={caption} idPrefix={`${table.id}-cap`} lang={lang} mode={canRead ? mode : 'none'} className="table-caption" />}
      <div className="table-wrap">
        <table className="exam-table" dir={lang === 'en' ? 'ltr' : 'rtl'} lang={lang}>
          {hasHeaders && (
            <thead>
              <tr>
                {table.headers.map((h, c) => {
                  const id = headerId(table, c);
                  const text = shown(h, useNikud);
                  return (
                    <th key={c} className={current === id ? 'reading' : ''} onClick={() => tap(id, text)}>
                      {text}
                    </th>
                  );
                })}
              </tr>
            </thead>
          )}
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r} className={current === `${table.id}-r${r}` ? 'reading-row' : ''}>
                {row.map((cell, c) => {
                  const id = cellId(table, r, c);
                  const text = shown(cell, useNikud);
                  return (
                    <td key={c} className={current === id ? 'reading' : ''} onClick={() => tap(id, text)}>
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A picture in a question. Tapping it opens it full screen. Its caption is read as plain text. */
export function Figure({
  media,
  lang,
  useNikud,
  mode,
  idPrefix,
}: {
  media: Extract<Media, { kind: 'image' }>;
  lang: Lang;
  useNikud: boolean;
  mode: ReadMode;
  idPrefix?: string;
}) {
  const url = useImageUrl(media);
  const [open, setOpen] = useState(false);
  const caption = media.caption ? shown(media.caption, useNikud) : '';
  return (
    <figure className="exam-figure">
      <button className="figure-btn" onClick={() => url && setOpen(true)} aria-label="להגדיל את התמונה">
        {url ? <img src={url} alt="" /> : <span className="figure-loading">🖼️</span>}
        <span className="figure-zoom" aria-hidden>
          🔍
        </span>
      </button>
      {caption && (
        <figcaption>
          <ReadableText text={caption} idPrefix={`${idPrefix ?? ''}${media.id}-cap`} lang={lang} mode={mode} />
        </figcaption>
      )}
      {open && url && <ImageViewer url={url} onClose={() => setOpen(false)} />}
    </figure>
  );
}

/** Full screen picture: pinch to zoom, drag to move, double tap to zoom in or out, big close button. */
export function ImageViewer({ url, onClose }: { url: string; onClose: () => void }) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; scale: number; x: number; y: number; mx: number; my: number } | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    speech.stop();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const begin = () => {
    const pts = [...pointers.current.values()];
    if (pts.length === 0) {
      gesture.current = null;
      return;
    }
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture.current = { dist, scale: view.scale, x: view.x, y: view.y, mx, my };
  };

  return (
    <div className="viewer" role="dialog" aria-modal="true">
      <div
        className="viewer-stage"
        onPointerDown={(e) => {
          try {
            (e.currentTarget as Element).setPointerCapture?.(e.pointerId); // keep following the finger
          } catch {
            /* not possible for this pointer; the gesture still works inside the area */
          }
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 1) {
            const now = Date.now();
            if (now - lastTap.current < 300) {
              setView((v) => (v.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 }));
              lastTap.current = 0;
            } else lastTap.current = now;
          }
          begin();
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId)) return;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const g = gesture.current;
          if (!g) return;
          const pts = [...pointers.current.values()];
          const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
          const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
          let scale = g.scale;
          if (pts.length > 1 && g.dist > 0) {
            const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            scale = Math.min(6, Math.max(1, (g.scale * dist) / g.dist));
          }
          if (scale === 1 && pts.length === 1) return; // nothing to move when not zoomed
          setView({ scale, x: g.x + (mx - g.mx), y: g.y + (my - g.my) });
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (view.scale <= 1.02) setView({ scale: 1, x: 0, y: 0 });
          begin();
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          begin();
        }}
      >
        <img
          src={url}
          alt=""
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
      </div>
      <button className="viewer-close" onClick={onClose}>
        ✕ סְגִירָה
      </button>
    </div>
  );
}
