// Everything is saved in IndexedDB on the device right away: exams, answers, recordings,
// teacher settings (PIN, API key). Nothing is sent anywhere except the API calls the teacher starts.
import type { Exam } from './model';

export type AnswerMode = 'record' | 'text';

export type Answer = {
  examId: string;
  itemId: string;
  mode: AnswerMode;
  clipIds: string[]; // recordings that make up the spoken answer, in order
  text: string; // dictated / typed answer
  choice: number | null; // multiple-choice selection
  flagged: boolean; // "come back to this"
  updatedAt: number;
};

export type Recording = {
  id: string;
  examId?: string;
  questionId: string; // item id
  mimeType: string;
  createdAt: number;
  durationSec: number;
  blob?: Blob; // set when the recording finished; before that, see the chunks store
};

const DB_NAME = 'exam-reader';
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

// Safari on some iPads (iOS 14-15) never answers the first indexedDB.open() after
// the app starts. Poking indexedDB.databases() until it answers wakes it up.
async function safariIdbFix(): Promise<void> {
  const idb = indexedDB as IDBFactory & { databases?: () => Promise<unknown> };
  if (!/Safari/.test(navigator.userAgent) || /Chrome|Android/.test(navigator.userAgent)) return;
  if (!idb.databases) return;
  await new Promise<void>((resolve) => {
    let done = false;
    let tries = 0;
    const finish = () => {
      done = true;
      resolve();
    };
    const poke = () => {
      if (done) return;
      idb.databases!().then(finish, finish);
      tries += 1;
      if (tries < 30) window.setTimeout(poke, 100);
      else finish();
    };
    poke();
  });
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('IndexedDB timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function upgrade(db: IDBDatabase, tx: IDBTransaction, oldVersion: number) {
  if (oldVersion < 1) {
    db.createObjectStore('answers', { keyPath: 'questionId' }); // stage 1 (kept for migration)
    db.createObjectStore('recordings', { keyPath: 'id' });
    db.createObjectStore('chunks', { keyPath: ['recId', 'i'] });
    db.createObjectStore('meta', { keyPath: 'key' });
  }
  if (oldVersion < 2) {
    db.createObjectStore('exams', { keyPath: 'id' });
    const answers = db.createObjectStore('answers2', { keyPath: ['examId', 'itemId'] });
    answers.createIndex('byExam', 'examId');
    // Stage-1 answers belonged to the sample exam.
    const old = tx.objectStore('answers');
    old.openCursor().onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor) return;
      const a = cursor.value as Omit<Answer, 'examId' | 'itemId'> & { questionId: string };
      const { questionId, ...rest } = a;
      answers.put({ ...rest, examId: 'sample', itemId: questionId });
      cursor.continue();
    };
    // The stage-1 "submitted" flag also belonged to the sample exam.
    const meta = tx.objectStore('meta');
    const req = meta.get('submitted');
    req.onsuccess = () => {
      if (req.result) meta.put({ key: 'submitted:sample', value: req.result.value });
    };
  }
}

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    const opening = safariIdbFix().then(
      () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          if (typeof indexedDB === 'undefined') {
            reject(new Error('no IndexedDB'));
            return;
          }
          const req = indexedDB.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = (e) => upgrade(req.result, req.transaction!, e.oldVersion);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          req.onblocked = () => reject(new Error('IndexedDB blocked'));
        }),
    );
    dbPromise = withTimeout(opening, 6000);
    // Let a later call try again if this one failed.
    dbPromise.catch(() => {
      dbPromise = null;
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

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const db = {
  // ---- exams ----
  async listExams(): Promise<Exam[]> {
    const all: Exam[] = await reqToPromise((await store('exams', 'readonly')).getAll());
    return all.sort((a, b) => a.createdAt - b.createdAt);
  },
  async getExam(id: string): Promise<Exam | undefined> {
    return reqToPromise((await store('exams', 'readonly')).get(id));
  },
  async putExam(exam: Exam) {
    await reqToPromise((await store('exams', 'readwrite')).put(exam));
  },
  async deleteExam(id: string) {
    await reqToPromise((await store('exams', 'readwrite')).delete(id));
    await this.clearAnswers(id);
  },

  // ---- answers ----
  async getAnswers(examId: string): Promise<Answer[]> {
    const s = await store('answers2', 'readonly');
    return reqToPromise(s.index('byExam').getAll(examId));
  },
  async putAnswer(a: Answer) {
    await reqToPromise((await store('answers2', 'readwrite')).put(a));
  },
  /** Removes this exam's answers and its "submitted" mark. Recordings stay on the device. */
  async clearAnswers(examId: string) {
    const d = await openDb();
    const tx = d.transaction(['answers2', 'meta'], 'readwrite');
    const idx = tx.objectStore('answers2').index('byExam');
    idx.openCursor(examId).onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    tx.objectStore('meta').delete(`submitted:${examId}`);
    await txDone(tx);
  },

  // ---- recordings ----
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

  // ---- small settings ----
  async getMeta<T>(key: string): Promise<T | undefined> {
    const row = await reqToPromise((await store('meta', 'readonly')).get(key));
    return row?.value as T | undefined;
  },
  async setMeta(key: string, value: unknown) {
    await reqToPromise((await store('meta', 'readwrite')).put({ key, value }));
  },
  async deleteMeta(key: string) {
    await reqToPromise((await store('meta', 'readwrite')).delete(key));
  },
};

export function emptyAnswer(examId: string, itemId: string): Answer {
  return {
    examId,
    itemId,
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
