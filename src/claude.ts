// Calls to the Claude API, straight from the browser with the teacher's own key
// (the key is kept only in IndexedDB on this device).
import Anthropic from '@anthropic-ai/sdk';
import type { Lang } from './model';

const MODEL = 'claude-sonnet-5-5';
// If Claude's safety filter declines a request, the API retries it on a suitable model by itself.
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };

function client(apiKey: string) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

// ---------- errors in plain Hebrew ----------

export class ClaudeError extends Error {}

export function hebrewError(e: unknown): string {
  if (e instanceof ClaudeError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return 'הַמַּפְתֵּחַ לֹא נָכוֹן. בִּדְקִי שֶׁהֶעְתַּקְתְּ אֶת כֻּלּוֹ, בְּמָסַךְ הַהַגְדָּרוֹת.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'לַמַּפְתֵּחַ הַזֶּה אֵין הַרְשָׁאָה. בִּדְקִי אֶת הַחֶשְׁבּוֹן בְּאַתַר Claude Console.';
  if (e instanceof Anthropic.NotFoundError) return 'הַמּוֹדֶל לֹא זָמִין בַּחֶשְׁבּוֹן הַזֶּה.';
  if (e instanceof Anthropic.RateLimitError) return 'יוֹתֵר מִדַּי בַּקָּשׁוֹת בְּבַת אַחַת. חַכִּי דַּקָּה וְנַסִּי שׁוּב.';
  if (e instanceof Anthropic.APIConnectionError) return 'אֵין חִבּוּר לָאִינְטֶרְנֶט, אוֹ שֶׁהַחִבּוּר נִקְטַע. בִּדְקִי אֶת הָאִינְטֶרְנֶט וְנַסִּי שׁוּב.';
  if (e instanceof Anthropic.BadRequestError) {
    const msg = String(e.message).toLowerCase();
    if (msg.includes('credit') || msg.includes('balance') || msg.includes('billing'))
      return 'אֵין מַסְפִּיק קְרֶדִיט בַּחֶשְׁבּוֹן שֶׁל Claude. צָרִיךְ לִטְעֹן קְרֶדִיט בְּאַתַר Claude Console.';
    if (msg.includes('too large') || msg.includes('too long') || msg.includes('exceed') || msg.includes('size'))
      return 'הַקֹּבֶץ גָּדוֹל מִדַּי. נַסִּי קֹבֶץ קָטָן יוֹתֵר, אוֹ פַּחוֹת עַמּוּדִים.';
    if (msg.includes('pdf') || msg.includes('image') || msg.includes('document'))
      return 'Claude לֹא הִצְלִיחַ לִפְתֹּחַ אֶת הַקֹּבֶץ. נַסִּי לְצַלֵּם אוֹתוֹ שׁוּב, אוֹ לִשְׁמֹר אוֹתוֹ מֵחָדָשׁ.';
    return `הַבַּקָּשָׁה נִדְחֲתָה: ${e.message}`;
  }
  if (e instanceof Anthropic.APIError) {
    if (e.status === 529 || (e.status ?? 0) >= 500) return 'הַשֵּׁרוּת שֶׁל Claude עָמוּס כָּרֶגַע. נַסִּי שׁוּב בְּעוֹד כַּמָּה דַּקּוֹת.';
    return `שְׁגִיאָה מִ-Claude (${e.status}): ${e.message}`;
  }
  if (e instanceof SyntaxError) return 'הַתְּשׁוּבָה שֶׁל Claude לֹא הָיְתָה תְּקִינָה. נַסִּי שׁוּב.';
  return `מַשֶּׁהוּ הִשְׁתַּבֵּשׁ: ${e instanceof Error ? e.message : String(e)}`;
}

// ---------- connection test ----------

export async function testConnection(apiKey: string): Promise<void> {
  const res = await client(apiKey).beta.messages.create({
    ...FALLBACK,
    model: MODEL,
    max_tokens: 64,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
  });
  if (!res.content.some((b) => b.type === 'text')) throw new ClaudeError('Claude עָנָה, אֲבָל בְּלִי טֶקְסְט. נַסִּי שׁוּב.');
}

// ---------- shared streaming helper ----------

export type Progress = { phase: 'thinking' | 'writing'; chars: number; found: number };

async function streamJson<T>(
  apiKey: string,
  system: string,
  content: Anthropic.Beta.BetaContentBlockParam[],
  schema: Record<string, unknown>,
  onProgress: (p: Progress) => void,
  countPattern: RegExp,
  signal?: AbortSignal,
): Promise<T> {
  const stream = client(apiKey).beta.messages.stream(
    {
      ...FALLBACK,
      model: MODEL,
      max_tokens: 64000,
      system,
      output_config: { format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content }],
    },
    { signal },
  );
  onProgress({ phase: 'thinking', chars: 0, found: 0 });
  stream.on('text', (_delta, snapshot) => {
    onProgress({ phase: 'writing', chars: snapshot.length, found: (snapshot.match(countPattern) ?? []).length });
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new ClaudeError('Claude סֵרֵב לְעַבֵּד אֶת הַקֹּבֶץ הַזֶּה.');
  if (msg.stop_reason === 'max_tokens') throw new ClaudeError('הַמִּבְחָן אָרֹךְ מִדַּי לְעִבּוּד אֶחָד. נַסִּי לְחַלֵּק אוֹתוֹ לִשְׁנֵי קְבָצִים.');
  const text = msg.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return JSON.parse(text) as T;
}

// ---------- 1. reading the exam ----------

export type RawSub = {
  letter: string;
  type: 'open' | 'choice';
  text: string;
  lang: Lang;
  options: string[];
  reveals_answer: boolean;
  reveal_reason: string;
};
export type RawQuestion = Omit<RawSub, 'letter'> & {
  number: string;
  passage_id: string | null;
  subquestions: RawSub[];
};
export type RawExam = {
  title: string;
  instructions: { text: string; lang: Lang }[];
  passages: { id: string; title: string; text: string; lang: Lang }[];
  questions: RawQuestion[];
};

const LANG = { type: 'string', enum: ['he', 'en'] };
const STR = { type: 'string' };
const SUB_PROPS = {
  type: { type: 'string', enum: ['open', 'choice'] },
  text: STR,
  lang: LANG,
  options: { type: 'array', items: STR },
  reveals_answer: { type: 'boolean' },
  reveal_reason: STR,
};
const EXAM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'instructions', 'passages', 'questions'],
  properties: {
    title: STR,
    instructions: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['text', 'lang'], properties: { text: STR, lang: LANG } },
    },
    passages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'title', 'text', 'lang'],
        properties: { id: STR, title: STR, text: STR, lang: LANG },
      },
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['number', 'passage_id', 'subquestions', ...Object.keys(SUB_PROPS)],
        properties: {
          number: STR,
          passage_id: { anyOf: [STR, { type: 'null' }] },
          ...SUB_PROPS,
          subquestions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['letter', ...Object.keys(SUB_PROPS)],
              properties: { letter: STR, ...SUB_PROPS },
            },
          },
        },
      },
    },
  },
};

