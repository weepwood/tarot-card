import { ASSET_CONFIG, CARD_WIDTH_CSS } from './assets.js';
import { TarotCard } from './card.js';
import { damp } from './math.js';
import { TarotRenderer } from './renderer.js';

const canvas = document.querySelector('#tarot-canvas');
const cardColumn = document.querySelector('#card-column');
const shuffleButton = document.querySelector('#shuffle-button');
const statusElement = document.querySelector('#status');
const fatalError = document.querySelector('#fatal-error');
const backgroundElement = document.querySelector('#fixed-background');
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

let renderer = null;
let cards = [];
let backMaterial = null;
let materialSets = [];
let definitions = [...ASSET_CONFIG.cards];
let disposed = false;
let layoutDirty = true;
let sizeDirty = true;
let isShuffling = false;
let previousTime = performance.now();
let keyboardFlashTimer = 0;

const pointer = {
  active: false,
  x: window.innerWidth * 0.5,
  y: window.innerHeight * 0.35,
  type: 'mouse',
};

const lightTarget = new Float32Array([0, 70, 300]);
const lightCurrent = new Float32Array([0, 70, 300]);
const pointerGestures = new Map();

function setStatus(message) {
  statusElement.textContent = message;
}

function showFatal(message, error = null) {
  console.error(message, error || '');
  fatalError.hidden = false;
  fatalError.textContent = message;
  canvas.hidden = true;
  setStatus('页面已进入安全降级状态');
}

function preloadBackground(path) {
  const image = new Image();
  image.onload = () => {
    backgroundElement.style.backgroundImage = `url("${path}")`;
  };
  image.onerror = () => {
    console.error(`[背景图加载失败] 实际路径=${path}。保留纯色固定背景。`);
  };
  image.src = path;
}

function createCardSlots() {
  return ASSET_CONFIG.cards.map((definition, index) => {
    const button = document.createElement('button');
    button.className = 'card-slot';
    button.type = 'button';
    button.dataset.number = String(index + 1);
    button.setAttribute('aria-label', `第 ${index + 1} 张牌，纹理正在载入`);

    button.addEventListener('pointerdown', (event) => {
      pointerGestures.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
        scrollY: window.scrollY,
        moved: false,
        pointerType: event.pointerType,
      });
    }, { passive: true });

    button.addEventListener('pointermove', (event) => {
      const gesture = pointerGestures.get(event.pointerId);
      if (!gesture) return;
      const movement = Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y);
      const scrollMovement = Math.abs(window.scrollY - gesture.scrollY);
      if (movement > 9 || scrollMovement > 5) gesture.moved = true;
    }, { passive: true });

    button.addEventListener('pointerup', (event) => {
      const gesture = pointerGestures.get(event.pointerId);
      pointerGestures.delete(event.pointerId);
      if (!gesture || gesture.moved || isShuffling) return;
      cards[index]?.toggleFlip();
      setStatus(`已操作第 ${index + 1} 张牌`);
    }, { passive: true });

    button.addEventListener('pointercancel', (event) => {
      pointerGestures.delete(event.pointerId);
    }, { passive: true });

    // detail===0 表示由键盘等非指针方式触发，避免和 pointerup 重复翻牌。
    button.addEventListener('click', (event) => {
      if (event.detail !== 0 || isShuffling) return;
      cards[index]?.toggleFlip();
      setStatus(`已操作第 ${index + 1} 张牌`);
    });

    return { button, definition };
  });
}

async function waitUntil(predicate, timeoutMs) {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeoutMs) return false;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  return true;
}

function fisherYates(values) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

function shuffleToDifferentOrder(values) {
  if (values.length < 2) return [...values];
  const originalIds = values.map((entry) => entry.definition.id).join('|');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const shuffled = fisherYates(values);
    const shuffledIds = shuffled.map((entry) => entry.definition.id).join('|');
    if (shuffledIds !== originalIds) return shuffled;
  }
  return [...values.slice(1), values[0]];
}

