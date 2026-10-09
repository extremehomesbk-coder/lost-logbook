/**
 * Placeholder art, generated at boot from simple shapes. Every texture key is stable so real sprites can replace
 * them later by loading a PNG under the same key (see docs/TUNING.md, "Art keys").
 *
 *   fish_<fishId>              coloured fish, 128x64, facing right
 *   fish_<fishId>_silhouette   same shape, dark, for the collection log
 *   fishtop_<fishId>           top-down outline, 96x40, facing right (swims around the float)
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

  // top-down outline used while fish swim around the float (the "yellow outline" look)
  for (const f of data.fish) {
    make(`fishtop_${f.id}`, 96, 40, (g) => {
      const h = hash(f.id);
      const len = 56 + (h % 30);
      const wid = 14 + ((h >> 6) % 10);
      g.lineStyle(3, 0xffe27a, 1);
      g.strokeEllipse(48, 20, len, wid);
      g.fillStyle(0xffe27a, 0.25);
      g.fillEllipse(48, 20, len, wid);
      g.fillStyle(0xffe27a, 1);
      g.fillTriangle(48 - len / 2 + 4, 20, 48 - len / 2 - 14, 10, 48 - len / 2 - 14, 30);
      g.fillCircle(48 + len / 2 - 10, 20, 2.5);
    });
  }

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
