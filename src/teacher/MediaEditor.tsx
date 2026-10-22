// Tables and pictures of one question or passage, in the teacher's review screen.
import { useState } from 'react';
import { db } from '../db';
import { prepareImage } from '../files';
import { newId, newTable, sameWords, type Lang, type Media, type MediaPlace, type Table, type Txt } from '../model';
import { useImageUrl } from '../components/Media';

/** Changing a cell keeps its nikud only if the words stayed the same. */
function edit(t: Txt, text: string): Txt {
  return { text, nikud: t.nikud !== undefined && sameWords(text, t.nikud) ? t.nikud : undefined };
}

export function MediaEditor({
  examId,
  media,
  lang,
  hasStem,
  missing,
  canCrop,
  onChange,
  onMissingChange,
  onCrop,
}: {
  examId: string;
  media: Media[];
  lang: Lang;
  hasStem: boolean;
  missing?: string[];
  canCrop: boolean;
  onChange: (m: Media[]) => void;
  onMissingChange: (m: string[] | undefined) => void;
  onCrop: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const dir = lang === 'en' ? 'ltr' : 'rtl';

  const update = (i: number, fn: (m: Media) => Media) => onChange(media.map((m, j) => (j === i ? fn(m) : m)));
  const remove = (i: number) => onChange(media.filter((_, j) => j !== i));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= media.length) return;
    const next = [...media];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  async function addImageFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      const p = await prepareImage(file);
      const id = newId();
      await db.putImage({ id, examId, blob: p.blob, width: p.width, height: p.height });
      onChange([...media, { kind: 'image', id: newId(), place: 'text', imageId: id }]);
    } catch {
      setErr('לֹא הִצְלַחְתִּי לִפְתֹּחַ אֶת הַתְּמוּנָה.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="media-editor">
      {(missing ?? []).map((cap, i) => (
        <div key={i} className="missing-figure">
          📍 בַּמָּקוֹר יֵשׁ כָּאן תְּמוּנָה{cap ? ` ("${cap}")` : ''}.
          {canCrop && (
            <button className="btn btn-small btn-primary" onClick={onCrop}>
              ✂️ לַחְתֹּךְ מֵהַמָּקוֹר
            </button>
          )}
          <button
            className="btn btn-small"
            onClick={() => {
              const rest = (missing ?? []).filter((_, j) => j !== i);
              onMissingChange(rest.length ? rest : undefined);
            }}
          >
            ✕ לֹא צָרִיךְ
          </button>
        </div>
      ))}

      {media.map((m, i) => (
        <div key={m.id} className="media-edit-card">
          <div className="card-tools">
            <span className="field-label">{m.kind === 'table' ? '📊 טַבְלָה' : '🖼️ תְּמוּנָה'}</span>
            {hasStem && (
              <select
                className="select"
                value={m.place}
                aria-label="מיקום"
                onChange={(e) => update(i, (x) => ({ ...x, place: e.target.value as MediaPlace }))}
              >
                <option value="stem">אַחֲרֵי הַטֶּקְסְט הַמְּשֻׁתָּף</option>
                <option value="text">אַחֲרֵי הַשְּׁאֵלָה</option>
              </select>
            )}
            <button className="btn btn-icon" onClick={() => move(i, -1)} disabled={i === 0} aria-label="למעלה">
              ⬆️
            </button>
            <button className="btn btn-icon" onClick={() => move(i, 1)} disabled={i === media.length - 1} aria-label="למטה">
              ⬇️
            </button>
            <button className="btn btn-small btn-danger-outline" onClick={() => remove(i)}>
              🗑️ מְחִיקָה
            </button>
          </div>
          {m.kind === 'table' ? (
            <TableEditor table={m.table} dir={dir} onChange={(t) => update(i, (x) => ({ ...x, table: t }) as Media)} />
          ) : (
            <ImageEdit media={m} dir={dir} onCaption={(t) => update(i, (x) => ({ ...x, caption: t }) as Media)} />
          )}
        </div>
      ))}

      <div className="row-actions">
        <button className="btn btn-small" onClick={() => onChange([...media, { kind: 'table', id: newId(), place: 'text', table: newTable() }])}>
          ➕ טַבְלָה
        </button>
        {canCrop && (
          <button className="btn btn-small" onClick={onCrop}>
            ✂️ תְּמוּנָה מֵהַמָּקוֹר
          </button>
        )}
        <label className="btn btn-small file-btn">
          {busy ? '⏳' : '🖼️'} תְּמוּנָה מֵהָאַיְפֶּד
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              void addImageFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        {err && <span className="warn">{err}</span>}
      </div>
    </div>
  );
}

