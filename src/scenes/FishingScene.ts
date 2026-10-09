import Phaser from 'phaser';
import type { Fish, Spot } from '../data/schema';
import { S } from '../game/session';
import { BOTTOM, C, H, RARITY_CSS, RARITY_HEX, TIME_SKY, TOP, W, button, hud, panel, sky, text, toast, type Button } from '../game/ui';
import { candidates, hookResult, lineOutForPower, pickFish, planBite, zoneForPower, type BitePlan } from '../sim/bite';
import { rollSizeCm } from '../sim/economy';
import { createFight, stepFight, type FightParams, type FightState } from '../sim/fight';
import { predatorTap, rollPredator, startPredator, stepPredator, type PredatorState } from '../sim/predator';
import { randomRng } from '../sim/rng';
import { beginCast, equip, equippable, itemName, lineCapOf, recordCatch, recordLoss, rodOf, spotOf, timeOfDay, type CatchResult } from '../sim/state';

type Phase = 'idle' | 'charging' | 'flying' | 'waiting' | 'fight' | 'predator' | 'result' | 'reveal';

const WATER_TOP = TOP + 150;
const WATER_BOTTOM = H - BOTTOM - 130;
const ANGLER = { x: 48, y: WATER_BOTTOM - 10 };

/** The core loop: hold to cast, tap the dip, hold/release to fight, reveal. Input: pointer anywhere on the water or SPACE. */
export class FishingScene extends Phaser.Scene {
  private phase: Phase = 'idle';
  private spot!: Spot;
  private hudRef!: { refresh(): void };
  private hint!: Phaser.GameObjects.Text;
  private bobber!: Phaser.GameObjects.Image;
  private line!: Phaser.GameObjects.Graphics;
  private shadow!: Phaser.GameObjects.Image;
  private powerBar!: Phaser.GameObjects.Rectangle;
  private powerFill!: Phaser.GameObjects.Rectangle;
  private tensionBar!: Phaser.GameObjects.Rectangle;
  private tensionFill!: Phaser.GameObjects.Rectangle;
  private tensionLabel!: Phaser.GameObjects.Text;
  private distFill!: Phaser.GameObjects.Rectangle;
  private distLabel!: Phaser.GameObjects.Text;
  private fightUi!: Phaser.GameObjects.Container;
  private baitBtn!: Button;
  private reelInBtn!: Button;
  private holding = false;
  private spaceKey?: Phaser.Input.Keyboard.Key;

  // cast
  private power = 0;
  private charge = 0;
  private landing = new Phaser.Math.Vector2();

  // bite
  private bite!: BitePlan;
  private waitT = 0;
  private nibbleIdx = 0;
  private dipped = false;
  private hookedFish: Fish | null = null;

  // fight
  private fight!: FightState;
  private fightParams!: FightParams;
  private predatorPending = false;
  private predator: PredatorState | null = null;
  private predatorUi: Phaser.GameObjects.Container | null = null;

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

    const time = timeOfDay(data, player);
    sky(this, time, WATER_TOP);
    panel(this, 0, WATER_TOP, W, WATER_BOTTOM - WATER_TOP, TIME_SKY[time][2]);
    const deep = this.add.graphics();
    deep.fillStyle(0x000000, 0.18);
    deep.fillRect(0, WATER_TOP, W, 70);
    deep.fillStyle(0x000000, 0.1);
    deep.fillRect(0, WATER_TOP + 70, W, 60);
    // far bank + dock plank
    this.add.rectangle(0, WATER_TOP - 10, W, 20, 0x3b5c45).setOrigin(0, 0);
    this.add.rectangle(0, WATER_BOTTOM - 26, 120, 26, 0x6b4f3a).setOrigin(0, 0);
    // angler placeholder (a rod)
    this.line = this.add.graphics().setDepth(5);
    this.add.rectangle(ANGLER.x, ANGLER.y - 30, 6, 90, 0xd0c090).setOrigin(0.5, 1).setAngle(35);
    panel(this, 0, WATER_BOTTOM, W, H - WATER_BOTTOM, C.panelDark);

    this.hudRef = hud(this, this.spot.name);
    button(this, 40, TOP - 20, 64, 34, '‹ Map', () => this.leave(), { size: 15, fill: C.panel });

    this.bobber = this.add.image(ANGLER.x + 40, ANGLER.y - 60, 'bobber').setDepth(6).setVisible(false);
    this.shadow = this.add.image(0, 0, 'fish_dock_perch').setDepth(4).setTint(0x000000).setAlpha(0.35).setVisible(false);

