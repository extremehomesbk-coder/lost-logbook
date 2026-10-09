/** Tiny UI kit: layout constants, palette, text, buttons, panels, HUD, scroll list, toasts. */
import Phaser from 'phaser';
import type { Rarity, TimeOfDay } from '../data/schema';
import { timeOfDay } from '../sim/state';
import { S } from './session';

export const W = 390;
export const H = 844;
export const TOP = 56; // below the notch
export const BOTTOM = 36; // above the home bar

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const C = {
  bg: 0x0b1d2a,
  bgCss: '#0b1d2a',
  panel: 0x12303f,
  panelLight: 0x1b4255,
  panelDark: 0x081621,
  accent: 0xf2b63c,
  accentCss: '#f2b63c',
  text: '#f3efe4',
  muted: '#9fb3bf',
  mutedHex: 0x9fb3bf,
  danger: 0xd9534f,
  dangerCss: '#ff6b63',
  good: 0x5cb85c,
  goodCss: '#7ad67a',
  water: 0x1f5f7a,
  waterDeep: 0x123d52,
  line: 0xe8e2d0,
};

export const RARITY_CSS: Record<Rarity, string> = {
  common: '#c9d3d8',
  uncommon: '#6fd38a',
  rare: '#f2b63c',
  legendary: '#ff6ad5',
};
export const RARITY_HEX: Record<Rarity, number> = {
  common: 0xc9d3d8,
  uncommon: 0x6fd38a,
  rare: 0xf2b63c,
  legendary: 0xff6ad5,
};

export const TIME_LABEL: Record<TimeOfDay, string> = { morning: 'Morning', day: 'Midday', dusk: 'Dusk', night: 'Night' };
/** sky top / sky bottom / water tint per period */
export const TIME_SKY: Record<TimeOfDay, [number, number, number]> = {
  morning: [0xf7c9a0, 0x9fd3e6, 0x2a7a94],
  day: [0x6fb7e6, 0xbfe3f5, 0x1f6f8c],
  dusk: [0x3b2a5a, 0xf08a5d, 0x4a3a62],
  night: [0x060b1a, 0x12223f, 0x0e2235],
};

export function hexToCss(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}
export function cssToHex(s: string): number {
  return parseInt(s.replace('#', ''), 16);
}

export interface TextOpts {
  color?: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  origin?: [number, number];
  wrap?: number;
  stroke?: boolean;
}

export function text(scene: Phaser.Scene, x: number, y: number, str: string, size: number, opts: TextOpts = {}): Phaser.GameObjects.Text {
  const t = scene.add.text(x, y, str, {
    fontFamily: FONT,
    fontSize: `${size}px`,
    color: opts.color ?? C.text,
    fontStyle: opts.bold ? 'bold' : 'normal',
    align: opts.align ?? 'center',
    wordWrap: opts.wrap ? { width: opts.wrap, useAdvancedWrap: true } : undefined,
  });
  const [ox, oy] = opts.origin ?? [0.5, 0.5];
  t.setOrigin(ox, oy);
  if (opts.stroke) t.setStroke('#000000', Math.max(2, size / 8));
  return t;
}

export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, fill = C.panel, alpha = 1): Phaser.GameObjects.Rectangle {
  return scene.add.rectangle(x, y, w, h, fill, alpha).setOrigin(0, 0);
}

export interface ButtonOpts {
  fill?: number;
  color?: string;
  size?: number;
  disabled?: boolean;
  /** extra check before firing (e.g. inside a scroll list's viewport) */
  hitFilter?: (p: Phaser.Input.Pointer) => boolean;
}

/** A tap button. Fires on pointerup when the pointer did not drag (so it works inside scroll lists). */
export class Button extends Phaser.GameObjects.Container {
  readonly bg: Phaser.GameObjects.Rectangle;
  readonly label: Phaser.GameObjects.Text;
  private enabledState = true;
  private readonly baseFill: number;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, str: string, onTap: () => void, opts: ButtonOpts = {}) {
    super(scene, x, y);
    this.baseFill = opts.fill ?? C.panelLight;
    this.bg = scene.add.rectangle(0, 0, w, h, this.baseFill).setStrokeStyle(2, 0xffffff, 0.12);
    this.label = text(scene, 0, 0, str, opts.size ?? 18, { color: opts.color ?? C.text, bold: true });
    this.add([this.bg, this.label]);
    this.setSize(w, h);
    this.bg.setInteractive({ useHandCursor: true });
    this.bg.on('pointerdown', () => {
      if (this.enabledState) this.bg.setFillStyle(Phaser.Display.Color.ValueToColor(this.baseFill).brighten(15).color);
    });
    this.bg.on('pointerout', () => this.bg.setFillStyle(this.enabledState ? this.baseFill : C.panelDark));
    this.bg.on('pointerup', (p: Phaser.Input.Pointer) => {
      this.bg.setFillStyle(this.enabledState ? this.baseFill : C.panelDark);
      if (!this.enabledState) return;
      if (p.getDistance() > 12) return;
      if (opts.hitFilter && !opts.hitFilter(p)) return;
      onTap();
    });
    scene.add.existing(this);
    if (opts.disabled) this.setEnabled(false);
  }

  setEnabled(on: boolean): this {
    this.enabledState = on;
    this.bg.setFillStyle(on ? this.baseFill : C.panelDark);
    this.label.setAlpha(on ? 1 : 0.45);
    return this;
  }

  setText(str: string): this {
    this.label.setText(str);
    return this;
  }
}

