// The pages of the source file (PDF or pictures), as pictures the teacher can cut from.
import type { Source } from '../db';

export type SourcePage = {
  /** Draws the page at about this width (pixels) and returns it as a picture. */
  render: (width: number) => Promise<HTMLCanvasElement | HTMLImageElement>;
};

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve(img); // the URL stays valid while the tool is open
    img.onerror = () => reject(new Error('image'));
    img.src = url;
  });
}

export async function openSource(src: Source): Promise<SourcePage[]> {
  if (src.pages?.length) {
    return src.pages.map((blob) => {
      let img: Promise<HTMLImageElement> | null = null;
      return { render: () => (img ??= loadImage(blob)) };
    });
  }
  if (!src.pdf) return [];
  // pdf.js is loaded only here (teacher mode), from the files kept for offline use.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await src.pdf.arrayBuffer()) }).promise;
  const pages: SourcePage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const cache = new Map<number, Promise<HTMLCanvasElement>>();
    pages.push({
      render: (width: number) => {
        const key = Math.round(width);
        if (!cache.has(key))
          cache.set(
            key,
            (async () => {
              const page = await doc.getPage(n);
              const base = page.getViewport({ scale: 1 });
              const viewport = page.getViewport({ scale: width / base.width });
              const canvas = document.createElement('canvas');
              canvas.width = Math.round(viewport.width);
              canvas.height = Math.round(viewport.height);
              await page.render({ canvas, viewport }).promise;
              return canvas;
            })(),
          );
        return cache.get(key)!;
      },
    });
  }
  return pages;
}