    // bottom controls
    this.hint = text(this, W / 2, WATER_BOTTOM + 36, '', 18, { bold: true, wrap: W - 40 });
    this.baitBtn = button(this, W / 2, H - BOTTOM - 36, W - 24, 48, '', () => this.cycleBait(), { size: 15, fill: C.panel });
    this.reelInBtn = button(this, W - 60, WATER_TOP + 22, 96, 34, 'Reel in', () => this.cancelWait(), { size: 14, fill: C.panel }).setVisible(false);
    this.refreshBaitBtn();

    // power bar
    this.powerBar = this.add.rectangle(W / 2, WATER_BOTTOM + 76, W - 60, 18, 0x000000, 0.6).setVisible(false);
    this.powerFill = this.add.rectangle(30, WATER_BOTTOM + 76, 0, 14, C.accent).setOrigin(0, 0.5).setVisible(false);

    // fight UI
    this.fightUi = this.add.container(0, 0).setVisible(false).setDepth(20);
    this.tensionBar = this.add.rectangle(W / 2, WATER_TOP + 24, W - 48, 26, 0x000000, 0.65);
    this.tensionFill = this.add.rectangle(24, WATER_TOP + 24, 0, 20, C.good).setOrigin(0, 0.5);
    const dangerZone = this.add.rectangle(24 + (W - 48) * 0.8, WATER_TOP + 24, (W - 48) * 0.2, 20, C.danger, 0.35).setOrigin(0, 0.5);
    this.tensionLabel = text(this, W / 2, WATER_TOP + 24, 'TENSION', 12, { bold: true, stroke: true });
    const distBar = this.add.rectangle(W / 2, WATER_TOP + 52, W - 48, 12, 0x000000, 0.5);
    this.distFill = this.add.rectangle(24, WATER_TOP + 52, 0, 8, 0xffffff, 0.8).setOrigin(0, 0.5);
    this.distLabel = text(this, W / 2, WATER_TOP + 70, '', 12, { color: C.text, stroke: true });
    this.fightUi.add([this.tensionBar, this.tensionFill, dangerZone, this.tensionLabel, distBar, this.distFill, this.distLabel]);

    // input: the water zone starts actions, the global pointerup ends holds
    const zone = this.add.zone(0, TOP + 44, W, WATER_BOTTOM + 60 - (TOP + 44)).setOrigin(0, 0).setInteractive();
    zone.on('pointerdown', () => this.press());
    this.input.on('pointerup', () => this.release());
    this.spaceKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.input.keyboard?.on('keydown-SPACE', (e: KeyboardEvent) => { e.preventDefault(); if (!e.repeat) this.press(); });
    this.input.keyboard?.on('keyup-SPACE', () => this.release());
    this.input.keyboard?.on('keydown-ESC', () => this.leave());