const EXTRACT_SYSTEM = `You convert a school exam into structured JSON for an accessibility app. A 15-year-old student with dyslexia uses the app: a text-to-speech voice reads each question to her and she answers orally. Her teacher reviews your output before the student sees it.

THE MOST IMPORTANT RULE: COPY THE WORDING EXACTLY.
Every text field must contain the exam's wording exactly as it appears in the source, character for character: the same words in the same order, the same spelling (keep spelling mistakes), the same punctuation, the same numbers, and the same nikud (vowel marks) wherever the source has them. Never rephrase, summarize, shorten, complete, correct, translate, explain or add words. A changed word can change the meaning of a question in an exam. If a part cannot be read, copy what you can and write [לא ברור] in place of the unreadable part.

How to fill the fields:
- title: the exam title as written. If there is no title, write a short title in the exam's language that describes it (subject and class if shown).
- instructions: general instructions that belong to no single question (time allowed, how many questions to answer, materials allowed). One entry per paragraph.
- passages: reading passages, poems, articles or texts that questions refer to. Give them ids "p1", "p2", ... in order. title: the passage title as written ("" if none). text: the whole passage, with paragraphs separated by "\\n".
- questions: every question, in order.
  - number: the question number as written, e.g. "1" or "4". Sub-question letters go in subquestions, not here. Do not repeat the number at the start of text.
  - text: the question's wording. For a question that has sub-questions, text is the shared part that comes before them ("" if there is none).
  - type: "choice" if the student picks from given options, otherwise "open".
  - options: for "choice", the text of each option without its label (without "א.", "ב.", "a)", "1."). For "open", an empty array.
  - subquestions: sections marked א, ב, ג... (or a, b, c / i, ii). letter: the label without punctuation. text: the wording without the label. Each sub-question has its own type and options.
  - passage_id: the id of the passage the question refers to, or null.
  - lang: "he" or "en", by the language the item is written in.
- Keep point values such as "(10 נקודות)" in the text, as written.
- Leave out lines or boxes for writing answers, page numbers, headers and footers, and logos.
- If a question contains a table, copy its contents as text, row by row. If it contains a picture or diagram, write [איור] where it appears.

Questions where reading aloud or nikud could give away the answer:
Set reveals_answer to true when hearing the text read aloud, or seeing it with nikud, would help answer the question. Typical cases are Hebrew language (לשון) questions: adding nikud (נקדי / ניקוד), identifying a binyan (מה הבניין / באיזה בניין), finding a root (מצאי שורש / מה השורש), identifying a mishkal, tense, person, gender or number from the form of a word, spelling (כתיב), and questions about how a word is pronounced. Also English questions about spelling or pronunciation. reveal_reason: a short explanation in Hebrew, e.g. "שאלת שורש: הקראה עם ניקוד תחשוף את התשובה". Otherwise reveals_answer is false and reveal_reason is "".`;

