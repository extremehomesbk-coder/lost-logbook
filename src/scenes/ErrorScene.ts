import Phaser from 'phaser';
import { C, H, W, panel, text } from '../game/ui';

/** Shown when a data file fails schema validation. Names the file and the first problems. */
export class ErrorScene extends Phaser.Scene {
  constructor() {
    super('Error');
  }

  create(data: { file?: string; message?: string }): void {
    panel(this, 0, 0, W, H, C.panelDark);
    panel(this, 16, 120, W - 32, 8, C.danger);
    text(this, W / 2, 170, 'Data file invalid', 30, { bold: true, color: C.dangerCss });
    text(this, W / 2, 215, data.file ?? 'unknown file', 20, { bold: true });
    text(this, W / 2, 260, 'The game cannot start until this is fixed:', 15, { color: C.muted, wrap: W - 48 });
    text(this, W / 2, 300, data.message ?? 'Unknown error', 15, { color: C.text, wrap: W - 48, origin: [0.5, 0], align: 'left' });
    text(this, W / 2, H - 80, 'Fix the file in src/data/ and reload.', 14, { color: C.muted });
  }
}
