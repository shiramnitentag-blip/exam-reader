// Sample exam, hard-coded for stage 1. Text is fully vocalized (with nikud).

export type Sentence = { id: string; text: string };

export type OpenItem = {
  kind: 'open';
  id: string;
  label: string; // shown in the bottom bar, e.g. "1א"
  title: string; // shown in the header
  stem: Sentence[]; // shared text of the parent question
  prompt: Sentence[]; // the sub-question itself
  hasPassage: boolean;
};

export type ChoiceItem = {
  kind: 'choice';
  id: string;
  label: string;
  title: string;
  stem: Sentence[];
  options: Sentence[];
  hasPassage: boolean;
};

export type ExamItem = OpenItem | ChoiceItem;

const s = (prefix: string, texts: string[]): Sentence[] =>
  texts.map((text, i) => ({ id: `${prefix}-${i}`, text }));

export const exam = {
  title: 'מִבְחָן לְדֻגְמָה',
  instructions: s('intro', [
    'בַּמִּבְחָן הַזֶּה יֵשׁ שְׁתֵּי שְׁאֵלוֹת.',
    'קִרְאִי אֶת הַקֶּטַע, וַעֲנִי עַל הַשְּׁאֵלוֹת.',
    'אֶפְשָׁר לַעֲנוֹת בְּהַקְלָטָה, אוֹ לִכְתֹּב בְּקוֹל.',
    'בְּהַצְלָחָה!',
  ]),
  passage: {
    title: { id: 'passage-title', text: 'הַדְּבוֹרִים וְהַפְּרָחִים' } as Sentence,
    paragraphs: [
      s('p1', [
        'הַדְּבוֹרִים עוֹבְדוֹת קָשֶׁה כָּל הַיּוֹם.',
        'הֵן עָפוֹת מִפֶּרַח לְפֶרַח, וְאוֹסְפוֹת צוּף.',
        'מֵהַצּוּף הֵן מְכִינוֹת דְּבַשׁ.',
        'כְּשֶׁהַדְּבוֹרָה עוֹמֶדֶת עַל פֶּרַח, אַבְקָה נִדְבֶּקֶת לְרַגְלֶיהָ.',
        'כָּךְ הִיא מַעֲבִירָה אַבְקָה מִפֶּרַח אֶחָד לְפֶרַח אַחֵר.',
        'בִּזְכוּת זֶה גְּדֵלִים פֵּרוֹת חֲדָשִׁים.',
      ]),
      s('p2', [
        'בַּשָּׁנִים הָאַחֲרוֹנוֹת יֵשׁ פָּחוֹת דְּבוֹרִים בָּעוֹלָם.',
        'מַדְעָנִים מְנַסִּים לְהָבִין לָמָּה זֶה קוֹרֶה, וְאֵיךְ אֶפְשָׁר לַעֲזֹר.',
      ]),
    ],
  },
  items: [
    {
      kind: 'open',
      id: '1a',
      label: '1א',
      title: 'שְׁאֵלָה 1, סָעִיף א',
      stem: s('q1-stem', ['שְׁאֵלָה 1.', 'עִנִי עַל פִּי הַקֶּטַע "הַדְּבוֹרִים וְהַפְּרָחִים".']),
      prompt: s('q1a', ['סָעִיף א.', 'מָה הַדְּבוֹרִים אוֹסְפוֹת מֵהַפְּרָחִים?', 'מָה הֵן מְכִינוֹת מִזֶּה?']),
      hasPassage: true,
    },
    {
      kind: 'open',
      id: '1b',
      label: '1ב',
      title: 'שְׁאֵלָה 1, סָעִיף ב',
      stem: s('q1-stem', ['שְׁאֵלָה 1.', 'עִנִי עַל פִּי הַקֶּטַע "הַדְּבוֹרִים וְהַפְּרָחִים".']),
      prompt: s('q1b', ['סָעִיף ב.', 'לָמָּה הַדְּבוֹרִים חֲשׁוּבוֹת לָנוּ?', 'הַסְבִּירִי בְּעֶזְרַת הַקֶּטַע.']),
      hasPassage: true,
    },
    {
      kind: 'choice',
      id: '2',
      label: '2',
      title: 'שְׁאֵלָה 2',
      stem: s('q2', ['שְׁאֵלָה 2.', 'לְפִי הַקֶּטַע, מָה קוֹרֶה בַּשָּׁנִים הָאַחֲרוֹנוֹת?', 'בַּחֲרִי תְּשׁוּבָה אַחַת.']),
      options: s('q2-opt', [
        'יֵשׁ יוֹתֵר דְּבוֹרִים בָּעוֹלָם.',
        'יֵשׁ פָּחוֹת דְּבוֹרִים בָּעוֹלָם.',
        'הַדְּבוֹרִים מְכִינוֹת יוֹתֵר דְּבַשׁ.',
        'הַפְּרָחִים גְּדֵלִים בְּלִי אַבְקָה.',
      ]),
      hasPassage: true,
    },
  ] as ExamItem[],
};

export const OPTION_LETTERS = ['א', 'ב', 'ג', 'ד'];