async function reshuffle() {
  if (isShuffling || !cards.length) return;
  isShuffling = true;
  shuffleButton.disabled = true;
  setStatus('正在收拢牌面…');

  cards.forEach((card, index) => {
    card.showBack();
    card.shuffleOffsetTargetY = (index - 1.5) * (reducedMotionQuery.matches ? 1 : 7);
    card.shuffleRotationTarget = (index % 2 === 0 ? -1 : 1) * (reducedMotionQuery.matches ? 0 : 0.018);
  });

  await waitUntil(() => cards.every((card) => card.isAtBack()), reducedMotionQuery.matches ? 380 : 1200);
  cards.forEach((card) => { card.opacityTarget = reducedMotionQuery.matches ? 1 : 0.72; });
  await new Promise((resolve) => setTimeout(resolve, reducedMotionQuery.matches ? 20 : 130));

  const order = shuffleToDifferentOrder(definitions.map((definition, index) => ({
    definition,
    materialSet: materialSets[index],
  })));
  definitions = order.map((entry) => entry.definition);
  materialSets = order.map((entry) => entry.materialSet);
  cards.forEach((card, index) => card.setMaterialSet(materialSets[index], definitions[index]));

  setStatus('牌序已重新随机排列');
  cards.forEach((card) => {
    card.opacityTarget = 1;
    card.shuffleOffsetTargetY = 0;
    card.shuffleRotationTarget = 0;
  });
  await new Promise((resolve) => setTimeout(resolve, reducedMotionQuery.matches ? 30 : 360));
  shuffleButton.disabled = false;
  isShuffling = false;
}

function updateViewport() {
  const width = document.documentElement.clientWidth || window.innerWidth;
  const height = window.innerHeight;
  if (width <= 0 || height <= 0 || !renderer) return;
  renderer.resize(width, height, window.devicePixelRatio);
  sizeDirty = false;
  layoutDirty = true;
}

function updateLayout() {
  if (!renderer) return;
  for (const card of cards) {
    card.setLayoutFromRect(
      card.element.getBoundingClientRect(),
      renderer.viewportWidth,
      renderer.viewportHeight,
    );
  }
  layoutDirty = false;
}

function updatePointerAndLight(deltaSeconds) {
  let hit = null;
  if (pointer.active && pointer.type !== 'touch') {
    hit = renderer.raycastCards(pointer.x, pointer.y);
  }
  for (const card of cards) card.setHover(null, false);
  if (hit) hit.card.setHover(hit.uv, true);

  if (pointer.active && pointer.type !== 'touch') {
    const ray = renderer.createWorldRay(pointer.x, pointer.y);
    const targetZ = 270;
    const denominator = ray.direction[2];
    const t = Math.abs(denominator) > 0.00001
      ? (targetZ - ray.origin[2]) / denominator
      : 0;
    lightTarget[0] = ray.origin[0] + ray.direction[0] * t;
    lightTarget[1] = ray.origin[1] + ray.direction[1] * t;
    lightTarget[2] = targetZ;
  } else {
    lightTarget[0] = 0;
    lightTarget[1] = 85;
    lightTarget[2] = 310;
  }

  const lambda = reducedMotionQuery.matches ? 16 : 7.5;
  for (let axis = 0; axis < 3; axis += 1) {
    lightCurrent[axis] = damp(lightCurrent[axis], lightTarget[axis], lambda, deltaSeconds);
    renderer.lightPosition[axis] = lightCurrent[axis];
  }
}

function animate(time) {
  if (disposed || !renderer) return;
  const deltaSeconds = Math.min(0.05, Math.max(0.001, (time - previousTime) / 1000));
  previousTime = time;
  if (sizeDirty) updateViewport();
  if (layoutDirty) updateLayout();
  updatePointerAndLight(deltaSeconds);
  for (const card of cards) card.update(deltaSeconds);
  renderer.render(backMaterial);
  requestAnimationFrame(animate);
}

