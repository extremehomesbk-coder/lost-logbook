import Phaser from 'phaser';
import { DataError, loadGameData } from '../data/load';
import { initSession } from '../game/session';
import { buildTextures } from '../game/textures';

/** Validates the data files, builds placeholder textures, restores the save, then hands off to the title. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    try {
      const data = loadGameData();
      buildTextures(this, data);
      initSession(data);
      this.scene.start('Title');
    } catch (e) {
      const file = e instanceof DataError ? e.file : 'startup';
      const message = e instanceof Error ? e.message : String(e);
      this.scene.start('Error', { file, message });
    }
  }
}