    this.setHint('HOLD the water to cast. Longer hold = farther.');
    this.events.once('shutdown', () => {
      this.input.keyboard?.removeAllListeners();
    });
  }

  // ---------- helpers ----------

  private setHint(s: string, color = C.text): void {
    this.hint.setText(s).setColor(color);
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
    const isLure = data.gear.lures.some((l) => l.id === player.equipped);
    this.baitBtn.setText(`On the hook: ${itemName(data, player.equipped)}${isLure ? ' (lure)' : ` ×${n}`}   ▸ tap to change`);
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
    const next = options[(i + 1) % options.length];
    equip(data, player, next.id);
    S().save();
    this.refreshBaitBtn();
  }

  // ---------- input ----------

  private press(): void {
    switch (this.phase) {
      case 'idle':
        this.startCharge();
        break;
      case 'waiting':
        this.tryHook();
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
    this.powerBar.setVisible(true);
    this.powerFill.setVisible(true);
    this.setHint('Building power... release to cast');
  }

  private castNow(): void {
    const { data, player } = S();
    const r = beginCast(data, player);
    if (!r.ok) {
      toast(this, r.reason, C.dangerCss);
      this.phase = 'idle';
      this.powerBar.setVisible(false);
      this.powerFill.setVisible(false);
      return;
    }
    S().save();
    this.refreshBaitBtn();
    this.phase = 'flying';
    this.powerBar.setVisible(false);
    this.powerFill.setVisible(false);
    const zoneName = zoneForPower(this.power, data.config.cast.zones);
    // farther casts land higher (deeper water) and to the right
    const tx = ANGLER.x + 70 + this.power * (W - 150);
    const ty = WATER_BOTTOM - 50 - this.power * (WATER_BOTTOM - WATER_TOP - 90);
    this.landing.set(tx, ty);
    this.bobber.setPosition(ANGLER.x + 40, ANGLER.y - 70).setVisible(true).setScale(1);
    this.setHint(`Cast to ${zoneName} water...`);
    this.tweens.add({
      targets: this.bobber,
      x: tx,
      y: ty,
      duration: data.config.cast.flightSeconds * 1000,
      ease: 'Quad.easeOut',
      onComplete: () => this.startWaiting(zoneName),
    });
  }

  private startWaiting(zone: 'shallow' | 'mid' | 'deep'): void {
    const { data, player } = S();
    this.phase = 'waiting';
    this.waitT = 0;
    this.nibbleIdx = 0;
    this.dipped = false;
    this.splash(this.landing.x, this.landing.y);
    const time = timeOfDay(data, player);
    const cands = candidates(data.fish, this.spot.id, zone, time, player.equipped, player.log);
    this.hookedFish = pickFish(cands, data.config.rarityWeight, randomRng);
    this.bite = planBite(data.config.bite, this.spot, randomRng);
    if (!this.hookedFish) this.bite = { waitSeconds: 0, nibbleTimes: [], dipAt: Number.POSITIVE_INFINITY };
    this.setHint('Watch the bobber. TAP when it dips!');
    this.reelInBtn.setVisible(true);
  }

  private cancelWait(): void {
    if (this.phase !== 'waiting') return;
    this.reelInBtn.setVisible(false);
    this.bobber.setVisible(false);
    this.phase = 'idle';
    this.setHint('Reeled in. HOLD to cast again.');
  }

  private tryHook(): void {
    const { data } = S();
    const r = hookResult(this.waitT, this.bite.dipAt, data.config.bite.hookWindowSeconds);
    if (r === 'hooked' && this.hookedFish) {
      this.startFight(this.hookedFish);
      return;
    }
    if (r === 'early') {
      if (!data.config.bite.earlyTapSpooks && this.hookedFish) return;
      this.loseFish(this.hookedFish ? 'Too early! You spooked it.' : 'Nothing there yet... and now it is gone.');
      return;
    }
    this.loseFish('Too late! It spat the hook.');
  }

  // ---------- fight ----------

  private startFight(fish: Fish): void {
    const { data, player } = S();
    this.phase = 'fight';
    this.reelInBtn.setVisible(false);
    this.holding = true;
    this.cameras.main.shake(120, 0.004);
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
    this.fightUi.setVisible(true);
    this.shadow.setTexture(`fish_${fish.id}`).setVisible(true).setScale(0.6 + 0.5 * (fish.sizeCm.max / 190)).setTint(0x000000).setAlpha(0.35);
    this.bobber.setVisible(false);
    this.setHint(fish.boss ? 'Something enormous is on! HOLD to reel, release when it runs.' : 'HOOKED! HOLD to reel. Release when it runs.', C.accentCss);
    this.flash('HOOKED!', C.accentCss, 44);
  }

  private updateFight(dt: number): void {
    const reeling = this.holding || !!this.spaceKey?.isDown;
    stepFight(this.fight, this.fightParams, dt, reeling);
    for (const e of this.fight.events) {
      if (e.type === 'run') this.flash('It runs! Let go!', '#9fd3e6', 26);
      if (e.type === 'tired') this.flash('It is tiring...', C.goodCss, 24);
      if (e.type === 'phase') {
        this.flash(e.label, RARITY_CSS.rare, 32);
        this.cameras.main.shake(250, 0.008);
      }
    }
    const f = this.fight;
    const frac = Phaser.Math.Clamp(f.tension / this.fightParams.lineCap, 0, 1);
    this.tensionFill.width = (W - 48) * frac;
    this.tensionFill.setFillStyle(frac > 0.8 ? C.danger : frac > 0.55 ? C.accent : C.good);
    this.tensionLabel.setText(f.running ? 'RUNNING – release!' : frac > 0.8 ? 'DANGER' : frac < 0.1 ? 'SLACK!' : reeling ? 'REELING' : 'LINE OUT');
    const dfrac = Phaser.Math.Clamp(1 - f.lineOut / f.startLineOut, 0, 1);
    this.distFill.width = (W - 48) * dfrac;
    this.distLabel.setText(`${Math.max(0, f.lineOut).toFixed(0)} m out · stamina ${(f.stamina * 100).toFixed(0)}%`);
    // shadow moves from the landing point toward the angler as line comes in
    const t = Phaser.Math.Clamp(f.lineOut / f.startLineOut, 0, 1.5);
    this.shadow.setPosition(Phaser.Math.Linear(ANGLER.x + 60, this.landing.x, t), Phaser.Math.Linear(ANGLER.y - 40, this.landing.y, t));
    this.shadow.setFlipX(!f.running);
    this.drawLine(this.shadow.x, this.shadow.y, frac);

    if (this.predatorPending && f.stamina < S().data.config.predator.triggerStaminaBelow && f.outcome === 'fighting') {
      this.predatorPending = false;
      this.startPredator();
      return;
    }
    if (f.outcome === 'landed') this.land();
    else if (f.outcome === 'snapped') this.loseFish('SNAP! The line broke.', true);
    else if (f.outcome === 'escaped') this.loseFish('The line went slack. It slipped the hook.');
  }

  private drawLine(x: number, y: number, tension: number): void {
    this.line.clear();
    const color = tension > 0.8 ? C.danger : C.line;
    this.line.lineStyle(2, color, 0.9);
    const tipX = ANGLER.x + 52;
    const tipY = ANGLER.y - 102;
    const sag = (1 - tension) * 40;
    this.line.beginPath();
    this.line.moveTo(tipX, tipY);
    this.line.lineTo((tipX + x) / 2, (tipY + y) / 2 + sag);
    this.line.lineTo(x, y);
    this.line.strokePath();
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
    const bar = this.add.rectangle(W / 2, WATER_TOP + 320, W - 80, 16, C.danger).setOrigin(0.5, 0.5);
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

  private loseFish(reason: string, snap = false): void {
    const { player } = S();
    if (this.phase === 'fight' || this.phase === 'predator' || (this.phase === 'waiting' && this.hookedFish)) recordLoss(player);
    S().save();
    this.phase = 'result';
    this.reelInBtn.setVisible(false);
    this.fightUi.setVisible(false);
    this.shadow.setVisible(false);
    this.bobber.setVisible(false);
    this.line.clear();
    if (snap) this.cameras.main.shake(300, 0.012);
    this.flash(reason, C.dangerCss, snap ? 40 : 28);
    this.setHint(reason, C.dangerCss);
    this.time.delayedCall(1300, () => {
      this.phase = 'idle';
      this.setHint('HOLD the water to cast again.');
      this.hudRef.refresh();
    });
  }

  private land(): void {
    const { data, player } = S();
    const fish = this.hookedFish!;
    const size = rollSizeCm(fish, randomRng);
    const result = recordCatch(data, player, fish, size, timeOfDay(data, player));
    S().save();
    this.fightUi.setVisible(false);
    this.shadow.setVisible(false);
    this.line.clear();
    this.phase = 'reveal';
    this.hudRef.refresh();
    this.setHint(`Landed a ${fish.name}!`, C.goodCss);
    this.showReveal(fish, size, result);
  }

  private dismissReveal: (() => void) | null = null;

  /** The catch card. Must read instantly with the sound off: big rarity word, big size, colour-coded frame. */
  private showReveal(fish: Fish, size: number, r: CatchResult): void {
    const { data } = S();
    const rar = fish.rarity;
    const hold = data.config.reveal[`${rar}Seconds`] * 1000;
    const c = this.add.container(0, 0).setDepth(100);
    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, rar === 'legendary' ? 0.85 : 0.6);
    c.add(dim);

    if (rar === 'rare' || rar === 'legendary') {
      this.cameras.main.flash(300, 255, 230, 150);
      this.cameras.main.shake(300, 0.01);
      for (let i = 0; i < (rar === 'legendary' ? 16 : 8); i++) {
        const ray = this.add.image(W / 2, H * 0.4, 'ray').setOrigin(0, 0.5).setTint(RARITY_HEX[rar]).setAlpha(0.18).setAngle((360 / (rar === 'legendary' ? 16 : 8)) * i);
        c.add(ray);
        this.tweens.add({ targets: ray, angle: ray.angle + 40, duration: 6000, repeat: -1 });
      }
    }
    const card = this.add.rectangle(W / 2, H * 0.42, W - 40, 330, C.panel).setStrokeStyle(rar === 'common' ? 2 : 6, RARITY_HEX[rar]);
    c.add(card);
    const img = this.add.image(W / 2, H * 0.42 - 70, `fish_${fish.id}`).setScale(1.6 + 1.2 * (size / 190));
    c.add(img);
    this.tweens.add({ targets: img, scale: img.scale * 1.06, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    const rarityWord = rar === 'legendary' ? 'LEGENDARY' : rar.toUpperCase();
    const rt = text(this, W / 2, H * 0.42 - 150, rarityWord, rar === 'legendary' ? 44 : rar === 'rare' ? 34 : 20, { bold: true, color: RARITY_CSS[rar], stroke: true });
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
      const legendT = text(this, W / 2, H * 0.42 + 270, 'You caught the one from the logbook.', 18, { color: RARITY_CSS.legendary, bold: true, wrap: W - 60 });
      c.add(legendT);
      const emitter = this.add.particles(0, 0, 'spark', {
        x: { min: 0, max: W },
        y: -10,
        lifespan: 3500,
        speedY: { min: 60, max: 160 },
        speedX: { min: -30, max: 30 },
        scale: { start: 0.9, end: 0.2 },
        tint: [0xff6ad5, 0xf2b63c, 0x6fd38a, 0xffffff],
        quantity: 2,
        frequency: 60,
      });
      emitter.setDepth(101);
      c.add(emitter);
    } else if (rar !== 'common') {
      const burst = this.add.particles(W / 2, H * 0.42 - 70, 'spark', {
        speed: { min: 80, max: 260 },
        lifespan: 900,
        scale: { start: 0.8, end: 0 },
        tint: RARITY_HEX[rar],
        emitting: false,
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
      this.setHint(rar === 'legendary' ? 'Fifty years. Nobody. Until you. (Keep fishing, or visit the shop.)' : 'HOLD the water to cast again.');
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
    const ring = this.add.ellipse(x, y + 8, 20, 8).setStrokeStyle(2, 0xffffff, 0.8).setDepth(5);
    this.tweens.add({ targets: ring, scaleX: 3.5, scaleY: 3, alpha: 0, duration: 700, onComplete: () => ring.destroy() });
  }

  private nibble(strength: number): void {
    this.tweens.add({ targets: this.bobber, y: this.landing.y + 6 * strength, duration: 90, yoyo: true, repeat: 1 });
    const ring = this.add.ellipse(this.landing.x, this.landing.y + 8, 16, 6).setStrokeStyle(1.5, 0xffffff, 0.6).setDepth(5);
    this.tweens.add({ targets: ring, scaleX: 2.5, scaleY: 2, alpha: 0, duration: 500, onComplete: () => ring.destroy() });
  }

  // ---------- loop ----------

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.05, deltaMs / 1000);
    S().player.stats.playSeconds += dt;
    const { data } = S();
    switch (this.phase) {
      case 'charging': {
        this.charge += dt;
        this.power = Phaser.Math.Clamp(this.charge / data.config.cast.chargeSeconds, 0, 1);
        this.powerFill.width = (W - 60) * this.power;
        const zoneName = zoneForPower(this.power, data.config.cast.zones);
        this.powerFill.setFillStyle(zoneName === 'deep' ? 0x6f8fc9 : zoneName === 'mid' ? C.accent : C.good);
        this.setHint(`Power: ${zoneName.toUpperCase()} water — release to cast`);
        break;
      }
      case 'waiting': {
        this.waitT += dt;
        if (!this.hookedFish) {
          if (this.waitT >= data.config.bite.nothingBitingSeconds) {
            this.reelInBtn.setVisible(false);
            this.bobber.setVisible(false);
            this.phase = 'idle';
            toast(this, 'Nothing is biting on this here, now. Try another bait, depth or time.', C.muted);
            this.setHint('HOLD the water to cast again.');
          }
          break;
        }
        if (this.nibbleIdx < this.bite.nibbleTimes.length && this.waitT >= this.bite.nibbleTimes[this.nibbleIdx]) {
          this.nibbleIdx++;
          this.nibble(1);
        }
        if (!this.dipped && this.waitT >= this.bite.dipAt) {
          this.dipped = true;
          this.bobber.setY(this.landing.y + 14).setTint(0xffd27f);
          this.splash(this.landing.x, this.landing.y);
          this.setHint('TAP NOW!', C.accentCss);
        }
        if (this.dipped && this.waitT > this.bite.dipAt + data.config.bite.hookWindowSeconds) {
          this.bobber.clearTint();
          this.loseFish('Too slow. It took the bait and left.');
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
  const isLure = data.gear.lures.some((l) => l.id === player.equipped);
  if (!isLure && (player.inventory[player.equipped] ?? 0) <= 0) return { ok: false, reason: `Out of ${itemName(data, player.equipped)}. Tap the hook to change bait.` };
  return { ok: true };
}
