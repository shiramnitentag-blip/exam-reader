// A real PDF file of the answers, made on the iPad without internet.
// Each A4 page is drawn by the browser (so Hebrew, nikud and right-to-left come out exactly
// as on screen) and the pages are packed into a small PDF.
import { formatDate, optionLetter, recordingLine, statusText, type Report } from './report';
import { baseFileName } from './export';

const PAGE_W = 595; // A4 in points
const PAGE_H = 842;
const SCALE = 2.2; // pixels per point: sharp enough for printing, small enough for the iPad
const MARGIN = 48;
const FONT = '"Noto Sans Hebrew", "Arial Hebrew", Arial, sans-serif';

type Style = { size: number; bold?: boolean; color?: string; center?: boolean; gapBefore?: number; gapAfter?: number };

class Pages {
  pages: HTMLCanvasElement[] = [];
  ctx!: CanvasRenderingContext2D;
  y = 0;

  constructor() {
    this.newPage();
  }

  newPage() {
    const c = document.createElement('canvas');
    c.width = Math.round(PAGE_W * SCALE);
    c.height = Math.round(PAGE_H * SCALE);
    const ctx = c.getContext('2d')!;
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.textBaseline = 'alphabetic';
    this.pages.push(c);
    this.ctx = ctx;
    this.y = MARGIN;
  }

  ensure(h: number) {
    if (this.y + h > PAGE_H - MARGIN) this.newPage();
  }

  private font(s: Style) {
    return `${s.bold ? '700' : '400'} ${s.size}px ${FONT}`;
  }

  /** Breaks text into lines that fit the width (the browser handles the direction of each line). */
  wrap(text: string, s: Style, width: number): string[] {
    this.ctx.font = this.font(s);
    const out: string[] = [];
    for (const para of text.split('\n')) {
      const words = para.split(/\s+/).filter(Boolean);
      if (words.length === 0) continue;
      let line = '';
      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (line && this.ctx.measureText(test).width > width) {
          out.push(line);
          line = w;
        } else line = test;
      }
      if (line) out.push(line);
    }
    return out;
  }

  /** Writes a paragraph. rtl: Hebrew (right-aligned), otherwise English (left-aligned). */
  text(text: string, s: Style, rtl = true, indent = 0) {
    const width = PAGE_W - 2 * MARGIN - indent;
    const lineH = s.size * 1.55;
    this.y += s.gapBefore ?? 0;
    for (const line of this.wrap(text, s, width)) {
      this.ensure(lineH);
      const ctx = this.ctx;
      ctx.font = this.font(s);
      ctx.fillStyle = s.color ?? '#111';
      ctx.direction = rtl ? 'rtl' : 'ltr';
      if (s.center) {
        ctx.textAlign = 'center';
        ctx.fillText(line, PAGE_W / 2, this.y + s.size);
      } else {
        ctx.textAlign = 'start';
        ctx.fillText(line, rtl ? PAGE_W - MARGIN - indent : MARGIN + indent, this.y + s.size);
      }
      this.y += lineH;
    }
    this.y += s.gapAfter ?? 0;
  }

  rule(gap = 10) {
    this.ensure(gap * 2 + 20);
    this.y += gap;
    const ctx = this.ctx;
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(MARGIN, this.y);
    ctx.lineTo(PAGE_W - MARGIN, this.y);
    ctx.stroke();
    this.y += gap;
  }

  /** The written answer, in a light box (split over pages if it is long). */
  box(text: string, s: Style, rtl: boolean) {
    const pad = 8;
    const lineH = s.size * 1.55;
    const lines = this.wrap(text, s, PAGE_W - 2 * MARGIN - 2 * pad);
    let i = 0;
    while (i < lines.length) {
      this.ensure(lineH + 2 * pad);
      const room = Math.max(1, Math.floor((PAGE_H - MARGIN - this.y - 2 * pad) / lineH));
      const chunk = lines.slice(i, i + room);
      const h = chunk.length * lineH + 2 * pad;
      const ctx = this.ctx;
      ctx.fillStyle = '#f7f6f1';
      ctx.strokeStyle = '#bbb';
      ctx.lineWidth = 0.7;
      ctx.fillRect(MARGIN, this.y, PAGE_W - 2 * MARGIN, h);
      ctx.strokeRect(MARGIN, this.y, PAGE_W - 2 * MARGIN, h);
      let y = this.y + pad;
      for (const line of chunk) {
        ctx.font = this.font(s);
        ctx.fillStyle = '#111';
        ctx.direction = rtl ? 'rtl' : 'ltr';
        ctx.textAlign = 'start';
        ctx.fillText(line, rtl ? PAGE_W - MARGIN - pad : MARGIN + pad, y + s.size);
        y += lineH;
      }
      this.y += h;
      i += chunk.length;
    }
    this.y += 4;
  }
}

