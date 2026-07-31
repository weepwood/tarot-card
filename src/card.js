import {
  createMat4,
  damp,
  identity,
  multiply,
  rotationX,
  rotationY,
  rotationZ,
  translation,
} from './math.js';

const PI = Math.PI;

export class TarotCard {
  constructor({ element, slotIndex, materialSet, cardDefinition, reducedMotion }) {
    this.element = element;
    this.slotIndex = slotIndex;
    this.materialSet = materialSet;
    this.cardDefinition = cardDefinition;
    this.reducedMotion = reducedMotion;

    this.width = 240;
    this.height = 608;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.visible = false;

    // 初始确定为卡背；纹理准备前 card.visible=false，避免正面闪现。
    this.flip = PI;
    this.flipTarget = PI;
    this.tiltX = 0;
    this.tiltY = 0;
    this.tiltTargetX = 0;
    this.tiltTargetY = 0;
    this.pointerUv = new Float32Array([0.5, 0.5]);
    this.pointerInfluence = 0;
    this.pointerInfluenceTarget = 0;
    this.opacity = 0;
    this.opacityTarget = 1;
    this.shuffleOffsetY = 0;
    this.shuffleOffsetTargetY = 0;
    this.shuffleRotation = 0;
    this.shuffleRotationTarget = 0;

    this.model = createMat4();
    this._tempA = createMat4();
    this._tempB = createMat4();
    this._tempC = createMat4();
    this._tempD = createMat4();
    this._tempE = createMat4();
  }

  setDimensions(width, height) {
    this.width = width;
    this.height = height;
    this.element.style.height = `${height}px`;
  }

  setMaterialSet(materialSet, definition) {
    this.materialSet = materialSet;
    this.cardDefinition = definition;
    this.element.setAttribute('aria-label', `第 ${this.slotIndex + 1} 张牌，当前为卡背，点击翻牌`);
  }

  setLayoutFromRect(rect, viewportWidth, viewportHeight) {
    this.x = rect.left + rect.width * 0.5 - viewportWidth * 0.5;
    this.y = viewportHeight * 0.5 - (rect.top + rect.height * 0.5);
    this.visible = rect.bottom > -160 && rect.top < viewportHeight + 160 && rect.width > 0 && rect.height > 0;
  }

  toggleFlip() {
    this.flipTarget = this.flipTarget > PI * 0.5 ? 0 : PI;
    this.updateAria();
  }

  showBack() {
    this.flipTarget = PI;
    this.updateAria();
  }

  updateAria() {
    const targetSide = this.flipTarget > PI * 0.5 ? '卡背' : `正面：${this.cardDefinition.title}`;
    this.element.setAttribute('aria-label', `第 ${this.slotIndex + 1} 张牌，目标为${targetSide}，点击翻牌`);
  }

  setHover(uv, active) {
    if (active && uv) {
      this.pointerUv[0] = uv[0];
      this.pointerUv[1] = uv[1];
      this.pointerInfluenceTarget = 1;
      if (!this.reducedMotion) {
        const maxTilt = 0.105;
        this.tiltTargetX = (uv[1] - 0.5) * maxTilt * 2;
        this.tiltTargetY = -(uv[0] - 0.5) * maxTilt * 2;
      }
      return;
    }
    this.pointerInfluenceTarget = 0;
    this.tiltTargetX = 0;
    this.tiltTargetY = 0;
  }

  update(deltaSeconds) {
    const motionScale = this.reducedMotion ? 3.2 : 1;
    this.flip = damp(this.flip, this.flipTarget, 10.5 * motionScale, deltaSeconds);
    this.tiltX = damp(this.tiltX, this.tiltTargetX, 11 * motionScale, deltaSeconds);
    this.tiltY = damp(this.tiltY, this.tiltTargetY, 11 * motionScale, deltaSeconds);
    this.pointerInfluence = damp(
      this.pointerInfluence,
      this.pointerInfluenceTarget,
      9 * motionScale,
      deltaSeconds,
    );
    this.opacity = damp(this.opacity, this.opacityTarget, 7 * motionScale, deltaSeconds);
    this.shuffleOffsetY = damp(this.shuffleOffsetY, this.shuffleOffsetTargetY, 9 * motionScale, deltaSeconds);
    this.shuffleRotation = damp(this.shuffleRotation, this.shuffleRotationTarget, 9 * motionScale, deltaSeconds);

    if (Math.abs(this.flip - this.flipTarget) < 0.00008) this.flip = this.flipTarget;
    if (Math.abs(this.tiltX) < 0.00004 && this.tiltTargetX === 0) this.tiltX = 0;
    if (Math.abs(this.tiltY) < 0.00004 && this.tiltTargetY === 0) this.tiltY = 0;
  }

  isAtBack(epsilon = 0.018) {
    return Math.abs(this.flip - PI) <= epsilon && this.flipTarget === PI;
  }

  buildBaseModel() {
    // 与 cardRoot → tiltGroup → flipGroup 对应：
    // 基础位置/洗牌、悬停倾斜、正反翻转分别使用独立矩阵，互不重置状态。
    const rootTranslation = translation(this._tempA, this.x, this.y + this.shuffleOffsetY, this.z);
    const rootShuffleRotation = rotationZ(this._tempB, this.shuffleRotation);
    const tiltX = rotationX(this._tempC, this.tiltX);
    const tiltY = rotationY(this._tempD, this.tiltY);
    const flipY = rotationY(this._tempE, this.flip);

    identity(this.model);
    multiply(this.model, rootTranslation, rootShuffleRotation);
    multiply(this.model, this.model, tiltX);
    multiply(this.model, this.model, tiltY);
    multiply(this.model, this.model, flipY);
    return this.model;
  }
}
