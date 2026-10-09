import Phaser from 'phaser';
import { S } from '../game/session';
import { BOTTOM, C, H, ScrollList, TOP, W, backButton, button, hud, panel, text, toast } from '../game/ui';
import { landability, landabilityLabel } from '../sim/fight';
import { buy, lineCapOf, rodOf, sellAll, shopItems } from '../sim/state';

export class ShopScene extends Phaser.Scene {
  constructor() {
    super('Shop');
  }

  create(): void {
    const { data, player } = S();
    panel(this, 0, 0, W, H, C.bg);
    const h = hud(this, 'Bait & Tackle');
    backButton(this);

    const creelValue = player.creel.reduce((a, c) => a + c.value, 0);
    const sell = button(this, W / 2, TOP + 78, W - 24, 52, player.creel.length ? `Sell ${player.creel.length} fish for ◉ ${creelValue}` : 'Creel is empty', () => {
      const got = sellAll(player);
      S().save();
      toast(this, `+${got} coins`, C.accentCss);
      this.scene.restart();
    }, { fill: C.accent, color: '#1a1200', size: 18, disabled: player.creel.length === 0 });
    sell.setDepth(5);

    const listTop = TOP + 116;
    const list = new ScrollList(this, 0, listTop, W, H - listTop - BOTTOM);
    const rowH = 74;
    let y = 0;
    const section = (label: string) => {
      list.add(text(this, 16, y + 14, label, 13, { color: C.muted, bold: true, origin: [0, 0.5] }));
      y += 28;
    };
    const items = shopItems(data, player);
    const groups: [string, typeof items][] = [
      ['RODS (reel speed, pull)', items.filter((i) => i.kind === 'rod')],
      ['LINES (tension cap)', items.filter((i) => i.kind === 'line')],
      ['BAIT (one per cast)', items.filter((i) => i.kind === 'bait')],
      ['LURES (never run out)', items.filter((i) => i.kind === 'lure')],
    ];
    const legend = data.fish.find((f) => f.rarity === 'legendary')!;
    for (const [label, group] of groups) {
      if (group.length === 0) continue;
      section(label);
      for (const it of group) {
        const row = this.add.rectangle(12, y, W - 24, rowH - 6, C.panel).setOrigin(0, 0);
        list.add(row);
        const owned = it.kind !== 'bait' && it.owned;
        const name = it.kind === 'bait' ? `${it.name} ×${it.pack}  (have ${it.have})` : it.name;
        list.add(text(this, 24, y + 16, name, 16, { bold: true, origin: [0, 0.5] }));
        let blurb = it.blurb;
        if (it.kind === 'rod' || it.kind === 'line') {
          const rod = it.kind === 'rod' ? data.gear.rods.find((r) => r.id === it.id)! : rodOf(data, player);
          const cap = it.kind === 'line' ? data.config.fight.lineCaps[String(data.gear.lines.find((l) => l.id === it.id)!.tier)] : lineCapOf(data, player);
          blurb += ` Legend: ${landabilityLabel(landability(data.config.fight, legend.fight, rod.strength, cap))}.`;
        }
        list.add(text(this, 24, y + 42, blurb, 12, { color: C.muted, origin: [0, 0.5], wrap: W - 150, align: 'left' }));
        const canAfford = player.coins >= it.price;
        const b = button(this, W - 64, y + (rowH - 6) / 2, 84, 40, owned ? 'Owned' : `◉ ${it.price}`, () => {
          const r = buy(data, player, it.id);
          if (!r.ok) {
            toast(this, r.reason, C.dangerCss);
            return;
          }
          S().save();
          h.refresh();
          toast(this, `Bought ${it.name}`, C.goodCss);
          this.scene.restart();
        }, { size: 15, fill: owned ? C.panelDark : canAfford ? C.good : C.panelLight, hitFilter: list.hit, disabled: owned || !canAfford });
        list.add(b);
        y += rowH;
      }
    }
    list.contentHeight = y + 10;
  }
}
