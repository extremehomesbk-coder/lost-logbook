/**
 * Placeholder art, generated at boot from simple shapes. Every texture key is stable so real sprites can replace
 * them later by loading a PNG under the same key (see docs/TUNING.md, "Art keys").
 *
 *   fish_<fishId>              coloured fish, 128x64, facing right
 *   fish_<fishId>_silhouette   same shape, dark, for the collection log
 *   fishtop_<fishId>           top-down outline, 96x40, facing right (swims around the float)
 *   angler                     the player seen from behind, 56x72
 *   wave, reed, leaf           water highlight tile, bank reeds, drifting leaf
 *   bobber                     red/white float, 24x32
 *   spot_<spotId>              map marker, 72x72
 *   predator_<predatorId>      gull / otter / pike / heron, 96x64
 *   coin, lock, spark, ray     small icons and particle shapes
 */
import Phaser from 'phaser';
import type { GameData } from '../data/schema';
import { cssToHex } from './ui';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function drawFish(g: Phaser.GameObjects.Graphics, id: string, color: number, silhouette: boolean): void {
  const h = hash(id);
  const bodyW = 70 + (h % 30); // 70..99
  const bodyH = 26 + ((h >> 5) % 18); // 26..43
  const tailLen = 16 + ((h >> 10) % 12);
  const cx = 64;
  const cy = 32;
  const body = silhouette ? 0x3a5262 : color;
  const dark = silhouette ? 0x2c4150 : Phaser.Display.Color.ValueToColor(color).darken(25).color;
  const light = silhouette ? 0x3a5262 : Phaser.Display.Color.ValueToColor(color).lighten(25).color;

  // tail
  g.fillStyle(dark, 1);
  g.fillTriangle(cx - bodyW / 2 + 6, cy, cx - bodyW / 2 - tailLen, cy - 16, cx - bodyW / 2 - tailLen, cy + 16);
  // body
  g.fillStyle(body, 1);
  g.fillEllipse(cx, cy, bodyW, bodyH);
  // dorsal fin
  g.fillStyle(dark, 1);
  g.fillTriangle(cx - 10, cy - bodyH / 2 + 2, cx + 14, cy - bodyH / 2 + 2, cx + 2, cy - bodyH / 2 - 10 - ((h >> 15) % 6));
  // belly highlight
  if (!silhouette) {
    g.fillStyle(light, 0.5);
    g.fillEllipse(cx + 4, cy + bodyH / 5, bodyW * 0.55, bodyH * 0.35);
    // eye
    g.fillStyle(0xffffff, 1);
    g.fillCircle(cx + bodyW / 2 - 16, cy - 4, 4.5);
    g.fillStyle(0x111111, 1);
    g.fillCircle(cx + bodyW / 2 - 15, cy - 4, 2.2);
    // stripes for some species
    if (h % 3 === 0) {
      g.fillStyle(dark, 0.45);
      for (let i = -1; i <= 1; i++) g.fillRect(cx + i * 14 - 3, cy - bodyH / 2 + 4, 6, bodyH - 8);
    }
  }
}

