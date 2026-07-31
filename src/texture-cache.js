function isPowerOfTwo(value) {
  return value > 0 && (value & (value - 1)) === 0;
}

export class TextureCache {
  constructor(gl) {
    this.gl = gl;
    this.cache = new Map();
    this.fallbacks = new Map();
  }

  createSolidTexture(key, rgba) {
    if (this.fallbacks.has(key)) return this.fallbacks.get(key);
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(rgba),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const result = { texture, width: 1, height: 1, path: `[内存中性纹理:${key}]`, fallback: true };
    this.fallbacks.set(key, result);
    return result;
  }

  neutral(kind) {
    switch (kind) {
      case 'normal': return this.createSolidTexture('normal', [128, 128, 255, 255]);
      case 'roughness': return this.createSolidTexture('roughness', [224, 224, 224, 255]);
      case 'height': return this.createSolidTexture('height', [128, 128, 128, 255]);
      default: return this.createSolidTexture('color', [45, 36, 57, 255]);
    }
  }

  load(path, kind = 'color') {
    if (!path) {
      console.warn(`[纹理降级] ${kind} 未配置路径，使用内存中性纹理。`);
      return Promise.resolve(this.neutral(kind));
    }
    const cacheKey = `${kind}:${path}`;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    const promise = new Promise((resolve) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        if (isPowerOfTwo(image.naturalWidth) && isPowerOfTwo(image.naturalHeight)) {
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        } else {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        }
        resolve({
          texture,
          width: image.naturalWidth,
          height: image.naturalHeight,
          path,
          fallback: false,
        });
      };
      image.onerror = () => {
        console.error(`[纹理加载失败] 类型=${kind}，实际路径=${path}。已对该纹理安全降级。`);
        resolve(this.neutral(kind));
      };
      image.src = path;
    });

    this.cache.set(cacheKey, promise);
    return promise;
  }

  dispose() {
    const gl = this.gl;
    for (const promise of this.cache.values()) {
      Promise.resolve(promise).then((entry) => {
        if (entry?.texture && !entry.fallback) gl.deleteTexture(entry.texture);
      });
    }
    for (const entry of this.fallbacks.values()) {
      if (entry.texture) gl.deleteTexture(entry.texture);
    }
    this.cache.clear();
    this.fallbacks.clear();
  }
}
