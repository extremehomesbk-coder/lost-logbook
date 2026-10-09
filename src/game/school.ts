/**
 * Top-down fish AI for the casting screen: visible fish wander in their depth band, notice bait in range, approach,
 * circle the float (nibbles), then bite; fish that do not take the bait inspect it and turn away. Lures are chased
 * while they move. One fish engages the bait at a time. Rendering is a tinted outline sprite per actor.
 */
import Phaser from 'phaser';
import type { Fish, GameConfig, Zone } from '../data/schema';
import { between, weightedIndex, type Rng } from '../sim/rng';

export type ActorState = 'wander' | 'approach' | 'circle' | 'inspect' | 'leave' | 'bite' | 'chase';

export interface Bait {
  x: number;
  y: number;
  /** true while a lure is being retrieved (moving) */
  moving: boolean;
  isLure: boolean;
}

export type SchoolEvent =
  | { type: 'nibble'; actor: FishActor }
  | { type: 'bite'; actor: FishActor }
  | { type: 'inspect'; actor: FishActor }
  | { type: 'spooked'; actor: FishActor };

export interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export class FishActor {
  state: ActorState = 'wander';
  x: number;
  y: number;
  tx: number;
  ty: number;
  t = 0;
  angle = 0;
  nibblesLeft = 0;
  nextNibbleIn = 0;
  readonly sprite: Phaser.GameObjects.Image;

  constructor(scene: Phaser.Scene, readonly fish: Fish, readonly eligible: boolean, readonly band: { top: number; bottom: number }, x: number, y: number) {
    this.x = x;
    this.y = y;
    this.tx = x;
    this.ty = y;
    const size = 0.55 + 0.75 * Math.min(1, fish.sizeCm.max / 190);
    this.sprite = scene.add.image(x, y, `fishtop_${fish.id}`).setScale(size).setAlpha(0.75).setDepth(3);
    if (fish.rarity === 'legendary') this.sprite.setTint(0xffffff).setAlpha(0.9);
    else if (fish.rarity === 'rare') this.sprite.setTint(0xffd27f);
    else if (!eligible) this.sprite.setTint(0xb0c4cc).setAlpha(0.55);
  }

  destroy(): void {
    this.sprite.destroy();
  }
}

