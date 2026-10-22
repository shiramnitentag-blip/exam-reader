import mammoth from 'mammoth';
// Reading the teacher's files: Word → text, PDF → as is, photos → resized JPEG.

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export type PreparedImage = {
  base64: string;
  mediaType: 'image/jpeg';
  previewUrl: string;
  name: string;
  blob: Blob;
  width: number;
  height: number;
};

// The model reads images up to 2576 pixels on the long edge; larger photos only cost more.
const MAX_EDGE = 2576;
// Pictures smaller than this in a Word file are icons or bullets, not exam text.
const MIN_EDGE = 40;
class TooSmall extends Error {}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = url;
  });
}

/** Shrinks a photo if needed and turns it into JPEG (the browser applies the camera rotation). */
export async function prepareImage(file: Blob & { name?: string }): Promise<PreparedImage> {
  const srcUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(srcUrl);
    if (img.naturalWidth < MIN_EDGE || img.naturalHeight < MIN_EDGE) throw new TooSmall();
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', 0.88),
    );
    return {
      base64: await blobToBase64(blob),
      mediaType: 'image/jpeg',
      previewUrl: URL.createObjectURL(blob),
      name: file.name ?? '',
      blob,
      width: w,
      height: h,
    };
  } finally {
    URL.revokeObjectURL(srcUrl);
  }
}

export function fileKind(file: File): 'docx' | 'pdf' | 'image' | 'other' {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx') || file.type.includes('wordprocessingml')) return 'docx';
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (file.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/.test(name)) return 'image';
  return 'other';
}

// ---------- Word files, including pictures inside them ----------

export type DocxContent = {
  text: string; // the document text; [IMAGE n] marks where picture n appears
  plainText: string; // the same text without the marks, for the word-for-word check
  images: PreparedImage[];
  unreadable: number; // pictures in a format the browser cannot open (e.g. EMF drawings)
};

const BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'TABLE', 'UL', 'OL', 'DIV']);

/**
 * Reads a Word file. Text alone is not enough: teachers often paste a passage or a question
 * as a picture, so the pictures are taken too, with marks showing where each one appears.
 */
export async function readDocx(file: File): Promise<DocxContent> {
  const raw: { base64: string; type: string }[] = [];
  const res = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        raw.push({ base64: await image.readAsBase64String(), type: image.contentType });
        return { src: `docx-image:${raw.length - 1}` };
      }),
    },
  );

  // Turn the pictures into JPEGs the model can read; remember which ones worked.
  const images: PreparedImage[] = [];
  const numberOf = new Map<number, number>(); // index in the file → picture number sent to Claude
  let unreadable = 0;
  for (let i = 0; i < raw.length; i++) {
    try {
      const bytes = Uint8Array.from(atob(raw[i].base64), (c) => c.charCodeAt(0));
      images.push(await prepareImage(new Blob([bytes], { type: raw[i].type })));
      numberOf.set(i, images.length);
    } catch (e) {
      if (!(e instanceof TooSmall)) unreadable++;
    }
  }

  const doc = new DOMParser().parseFromString(res.value, 'text/html');
  const walk = (node: Node, withMarks: boolean): string => {
    let out = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) out += n.textContent ?? '';
      else if (n.nodeName === 'IMG') {
        const idx = Number((n as Element).getAttribute('src')?.replace('docx-image:', ''));
        const num = numberOf.get(idx);
        if (withMarks && num) out += `\n[IMAGE ${num}]\n`;
      } else if (n.nodeName === 'BR') out += '\n';
      else if (n.nodeName === 'TD' || n.nodeName === 'TH') out += walk(n, withMarks) + ' | ';
      else if (BLOCKS.has(n.nodeName)) out += walk(n, withMarks) + '\n';
      else out += walk(n, withMarks);
    });
    return out;
  };
  const tidy = (s: string) => s.replace(/\n{3,}/g, '\n\n').trim();
  return {
    text: tidy(walk(doc.body, true)),
    plainText: tidy(walk(doc.body, false)),
    images,
    unreadable,
  };
}