export function button(scene: Phaser.Scene, x: number, y: number, w: number, h: number, str: string, onTap: () => void, opts: ButtonOpts = {}): Button {
  return new Button(scene, x, y, w, h, str, onTap, opts);
}

/** Top bar: coins, time of day, creel count, rod/line. */
export function hud(scene: Phaser.Scene, title: string): { refresh(): void } {
  panel(scene, 0, 0, W, TOP + 44, C.panelDark, 0.9);
  const titleT = text(scene, W / 2, TOP + 2, title, 18, { bold: true });
  const coinsT = text(scene, 14, TOP + 26, '', 15, { color: C.accentCss, bold: true, origin: [0, 0.5] });
  const timeT = text(scene, W / 2, TOP + 26, '', 15, { color: C.muted, origin: [0.5, 0.5] });
  const creelT = text(scene, W - 14, TOP + 26, '', 15, { color: C.muted, origin: [1, 0.5] });
  const refresh = () => {
    const { data, player } = S();
    titleT.setText(title);
    coinsT.setText(`◉ ${player.coins}`);
    timeT.setText(TIME_LABEL[timeOfDay(data, player)]);
    creelT.setText(`Creel ${player.creel.length}/${data.config.economy.creelSize}`);
  };
  refresh();
  return { refresh };
}

/** Vertical drag-scroll viewport. Add children with `add`; set `contentHeight` when done. */
export class ScrollList {
  readonly container: Phaser.GameObjects.Container;
  contentHeight = 0;
  private dragging = false;
  private lastY = 0;
  private velocity = 0;

  constructor(scene: Phaser.Scene, readonly x: number, readonly y: number, readonly w: number, readonly h: number) {
    this.container = scene.add.container(x, y);
    const shape = scene.make.graphics({});
    shape.fillRect(x, y, w, h);
    this.container.setMask(shape.createGeometryMask());

    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (this.contains(p)) {
        this.dragging = true;
        this.lastY = p.y;
        this.velocity = 0;
      }
    });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.dragging || !p.isDown) return;
      const dy = p.y - this.lastY;
      this.lastY = p.y;
      this.velocity = dy;
      this.scrollBy(dy);
    });
    scene.input.on('pointerup', () => (this.dragging = false));
    scene.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.contains(p)) this.scrollBy(-dy * 0.5);
    });
    scene.events.on('update', () => {
      if (!this.dragging && Math.abs(this.velocity) > 0.5) {
        this.scrollBy(this.velocity);
        this.velocity *= 0.9;
      }
    });
  }

  contains(p: Phaser.Input.Pointer): boolean {
    return p.x >= this.x && p.x <= this.x + this.w && p.y >= this.y && p.y <= this.y + this.h;
  }

  add(child: Phaser.GameObjects.GameObject): void {
    this.container.add(child);
  }

  private scrollBy(dy: number): void {
    const minY = Math.min(this.y, this.y + this.h - this.contentHeight);
    this.container.y = Phaser.Math.Clamp(this.container.y + dy, minY, this.y);
  }

  /** hitFilter for buttons inside the list */
  readonly hit = (p: Phaser.Input.Pointer): boolean => this.contains(p);
}

export function toast(scene: Phaser.Scene, msg: string, color = C.text, y = H - BOTTOM - 110): void {
  const bg = scene.add.rectangle(W / 2, y, Math.min(W - 24, msg.length * 9 + 40), 44, 0x000000, 0.75).setDepth(900);
  const t = text(scene, W / 2, y, msg, 16, { color, bold: true, wrap: W - 48 }).setDepth(901);
  bg.setSize(Math.max(120, t.width + 32), t.height + 20);
  scene.tweens.add({ targets: [bg, t], alpha: 0, delay: 1400, duration: 400, onComplete: () => { bg.destroy(); t.destroy(); } });
}

/** Back button in the top-left corner. */
export function backButton(scene: Phaser.Scene, target = 'Map'): Button {
  return button(scene, 40, TOP - 20, 64, 34, '‹ Back', () => scene.scene.start(target), { size: 15, fill: C.panel });
}

/** Draws a vertical gradient sky into a Graphics object. */
export function sky(scene: Phaser.Scene, time: TimeOfDay, height: number): Phaser.GameObjects.Graphics {
  const [top, bottom] = TIME_SKY[time];
  const g = scene.add.graphics();
  const steps = 24;
  for (let i = 0; i < steps; i++) {
    const c = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.ValueToColor(top),
      Phaser.Display.Color.ValueToColor(bottom),
      steps,
      i,
    );
    g.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
    g.fillRect(0, (height / steps) * i, W, height / steps + 1);
  }
  return g;
}