export function buildTextures(scene: Phaser.Scene, data: GameData): void {
  const tex = scene.textures;
  const make = (key: string, w: number, h: number, draw: (g: Phaser.GameObjects.Graphics) => void) => {
    if (tex.exists(key)) return;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    draw(g);
    g.generateTexture(key, w, h);
    g.destroy();
  };

  for (const f of data.fish) {
    const color = cssToHex(f.color);
    make(`fish_${f.id}`, 128, 64, (g) => drawFish(g, f.id, color, false));
    make(`fish_${f.id}_silhouette`, 128, 64, (g) => drawFish(g, f.id, color, true));
  }

  // top-down outline used while fish swim around the float: slim body, forked tail, pectoral fins, facing right
  for (const f of data.fish) {
    make(`fishtop_${f.id}`, 96, 40, (g) => {
      const h = hash(f.id);
      const len = 50 + (h % 26);
      const wid = 9 + ((h >> 6) % 6);
      const cx = 50;
      const cy = 20;
      const col = 0xf4e6a8;
      g.fillStyle(col, 0.22);
      g.fillEllipse(cx, cy, len, wid);
      g.lineStyle(2, col, 0.95);
      g.strokeEllipse(cx, cy, len, wid);
      // forked tail
      g.fillStyle(col, 0.9);
      const tx = cx - len / 2;
      g.fillTriangle(tx + 3, cy, tx - 11, cy - 7, tx - 7, cy);
      g.fillTriangle(tx + 3, cy, tx - 11, cy + 7, tx - 7, cy);
      // pectoral fins
      g.fillStyle(col, 0.6);
      g.fillTriangle(cx + 4, cy - wid / 2, cx - 6, cy - wid / 2 - 6, cx - 8, cy - wid / 2 + 1);
      g.fillTriangle(cx + 4, cy + wid / 2, cx - 6, cy + wid / 2 + 6, cx - 8, cy + wid / 2 - 1);
      // spine line + head
      g.lineStyle(1, col, 0.5);
      g.lineBetween(tx + 6, cy, cx + len / 2 - 8, cy);
      g.fillStyle(col, 1);
      g.fillCircle(cx + len / 2 - 6, cy, 1.6);
    });
  }

  // angler seen from behind/above: hat, shoulders, arms, legs. 56x72, feet at the bottom centre.
  make('angler', 56, 72, (g) => {
    g.fillStyle(0x000000, 0.25);
    g.fillEllipse(28, 68, 34, 8); // ground shadow
    g.fillStyle(0x3b4a7a, 1); // trousers
    g.fillRect(17, 44, 9, 22);
    g.fillRect(30, 44, 9, 22);
    g.fillStyle(0x2a2a2a, 1); // boots
    g.fillRect(16, 62, 11, 6);
    g.fillRect(29, 62, 11, 6);
    g.fillStyle(0xc9573f, 1); // jacket
    g.fillRoundedRect(12, 22, 32, 26, 6);
    g.fillStyle(0xa8432f, 1); // jacket shading + arms
    g.fillRect(12, 40, 32, 8);
    g.fillRoundedRect(6, 26, 9, 20, 4);
    g.fillRoundedRect(41, 24, 9, 18, 4);
    g.fillStyle(0xf1c9a0, 1); // hands + neck
    g.fillCircle(10, 47, 4);
    g.fillCircle(46, 42, 4);
    g.fillRect(24, 16, 8, 6);
    g.fillStyle(0x5a3a22, 1); // hair
    g.fillEllipse(28, 12, 20, 16);
    g.fillStyle(0x6e8a4a, 1); // hat
    g.fillEllipse(28, 10, 30, 10);
    g.fillEllipse(28, 6, 18, 12);
    g.fillStyle(0x56703a, 1);
    g.fillEllipse(28, 11, 30, 4);
  });

  // soft crescent highlights, tiled and scrolled for moving water
  make('wave', 128, 128, (g) => {
    const spots: [number, number, number][] = [[20, 30, 26], [78, 18, 18], [104, 70, 22], [46, 88, 30], [10, 110, 16], [90, 112, 20]];
    for (const [x, y, w] of spots) {
      g.lineStyle(2, 0xffffff, 0.16);
      g.beginPath();
      g.arc(x, y, w / 2, Math.PI * 1.1, Math.PI * 1.9, false);
      g.strokePath();
      g.fillStyle(0xffffff, 0.04);
      g.fillEllipse(x, y + 3, w, w / 3);
    }
  });

  make('reed', 10, 44, (g) => {
    g.fillStyle(0x4f7a3a, 1);
    g.fillEllipse(5, 22, 6, 44);
    g.fillStyle(0x6b4a2a, 1);
    g.fillEllipse(5, 8, 5, 12);
  });

  make('leaf', 14, 10, (g) => {
    g.fillStyle(0xb98a3a, 1);
    g.fillEllipse(7, 5, 14, 7);
    g.lineStyle(1, 0x7a5a24, 1);
    g.lineBetween(1, 5, 13, 5);
  });

  make('bobber', 24, 32, (g) => {
    g.fillStyle(0xf3efe4, 1);
    g.fillCircle(12, 18, 11);
    g.fillStyle(0xd9534f, 1);
    g.slice(12, 18, 11, Phaser.Math.DegToRad(180), Phaser.Math.DegToRad(360), false);
    g.fillPath();
    g.fillStyle(0x333333, 1);
    g.fillRect(10, 0, 4, 10);
  });

  for (const s of data.spots) {
    const color = cssToHex(s.color);
    make(`spot_${s.id}`, 72, 72, (g) => {
      g.fillStyle(Phaser.Display.Color.ValueToColor(color).darken(20).color, 1);
      g.fillEllipse(36, 36, 70, 56);
      g.fillStyle(color, 1);
      g.fillEllipse(36, 34, 58, 44);
      g.fillStyle(0xffffff, 0.25);
      g.fillEllipse(28, 28, 22, 10);
    });
  }

  const predators = new Map(data.spots.filter((s) => s.predator).map((s) => [s.predator!.id, s.predator!]));
  for (const [id] of predators) {
    make(`predator_${id}`, 96, 64, (g) => {
      const h = hash(id);
      const color = [0xd8dde3, 0x6b4f3a, 0x4f6b3a, 0x5f6f8a][h % 4];
      g.fillStyle(color, 1);
      if (id.includes('gull') || id.includes('heron')) {
        // bird: body + wings + beak
        g.fillEllipse(48, 36, 40, 22);
        g.fillTriangle(10, 20, 48, 34, 44, 44);
        g.fillTriangle(86, 20, 48, 34, 52, 44);
        g.fillStyle(0xf2b63c, 1);
        g.fillTriangle(68, 34, 82, 38, 68, 42);
      } else {
        // otter / pike: long body + tail
        g.fillEllipse(48, 36, 70, 24);
        g.fillTriangle(14, 36, 0, 24, 0, 48);
        g.fillStyle(0xffffff, 1);
        g.fillCircle(72, 32, 4);
        g.fillStyle(0x111111, 1);
        g.fillCircle(73, 32, 2);
      }
    });
  }

  make('coin', 20, 20, (g) => {
    g.fillStyle(0xf2b63c, 1);
    g.fillCircle(10, 10, 9);
    g.fillStyle(0xffe08a, 1);
    g.fillCircle(10, 10, 5);
  });
  make('lock', 24, 28, (g) => {
    g.lineStyle(4, 0xdddddd, 1);
    g.strokeCircle(12, 9, 6);
    g.fillStyle(0xdddddd, 1);
    g.fillRoundedRect(2, 12, 20, 15, 3);
  });
  make('spark', 12, 12, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillCircle(6, 6, 5);
  });
  make('ray', 400, 24, (g) => {
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(0, 12, 400, 0, 400, 24);
  });
}
