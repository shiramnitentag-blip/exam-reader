// The built-in sample exam (always in the list, cannot be deleted). Text is fully vocalized.
import type { Exam } from './model';

const stem = { text: 'שְׁאֵלָה 1. עִנִי עַל פִּי הַקֶּטַע "הַדְּבוֹרִים וְהַפְּרָחִים".' };

export const SAMPLE_ID = 'sample';

export const sampleExam: Exam = {
  id: SAMPLE_ID,
  title: 'מִבְחָן לְדֻגְמָה',
  createdAt: 0,
  approved: true,
  builtin: true,
  instructions: [
    {
      id: 'intro',
      lang: 'he',
      text: {
        text:
          'בַּמִּבְחָן הַזֶּה יֵשׁ שְׁתֵּי שְׁאֵלוֹת. קִרְאִי אֶת הַקֶּטַע, וַעֲנִי עַל הַשְּׁאֵלוֹת. ' +
          'אֶפְשָׁר לַעֲנוֹת בְּהַקְלָטָה, אוֹ לִכְתֹּב בְּקוֹל. בְּהַצְלָחָה!',
      },
    },
  ],
  passages: [
    {
      id: 'p1',
      lang: 'he',
      title: { text: 'הַדְּבוֹרִים וְהַפְּרָחִים' },
      body: {
        text:
          'הַדְּבוֹרִים עוֹבְדוֹת קָשֶׁה כָּל הַיּוֹם. הֵן עָפוֹת מִפֶּרַח לְפֶרַח, וְאוֹסְפוֹת צוּף. ' +
          'מֵהַצּוּף הֵן מְכִינוֹת דְּבַשׁ. כְּשֶׁהַדְּבוֹרָה עוֹמֶדֶת עַל פֶּרַח, אַבְקָה נִדְבֶּקֶת לְרַגְלֶיהָ. ' +
          'כָּךְ הִיא מַעֲבִירָה אַבְקָה מִפֶּרַח אֶחָד לְפֶרַח אַחֵר. בִּזְכוּת זֶה גְּדֵלִים פֵּרוֹת חֲדָשִׁים.\n' +
          'בַּשָּׁנִים הָאַחֲרוֹנוֹת יֵשׁ פָּחוֹת דְּבוֹרִים בָּעוֹלָם. ' +
          'מַדְעָנִים מְנַסִּים לְהָבִין לָמָּה זֶה קוֹרֶה, וְאֵיךְ אֶפְשָׁר לַעֲזֹר.',
      },
    },
  ],
  items: [
    {
      id: '1a',
      label: '1א',
      kind: 'open',
      stem,
      text: { text: 'סָעִיף א. מָה הַדְּבוֹרִים אוֹסְפוֹת מֵהַפְּרָחִים? מָה הֵן מְכִינוֹת מִזֶּה?' },
      options: [],
      lang: 'he',
      passageId: 'p1',
      reveals: false,
      useNikud: false,
      readMode: 'normal',
    },
    {
      id: '1b',
      label: '1ב',
      kind: 'open',
      stem,
      text: { text: 'סָעִיף ב. לָמָּה הַדְּבוֹרִים חֲשׁוּבוֹת לָנוּ? הַסְבִּירִי בְּעֶזְרַת הַקֶּטַע.' },
      options: [],
      lang: 'he',
      passageId: 'p1',
      reveals: false,
      useNikud: false,
      readMode: 'normal',
    },
    {
      id: '2',
      label: '2',
      kind: 'choice',
      text: { text: 'שְׁאֵלָה 2. לְפִי הַקֶּטַע, מָה קוֹרֶה בַּשָּׁנִים הָאַחֲרוֹנוֹת? בַּחֲרִי תְּשׁוּבָה אַחַת.' },
      options: [
        { text: 'יֵשׁ יוֹתֵר דְּבוֹרִים בָּעוֹלָם.' },
        { text: 'יֵשׁ פָּחוֹת דְּבוֹרִים בָּעוֹלָם.' },
        { text: 'הַדְּבוֹרִים מְכִינוֹת יוֹתֵר דְּבַשׁ.' },
        { text: 'הַפְּרָחִים גְּדֵלִים בְּלִי אַבְקָה.' },
      ],
      lang: 'he',
      passageId: 'p1',
      reveals: false,
      useNikud: false,
      readMode: 'normal',
    },
  ],
};