function ImageEdit({
  media,
  dir,
  onCaption,
}: {
  media: Extract<Media, { kind: 'image' }>;
  dir: 'rtl' | 'ltr';
  onCaption: (t: Txt | undefined) => void;
}) {
  const url = useImageUrl(media);
  return (
    <div className="image-edit">
      {url ? <img src={url} alt="" /> : <span className="help">טוֹעֶנֶת…</span>}
      <label className="field-label small">כִּיתוּב מִתַּחַת לַתְּמוּנָה (מֻקְרָא כְּטֶקְסְט רָגִיל)</label>
      <input
        className="text-input"
        dir={dir}
        value={media.caption?.text ?? ''}
        placeholder="לְמָשָׁל: מָקוֹר: ..."
        onChange={(e) => onCaption(e.target.value ? edit(media.caption ?? { text: '' }, e.target.value) : undefined)}
      />
    </div>
  );
}

/** Cells to edit; rows and columns can be added or removed. */
function TableEditor({ table, dir, onChange }: { table: Table; dir: 'rtl' | 'ltr'; onChange: (t: Table) => void }) {
  const cols = Math.max(table.headers.length, ...table.rows.map((r) => r.length), 1);
  const set = (fn: (t: Table) => void) => {
    const t: Table = JSON.parse(JSON.stringify(table));
    fn(t);
    onChange(t);
  };
  return (
    <div className="table-editor">
      <input
        className="text-input"
        dir={dir}
        value={table.caption?.text ?? ''}
        placeholder="כּוֹתֶרֶת אוֹ הֶעָרָה לַטַּבְלָה (לֹא חוֹבָה)"
        onChange={(e) =>
          set((t) => {
            t.caption = e.target.value ? edit(t.caption ?? { text: '' }, e.target.value) : undefined;
          })
        }
      />
      <div className="table-wrap">
        <table className="edit-table" dir={dir}>
          <thead>
            <tr>
              {Array.from({ length: cols }, (_, c) => (
                <th key={c}>
                  <input
                    value={table.headers[c]?.text ?? ''}
                    placeholder={`עַמּוּדָה ${c + 1}`}
                    onChange={(e) =>
                      set((t) => {
                        while (t.headers.length < cols) t.headers.push({ text: '' });
                        t.headers[c] = edit(t.headers[c], e.target.value);
                      })
                    }
                  />
                </th>
              ))}
              <th className="row-tools" />
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r}>
                {Array.from({ length: cols }, (_, c) => (
                  <td key={c}>
                    <textarea
                      rows={1}
                      value={row[c]?.text ?? ''}
                      onChange={(e) =>
                        set((t) => {
                          while (t.rows[r].length < cols) t.rows[r].push({ text: '' });
                          t.rows[r][c] = edit(t.rows[r][c], e.target.value);
                        })
                      }
                    />
                  </td>
                ))}
                <td className="row-tools">
                  <button
                    className="btn btn-icon"
                    aria-label="למחוק שורה"
                    onClick={() => set((t) => t.rows.splice(r, 1))}
                    disabled={table.rows.length <= 1}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row-actions">
        <button className="btn btn-small" onClick={() => set((t) => t.rows.push(Array.from({ length: cols }, () => ({ text: '' }))))}>
          ➕ שׁוּרָה
        </button>
        <button
          className="btn btn-small"
          onClick={() =>
            set((t) => {
              t.headers.push({ text: '' });
              t.rows.forEach((row) => row.push({ text: '' }));
            })
          }
        >
          ➕ עַמּוּדָה
        </button>
        <button
          className="btn btn-small"
          disabled={cols <= 1}
          onClick={() =>
            set((t) => {
              t.headers.splice(cols - 1, 1);
              t.rows.forEach((row) => row.splice(cols - 1, 1));
            })
          }
        >
          ➖ עַמּוּדָה אַחֲרוֹנָה
        </button>
      </div>
    </div>
  );
}
