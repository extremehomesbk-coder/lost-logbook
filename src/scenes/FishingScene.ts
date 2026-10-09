import Phaser from 'phaser';
import type { Fish, Spot, Zone } from '../data/schema';
import { School, type Bait } from '../game/school';
import { S } from '../game/session';
import { BOTTOM, C, H, RARITY_CSS, RARITY_HEX, TIME_SKY, TOP, W, button, hud, panel, sky, text, toast, type Button } from '../game/ui';
import { candidates, hookResult, lineOutForPower, planBite, zoneForPower } from '../sim/bite';
import { rollSizeCm } from '../sim/economy';
import { createFight, stepFight, type FightParams, type FightState } from '../sim/fight';
import { predatorTap, rollPredator, startPredator, stepPredator, type PredatorState } from '../sim/predator';
import { randomRng } from '../sim/rng';
import { beginCast, equip, equippable, isLure, itemName, lineCapOf, recordCatch, recordLoss, rodOf, spotOf, timeOfDay, type CatchResult } from '../sim/state';

type Phase = 'idle' | 'charging' | 'flying' | 'waiting' | 'fight' | 'predator' | 'result' | 'reveal';

const WATER_TOP = TOP + 54;
const WATER_BOTTOM = H - BOTTOM - 168;
const BANK_H = 46;
const ANGLER = { x: W / 2, y: WATER_BOTTOM + 22 };

/**
 * The core loop, modelled on the classic handheld fishing adventures: a top-down bank where you aim and hold to
 * cast, visible fish that notice the bait, circle the float and bite, then a cut to an underwater side view for
 * the fight (let it run, reel when it rests). Input: pointer on the water, or SPACE / arrow keys on desktop.
 */
export class FishingScene extends Phaser.Scene {
  private phase: Phase = 'idle';
  private spot!: Spot;
  private hudRef!: { refresh(): void };
  private hint!: Phaser.GameObjects.Text;
  private bobber!: Phaser.GameObjects.Image;
  private castLine!: Phaser.GameObjects.Graphics;
  private aimLine!: Phaser.GameObjects.Graphics;
  private powerBar!: Phaser.GameObjects.Rectangle;
  private powerFill!: Phaser.GameObjects.Rectangle;
  private baitBtn!: Button;
  private reelInBtn!: Button;
  private school: School | null = null;
  private rodG!: Phaser.GameObjects.Graphics;
  private rodSwing = 0; // -1 back, 0 rest, 1 forward
  private rodBend = 0; // 0..1 from tension
  private waves: Phaser.GameObjects.TileSprite[] = [];
  private reelBtn!: Phaser.GameObjects.Container;
  private reelCrank!: Phaser.GameObjects.Graphics;
  private crankAngle = 0;
  private vignette!: Phaser.GameObjects.Graphics;
  private holding = false;
  private pointerX = W / 2;
  private spaceKey?: Phaser.Input.Keyboard.Key;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;

  // cast
  private power = 0;
  private charge = 0;
  private aimX = W / 2;
  private landing = new Phaser.Math.Vector2();
  private lureMoving = false;
  private usingLure = false;

  // bite
  private waitT = 0;
  private biteAt = Number.POSITIVE_INFINITY;
  private nibblePlan = { nibbles: 1, gap: 0.8 };
  private hookedFish: Fish | null = null;
  private sawEligible = false;

  // fight
  private fight!: FightState;
  private fightParams!: FightParams;
  private under!: Phaser.GameObjects.Container;
  private underFish!: Phaser.GameObjects.Image;
  private underLine!: Phaser.GameObjects.Graphics;
  private tensionFill!: Phaser.GameObjects.Rectangle;
  private tensionLabel!: Phaser.GameObjects.Text;
  private distFill!: Phaser.GameObjects.Rectangle;
  private distLabel!: Phaser.GameObjects.Text;
  private bubbles!: Phaser.GameObjects.Particles.ParticleEmitter;
  private predatorPending = false;
  private predator: PredatorState | null = null;
  private predatorUi: Phaser.GameObjects.Container | null = null;
  private dismissReveal: (() => void) | null = null;

  constructor() {
    super('Fishing');
  }

