import Phaser from 'phaser';
import { S } from '../game/session';
import { BOTTOM, C, H, RARITY_CSS, ScrollList, TIME_LABEL, TOP, W, backButton, hud, panel, text } from '../game/ui';
import { itemName } from '../sim/state';

/** Collection log: silhouettes until caught, plus the logbook's own hints on where each fish lives. */
export class LogScene extends Phaser.Scene {
  constructor() {
    super('Log');
  }

  create(): void {
    const { data, player } = S();
    panel(this, 0, 0, W, H, C.bg);
    hud(this, 'Logbook');
    backButton(this);
    const caught = Object.keys(player.log).length;
    text(this, W / 2, TOP + 66, `${caught} / ${data.fish.length} species logged`, 15, { color: C.muted });

    const listTop = TOP + 86;
    const list = new ScrollList(this, 0, listTop, W, H - listTop - BOTTOM);
    const cardW = (W - 36) / 2;
    const cardH = 150;
    data.fish.forEach((f, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 12 + col * (cardW + 12);
      const y = row * (cardH + 10);
      const entry = player.log[f.id];
      const known = !!entry;
      list.add(this.add.rectangle(x, y, cardW, cardH, C.panel).setOrigin(0, 0).setStrokeStyle(2, known ? Phaser.Display.Color.HexStringToColor(RARITY_CSS[f.rarity]).color : 0x000000, known ? 0.8 : 0));
      const img = this.add.image(x + cardW / 2, y + 44, known ? `fish_${f.id}` : `fish_${f.id}_silhouette`).setScale(0.75);
      if (!known) img.setAlpha(0.7);
      list.add(img);
      list.add(text(this, x + cardW / 2, y + 88, known ? f.name : '???', 14, { bold: true }));
      list.add(text(this, x + cardW / 2, y + 106, f.rarity.toUpperCase(), 10, { color: RARITY_CSS[f.rarity], bold: true }));
      const spots = f.spots.map((s) => data.spots.find((sp) => sp.id === s)?.name ?? s).join(', ');
      const times = f.times.length === 4 ? 'any time' : f.times.map((t) => TIME_LABEL[t]).join('/');
      const hint = known
        ? `×${entry.count} · best ${entry.best} cm`
        : `${spots} · ${times}\n${f.requires ? `needs ${itemName(data, f.requires)}` : f.zones.join('/')}`;
      list.add(text(this, x + cardW / 2, y + 128, hint, 11, { color: C.muted, wrap: cardW - 12 }));
    });
    list.contentHeight = Math.ceil(data.fish.length / 2) * (cardH + 10) + 10;
  }
}
