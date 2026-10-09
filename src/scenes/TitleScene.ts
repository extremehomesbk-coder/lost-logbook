import Phaser from 'phaser';
import { S } from '../game/session';
import { BOTTOM, C, H, W, button, sky, text } from '../game/ui';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  create(): void {
    const { data, player, hadSave } = S();
    sky(this, 'dusk', H);
    this.add.rectangle(0, H * 0.62, W, H * 0.38, C.waterDeep).setOrigin(0, 0);
    // a few placeholder ripples
    for (let i = 0; i < 6; i++) {
      const r = this.add.ellipse(60 + i * 55, H * 0.66 + (i % 3) * 40, 70, 10, 0xffffff, 0.08);
      this.tweens.add({ targets: r, scaleX: 1.4, alpha: 0, duration: 2600 + i * 300, repeat: -1, delay: i * 400 });
    }
    const bobber = this.add.image(W * 0.5, H * 0.6, 'bobber').setScale(2);
    this.tweens.add({ targets: bobber, y: H * 0.6 + 6, duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    text(this, W / 2, 150, data.config.title, 46, { bold: true, stroke: true });
    text(this, W / 2, 196, 'a fishing adventure (prototype)', 16, { color: '#f8e6d8' });
    text(this, W / 2, 290, data.config.premise, 18, { wrap: W - 60, color: '#fff6ee', stroke: true });

    const hasProgress = hadSave && (player.stats.casts > 0 || player.coins !== data.config.start.coins);
    if (hasProgress) {
      button(this, W / 2, H - BOTTOM - 150, 240, 56, 'Continue', () => this.scene.start('Map'), { fill: C.accent, color: '#1a1200', size: 22 });
      let armed = false;
      const nb = button(this, W / 2, H - BOTTOM - 84, 240, 44, 'New game', () => {
        if (!armed) {
          armed = true;
          nb.setText('Tap again to erase save');
          this.time.delayedCall(2500, () => { armed = false; nb.setText('New game'); });
          return;
        }
        S().reset();
        this.scene.start('Map');
      }, { size: 16 });
    } else {
      button(this, W / 2, H - BOTTOM - 120, 240, 56, 'Start fishing', () => this.scene.start('Map'), { fill: C.accent, color: '#1a1200', size: 22 });
    }
    text(this, W / 2, H - BOTTOM - 20, 'v0.1 · placeholder art · no sound', 12, { color: '#d8cfc4' });
    this.input.keyboard?.once('keydown-SPACE', () => this.scene.start('Map'));
  }
}
