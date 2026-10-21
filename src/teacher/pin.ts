// The teacher's 4-digit PIN. Only a salted hash is stored on the device, never the digits.
import { db } from '../db';

type StoredPin = { salt: string; hash: string };

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashPin(salt: string, pin: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

export async function hasPin(): Promise<boolean> {
  return !!(await db.getMeta<StoredPin>('pin'));
}

export async function setPin(pin: string): Promise<void> {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer);
  await db.setMeta('pin', { salt, hash: await hashPin(salt, pin) });
}

export async function checkPin(pin: string): Promise<boolean> {
  const stored = await db.getMeta<StoredPin>('pin');
  if (!stored) return false;
  return (await hashPin(stored.salt, pin)) === stored.hash;
}
