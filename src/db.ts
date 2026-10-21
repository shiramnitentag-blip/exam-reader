// Everything the student does is saved in IndexedDB on the device right away.

export type AnswerMode = 'record' | 'text';

export type Answer = {
  questionId: string;
  mode: AnswerMode;
  clipIds: string[]; // recordings that make up the spoken answer, in order
  text: string; // dictated / typed answer
  choice: number | null; // multiple-choice selection
  flagged: boolean; // "come back to this"
  updatedAt: number;
};

export type Recording = {
  id: string;
  questionId: string;
  mimeType: string;
  createdAt: number;
  durationSec: number;
  blob?: Blob; // set when the recording finished; before that, see the chunks store
};

const DB_NAME = 'exam-reader';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('answers', { keyPath: 'questionId' });
        db.createObjectStore('recordings', { keyPath: 'id' });
        db.createObjectStore('chunks', { keyPath: ['recId', 'i'] });
        db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: string, mode: IDBTransactionMode) {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export const db = {
  async getAllAnswers(): Promise<Answer[]> {
    return reqToPromise((await store('answers', 'readonly')).getAll());
  },
  async putAnswer(a: Answer) {
    await reqToPromise((await store('answers', 'readwrite')).put(a));
  },

  async putRecording(r: Recording) {
    await reqToPromise((await store('recordings', 'readwrite')).put(r));
  },
  async putChunk(recId: string, i: number, blob: Blob) {
    await reqToPromise((await store('chunks', 'readwrite')).put({ recId, i, blob }));
  },
  async getRecording(id: string): Promise<Recording | undefined> {
    return reqToPromise((await store('recordings', 'readonly')).get(id));
  },
  /** Returns the audio of a recording, rebuilding it from saved pieces if needed. */
  async getRecordingBlob(id: string): Promise<Blob | null> {
    const rec = await this.getRecording(id);
    if (!rec) return null;
    if (rec.blob) return rec.blob;
    const range = IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
    const chunks: { blob: Blob }[] = await reqToPromise(
      (await store('chunks', 'readonly')).getAll(range),
    );
    if (chunks.length === 0) return null;
    return new Blob(
      chunks.map((c) => c.blob),
      { type: rec.mimeType },
    );
  },

  async getMeta<T>(key: string): Promise<T | undefined> {
    const row = await reqToPromise((await store('meta', 'readonly')).get(key));
    return row?.value as T | undefined;
  },
  async setMeta(key: string, value: unknown) {
    await reqToPromise((await store('meta', 'readwrite')).put({ key, value }));
  },

  async clearAll() {
    const db = await openDb();
    const tx = db.transaction(['answers', 'recordings', 'chunks', 'meta'], 'readwrite');
    for (const n of ['answers', 'recordings', 'chunks', 'meta']) tx.objectStore(n).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

export function emptyAnswer(questionId: string): Answer {
  return {
    questionId,
    mode: 'record',
    clipIds: [],
    text: '',
    choice: null,
    flagged: false,
    updatedAt: Date.now(),
  };
}

export function isAnswered(a: Answer | undefined): boolean {
  if (!a) return false;
  return a.clipIds.length > 0 || a.text.trim().length > 0 || a.choice !== null;
}
