// Reading the teacher's files: Word → text, PDF → as is, photos → resized JPEG.

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function docxToText(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const res = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return res.value;
}

export type PreparedImage = { base64: string; mediaType: 'image/jpeg'; previewUrl: string; name: string };

// The model reads images up to 2576 pixels on the long edge; larger photos only cost more.
const MAX_EDGE = 2576;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = url;
  });
}

/** Shrinks a photo if needed and turns it into JPEG (the browser applies the camera rotation). */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const srcUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(srcUrl);
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
      name: file.name,
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