function draw(r: Report): HTMLCanvasElement[] {
  const p = new Pages();
  p.text(r.exam.title, { size: 20, bold: true, center: true, gapAfter: 2 });
  const meta = [r.studentName && `שם התלמידה: ${r.studentName}`, `תאריך: ${formatDate(r.date)}`, statusText(r.status)]
    .filter(Boolean)
    .join('   ·   ');
  p.text(meta, { size: 11.5, color: '#444', center: true, gapAfter: 6 });

  for (const { item, answer, clips, answered } of r.items) {
    const rtl = item.lang !== 'en';
    p.rule();
    p.ensure(60); // keep the question title with at least its first lines
    p.text(`שאלה ${item.label}`, { size: 14, bold: true, gapAfter: 2 });
    if (item.stem?.text.trim()) p.text(item.stem.text, { size: 11.5, color: '#555' }, rtl);
    p.text(item.text.text, { size: 12 }, rtl);
    if (item.kind === 'choice') {
      item.options.forEach((o, i) => {
        const chosen = answer?.choice === i;
        p.text(`${optionLetter(item, i)}. ${o.text}${chosen ? '   ← נבחרה' : ''}`, {
          size: 12,
          bold: chosen,
          color: chosen ? '#1f6b3a' : '#111',
        }, rtl, 12);
      });
    }
    if (!answered) {
      p.text('לא נענתה', { size: 12, bold: true, color: '#b42318', gapBefore: 4 });
      continue;
    }
    if (answer?.text.trim()) {
      p.text('התשובה בכתב:', { size: 12, bold: true, gapBefore: 4, gapAfter: 2 });
      p.box(answer.text, { size: 12 }, rtl);
    }
    if (clips.length > 0) p.text(recordingLine(clips), { size: 12, gapBefore: 2 });
  }
  return p.pages;
}

// ---------- packing JPEG pages into a PDF ----------

function jpegOf(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a)), reject) : reject(new Error('toBlob'))),
      'image/jpeg',
      0.9,
    ),
  );
}

function pdfFromJpegs(pages: { data: Uint8Array; w: number; h: number }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Uint8Array | string) => {
    const bytes = typeof b === 'string' ? enc.encode(b) : b;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n: number, body: () => void) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body();
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length;
  // 1: catalog, 2: page list, then for each page: page, contents, image
  const pageObj = (i: number) => 3 + i * 3;
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`));
  pages.forEach((pg, i) => {
    const p = pageObj(i);
    obj(p, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
          `/Resources << /XObject << /Im${i} ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`,
      ),
    );
    const content = `q ${PAGE_W} 0 0 ${PAGE_H} 0 0 cm /Im${i} Do Q`;
    obj(p + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(p + 2, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB ` +
          `/BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.data.length} >>\nstream\n`,
      );
      push(pg.data);
      push('\nendstream');
    });
  });
  const total = 3 + n * 3;
  const xref = length;
  let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

export async function buildPdf(r: Report): Promise<File> {
  // The Hebrew font must be ready before drawing, or the browser would use a fallback.
  try {
    await Promise.all([document.fonts.load(`400 12px ${FONT}`, 'אבג'), document.fonts.load(`700 12px ${FONT}`, 'אבג')]);
  } catch {
    /* draw with whatever font is available */
  }
  const canvases = draw(r);
  const pages = [];
  for (const c of canvases) {
    pages.push({ data: await jpegOf(c), w: c.width, h: c.height });
    c.width = 0; // free the memory right away (iPad has a limit for canvases)
    c.height = 0;
  }
  const bytes = pdfFromJpegs(pages);
  return new File([bytes as BlobPart], `תשובות - ${baseFileName(r)}.pdf`, { type: 'application/pdf' });
}