export class School {
  readonly actors: FishActor[] = [];
  private engaged: FishActor | null = null;
  private respawnIn = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly cfg: GameConfig['school'],
    private readonly bounds: Bounds,
    private readonly bands: Record<Zone, { top: number; bottom: number }>,
    private readonly pools: { eligible: Record<Zone, Fish[]>; others: Record<Zone, Fish[]> },
    private readonly weights: GameConfig['rarityWeight'],
    private readonly rng: Rng,
  ) {
    for (let i = 0; i < cfg.count; i++) this.spawn(true);
  }

  /** The fish currently on the bait (biting) or null. */
  get biting(): FishActor | null {
    return this.engaged && this.engaged.state === 'bite' ? this.engaged : null;
  }

  get anyEligible(): boolean {
    return this.actors.some((a) => a.eligible);
  }

  private spawn(anywhere: boolean): void {
    const zones: Zone[] = ['shallow', 'mid', 'deep'];
    const zone = zones[Math.floor(this.rng() * 3)];
    const wantEligible = this.rng() < this.cfg.eligibleSpawnChance;
    let pool = wantEligible ? this.pools.eligible[zone] : this.pools.others[zone];
    let eligible = wantEligible;
    if (pool.length === 0) {
      pool = wantEligible ? this.pools.others[zone] : this.pools.eligible[zone];
      eligible = !wantEligible;
    }
    if (pool.length === 0) return;
    const i = weightedIndex(this.rng, pool.map((f) => this.weights[f.rarity]));
    const fish = pool[Math.max(0, i)];
    const band = this.bands[zone];
    const y = between(this.rng, band.top, band.bottom);
    const fromLeft = this.rng() < 0.5;
    const x = anywhere ? between(this.rng, this.bounds.left, this.bounds.right) : fromLeft ? this.bounds.left - 40 : this.bounds.right + 40;
    const a = new FishActor(this.scene, fish, eligible, band, x, y);
    this.pickTarget(a);
    this.actors.push(a);
  }

  private pickTarget(a: FishActor): void {
    a.tx = between(this.rng, this.bounds.left + 20, this.bounds.right - 20);
    a.ty = between(this.rng, a.band.top, a.band.bottom);
  }

  private remove(a: FishActor): void {
    a.destroy();
    const i = this.actors.indexOf(a);
    if (i >= 0) this.actors.splice(i, 1);
    if (this.engaged === a) this.engaged = null;
    this.respawnIn = between(this.rng, this.cfg.respawn.min, this.cfg.respawn.max);
  }

  /** Scare the engaged fish (and anything near the bait) away. */
  spook(bait: Bait | null): void {
    for (const a of this.actors) {
      const near = bait ? Phaser.Math.Distance.Between(a.x, a.y, bait.x, bait.y) < this.cfg.spookRadius : false;
      if (a === this.engaged || near) {
        a.state = 'leave';
        a.t = 0;
        a.tx = a.x < (this.bounds.left + this.bounds.right) / 2 ? this.bounds.left - 80 : this.bounds.right + 80;
        a.ty = a.y;
      }
    }
    this.engaged = null;
  }

  /** The engaged fish was hooked: remove it from the water. */
  takeEngaged(): FishActor | null {
    const a = this.engaged;
    if (a) this.remove(a);
    return a;
  }

  /** Begin the bite plan for an interested fish: how many circles (nibbles) before it commits. */
  private startCircle(a: FishActor, nibbles: number, gap: number): void {
    a.state = 'circle';
    a.t = 0;
    a.nibblesLeft = nibbles;
    a.nextNibbleIn = gap;
    a.angle = Math.atan2(a.y - this.lastBait!.y, a.x - this.lastBait!.x);
  }

  private lastBait: Bait | null = null;

  update(dt: number, bait: Bait | null, plan: { nibbles: number; gap: number }): SchoolEvent[] {
    const events: SchoolEvent[] = [];
    this.lastBait = bait;
    const cfg = this.cfg;
    if (this.actors.length < cfg.count) {
      this.respawnIn -= dt;
      if (this.respawnIn <= 0) this.spawn(false);
    }
    for (const a of [...this.actors]) {
      a.t += dt;
      const d = bait ? Phaser.Math.Distance.Between(a.x, a.y, bait.x, bait.y) : Infinity;
      switch (a.state) {
        case 'wander': {
          const speed = between(this.rng, cfg.wanderSpeed.min, cfg.wanderSpeed.max);
          if (this.moveToward(a, a.tx, a.ty, speed, dt)) this.pickTarget(a);
          if (bait && !this.engaged) {
            if (bait.isLure && a.eligible && bait.moving && d < cfg.lure.chaseRadius) {
              a.state = 'chase';
              this.engaged = a;
            } else if (!bait.isLure && d < cfg.senseRadius) {
              a.state = 'approach';
              a.t = 0;
              this.engaged = a;
            } else if (bait.isLure && !a.eligible && d < cfg.senseRadius * 0.6 && this.rng() < 0.3 * dt) {
              a.state = 'approach';
              a.t = 0;
              this.engaged = a;
            }
          }
          break;
        }
        case 'approach': {
          if (!bait) { a.state = 'wander'; this.engaged = null; break; }
          const ang = Math.atan2(a.y - bait.y, a.x - bait.x);
          const gx = bait.x + Math.cos(ang) * cfg.circleRadius;
          const gy = bait.y + Math.sin(ang) * cfg.circleRadius;
          if (this.moveToward(a, gx, gy, cfg.approachSpeed, dt) || a.t > 4) {
            if (a.eligible) this.startCircle(a, plan.nibbles, plan.gap);
            else {
              a.state = 'inspect';
              a.t = 0;
              events.push({ type: 'inspect', actor: a });
            }
          }
          break;
        }
        case 'circle': {
          if (!bait) { a.state = 'wander'; this.engaged = null; break; }
          a.angle += cfg.circleSpeed * dt;
          a.x = bait.x + Math.cos(a.angle) * cfg.circleRadius;
          a.y = bait.y + Math.sin(a.angle) * cfg.circleRadius;
          a.sprite.setRotation(a.angle + Math.PI / 2);
          a.nextNibbleIn -= dt;
          if (a.nextNibbleIn <= 0) {
            if (a.nibblesLeft > 0) {
              a.nibblesLeft--;
              a.nextNibbleIn = plan.gap;
              events.push({ type: 'nibble', actor: a });
            } else {
              a.state = 'bite';
              a.t = 0;
              a.sprite.setRotation(0);
              events.push({ type: 'bite', actor: a });
            }
          }
          break;
        }
        case 'bite': {
          if (bait) {
            a.x = bait.x;
            a.y = bait.y + 6;
          }
          break;
        }
        case 'chase': {
          if (!bait || !bait.isLure) { a.state = 'wander'; this.engaged = null; break; }
          this.moveToward(a, bait.x, bait.y + 4, cfg.approachSpeed * 1.2, dt);
          if (d < cfg.lure.strikeRadius && (bait.moving || a.t < 0.5) && this.rng() < cfg.lure.strikePerSecond * dt) {
            a.state = 'bite';
            a.t = 0;
            events.push({ type: 'bite', actor: a });
          } else if (!bait.moving && a.t > 2.5) {
            a.state = 'leave';
            a.t = 0;
            a.tx = a.x + (this.rng() < 0.5 ? -200 : 200);
            a.ty = a.y;
          }
          if (bait.moving) a.t = 0;
          break;
        }
        case 'inspect': {
          if (a.t > cfg.inspectSeconds) {
            a.state = 'leave';
            a.t = 0;
            a.tx = a.x + (this.rng() < 0.5 ? -220 : 220);
            a.ty = Phaser.Math.Clamp(a.y + between(this.rng, -60, 60), a.band.top, a.band.bottom);
            this.engaged = null;
          }
          break;
        }
        case 'leave': {
          const done = this.moveToward(a, a.tx, a.ty, cfg.approachSpeed * 1.6, dt);
          const offscreen = a.x < this.bounds.left - 60 || a.x > this.bounds.right + 60;
          if (offscreen) this.remove(a);
          else if (done) {
            a.state = 'wander';
            this.pickTarget(a);
          }
          break;
        }
      }
      this.render(a);
    }
    return events;
  }

  private moveToward(a: FishActor, tx: number, ty: number, speed: number, dt: number): boolean {
    const dx = tx - a.x;
    const dy = ty - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) return true;
    const step = Math.min(dist, speed * dt);
    a.x += (dx / dist) * step;
    a.y += (dy / dist) * step;
    if (a.state !== 'circle') {
      a.sprite.setRotation(0);
      a.sprite.setFlipX(dx < 0);
    }
    return dist - step < 4;
  }

  private render(a: FishActor): void {
    a.sprite.setPosition(a.x, a.y);
    // gentle tail wiggle
    if (a.state !== 'circle') a.sprite.setRotation(Math.sin(a.t * 8) * 0.06);
  }

  destroy(): void {
    for (const a of this.actors) a.destroy();
    this.actors.length = 0;
  }
}
