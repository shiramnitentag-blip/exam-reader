// Fixed sentences the student hears. Kept in one place so voice files can be made for them in advance.
export const PHRASES = {
  allAnswered: 'עָנִית עַל כָּל הַשְּׁאֵלוֹת.',
  notAnswered: 'לֹא עָנִית עַל:',
  flagged: 'סִמַּנְתְּ לַחְזֹר אֶל:',
  submitted: 'הַמִּבְחָן הוּגַשׁ.',
  submittedOk: 'הַמִּבְחָן הוּגַשׁ בְּהַצְלָחָה!',
  startHint: 'כְּדֵי לְהַתְחִיל, לְחָצִי עַל "לְהַתְחִיל מִבְחָן".',
  continueHint: 'כְּדֵי לְהַמְשִׁיךְ מֵהַמָּקוֹם שֶׁעָצַרְתְּ, לְחָצִי עַל "לְהַמְשִׁיךְ מִבְחָן".',
  noExam: 'אֵין מִבְחָן פָּעִיל כָּרֶגַע.',
  callTeacher: 'קִרְאִי לַמּוֹרָה.',
  wellDone: 'כָּל הַכָּבוֹד!',
  confirmSubmit: 'לְהַגִּישׁ אֶת הַמִּבְחָן? אַחֲרֵי הַהַגָּשָׁה אִי אֶפְשָׁר לְשַׁנּוֹת.',
};

export const questionPhrase = (label: string) => `שְׁאֵלָה ${label}.`;
