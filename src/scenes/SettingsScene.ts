import Phaser from 'phaser';
import { S } from '../game/session';
import { BOTTOM, C, H, TOP, W, backButton, button, hud, panel, text, toast } from '../game/ui';
import { exportCode, importCode } from '../sim/save';

/** Export / import save codes, reset, about. No sound settings: this slice has no audio. */
export class SettingsScene extends Phaser.Scene {
  constructor() {
    super('Settings');
  }

  create(): void {
    const { data, player } = S();
    const prefix = data.config.save.exportPrefix;
    panel(this, 0, 0, W, H, C.bg);
    hud(this, 'Menu');
    backButton(this);

    let y = TOP + 100;
    const row = (label: string, blurb: string, onTap: () => void, fill = C.panelLight, color = C.text) => {
      button(this, W / 2, y, W - 24, 52, label, onTap, { fill, color, size: 18 });
      text(this, W / 2, y + 42, blurb, 12, { color: C.muted, wrap: W - 40 });
      y += 92;
    };

    const codeBox = text(this, W / 2, H - BOTTOM - 150, '', 10, { color: C.muted, wrap: W - 32 }).setVisible(false);

    row('Export save', 'Copies a save code to the clipboard (and shows it below). Paste it somewhere safe.', async () => {
      const code = exportCode(player, prefix);
      const copied = await navigator.clipboard.writeText(code).then(() => true, () => false);
      codeBox.setText(code).setVisible(true);
      toast(this, copied ? 'Save code copied to clipboard' : 'Copy failed: select the code below', copied ? C.goodCss : C.dangerCss);
    });

    row('Import save', 'Paste a save code. It is checked before anything is replaced.', () => {
      const code = window.prompt('Paste your save code:');
      if (code === null) return;
      const r = importCode(code, prefix);
      if (!r.ok) {
        toast(this, `Import failed: ${r.error}`, C.dangerCss);
        return;
      }
      S().replace(r.state);
      toast(this, 'Save imported', C.goodCss);
      this.time.delayedCall(600, () => this.scene.start('Map'));
    });

    let armed = false;
    const resetBtn = button(this, W / 2, y, W - 24, 52, 'Erase save', () => {
      if (!armed) {
        armed = true;
        resetBtn.setText('Tap again to erase everything');
        this.time.delayedCall(3000, () => { armed = false; resetBtn.setText('Erase save'); });
        return;
      }
      S().reset();
      this.scene.start('Title');
    }, { fill: C.danger, size: 18 });
    text(this, W / 2, y + 42, 'Starts over from the first cast. Export first if unsure.', 12, { color: C.muted });
    y += 92;

    const s = player.stats;
    const mins = Math.floor(s.playSeconds / 60);
    const legend = s.legendaryAtSeconds !== null ? ` · legend at ${Math.floor(s.legendaryAtSeconds / 60)} min` : '';
    text(this, W / 2, y, `Played ${mins} min · ${s.casts} casts · ${s.catches} landed · ${s.lost} lost${legend}`, 13, { color: C.muted, wrap: W - 40 });
    y += 40;
    text(this, W / 2, y, `${data.config.title} v0.1 · save format v${data.config.save.version}\nPlaceholder shapes, no sound, no network. Autosaves after every catch and purchase.`, 12, { color: C.muted, wrap: W - 40 });
  }
}