export type SourceInput =
  | { kind: 'text'; text: string }
  | { kind: 'pdf'; base64: string }
  | { kind: 'images'; images: { base64: string; mediaType: 'image/jpeg' | 'image/png' }[] };

export async function extractExam(
  apiKey: string,
  input: SourceInput,
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<RawExam> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (input.kind === 'text') {
    content.push({
      type: 'text',
      text: `This is the text of the exam, extracted from a Word file:\n<exam>\n${input.text}\n</exam>`,
    });
  } else if (input.kind === 'pdf') {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.base64 } });
  } else {
    input.images.forEach((img, i) => {
      content.push({ type: 'text', text: `Page ${i + 1}:` });
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } });
    });
  }
  content.push({
    type: 'text',
    text: 'Convert this exam to the JSON format. Copy every text exactly as written in the source.',
  });
  return streamJson<RawExam>(apiKey, EXTRACT_SYSTEM, content, EXAM_SCHEMA, onProgress, /"number"\s*:/g, signal);
}

// ---------- 2. adding nikud ----------

const NIKUD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'nikud'],
        properties: { id: STR, nikud: STR },
      },
    },
  },
};

const NIKUD_SYSTEM = `You add Hebrew nikud (vowel points) to the texts of a school exam, for a student with dyslexia who reads vocalized text more easily.

Input: a JSON array of {"id", "text"}. Output: for every id, the same text with full, correct nikud chosen according to the context of the sentence and the whole exam (including dagesh and the shin/sin dot).

Rules:
- Add vowel marks only. Every letter, word, space, punctuation mark, number, line break and non-Hebrew text must stay exactly the same and in the same order. Do not add, remove, replace or reorder anything.
- Do not correct spelling. Vocalize words as they are written.
- Where a word already has nikud, keep its marks exactly as they are.
- Return every id exactly once.`;

export async function addNikud(
  apiKey: string,
  texts: { id: string; text: string }[],
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: 'text', text: JSON.stringify(texts) },
  ];
  const res = await streamJson<{ items: { id: string; nikud: string }[] }>(
    apiKey,
    NIKUD_SYSTEM,
    content,
    NIKUD_SCHEMA,
    onProgress,
    /"id"\s*:/g,
    signal,
  );
  const out: Record<string, string> = {};
  res.items.forEach((x) => (out[x.id] = x.nikud));
  return out;
}