function handleNumberKey(event) {
  const target = event.target;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable
  ) return;

  const match = /^(?:Digit|Numpad)([1-4])$/.exec(event.code);
  if (!match || isShuffling) return;
  const index = Number(match[1]) - 1;
  event.preventDefault();
  cards[index]?.toggleFlip();
  cards[index]?.element.classList.add('key-flash');
  window.clearTimeout(keyboardFlashTimer);
  keyboardFlashTimer = window.setTimeout(() => {
    cards.forEach((card) => card.element.classList.remove('key-flash'));
  }, 240);
  setStatus(`数字键 ${index + 1} 已操作对应牌位`);
}

function installGlobalEvents() {
  document.addEventListener('pointermove', (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.type = event.pointerType || 'mouse';
    pointer.active = true;
  }, { passive: true });

  document.addEventListener('pointerup', (event) => {
    // 指针在卡牌外释放时也要清理手势，避免留下陈旧状态。
    pointerGestures.delete(event.pointerId);
    if (event.pointerType === 'touch') {
      pointer.active = false;
      cards.forEach((card) => card.setHover(null, false));
    }
  }, { passive: true });

  document.addEventListener('pointercancel', (event) => {
    pointerGestures.delete(event.pointerId);
    if (event.pointerType === 'touch') pointer.active = false;
  }, { passive: true });

  window.addEventListener('mouseout', (event) => {
    if (event.relatedTarget === null) pointer.active = false;
  }, { passive: true });

  window.addEventListener('blur', () => { pointer.active = false; });
  window.addEventListener('scroll', () => { layoutDirty = true; }, { passive: true });
  window.addEventListener('resize', () => {
    sizeDirty = true;
    layoutDirty = true;
  }, { passive: true });
  window.addEventListener('orientationchange', () => {
    sizeDirty = true;
    layoutDirty = true;
  }, { passive: true });
  window.addEventListener('keydown', handleNumberKey);
  shuffleButton.addEventListener('click', reshuffle);

  reducedMotionQuery.addEventListener?.('change', (event) => {
    cards.forEach((card) => { card.reducedMotion = event.matches; });
  });

  window.addEventListener('pagehide', dispose, { once: true });
}

function dispose() {
  if (disposed) return;
  disposed = true;
  renderer?.dispose();
}

async function initialize() {
  preloadBackground(ASSET_CONFIG.background);
  const slotEntries = createCardSlots();
  const fragment = document.createDocumentFragment();
  slotEntries.forEach(({ button }) => fragment.appendChild(button));
  cardColumn.appendChild(fragment);

  try {
    renderer = new TarotRenderer(canvas);
  } catch (error) {
    showFatal(`无法初始化 WebGL：${error.message}`, error);
    return;
  }

  try {
    setStatus('正在载入正面与卡背纹理…');
    const [loadedMaterialSets, loadedBackMaterial] = await Promise.all([
      Promise.all(ASSET_CONFIG.cards.map((definition) => renderer.loadMaterialSet(definition))),
      renderer.loadBackMaterial(ASSET_CONFIG.back),
    ]);
    backMaterial = loadedBackMaterial;
    materialSets = loadedMaterialSets;

    cards = slotEntries.map(({ button, definition }, index) => {
      const sourceWidth = materialSets[index].clean.width || 750;
      const sourceHeight = materialSets[index].clean.height || 1900;
      const cardHeight = CARD_WIDTH_CSS * sourceHeight / sourceWidth;
      const card = new TarotCard({
        element: button,
        slotIndex: index,
        materialSet: materialSets[index],
        cardDefinition: definition,
        reducedMotion: reducedMotionQuery.matches,
      });
      card.setDimensions(CARD_WIDTH_CSS, cardHeight);
      button.classList.add('ready');
      card.updateAria();
      return card;
    });

    renderer.setCards(cards);
    updateViewport();
    updateLayout();
    installGlobalEvents();
    setStatus('牌面准备完成；点击卡背或按数字键 1–4');
    requestAnimationFrame(animate);
  } catch (error) {
    showFatal(`牌面初始化失败：${error.message}`, error);
  }
}

initialize();
