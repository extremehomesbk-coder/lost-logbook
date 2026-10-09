/** Versioned save: localStorage autosave plus export/import codes. Every storage call is wrapped in try/catch. */
import type { GameData } from '../data/schema';
import { PlayerStateSchema, newPlayer, type PlayerState } from './state';

export const CURRENT_SAVE_VERSION = 1;

/** Upgrade older save shapes in place. Add a case per version bump; never throw on unknown fields. */
export function migrate(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  const v = typeof obj.v === 'number' ? obj.v : 0;
  // v0 -> v1: (no public v0 builds; placeholder for the pattern)
  if (v < 1) obj.v = 1;
  return obj;
}

export function validateSave(raw: unknown): { ok: true; state: PlayerState } | { ok: false; error: string } {
  const migrated = migrate(raw);
  const r = PlayerStateSchema.safeParse(migrated);
  if (!r.success) {
    const first = r.error.issues[0];
    return { ok: false, error: `${first.path.join('.') || 'save'}: ${first.message}` };
  }
  if (r.data.v > CURRENT_SAVE_VERSION) return { ok: false, error: `Save is from a newer build (v${r.data.v}).` };
  return { ok: true, state: r.data };
}

// ---------- localStorage ----------

export function saveToStorage(key: string, state: PlayerState): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function loadFromStorage(key: string, data: GameData): PlayerState {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return newPlayer(data);
    const parsed = validateSave(JSON.parse(raw));
    return parsed.ok ? parsed.state : newPlayer(data);
  } catch {
    return newPlayer(data);
  }
}

export function clearStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ---------- export / import codes ----------

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** `<prefix><base64url json>.<fnv1a>` */
export function exportCode(state: PlayerState, prefix: string): string {
  const json = JSON.stringify(state);
  return `${prefix}${toBase64Url(json)}.${fnv1a(json)}`;
}

export function importCode(code: string, prefix: string): { ok: true; state: PlayerState } | { ok: false; error: string } {
  const trimmed = code.trim();
  if (!trimmed.startsWith(prefix)) return { ok: false, error: `Code must start with ${prefix}` };
  const body = trimmed.slice(prefix.length);
  const dot = body.lastIndexOf('.');
  if (dot < 0) return { ok: false, error: 'Code is missing its checksum.' };
  let json: string;
  try {
    json = fromBase64Url(body.slice(0, dot));
  } catch {
    return { ok: false, error: 'Code is not valid base64.' };
  }
  if (fnv1a(json) !== body.slice(dot + 1)) return { ok: false, error: 'Checksum does not match. Was the code copied completely?' };
  try {
    return validateSave(JSON.parse(json));
  } catch {
    return { ok: false, error: 'Code does not contain valid JSON.' };
  }
}
