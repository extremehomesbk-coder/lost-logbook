/** One place that owns the loaded data and the live player state; scenes read and mutate through it. */
import type { GameData } from '../data/schema';
import { clearStorage, loadFromStorage, saveToStorage } from '../sim/save';
import { newPlayer, type PlayerState } from '../sim/state';

export interface Session {
  data: GameData;
  player: PlayerState;
  /** true when a save existed in storage when the game booted */
  hadSave: boolean;
  save(): boolean;
  reset(): void;
  replace(p: PlayerState): void;
}

let current: Session | null = null;

export function initSession(data: GameData): Session {
  const key = data.config.save.key;
  const hadSave = (() => {
    try {
      return window.localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  })();
  const session: Session = {
    data,
    player: loadFromStorage(key, data),
    hadSave,
    save() {
      return saveToStorage(key, session.player);
    },
    reset() {
      clearStorage(key);
      session.player = newPlayer(data);
      session.hadSave = false;
    },
    replace(p: PlayerState) {
      session.player = p;
      session.save();
    },
  };
  current = session;
  return session;
}

export function S(): Session {
  if (!current) throw new Error('Session not initialised (BootScene must run first)');
  return current;
}
