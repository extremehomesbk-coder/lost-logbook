import Phaser from 'phaser';
import { S } from '../game/session';
import { BOTTOM, C, H, TIME_LABEL, TOP, W, button, cssToHex, hud, panel, text, toast } from '../game/ui';
import { itemName, lineOf, rodOf, spotLocked, timeOfDay, travel, waitPeriod } from '../sim/state';

/** Top-down region map: tap a spot to travel and fish there. */
export class MapScene extends Phaser.Scene {
  constructor() {
    super('Map');
  }

  create(): void {
    const { data, player } = S();
    panel(this, 0, 0, W, H, C.bg);
    const top = TOP + 56;
    const mapH = H - top - BOTTOM - 120;
    // land
    panel(this, 12, top, W - 24, mapH, 0x2f4a3a);
    const g = this.add.graphics();
    g.fillStyle(0x3b5c45, 1);
    for (let i = 0; i < 14; i++) g.fillEllipse(30 + ((i * 97) % (W - 60)), top + 30 + ((i * 61) % (mapH - 60)), 60 + (i % 4) * 20, 24 + (i % 3) * 8);
    // path between spots
    g.lineStyle(4, 0x8a7a5a, 0.6);
    const pts = data.spots.map((s) => new Phaser.Math.Vector2(12 + s.x * (W - 24), top + s.y * mapH));
    for (let i = 1; i < pts.length; i++) g.lineBetween(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);

    const h = hud(this, data.config.title);

    data.spots.forEach((spot, i) => {
      const p = pts[i];
      const locked = spotLocked(data, player, spot);
      const img = this.add.image(p.x, p.y, `spot_${spot.id}`).setTint(locked ? 0x555555 : 0xffffff);
      if (player.spot === spot.id) {
        const ring = this.add.circle(p.x, p.y, 44).setStrokeStyle(3, C.accent, 1);
        this.tweens.add({ targets: ring, scale: 1.12, alpha: 0.4, duration: 900, yoyo: true, repeat: -1 });
      }
      text(this, p.x, p.y + 44, spot.name, 14, { bold: true, stroke: true, color: locked ? C.muted : C.text });
      if (locked) {
        this.add.image(p.x, p.y - 4, 'lock').setScale(0.9);
        text(this, p.x, p.y + 62, locked, 11, { color: '#ffd27f', stroke: true, wrap: 140 });
      }
      img.setInteractive({ useHandCursor: true });
      img.on('pointerup', (ptr: Phaser.Input.Pointer) => {
        if (ptr.getDistance() > 12) return;
        if (locked) {
          toast(this, `${spot.name}: ${locked}`, '#ffd27f');
          return;
        }
        const before = timeOfDay(data, player);
        travel(data, player, spot.id);
        S().save();
        if (timeOfDay(data, player) !== before) toast(this, `Walked to ${spot.name}. It is now ${TIME_LABEL[timeOfDay(data, player)].toLowerCase()}.`);
        this.scene.start('Fishing');
      });
      img.on('pointerover', () => img.setTint(locked ? 0x777777 : cssToHex(spot.color)));
      img.on('pointerout', () => img.setTint(locked ? 0x555555 : 0xffffff));
    });

    const spotNow = data.spots.find((s) => s.id === player.spot)!;
    text(this, W / 2, top + mapH + 18, `${spotNow.name}: ${spotNow.blurb}`, 13, { color: C.muted, wrap: W - 40 });
    text(this, 12, TOP + 48, `${rodOf(data, player).name} · ${lineOf(data, player).name} · ${itemName(data, player.equipped)} on the hook`, 12, { color: C.muted, origin: [0, 0.5] });

    // bottom bar
    const by = H - BOTTOM - 36;
    const bw = (W - 24 - 4 * 8) / 5;
    const labels: [string, () => void][] = [
      ['Fish', () => this.scene.start('Fishing')],
      ['Shop', () => this.scene.start('Shop')],
      ['Log', () => this.scene.start('Log')],
      ['Board', () => this.scene.start('Board')],
      ['Menu', () => this.scene.start('Settings')],
    ];
    labels.forEach(([label, fn], i) => button(this, 12 + bw / 2 + i * (bw + 8), by, bw, 52, label, fn, { size: 15, fill: i === 0 ? C.accent : C.panelLight, color: i === 0 ? '#1a1200' : C.text }));
    const ready = data.quests.some((q) => player.quests[q.id] === 'open' && (player.counters[q.id] ?? 0) >= q.condition.count);
    if (ready) this.add.circle(12 + bw / 2 + 3 * (bw + 8) + bw / 2 - 6, by - 20, 7, C.danger);

    button(this, W - 12 - 90, top + mapH - 28, 168, 36, `Wait → ${TIME_LABEL[data.config.time.order[(player.timeIndex + 1) % 4]].toLowerCase()}`, () => {
      waitPeriod(data, player);
      S().save();
      h.refresh();
      this.scene.restart();
    }, { size: 14, fill: C.panel });
  }
}
