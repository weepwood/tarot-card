/**
 * 由当前可见项目素材扫描结果建立的集中映射。
 * 当前目录只确认到一套完整正面 PBR 贴图，因此四个牌位复用同一套贴图。
 * 路径全部对应项目中真实存在的文件，不在运行时猜测文件名。
 */
const CONFIRMED_FRONT = Object.freeze({
  sourceId: 'odette-confirmed-set',
  title: '奥黛塔',
  clean: './assets/1.png',
  normal: './assets/2.png',
  roughness: './assets/3.png',
  height: './assets/4.png',
});

export const ASSET_CONFIG = Object.freeze({
  cards: Object.freeze([
    Object.freeze({ ...CONFIRMED_FRONT, id: 'card-1', title: '奥黛塔 · 一' }),
    Object.freeze({ ...CONFIRMED_FRONT, id: 'card-2', title: '奥黛塔 · 二' }),
    Object.freeze({ ...CONFIRMED_FRONT, id: 'card-3', title: '奥黛塔 · 三' }),
    Object.freeze({ ...CONFIRMED_FRONT, id: 'card-4', title: '奥黛塔 · 四' }),
  ]),
  back: Object.freeze({
    // 没有扫描到可确认用途的独立卡背，因此仅使用现有法线图作为卡背颜色图。
    clean: './assets/2.png',
    normal: null,
    roughness: null,
    height: null,
  }),
  background: './assets/1.png',
});

export const CARD_WIDTH_CSS = 240;
