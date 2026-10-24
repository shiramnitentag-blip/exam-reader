declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;

/** e.g. "1.0.0 (2026-10-24 · 31cb9b1)": shown in the settings, to know which version is installed. */
export const APP_VERSION = `${__APP_VERSION__} (${__APP_BUILD__})`;