  create(): void {
    const { data, player } = S();
    this.spot = spotOf(data, player);
    this.phase = 'idle';
    this.holding = false;
    this.hookedFish = null;
    this.predator = null;
    this.predatorUi = null;
    this.school = null;

    const time = timeOfDay(data, player);
    const [, , waterTint] = TIME_SKY[time];
    sky(this, time, WATER_TOP);
    // top-down water: continuous gradient (far = dark and deep, near = light and shallow), two scrolling highlight
    // layers, drifting light and leaves, reeds on the near bank. Depth bands are only hinted with faint labels.
    const waterH = WATER_BOTTOM - WATER_TOP;
    const far = Phaser.Display.Color.ValueToColor(waterTint).darken(38);
    const near = Phaser.Display.Color.ValueToColor(waterTint).lighten(14);
    const wg = this.add.graphics();
    const steps = 28;
    for (let i = 0; i < steps; i++) {
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(far, near, steps, i);
      wg.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
      wg.fillRect(0, WATER_TOP + (waterH / steps) * i, W, waterH / steps + 1);
    }
    // sky reflection along the far bank
    wg.fillStyle(TIME_SKY[time][1], 0.18);
    wg.fillRect(0, WATER_TOP, W, 34);
    this.waves = [
      this.add.tileSprite(W / 2, WATER_TOP + waterH / 2, W, waterH, 'wave').setAlpha(0.5),
      this.add.tileSprite(W / 2, WATER_TOP + waterH / 2, W, waterH, 'wave').setAlpha(0.3).setTileScale(1.6, 1.6),
    ];
    for (let i = 0; i < 7; i++) {
      const r = this.add.ellipse((i * 67 + 30) % W, WATER_TOP + ((i * 97 + 40) % waterH), 70, 10, 0xffffff, 0.07);
      this.tweens.add({ targets: r, scaleX: 1.6, alpha: 0, duration: 3200 + i * 350, repeat: -1, delay: i * 500 });
    }
    for (let i = 0; i < 3; i++) {
      const leaf = this.add.image(-20 - i * 140, WATER_TOP + 40 + i * 110, 'leaf').setAlpha(0.8).setAngle(i * 40).setDepth(2);
      this.tweens.add({ targets: leaf, x: W + 30, y: leaf.y + 30, angle: leaf.angle + 60, duration: 42000 + i * 9000, repeat: -1, delay: i * 6000 });
    }
    const bandLabels: [string, number][] = [['far · deep', WATER_TOP + 12], ['mid', WATER_TOP + waterH / 3 + 10], ['near · shallow', WATER_TOP + (2 * waterH) / 3 + 10]];
    for (const [label, y] of bandLabels) text(this, 8, y, label, 10, { color: '#cfe3ee', origin: [0, 0.5] }).setAlpha(0.35);
    // far bank: grass + treeline silhouettes
    panel(this, 0, WATER_TOP - 14, W, 16, 0x3b5c45);
    const trees = this.add.graphics();
    trees.fillStyle(0x24402e, 1);
    for (let i = 0; i < 20; i++) trees.fillEllipse(i * 21 + 4, WATER_TOP - 11, 26, 9 + (i % 3) * 3);
    // our bank with the angler
    panel(this, 0, WATER_BOTTOM, W, BANK_H, 0x6b5a3a);
    panel(this, 0, WATER_BOTTOM, W, 5, 0x8a7a5a);
    const bankG = this.add.graphics();
    bankG.fillStyle(0x5a4a2e, 1);
    for (let i = 0; i < 9; i++) bankG.fillEllipse(20 + i * 44, WATER_BOTTOM + 30 + (i % 2) * 6, 18, 8);
    for (let i = 0; i < 6; i++) {
      const rx = i < 3 ? 14 + i * 22 : W - 14 - (i - 3) * 22;
      this.add.image(rx, WATER_BOTTOM - 6, 'reed').setOrigin(0.5, 1).setDepth(4).setAngle(-6 + (i % 3) * 6);
    }
    this.add.image(ANGLER.x, ANGLER.y + 10, 'angler').setDepth(6);
    this.rodG = this.add.graphics().setDepth(7);
    this.vignette = this.add.graphics().setDepth(40).setAlpha(0);
    this.vignette.lineStyle(26, 0xd9534f, 1);
    this.vignette.strokeRect(0, 0, W, H);
    panel(this, 0, WATER_BOTTOM + BANK_H, W, H - WATER_BOTTOM - BANK_H, C.panelDark);

    this.castLine = this.add.graphics().setDepth(5);
    this.aimLine = this.add.graphics().setDepth(5);
    this.hudRef = hud(this, this.spot.name);
    button(this, 40, TOP - 20, 64, 34, '‹ Map', () => this.leave(), { size: 15, fill: C.panel });

    this.bobber = this.add.image(0, 0, 'bobber').setDepth(6).setVisible(false);

    // bottom controls
    this.hint = text(this, W / 2, WATER_BOTTOM + BANK_H + 30, '', 17, { bold: true, wrap: W - 30 });
    this.baitBtn = button(this, W / 2, H - BOTTOM - 36, W - 24, 48, '', () => this.cycleBait(), { size: 15, fill: C.panel });
    this.reelInBtn = button(this, W - 60, WATER_TOP + 22, 96, 34, 'Reel in', () => this.cancelWait(), { size: 14, fill: C.panel }).setVisible(false).setDepth(10);
    this.refreshBaitBtn();

    this.powerBar = this.add.rectangle(W / 2, WATER_BOTTOM + BANK_H + 64, W - 60, 18, 0x000000, 0.6).setVisible(false);
    this.powerFill = this.add.rectangle(30, WATER_BOTTOM + BANK_H + 64, 0, 14, C.accent).setOrigin(0, 0.5).setVisible(false);

    this.buildUnderwater();
    this.buildReelButton();
    this.spawnSchool();

    // input
    const zone = this.add.zone(0, TOP + 44, W, WATER_BOTTOM + BANK_H - (TOP + 44)).setOrigin(0, 0).setInteractive();
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => { this.pointerX = p.x; this.press(); });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => { this.pointerX = p.x; });
    this.input.on('pointerup', () => this.release());
    this.spaceKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.input.keyboard?.on('keydown-SPACE', (e: KeyboardEvent) => { e.preventDefault(); if (!e.repeat) this.press(); });
    this.input.keyboard?.on('keyup-SPACE', () => this.release());
    this.input.keyboard?.on('keydown-ESC', () => this.leave());
    this.events.once('shutdown', () => {
      this.input.keyboard?.removeAllListeners();
      this.school?.destroy();
    });

    this.setHint('HOLD on the water to cast. Slide to aim, longer hold = farther out.');
  }

  // ---------- setup helpers ----------

  private bands(): Record<Zone, { top: number; bottom: number }> {
    const h = (WATER_BOTTOM - WATER_TOP) / 3;
    return {
      deep: { top: WATER_TOP + 14, bottom: WATER_TOP + h - 8 },
      mid: { top: WATER_TOP + h + 8, bottom: WATER_TOP + 2 * h - 8 },
      shallow: { top: WATER_TOP + 2 * h + 8, bottom: WATER_BOTTOM - 16 },
    };
  }

  /** Where the rod tip is right now (the line starts here). */
  private rodTip(): { x: number; y: number } {
    const base = { x: ANGLER.x + 18, y: ANGLER.y + 2 };
    const len = 118;
    const swing = this.rodSwing; // -1 back (tip low-right), 1 forward (tip far up)
    const ang = -Math.PI / 2 + 0.55 - swing * 0.75; // rest: leaning right
    const bend = this.rodBend;
    return { x: base.x + Math.cos(ang) * len * (1 - 0.25 * bend), y: base.y + Math.sin(ang) * len * (1 - 0.1 * bend) + bend * 10 };
  }

  /** Tapered rod with guides, reel seat and a crank; bends toward the line under tension. */
  private drawRod(): void {
    const g = this.rodG;
    g.clear();
    const base = { x: ANGLER.x + 18, y: ANGLER.y + 2 };
    const tip = this.rodTip();
    const bend = this.rodBend;
    const cx = (base.x + tip.x) / 2 - bend * 26;
    const cy = (base.y + tip.y) / 2 + bend * 22;
    const curve = new Phaser.Curves.QuadraticBezier(new Phaser.Math.Vector2(base.x, base.y), new Phaser.Math.Vector2(cx, cy), new Phaser.Math.Vector2(tip.x, tip.y));
    const pts = curve.getPoints(14);
    for (let i = 1; i < pts.length; i++) {
      const w = 5 - (i / pts.length) * 3.6;
      g.lineStyle(w, i < 4 ? 0x3a2a1a : 0xd8c48a, 1);
      g.lineBetween(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    }
    g.lineStyle(1, 0x777777, 1);
    for (let i = 4; i < pts.length; i += 3) g.strokeCircle(pts[i].x, pts[i].y, 2);
    const rx = base.x + 2;
    const ry = base.y + 10;
    g.fillStyle(0x444c55, 1);
    g.fillCircle(rx, ry, 7);
    g.fillStyle(0x9aa4ad, 1);
    g.fillCircle(rx, ry, 4);
    g.lineStyle(2, 0xdddddd, 1);
    g.lineBetween(rx, ry, rx + Math.cos(this.crankAngle) * 9, ry + Math.sin(this.crankAngle) * 9);
    g.fillStyle(0x222222, 1);
    g.fillCircle(rx + Math.cos(this.crankAngle) * 9, ry + Math.sin(this.crankAngle) * 9, 2.2);
  }

  private buildReelButton(): void {
    const r = 46;
    const c = this.add.container(W - 70, H - BOTTOM - 108).setDepth(25).setVisible(false);
    const bg = this.add.circle(0, 0, r, C.accent).setStrokeStyle(4, 0xffffff, 0.5);
    this.reelCrank = this.add.graphics();
    const label = text(this, 0, 0, 'HOLD\nREEL', 15, { bold: true, color: '#1a1200' });
    c.add([bg, this.reelCrank, label]);
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerdown', () => { this.holding = true; bg.setFillStyle(0xffd27f); });
    const up = () => { this.holding = false; bg.setFillStyle(C.accent); };
    bg.on('pointerup', up);
    bg.on('pointerout', up);
    this.reelBtn = c;
  }

  /** Short vibration where supported (Android browsers); silent elsewhere. */
  private buzz(pattern: number | number[]): void {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* unsupported */
    }
  }

  /** (Re)populate the water with fish for the current bait and time. */
  private spawnSchool(): void {
    const { data, player } = S();
    this.school?.destroy();
    const time = timeOfDay(data, player);
    const zones: Zone[] = ['shallow', 'mid', 'deep'];
    const eligible = {} as Record<Zone, Fish[]>;
    const others = {} as Record<Zone, Fish[]>;
    for (const z of zones) {
      eligible[z] = candidates(data.fish, this.spot.id, z, time, player.equipped, player.log);
      others[z] = data.fish.filter(
        (f) => f.spots.includes(this.spot.id) && f.zones.includes(z) && f.times.includes(time) && !eligible[z].includes(f) && !(f.once && f.id in player.log),
      );
    }
    this.school = new School(
      this,
      data.config.school,
      { left: 10, right: W - 10, top: WATER_TOP + 12, bottom: WATER_BOTTOM - 14 },
      this.bands(),
      { eligible, others },
      data.config.rarityWeight,
      randomRng,
    );
  }

  private buildUnderwater(): void {
    this.under = this.add.container(0, 0).setVisible(false).setDepth(20);
    const h = WATER_BOTTOM + BANK_H - WATER_TOP;
    const bg = this.add.graphics();
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const c = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(0x2a7a94),
        Phaser.Display.Color.ValueToColor(0x061a26),
        steps,
        i,
      );
      bg.fillStyle(Phaser.Display.Color.GetColor(c.r, c.g, c.b));
      bg.fillRect(0, WATER_TOP + (h / steps) * i, W, h / steps + 1);
    }
    bg.fillStyle(0xcfe8f3, 0.9);
    bg.fillRect(0, WATER_TOP, W, 4);
    bg.fillStyle(0x3a2e1f, 1);
    bg.fillRect(0, WATER_BOTTOM + BANK_H - 18, W, 18);
    for (let i = 0; i < 9; i++) {
      bg.fillStyle(0x2f5a3a, 1);
      bg.fillEllipse(20 + i * 45, WATER_BOTTOM + BANK_H - 22, 10, 40 + (i % 3) * 14);
    }
    this.under.add(bg);
    this.underLine = this.add.graphics();
    this.under.add(this.underLine);
    this.underFish = this.add.image(W / 2, WATER_TOP + h / 2, 'fish_dock_perch');
    this.under.add(this.underFish);
    this.bubbles = this.add.particles(0, 0, 'spark', {
      speedY: { min: -40, max: -90 },
      speedX: { min: -10, max: 10 },
      lifespan: 1400,
      scale: { start: 0.35, end: 0.1 },
      alpha: { start: 0.7, end: 0 },
      quantity: 1,
      frequency: 120,
      emitting: false,
    });
    this.under.add(this.bubbles);

    const barY = WATER_TOP + 26;
    this.under.add(this.add.rectangle(W / 2, barY, W - 48, 26, 0x000000, 0.65));
    this.tensionFill = this.add.rectangle(24, barY, 0, 20, C.good).setOrigin(0, 0.5);
    this.under.add(this.tensionFill);
    this.under.add(this.add.rectangle(24 + (W - 48) * 0.8, barY, (W - 48) * 0.2, 20, C.danger, 0.35).setOrigin(0, 0.5));
    this.tensionLabel = text(this, W / 2, barY, 'TENSION', 12, { bold: true, stroke: true });
    this.under.add(this.tensionLabel);
    this.under.add(this.add.rectangle(W / 2, barY + 28, W - 48, 12, 0x000000, 0.5));
    this.distFill = this.add.rectangle(24, barY + 28, 0, 8, 0xffffff, 0.8).setOrigin(0, 0.5);
    this.under.add(this.distFill);
    this.distLabel = text(this, W / 2, barY + 48, '', 12, { color: C.text, stroke: true });
    this.under.add(this.distLabel);
  }

  // ---------- small helpers ----------

  private setHint(s: string, color = C.text): void {
    this.hint.setText(s).setColor(color);
    if (this.phase !== 'fight' && this.phase !== 'predator') this.hint.setX(W / 2).setOrigin(0.5, 0.5).setWordWrapWidth(W - 30).setAlign('center');
  }

  private leave(): void {
    if (this.phase === 'fight' || this.phase === 'predator') {
      toast(this, 'Finish the fight first!', C.dangerCss);
      return;
    }
    S().save();
    this.scene.start('Map');
  }

  private refreshBaitBtn(): void {
    const { data, player } = S();
    const n = player.inventory[player.equipped] ?? 0;
    const lure = isLure(data, player.equipped);
    this.baitBtn.setText(`On the hook: ${itemName(data, player.equipped)}${lure ? ' (lure)' : ` ×${n}`}   ▸ tap to change`);
    this.hudRef.refresh();
  }

  private cycleBait(): void {
    if (this.phase !== 'idle') return;
    const { data, player } = S();
    const options = equippable(data, player);
    if (options.length === 0) {
      toast(this, 'Nothing left to put on the hook. Buy bait at the shop.', C.dangerCss);
      return;
    }
    const i = options.findIndex((o) => o.id === player.equipped);
    equip(data, player, options[(i + 1) % options.length].id);
    S().save();
    this.refreshBaitBtn();
    this.spawnSchool();
  }

  private bait(): Bait | null {
    if (this.phase !== 'waiting') return null;
    return { x: this.bobber.x, y: this.bobber.y, moving: this.usingLure && this.lureMoving, isLure: this.usingLure };
  }

  // ---------- input ----------

  private press(): void {
    switch (this.phase) {
      case 'idle':
        this.startCharge();
        break;
      case 'waiting':
        if (this.usingLure) {
          this.holding = true;
          if (this.biteAt !== Number.POSITIVE_INFINITY) this.tryHook();
        } else this.tryHook();
        break;
      case 'fight':
        this.holding = true;
        break;
      case 'predator':
        this.predatorHit();
        break;
      case 'reveal':
        this.dismissReveal?.();
        break;
      default:
        break;
    }
  }

  private release(): void {
    if (this.phase === 'charging') this.castNow();
    this.holding = false;
  }

  // ---------- cast ----------

  private startCharge(): void {
    const { data, player } = S();
    const ok = beginCastCheck(data, player);
    if (!ok.ok) {
      toast(this, ok.reason, C.dangerCss);
      return;
    }
    this.phase = 'charging';
    this.charge = 0;
    this.power = 0;
    this.aimX = Phaser.Math.Clamp(this.pointerX, 30, W - 30);
    this.tweens.add({ targets: this, rodSwing: -1, duration: 400, ease: 'Sine.easeOut' });
    this.powerBar.setVisible(true);
    this.powerFill.setVisible(true);
  }

  private castNow(): void {
    const { data, player } = S();
    const r = beginCast(data, player);
    this.powerBar.setVisible(false);
    this.powerFill.setVisible(false);
    this.aimLine.clear();
    if (!r.ok) {
      toast(this, r.reason, C.dangerCss);
      this.phase = 'idle';
      return;
    }
    S().save();
    this.refreshBaitBtn();
    this.phase = 'flying';
    this.usingLure = isLure(data, player.equipped);
    const zoneName = zoneForPower(this.power, data.config.cast.zones);
    const b = this.bands();
    const band = b[zoneName];
    // farther = higher on screen; the zone decides the band, the power decides where inside it
    const t = zoneName === 'shallow' ? this.power / data.config.cast.zones.shallow
      : zoneName === 'mid' ? (this.power - data.config.cast.zones.shallow) / (data.config.cast.zones.mid - data.config.cast.zones.shallow)
        : (this.power - data.config.cast.zones.mid) / (1 - data.config.cast.zones.mid);
    const ty = Phaser.Math.Linear(band.bottom, band.top, Phaser.Math.Clamp(t, 0, 1));
    this.landing.set(this.aimX, ty);
    const tip = this.rodTip();
    this.bobber.setPosition(tip.x, tip.y).setVisible(true).setScale(1).clearTint().setAlpha(1);
    this.setHint(`Casting to ${zoneName} water...`);
    this.buzz(15);
    this.tweens.add({ targets: this, rodSwing: 1, duration: 160, ease: 'Quad.easeIn', onComplete: () => {
      this.tweens.add({ targets: this, rodSwing: 0.15, duration: 500, ease: 'Sine.easeOut' });
    } });
    this.tweens.add({
      targets: this.bobber,
      x: this.aimX,
      y: ty,
      duration: data.config.cast.flightSeconds * 1000,
      ease: 'Quad.easeOut',
      onComplete: () => this.startWaiting(),
    });
  }

  private startWaiting(): void {
    const { data } = S();
    this.phase = 'waiting';
    this.waitT = 0;
    this.biteAt = Number.POSITIVE_INFINITY;
    this.hookedFish = null;
    this.lureMoving = false;
    this.sawEligible = this.school?.anyEligible ?? false;
    const plan = planBite(data.config.bite, this.spot, randomRng);
    const gaps = plan.nibbleTimes.length ? (plan.dipAt - plan.nibbleTimes[0]) / plan.nibbleTimes.length : data.config.bite.nibbleGap.max;
    this.nibblePlan = { nibbles: plan.nibbleTimes.length, gap: Math.max(0.3, gaps) };
    this.splash(this.landing.x, this.landing.y);
    this.reelInBtn.setVisible(!this.usingLure);
    this.setHint(this.usingLure ? 'HOLD to retrieve the lure in pulses. Fish chase it while it moves.' : 'Watch the fish. When one takes the float, TAP!');
  }

  private cancelWait(): void {
    if (this.phase !== 'waiting') return;
    this.school?.spook(this.bait());
    this.endWait('Reeled in. HOLD to cast again.');
  }

  private endWait(hintText: string): void {
    this.reelInBtn.setVisible(false);
    this.bobber.setVisible(false);
    this.castLine.clear();
    this.phase = 'idle';
    this.biteAt = Number.POSITIVE_INFINITY;
    this.setHint(hintText);
  }

  private tryHook(): void {
    const { data } = S();
    const r = hookResult(this.waitT, this.biteAt, data.config.bite.hookWindowSeconds);
    if (r === 'hooked' && this.hookedFish) {
      this.startFight(this.hookedFish);
      return;
    }
    if (r === 'early') {
      const engaged = this.school?.actors.find((a) => a.state === 'circle' || a.state === 'approach');
      if (engaged && data.config.bite.earlyTapSpooks) {
        this.school?.spook(this.bait());
        this.loseFish('Too early! You yanked it away and spooked the fish.', false, false);
      } else if (!this.usingLure) {
        this.school?.spook(this.bait());
        this.loseFish('Nothing on yet. The splash scared them off.', false, false);
      }
      return;
    }
    this.school?.spook(this.bait());
    this.loseFish('Too late! It spat the hook.');
  }

  // ---------- fight ----------

  private startFight(fish: Fish): void {
    const { data, player } = S();
    this.phase = 'fight';
    this.reelInBtn.setVisible(false);
    this.holding = true;
    this.school?.takeEngaged();
    this.cameras.main.flash(180, 255, 255, 255);
    this.cameras.main.shake(140, 0.005);
    this.fightParams = {
      fish: fish.fight,
      bossPhases: fish.boss?.phases,
      rodStrength: rodOf(data, player).strength,
      lineCap: lineCapOf(data, player),
      lineOut: lineOutForPower(this.power, this.spot),
      cfg: data.config.fight,
      rng: randomRng,
    };
    this.fight = createFight(this.fightParams);
    this.predatorPending = !!this.spot.predator && rollPredator(this.spot.predator.chance, !!fish.boss, randomRng);
    this.bobber.setVisible(false);
    this.castLine.clear();
    this.under.setVisible(true);
    this.underFish.setTexture(`fish_${fish.id}`).setScale(0.9 + 1.1 * Math.min(1, fish.sizeCm.max / 190)).clearTint();
    this.bubbles.start();
    this.reelBtn.setVisible(true);
    this.hint.setX(14).setOrigin(0, 0.5).setWordWrapWidth(W - 150).setAlign('left');
    this.buzz([30, 40, 30]);
    this.setHint(fish.boss ? 'Something enormous. Let it run. Reel only when it rests.' : 'HOOKED! Let it run, reel when it rests. Release the moment it pulls.', C.accentCss);
    this.flash('HOOKED!', C.accentCss, 44);
  }

  private updateFight(dt: number): void {
    const reeling = this.holding || !!this.spaceKey?.isDown;
    stepFight(this.fight, this.fightParams, dt, reeling);
    for (const e of this.fight.events) {
      if (e.type === 'run' || e.type === 'resist') {
        this.flash(e.type === 'resist' ? 'It resists! Let go!' : 'It runs! Let go!', '#ffb0a0', 28);
        this.buzz(40);
      }
      if (e.type === 'tired') this.flash('It is tiring...', C.goodCss, 24);
      if (e.type === 'phase') {
        this.flash(e.label, RARITY_CSS.rare, 32);
        this.cameras.main.shake(250, 0.008);
      }
    }
    const f = this.fight;
    const frac = Phaser.Math.Clamp(f.tension / this.fightParams.lineCap, 0, 1);
    this.rodBend = Phaser.Math.Linear(this.rodBend, frac, 0.2);
    if (reeling && !f.running) this.crankAngle += dt * 9;
    this.reelCrank.clear();
    this.reelCrank.lineStyle(3, 0x1a1200, 0.5);
    this.reelCrank.strokeCircle(0, 0, 34);
    this.reelCrank.lineStyle(4, 0x1a1200, 0.9);
    this.reelCrank.lineBetween(0, 0, Math.cos(this.crankAngle) * 34, Math.sin(this.crankAngle) * 34);
    this.vignette.setAlpha(f.running ? 0.55 + 0.35 * Math.sin(f.elapsed * 18) : frac > 0.8 ? 0.6 : 0);
    this.tensionFill.width = (W - 48) * frac;
    this.tensionFill.setFillStyle(frac > 0.8 ? C.danger : frac > 0.55 ? C.accent : C.good);
    this.tensionLabel.setText(f.running ? 'PULLING – release!' : frac > 0.8 ? 'DANGER' : frac < 0.1 ? 'SLACK!' : reeling ? 'REELING' : 'RESTING – reel now');
    const dfrac = Phaser.Math.Clamp(1 - f.lineOut / f.startLineOut, 0, 1);
    this.distFill.width = (W - 48) * dfrac;
    this.distLabel.setText(`${Math.max(0, f.lineOut).toFixed(0)} m out · fish ${(f.stamina * 100).toFixed(0)}% fresh`);

    // underwater view: fish at a distance proportional to line out, swimming away while it runs
    const t = Phaser.Math.Clamp(f.lineOut / f.startLineOut, 0, 1.5);
    const fx = Phaser.Math.Linear(70, W - 50, t);
    const fy = WATER_TOP + 150 + Math.sin(f.elapsed * (f.running ? 14 : 3)) * (f.running ? 10 : 4) + (1 - f.stamina) * 60;
    this.underFish.setPosition(fx, fy).setFlipX(f.running);
    this.underFish.setTint(f.running ? 0xffb0a0 : 0xffffff);
    this.underFish.setAngle(f.running ? Math.sin(f.elapsed * 30) * 10 : Math.sin(f.elapsed * 3) * 4);
    this.bubbles.setPosition(fx - 20, fy);
    this.underLine.clear();
    this.underLine.lineStyle(2, frac > 0.8 ? C.danger : C.line, 0.95);
    const sag = (1 - frac) * 50;
    this.underLine.beginPath();
    this.underLine.moveTo(30, WATER_TOP + 4);
    this.underLine.lineTo((30 + fx) / 2, (WATER_TOP + fy) / 2 + sag);
    this.underLine.lineTo(fx - 30, fy);
    this.underLine.strokePath();

    if (this.predatorPending && f.stamina < S().data.config.predator.triggerStaminaBelow && f.outcome === 'fighting') {
      this.predatorPending = false;
      this.startPredator();
      return;
    }
    if (f.outcome === 'landed') this.land();
    else if (f.outcome === 'snapped') this.loseFish('SNAP! The line broke.', true);
    else if (f.outcome === 'escaped') this.loseFish('The line went slack. It slipped the hook.');
  }

  // ---------- predator ----------

  private startPredator(): void {
    const { data } = S();
    const pred = this.spot.predator!;
    this.phase = 'predator';
    this.predator = startPredator(data.config.predator);
    this.cameras.main.shake(200, 0.01);
    const c = this.add.container(0, 0).setDepth(50);
    c.add(this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55));
    const img = this.add.image(W / 2, WATER_TOP + 160, `predator_${pred.id}`).setScale(2.2);
    c.add(img);
    this.tweens.add({ targets: img, y: img.y + 16, duration: 180, yoyo: true, repeat: -1 });
    c.add(text(this, W / 2, WATER_TOP + 60, `${pred.name} wants your fish!`, 26, { bold: true, stroke: true, color: C.dangerCss }));
    const counter = text(this, W / 2, WATER_TOP + 260, `TAP ×${data.config.predator.taps}`, 48, { bold: true, stroke: true });
    c.add(counter);
    const bar = this.add.rectangle(W / 2, WATER_TOP + 320, W - 80, 16, C.danger);
    c.add(bar);
    c.setData('counter', counter);
    c.setData('bar', bar);
    this.predatorUi = c;
  }

  private predatorHit(): void {
    const { data } = S();
    if (!this.predator) return;
    predatorTap(this.predator, data.config.predator);
    const counter = this.predatorUi?.getData('counter') as Phaser.GameObjects.Text | undefined;
    counter?.setText(`TAP ×${Math.max(0, data.config.predator.taps - this.predator.taps)}`);
    counter?.setScale(1.3);
    this.tweens.add({ targets: counter, scale: 1, duration: 120 });
    this.cameras.main.shake(60, 0.004);
  }

  private updatePredator(dt: number): void {
    const { data } = S();
    if (!this.predator) return;
    stepPredator(this.predator, dt);
    const bar = this.predatorUi?.getData('bar') as Phaser.GameObjects.Rectangle | undefined;
    if (bar) bar.width = (W - 80) * Phaser.Math.Clamp(this.predator.timeLeft / data.config.predator.seconds, 0, 1);
    if (this.predator.outcome === 'won') {
      this.predatorUi?.destroy();
      this.predatorUi = null;
      this.predator = null;
      this.phase = 'fight';
      this.flash('Chased it off!', C.goodCss, 30);
    } else if (this.predator.outcome === 'lost') {
      this.predatorUi?.destroy();
      this.predatorUi = null;
      const name = this.spot.predator?.name ?? 'Something';
      this.predator = null;
      this.loseFish(`${name} took your fish!`);
    }
  }

  // ---------- outcomes ----------

  private loseFish(reason: string, snap = false, countsAsLoss = true): void {
    const { player } = S();
    if (countsAsLoss) recordLoss(player);
    S().save();
    this.phase = 'result';
    this.reelInBtn.setVisible(false);
    this.reelBtn.setVisible(false);
    this.vignette.setAlpha(0);
    this.rodBend = 0;
    this.under.setVisible(false);
    this.bubbles.stop();
    if (snap) this.buzz([80, 40, 80]);
    this.bobber.setVisible(false);
    this.castLine.clear();
    if (snap) this.cameras.main.shake(300, 0.012);
    this.flash(reason, C.dangerCss, snap ? 40 : 26);
    this.setHint(reason, C.dangerCss);
    this.time.delayedCall(1300, () => {
      this.phase = 'idle';
      this.setHint('HOLD on the water to cast again.');
      this.hudRef.refresh();
    });
  }

  private land(): void {
    const { data, player } = S();
    const fish = this.hookedFish!;
    const size = rollSizeCm(fish, randomRng);
    const result = recordCatch(data, player, fish, size, timeOfDay(data, player));
    S().save();
    this.under.setVisible(false);
    this.reelBtn.setVisible(false);
    this.vignette.setAlpha(0);
    this.rodBend = 0;
    this.bubbles.stop();
    this.buzz(fish.rarity === 'common' ? 40 : [40, 60, 40, 60, 120]);
    this.phase = 'reveal';
    this.hudRef.refresh();
    this.setHint(`Landed a ${fish.name}!`, C.goodCss);
    this.showReveal(fish, size, result);
    if (fish.once) this.spawnSchool();
  }

  /** The catch card. Must read instantly with the sound off: big rarity word, big size, colour-coded frame. */
  private showReveal(fish: Fish, size: number, r: CatchResult): void {
    const { data } = S();
    const rar = fish.rarity;
    const hold = data.config.reveal[`${rar}Seconds`] * 1000;
    const c = this.add.container(0, 0).setDepth(100);
    c.add(this.add.rectangle(W / 2, H / 2, W, H, 0x000000, rar === 'legendary' ? 0.85 : 0.6));

    if (rar === 'rare' || rar === 'legendary') {
      this.cameras.main.flash(300, 255, 230, 150);
      this.cameras.main.shake(300, 0.01);
      const n = rar === 'legendary' ? 16 : 8;
      for (let i = 0; i < n; i++) {
        const ray = this.add.image(W / 2, H * 0.4, 'ray').setOrigin(0, 0.5).setTint(RARITY_HEX[rar]).setAlpha(0.18).setAngle((360 / n) * i);
        c.add(ray);
        this.tweens.add({ targets: ray, angle: ray.angle + 40, duration: 6000, repeat: -1 });
      }
    }
    const card = this.add.rectangle(W / 2, H * 0.42, W - 40, 330, C.panel).setStrokeStyle(rar === 'common' ? 2 : 6, RARITY_HEX[rar]);
    c.add(card);
    const img = this.add.image(W / 2, H * 0.42 - 70, `fish_${fish.id}`).setScale(1.6 + 1.2 * (size / 190));
    c.add(img);
    this.tweens.add({ targets: img, scale: img.scale * 1.06, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const rt = text(this, W / 2, H * 0.42 - 150, rar === 'legendary' ? 'LEGENDARY' : rar.toUpperCase(), rar === 'legendary' ? 44 : rar === 'rare' ? 34 : 20, { bold: true, color: RARITY_CSS[rar], stroke: true });
    c.add(rt);
    if (rar !== 'common') this.tweens.add({ targets: rt, scale: 1.1, duration: 400, yoyo: true, repeat: -1 });
    c.add(text(this, W / 2, H * 0.42 + 10, fish.name, 28, { bold: true }));
    c.add(text(this, W / 2, H * 0.42 + 56, `${size} cm`, 40, { bold: true, color: C.accentCss }));
    const badges: string[] = [];
    if (r.isNew) badges.push('NEW SPECIES');
    else if (r.isRecord) badges.push('NEW RECORD');
    c.add(text(this, W / 2, H * 0.42 + 96, badges.join('  ·  '), 16, { bold: true, color: C.goodCss }));
    c.add(text(this, W / 2, H * 0.42 + 126, `◉ ${r.entry.value} into the creel`, 15, { color: C.muted }));

    const extras: string[] = [];
    if (r.keyItem) extras.push(`Got: ${itemName(data, r.keyItem)}`);
    if (r.lureAssembled) extras.push(`${itemName(data, data.gear.assembly.result)} assembled!`);
    for (const q of r.questsReady) extras.push(`Quest ready: ${data.quests.find((x) => x.id === q)?.title ?? q}`);
    if (rar === 'legendary') extras.push(fish.blurb);
    c.add(text(this, W / 2, H * 0.42 + 200, extras.join('\n'), 17, { bold: true, color: C.accentCss, wrap: W - 60 }));
    if (rar === 'legendary') {
      c.add(text(this, W / 2, H * 0.42 + 270, 'You caught the one from the logbook.', 18, { color: RARITY_CSS.legendary, bold: true, wrap: W - 60 }));
      const emitter = this.add.particles(0, 0, 'spark', {
        x: { min: 0, max: W }, y: -10, lifespan: 3500, speedY: { min: 60, max: 160 }, speedX: { min: -30, max: 30 },
        scale: { start: 0.9, end: 0.2 }, tint: [0xff6ad5, 0xf2b63c, 0x6fd38a, 0xffffff], quantity: 2, frequency: 60,
      });
      emitter.setDepth(101);
      c.add(emitter);
    } else if (rar !== 'common') {
      const burst = this.add.particles(W / 2, H * 0.42 - 70, 'spark', {
        speed: { min: 80, max: 260 }, lifespan: 900, scale: { start: 0.8, end: 0 }, tint: RARITY_HEX[rar], emitting: false,
      });
      burst.setDepth(101);
      c.add(burst);
      burst.explode(rar === 'rare' ? 40 : 18);
    }
    const tapHint = text(this, W / 2, H - BOTTOM - 60, 'tap to continue', 14, { color: C.muted }).setAlpha(0);
    c.add(tapHint);
    this.tweens.add({ targets: tapHint, alpha: 1, delay: Math.max(600, hold * 0.6), duration: 300 });
    card.setScale(0.6);
    this.tweens.add({ targets: card, scale: 1, duration: 260, ease: 'Back.easeOut' });

    let canDismiss = false;
    this.time.delayedCall(Math.max(600, hold * 0.5), () => (canDismiss = true));
    this.dismissReveal = () => {
      if (!canDismiss) return;
      this.dismissReveal = null;
      c.destroy();
      this.phase = 'idle';
      this.hudRef.refresh();
      this.refreshBaitBtn();
      this.setHint(rar === 'legendary' ? 'Fifty years. Nobody. Until you. (Keep fishing, or visit the shop.)' : 'HOLD on the water to cast again.');
    };
    this.time.delayedCall(hold + 6000, () => this.dismissReveal?.());
  }

  // ---------- effects ----------

  private flash(str: string, color: string, size: number): void {
    const t = text(this, W / 2, WATER_TOP + 110, str, size, { bold: true, color, stroke: true, wrap: W - 40 }).setDepth(30);
    t.setScale(0.7);
    this.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, alpha: 0, y: t.y - 30, delay: 700, duration: 400, onComplete: () => t.destroy() });
  }

  private splash(x: number, y: number): void {
    const ring = this.add.ellipse(x, y + 4, 20, 12).setStrokeStyle(2, 0xffffff, 0.8).setDepth(5);
    this.tweens.add({ targets: ring, scaleX: 3.5, scaleY: 3, alpha: 0, duration: 700, onComplete: () => ring.destroy() });
  }

  private nibble(): void {
    this.buzz(12);
    this.tweens.add({ targets: this.bobber, y: this.bobber.y + 5, duration: 90, yoyo: true, repeat: 1 });
    this.bobber.setTint(0xffe27a);
    this.time.delayedCall(220, () => { if (this.biteAt === Number.POSITIVE_INFINITY) this.bobber.clearTint(); });
    const ring = this.add.ellipse(this.bobber.x, this.bobber.y + 4, 16, 10).setStrokeStyle(1.5, 0xffe27a, 0.8).setDepth(5);
    this.tweens.add({ targets: ring, scaleX: 2.5, scaleY: 2.5, alpha: 0, duration: 500, onComplete: () => ring.destroy() });
  }

  private drawCastLine(): void {
    this.castLine.clear();
    this.castLine.lineStyle(1.5, C.line, 0.7);
    const tip = this.rodTip();
    this.castLine.lineBetween(tip.x, tip.y, this.bobber.x, this.bobber.y);
  }

  // ---------- loop ----------

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.05, deltaMs / 1000);
    S().player.stats.playSeconds += dt;
    const { data } = S();
    const cfg = data.config;
    if (this.waves[0]) {
      this.waves[0].tilePositionX += 6 * dt;
      this.waves[0].tilePositionY += 2.5 * dt;
      this.waves[1].tilePositionX -= 3 * dt;
      this.waves[1].tilePositionY += 1.5 * dt;
    }
    this.drawRod();

    if (this.phase !== 'fight' && this.phase !== 'predator' && this.school) {
      const events = this.school.update(dt, this.bait(), this.nibblePlan);
      for (const e of events) {
        if (this.phase !== 'waiting') continue;
        if (e.type === 'nibble') this.nibble();
        else if (e.type === 'inspect') this.flash(`${e.actor.fish.name}: not interested in ${itemName(data, S().player.equipped)}`, '#cfe3ee', 15);
        else if (e.type === 'bite') {
          this.hookedFish = e.actor.fish;
          this.biteAt = this.waitT;
          this.bobber.setTint(0xffe27a).setY(this.bobber.y + 10).setAlpha(0.8);
          this.splash(this.bobber.x, this.bobber.y);
          this.buzz([20, 30, 60]);
          if (this.usingLure && this.holding) {
            // line already tight: a strike on a moving lure hooks itself
            this.startFight(this.hookedFish);
            return;
          }
          this.setHint('TAP NOW!', C.accentCss);
        }
      }
    }

    switch (this.phase) {
      case 'charging': {
        this.charge += dt;
        this.power = Phaser.Math.Clamp(this.charge / cfg.cast.chargeSeconds, 0, 1);
        if (this.cursors?.left.isDown) this.pointerX -= 220 * dt;
        if (this.cursors?.right.isDown) this.pointerX += 220 * dt;
        this.aimX = Phaser.Math.Clamp(this.pointerX, 30, W - 30);
        this.powerFill.width = (W - 60) * this.power;
        const zoneName = zoneForPower(this.power, cfg.cast.zones);
        this.powerFill.setFillStyle(zoneName === 'deep' ? 0x6f8fc9 : zoneName === 'mid' ? C.accent : C.good);
        const band = this.bands()[zoneName];
        this.aimLine.clear();
        this.aimLine.lineStyle(2, 0xffffff, 0.5);
        const tip = this.rodTip();
        this.aimLine.lineBetween(tip.x, tip.y, this.aimX, (band.top + band.bottom) / 2);
        this.aimLine.strokeCircle(this.aimX, (band.top + band.bottom) / 2, 14);
        this.setHint(`Aim: ${zoneName.toUpperCase()} water — release to cast`);
        break;
      }
      case 'waiting': {
        this.waitT += dt;
        this.drawCastLine();
        if (this.usingLure) {
          this.lureMoving = this.holding || !!this.spaceKey?.isDown;
          if (this.lureMoving && this.biteAt === Number.POSITIVE_INFINITY) {
            const tip = this.rodTip();
            const dx = tip.x - this.bobber.x;
            const dy = tip.y - this.bobber.y;
            const d = Math.hypot(dx, dy);
            const step = cfg.school.lure.retrieveSpeed * dt;
            if (d < 24) {
              this.endWait('Lure back in. HOLD to cast again.');
              break;
            }
            this.bobber.x += (dx / d) * step;
            this.bobber.y += (dy / d) * step;
            this.bobber.setAlpha(1);
          } else if (this.biteAt === Number.POSITIVE_INFINITY) {
            this.bobber.setAlpha(Math.max(0.45, this.bobber.alpha - cfg.school.lure.sinkSpeed * 0.01 * dt));
          }
        }
        if (this.biteAt !== Number.POSITIVE_INFINITY && this.waitT > this.biteAt + cfg.bite.hookWindowSeconds) {
          this.school?.spook(this.bait());
          this.loseFish('Too slow. It spat the bait and left.');
          break;
        }
        if (!this.sawEligible && this.waitT >= cfg.bite.nothingBitingSeconds && !(this.school?.anyEligible ?? false)) {
          this.endWait('');
          toast(this, `Nothing here takes ${itemName(data, S().player.equipped)} now. Try another bait, time or spot.`, C.muted);
          this.setHint('HOLD on the water to cast again.');
        }
        break;
      }
      case 'fight':
        this.updateFight(dt);
        break;
      case 'predator':
        this.updatePredator(dt);
        break;
      default:
        break;
    }
  }
}

/** Pre-check without consuming bait, so an impossible cast never starts charging. */
function beginCastCheck(data: ReturnType<typeof S>['data'], player: ReturnType<typeof S>['player']): { ok: true } | { ok: false; reason: string } {
  if (player.creel.length >= data.config.economy.creelSize) return { ok: false, reason: 'Creel full. Sell your catch at the shop.' };
  const lure = isLure(data, player.equipped);
  if (!lure && (player.inventory[player.equipped] ?? 0) <= 0) return { ok: false, reason: `Out of ${itemName(data, player.equipped)}. Tap the hook to change bait.` };
  return { ok: true };
}
