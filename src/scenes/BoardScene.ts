import Phaser from 'phaser';
import { S } from '../game/session';
import { BOTTOM, C, H, ScrollList, TOP, W, backButton, button, hud, panel, text, toast } from '../game/ui';
import { claimQuest, itemName, questProgress, questReady } from '../sim/state';

/** Notice board: tiny quests with progress and a Claim button. */
export class BoardScene extends Phaser.Scene {
  constructor() {
    super('Board');
  }

  create(): void {
    const { data, player } = S();
    panel(this, 0, 0, W, H, C.bg);
    const h = hud(this, 'Notice Board');
    backButton(this);

    const listTop = TOP + 60;
    const list = new ScrollList(this, 0, listTop, W, H - listTop - BOTTOM);
    const rowH = 124;
    data.quests.forEach((q, i) => {
      const y = i * rowH;
      const state = player.quests[q.id];
      const ready = questReady(data, player, q.id);
      const done = state === 'claimed';
      list.add(this.add.rectangle(12, y, W - 24, rowH - 10, done ? C.panelDark : C.panel).setOrigin(0, 0).setStrokeStyle(2, ready ? C.accent : 0x000000, ready ? 1 : 0));
      list.add(text(this, 24, y + 20, q.title, 17, { bold: true, origin: [0, 0.5], color: done ? C.muted : C.text }));
      list.add(text(this, 24, y + 50, q.text, 13, { color: C.muted, origin: [0, 0.5], wrap: W - 60, align: 'left' }));
      const rewards: string[] = [];
      if (q.reward.coins) rewards.push(`◉ ${q.reward.coins}`);
      for (const [id, n] of Object.entries(q.reward.items ?? {})) rewards.push(`${itemName(data, id)}${n > 1 ? ` ×${n}` : ''}`);
      if (q.reward.keyItem) rewards.push(itemName(data, q.reward.keyItem));
      list.add(text(this, 24, y + 86, `Reward: ${rewards.join(', ')}`, 13, { color: C.accentCss, origin: [0, 0.5] }));
      const progress = Math.min(questProgress(player, q.id), q.condition.count);
      const label = done ? 'Done' : ready ? 'Claim' : `${progress}/${q.condition.count}`;
      list.add(button(this, W - 64, y + 86, 84, 38, label, () => {
        if (!claimQuest(data, player, q.id)) return;
        S().save();
        h.refresh();
        toast(this, `Reward collected: ${rewards.join(', ')}`, C.goodCss);
        this.scene.restart();
      }, { size: 15, fill: ready ? C.accent : C.panelDark, color: ready ? '#1a1200' : C.muted, disabled: !ready, hitFilter: list.hit }));
    });
    list.contentHeight = data.quests.length * rowH + 10;
  }
}
