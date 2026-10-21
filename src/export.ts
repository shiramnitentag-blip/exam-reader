// Word file and ZIP of recordings, made on the device (works without internet).
// Loaded with the app (not on demand), so they are there offline, even on the first day.
import { AlignmentType, BorderStyle, Document, Packer, Paragraph, TextRun } from 'docx';
import { zipSync } from 'fflate';
import { db } from './db';
import {
  extensionFor,
  formatDate,
  labelForFile,
  optionLetter,
  recordingLine,
  statusText,
  type Report,
} from './report';

function safeName(s: string) {
  return s.replace(/[\\/:*?"<>|]/g, '-').trim() || 'מבחן';
}

export function baseFileName(r: Report) {
  return safeName([r.studentName, r.exam.title].filter(Boolean).join(' - '));
}

// ---------- Word ----------

export async function buildDocx(r: Report): Promise<File> {

  const run = (text: string, rtl: boolean, opts: { bold?: boolean; size?: number; color?: string } = {}) =>
    new TextRun({
      text,
      rightToLeft: rtl,
      bold: opts.bold,
      boldComplexScript: opts.bold,
      size: opts.size ?? 24,
      sizeComplexScript: opts.size ?? 24,
      color: opts.color,
      font: { ascii: 'Arial', hAnsi: 'Arial', cs: 'Arial' },
      language: rtl ? { bidirectional: 'he-IL' } : { value: 'en-US' },
    });

  // Every paragraph sets its direction (bidi) explicitly; English questions stay left-to-right.
  const para = (
    text: string,
    rtl: boolean,
    opts: { bold?: boolean; size?: number; color?: string; center?: boolean; before?: number; after?: number } = {},
  ) =>
    new Paragraph({
      bidirectional: rtl,
      alignment: opts.center ? AlignmentType.CENTER : AlignmentType.START,
      spacing: { before: opts.before ?? 0, after: opts.after ?? 120, line: 360 },
      children: [run(text, rtl, opts)],
    });

  const children: InstanceType<typeof Paragraph>[] = [
    para(r.exam.title, true, { bold: true, size: 36, center: true, after: 80 }),
    para([r.studentName && `שם התלמידה: ${r.studentName}`, `תאריך: ${formatDate(r.date)}`, statusText(r.status)].filter(Boolean).join('   ·   '), true, {
      center: true,
      color: '555555',
      after: 360,
    }),
  ];

  for (const { item, answer, clips, answered } of r.items) {
    const rtl = item.lang !== 'en';
    children.push(
      new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.START,
        spacing: { before: 240, after: 80 },
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB', space: 8 } },
        children: [run(`שאלה ${item.label}`, true, { bold: true, size: 28 })],
      }),
    );
    if (item.stem?.text.trim()) children.push(para(item.stem.text, rtl, { color: '555555' }));
    for (const line of item.text.text.split('\n')) if (line.trim()) children.push(para(line, rtl));
    if (item.kind === 'choice') {
      item.options.forEach((o, i) => {
        const chosen = answer?.choice === i;
        children.push(
          para(`${optionLetter(item, i)}. ${o.text}${chosen ? '   ← נבחרה' : ''}`, rtl, {
            bold: chosen,
            color: chosen ? '1F6B3A' : undefined,
          }),
        );
      });
    }
    if (!answered) {
      children.push(para('לא נענתה', true, { bold: true, color: 'B42318', before: 80 }));
      continue;
    }
    if (answer?.text.trim()) {
      children.push(para('התשובה בכתב:', true, { bold: true, before: 80 }));
      for (const line of answer.text.split('\n')) if (line.trim()) children.push(para(line, rtl));
    }
    if (clips.length > 0) children.push(para(recordingLine(clips), true, { before: 80 }));
  }

  const doc = new Document({
    creator: 'מבחן בקול',
    title: r.exam.title,
    styles: { default: { document: { run: { font: 'Arial', size: 24, sizeComplexScript: 24 } } } },
    sections: [{ properties: {}, children }],
  });
  const blob = await Packer.toBlob(doc);
  return new File([blob], `תשובות - ${baseFileName(r)}.docx`, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

// ---------- ZIP of recordings ----------

export async function buildRecordingsZip(r: Report): Promise<File | null> {
  const files: Record<string, Uint8Array> = {};
  for (const { item, clips } of r.items) {
    for (let i = 0; i < clips.length; i++) {
      const blob = await db.getRecordingBlob(clips[i].id);
      if (!blob) continue;
      const part = clips.length > 1 ? `-חלק-${i + 1}` : '';
      const name = `שאלה-${labelForFile(item.label)}${part}.${extensionFor(clips[i].mimeType)}`;
      files[name] = new Uint8Array(await blob.arrayBuffer());
    }
  }
  if (Object.keys(files).length === 0) return null;
  // Audio is already compressed: store it as is (level 0) so the ZIP is made quickly.
  const zipped = zipSync(files, { level: 0 });
  return new File([zipped as BlobPart], `הקלטות - ${baseFileName(r)}.zip`, { type: 'application/zip' });
}

// ---------- giving the file to the teacher ----------

/**
 * Opens the iPad's share sheet (save to Files, Mail, WhatsApp…). Where sharing files is not
 * possible, the file is downloaded instead. Must be called straight from a tap.
 */
export async function deliver(file: File): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: file.name });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // fall through to download
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}
