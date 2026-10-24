// Device checks for the teacher: free space, microphone, protected storage.

/** Below this much free space the teacher is warned (recordings take about 1 MB a minute). */
export const LOW_SPACE_MB = 300;

/** How much more this app may store on the device, in MB (null if the browser doesn't say). */
export async function freeSpaceMB(): Promise<{ freeMB: number; usedMB: number } | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est || typeof est.quota !== 'number') return null;
    const used = est.usage ?? 0;
    return { freeMB: Math.floor((est.quota - used) / 1e6), usedMB: Math.round(used / 1e6) };
  } catch {
    return null;
  }
}

/** Asks for the microphone (the iPad shows its question if needed) and lets it go at once. */
export async function checkMicrophone(): Promise<{ ok: boolean; detail: string }> {
  if (!navigator.mediaDevices?.getUserMedia || !('MediaRecorder' in window))
    return { ok: false, detail: 'הַהַקְלָטָה לֹא נִתְמֶכֶת בַּדַּפְדְּפָן הַזֶּה' };
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return { ok: true, detail: 'מְאֻשָּׁר' };
  } catch (e) {
    const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    return {
      ok: false,
      detail: denied
        ? 'לֹא אֻשַּׁר. בַּהַגְדָּרוֹת שֶׁל הָאַיְפֶּד: Safari ← מִיקְרוֹפוֹן ← "לְאַפְשֵׁר"'
        : 'לֹא נִמְצָא מִיקְרוֹפוֹן',
    };
  }
}

/** Asks the browser to keep the app's data even when the device is short of space. */
export async function protectStorage(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persisted) return null;
    if (await navigator.storage.persisted()) return true;
    return (await navigator.storage.persist?.()) ?? false;
  } catch {
    return null;
  }
}
