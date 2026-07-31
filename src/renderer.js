import { TextureCache } from './texture-cache.js';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders.js';
import {
  EPSILON,
  createMat4,
  identity,
  invert,
  multiply,
  normalize3,
  perspective,
  rotationY,
  transformVec4,
  translation,
} from './math.js';

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || '未知着色器编译错误';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || '未知着色器链接错误';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function buildSubdividedPlane(gl, segmentsX = 40, segmentsY = 96) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let y = 0; y <= segmentsY; y += 1) {
    const v = y / segmentsY;
    for (let x = 0; x <= segmentsX; x += 1) {
      const u = x / segmentsX;
      positions.push(u - 0.5, v - 0.5, 0);
      uvs.push(u, v);
    }
  }
  const row = segmentsX + 1;
  for (let y = 0; y < segmentsY; y += 1) {
    for (let x = 0; x < segmentsX; x += 1) {
      const a = y * row + x;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }

  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

  const uvBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);

  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

  return { positionBuffer, uvBuffer, indexBuffer, indexCount: indices.length };
}

export class TarotRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      depth: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    if (!this.gl) throw new Error('当前浏览器或设备不可用 WebGL。');

    const gl = this.gl;
    this.program = createProgram(gl);
    this.geometry = buildSubdividedPlane(gl);
    this.textureCache = new TextureCache(gl);
    this.cards = [];

    this.viewportWidth = 1;
    this.viewportHeight = 1;
    this.pixelRatio = 1;
    this.fov = Math.PI / 4;
    this.cameraDistance = 1000;
    this.cameraPosition = new Float32Array([0, 0, 1000]);
    this.lightPosition = new Float32Array([0, 60, 310]);

    this.projection = createMat4();
    this.view = createMat4();
    this.projectionView = createMat4();
    this.inverseProjectionView = createMat4();
    this.faceModel = createMat4();
    this.tempMatrixA = createMat4();
    this.tempMatrixB = createMat4();
    this.inverseModel = createMat4();
    this.nearPoint = new Float32Array(4);
    this.farPoint = new Float32Array(4);
    this.localOrigin = new Float32Array(4);
    this.localDirection = new Float32Array(4);
    this.rayDirection = new Float32Array(3);

    this.vertexTextureUnits = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) || 0;
    if (this.vertexTextureUnits < 1) {
      console.warn('[高度图降级] 当前 WebGL 实现不支持顶点纹理采样，局部高度位移将关闭。');
    }

    this.locations = this.lookupLocations();
    this.configureGl();
  }

  lookupLocations() {
    const gl = this.gl;
    const p = this.program;
    const attribute = (name) => gl.getAttribLocation(p, name);
    const uniform = (name) => gl.getUniformLocation(p, name);
    return {
      aPosition: attribute('aPosition'),
      aUv: attribute('aUv'),
      uProjectionView: uniform('uProjectionView'),
      uModel: uniform('uModel'),
      uCardSize: uniform('uCardSize'),
      uHeightMap: uniform('uHeightMap'),
      uColorMap: uniform('uColorMap'),
      uNormalMap: uniform('uNormalMap'),
      uRoughnessMap: uniform('uRoughnessMap'),
      uPointerUv: uniform('uPointerUv'),
      uPointerInfluence: uniform('uPointerInfluence'),
      uPointerRadius: uniform('uPointerRadius'),
      uDisplacement: uniform('uDisplacement'),
      uLightPosition: uniform('uLightPosition'),
      uCameraPosition: uniform('uCameraPosition'),
      uLightColor: uniform('uLightColor'),
      uLightIntensity: uniform('uLightIntensity'),
      uBaseRoughness: uniform('uBaseRoughness'),
      uNormalStrength: uniform('uNormalStrength'),
      uOpacity: uniform('uOpacity'),
    };
  }

  configureGl() {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
  }

  setCards(cards) {
    this.cards = cards;
  }

  async loadMaterialSet(definition) {
    const [clean, normal, roughness, height] = await Promise.all([
      this.textureCache.load(definition.clean, 'color'),
      this.textureCache.load(definition.normal, 'normal'),
      this.textureCache.load(definition.roughness, 'roughness'),
      this.textureCache.load(definition.height, 'height'),
    ]);
    return { clean, normal, roughness, height };
  }

  async loadBackMaterial(definition) {
    const [clean, normal, roughness, height] = await Promise.all([
      this.textureCache.load(definition.clean, 'color'),
      this.textureCache.load(definition.normal, 'normal'),
      this.textureCache.load(definition.roughness, 'roughness'),
      this.textureCache.load(definition.height, 'height'),
    ]);
    return { clean, normal, roughness, height };
  }

  resize(width, height, devicePixelRatio) {
    if (width <= 0 || height <= 0) return false;
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.pixelRatio = Math.min(Math.max(devicePixelRatio || 1, 1), 1.75);
    const renderWidth = Math.max(1, Math.round(width * this.pixelRatio));
    const renderHeight = Math.max(1, Math.round(height * this.pixelRatio));
    if (this.canvas.width !== renderWidth || this.canvas.height !== renderHeight) {
      this.canvas.width = renderWidth;
      this.canvas.height = renderHeight;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
    }
    this.gl.viewport(0, 0, renderWidth, renderHeight);

    this.cameraDistance = height / (2 * Math.tan(this.fov / 2));
    this.cameraPosition[2] = this.cameraDistance;
    perspective(this.projection, this.fov, width / height, 1, this.cameraDistance + 2400);
    translation(this.view, 0, 0, -this.cameraDistance);
    multiply(this.projectionView, this.projection, this.view);
    invert(this.inverseProjectionView, this.projectionView);
    return true;
  }

  bindGeometry() {
    const gl = this.gl;
    const loc = this.locations;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.geometry.positionBuffer);
    gl.enableVertexAttribArray(loc.aPosition);
    gl.vertexAttribPointer(loc.aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.geometry.uvBuffer);
    gl.enableVertexAttribArray(loc.aUv);
    gl.vertexAttribPointer(loc.aUv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.geometry.indexBuffer);
  }

  bindTexture(unit, location, entry) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.uniform1i(location, unit);
  }

  buildFaceModel(baseModel, isBack) {
    const faceRotation = rotationY(this.tempMatrixA, isBack ? Math.PI : 0);
    const faceOffset = translation(this.tempMatrixB, 0, 0, 0.45);
    multiply(this.faceModel, baseModel, faceRotation);
    multiply(this.faceModel, this.faceModel, faceOffset);
    return this.faceModel;
  }

  drawFace(card, material, isBack) {
    const gl = this.gl;
    const loc = this.locations;
    const model = this.buildFaceModel(card.model, isBack);
    gl.uniformMatrix4fv(loc.uModel, false, model);
    gl.uniform2f(loc.uCardSize, card.width, card.height);
    gl.uniform2fv(loc.uPointerUv, card.pointerUv);
    gl.uniform1f(loc.uPointerInfluence, isBack ? 0 : card.pointerInfluence);
    gl.uniform1f(loc.uPointerRadius, 0.23);
    gl.uniform1f(
      loc.uDisplacement,
      !isBack && this.vertexTextureUnits > 0 ? Math.min(4.2, card.width * 0.018) : 0,
    );
    gl.uniform1f(loc.uBaseRoughness, isBack ? 0.82 : 0.62);
    gl.uniform1f(loc.uNormalStrength, isBack ? 0.12 : 0.42);
    gl.uniform1f(loc.uOpacity, card.opacity);

    this.bindTexture(0, loc.uColorMap, material.clean);
    this.bindTexture(1, loc.uNormalMap, material.normal);
    this.bindTexture(2, loc.uRoughnessMap, material.roughness);
    this.bindTexture(3, loc.uHeightMap, material.height);
    gl.drawElements(gl.TRIANGLES, this.geometry.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  render(backMaterial) {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    this.bindGeometry();
    const loc = this.locations;
    gl.uniformMatrix4fv(loc.uProjectionView, false, this.projectionView);
    gl.uniform3fv(loc.uLightPosition, this.lightPosition);
    gl.uniform3fv(loc.uCameraPosition, this.cameraPosition);
    gl.uniform3f(loc.uLightColor, 1.0, 0.62, 0.36);
    gl.uniform1f(loc.uLightIntensity, 1.22);

    for (const card of this.cards) {
      if (!card.visible || card.opacity < 0.003 || !card.materialSet) continue;
      card.buildBaseModel();
      this.drawFace(card, card.materialSet, false);
      this.drawFace(card, backMaterial, true);
    }
  }

  createWorldRay(clientX, clientY) {
    const ndcX = (clientX / this.viewportWidth) * 2 - 1;
    const ndcY = 1 - (clientY / this.viewportHeight) * 2;
    transformVec4(this.nearPoint, this.inverseProjectionView, ndcX, ndcY, -1, 1);
    transformVec4(this.farPoint, this.inverseProjectionView, ndcX, ndcY, 1, 1);
    for (const point of [this.nearPoint, this.farPoint]) {
      const w = Math.abs(point[3]) > EPSILON ? point[3] : 1;
      point[0] /= w; point[1] /= w; point[2] /= w; point[3] = 1;
    }
    normalize3(
      this.rayDirection,
      this.farPoint[0] - this.nearPoint[0],
      this.farPoint[1] - this.nearPoint[1],
      this.farPoint[2] - this.nearPoint[2],
    );
    return { origin: this.nearPoint, direction: this.rayDirection };
  }

  raycastCards(clientX, clientY) {
    if (this.viewportWidth <= 0 || this.viewportHeight <= 0) return null;
    const ray = this.createWorldRay(clientX, clientY);
    let nearest = null;

    for (const card of this.cards) {
      if (!card.visible) continue;
      card.buildBaseModel();
      if (!invert(this.inverseModel, card.model)) continue;
      transformVec4(
        this.localOrigin,
        this.inverseModel,
        ray.origin[0], ray.origin[1], ray.origin[2], 1,
      );
      transformVec4(
        this.localDirection,
        this.inverseModel,
        ray.direction[0], ray.direction[1], ray.direction[2], 0,
      );
      const directionZ = this.localDirection[2];
      if (Math.abs(directionZ) < EPSILON) continue;
      const tLocal = -this.localOrigin[2] / directionZ;
      if (tLocal < 0) continue;
      const localX = this.localOrigin[0] + this.localDirection[0] * tLocal;
      const localY = this.localOrigin[1] + this.localDirection[1] * tLocal;
      if (Math.abs(localX) > card.width * 0.5 || Math.abs(localY) > card.height * 0.5) continue;

      const worldX = ray.origin[0] + ray.direction[0] * tLocal;
      const worldY = ray.origin[1] + ray.direction[1] * tLocal;
      const worldZ = ray.origin[2] + ray.direction[2] * tLocal;
      const distance = Math.hypot(
        worldX - ray.origin[0],
        worldY - ray.origin[1],
        worldZ - ray.origin[2],
      );
      if (!nearest || distance < nearest.distance) {
        nearest = {
          card,
          distance,
          uv: [localX / card.width + 0.5, localY / card.height + 0.5],
        };
      }
    }
    return nearest;
  }

  dispose() {
    const gl = this.gl;
    this.textureCache.dispose();
    gl.deleteBuffer(this.geometry.positionBuffer);
    gl.deleteBuffer(this.geometry.uvBuffer);
    gl.deleteBuffer(this.geometry.indexBuffer);
    gl.deleteProgram(this.program);
  }
}
