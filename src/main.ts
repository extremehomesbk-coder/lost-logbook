import Phaser from 'phaser';
import { BoardScene } from './scenes/BoardScene';
import { BootScene } from './scenes/BootScene';
import { ErrorScene } from './scenes/ErrorScene';
import { FishingScene } from './scenes/FishingScene';
import { LogScene } from './scenes/LogScene';
import { MapScene } from './scenes/MapScene';
import { SettingsScene } from './scenes/SettingsScene';
import { ShopScene } from './scenes/ShopScene';
import { TitleScene } from './scenes/TitleScene';
import { C, H, W } from './game/ui';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: C.bg,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: W,
    height: H,
  },
  render: { antialias: true, roundPixels: false },
  input: { activePointers: 2 },
  // dev only: keep the loop ticking in a hidden tab so the preview pane and harness can drive it
  fps: import.meta.env.DEV ? { forceSetTimeOut: true, target: 60 } : undefined,
  scene: [BootScene, ErrorScene, TitleScene, MapScene, FishingScene, ShopScene, LogScene, BoardScene, SettingsScene],
});

// Dev-only handle so the game loop can be driven from the console or a test harness.
if (import.meta.env.DEV) (window as unknown as { __game?: Phaser.Game }).__game = game;
