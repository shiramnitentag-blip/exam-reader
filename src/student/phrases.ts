// Fixed sentences the student hears. Kept in one place so voice files can be made for them in advance.
export const PHRASES = {
  allAnswered: 'עָנִית עַל כָּל הַשְּׁאֵלוֹת.',
  notAnswered: 'לֹא עָנִית עַל:',
  flagged: 'סִמַּנְתְּ לַחְזֹר אֶל:',
  submitted: 'הַמִּבְחָן הוּגַשׁ.',
  wellDone: 'כָּל הַכָּבוֹד!',
  confirmSubmit: 'לְהַגִּישׁ אֶת הַמִּבְחָן? אַחֲרֵי הַהַגָּשָׁה אִי אֶפְשָׁר לְשַׁנּוֹת.',
};

export const questionPhrase = (label: string) => `שְׁאֵלָה ${label}.`;
