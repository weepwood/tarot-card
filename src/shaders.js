export const VERTEX_SHADER = `
precision highp float;
attribute vec3 aPosition;
attribute vec2 aUv;
uniform mat4 uProjectionView;
uniform mat4 uModel;
uniform vec2 uCardSize;
uniform sampler2D uHeightMap;
uniform vec2 uPointerUv;
uniform float uPointerInfluence;
uniform float uPointerRadius;
uniform float uDisplacement;
varying vec2 vUv;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vWorldTangent;
varying vec3 vWorldBitangent;

void main() {
  vec3 localPosition = vec3(
    aPosition.x * uCardSize.x,
    aPosition.y * uCardSize.y,
    0.0
  );

  float pointerDistance = distance(aUv, uPointerUv);
  float radialMask = 1.0 - smoothstep(uPointerRadius * 0.2, uPointerRadius, pointerDistance);
  float sampledHeight = texture2D(uHeightMap, aUv).r * 2.0 - 1.0;
  localPosition.z += sampledHeight * uDisplacement * radialMask * uPointerInfluence;

  vec4 worldPosition = uModel * vec4(localPosition, 1.0);
  mat3 modelRotation = mat3(uModel);
  vUv = aUv;
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(modelRotation * vec3(0.0, 0.0, 1.0));
  vWorldTangent = normalize(modelRotation * vec3(1.0, 0.0, 0.0));
  vWorldBitangent = normalize(modelRotation * vec3(0.0, 1.0, 0.0));
  gl_Position = uProjectionView * worldPosition;
}
`;

export const FRAGMENT_SHADER = `
precision highp float;
uniform sampler2D uColorMap;
uniform sampler2D uNormalMap;
uniform sampler2D uRoughnessMap;
uniform vec3 uLightPosition;
uniform vec3 uCameraPosition;
uniform vec3 uLightColor;
uniform float uLightIntensity;
uniform float uBaseRoughness;
uniform float uNormalStrength;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying vec3 vWorldTangent;
varying vec3 vWorldBitangent;

vec3 srgbToLinear(vec3 color) {
  return pow(max(color, vec3(0.0)), vec3(2.2));
}

vec3 linearToSrgb(vec3 color) {
  return pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
}

void main() {
  vec4 sampledColor = texture2D(uColorMap, vUv);
  if (sampledColor.a < 0.025) discard;

  vec3 baseColor = srgbToLinear(sampledColor.rgb);
  vec3 tangentNormal = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
  tangentNormal.xy *= uNormalStrength;
  tangentNormal = normalize(tangentNormal);
  mat3 tbn = mat3(normalize(vWorldTangent), normalize(vWorldBitangent), normalize(vWorldNormal));
  vec3 normal = normalize(tbn * tangentNormal);

  float roughnessTexture = texture2D(uRoughnessMap, vUv).r;
  float roughness = clamp(mix(uBaseRoughness, 0.98, roughnessTexture * 0.72), 0.42, 0.98);
  vec3 toLight = uLightPosition - vWorldPosition;
  float lightDistance = max(length(toLight), 1.0);
  vec3 lightDirection = toLight / lightDistance;
  vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
  vec3 halfDirection = normalize(lightDirection + viewDirection);

  float diffuseFactor = max(dot(normal, lightDirection), 0.0);
  float attenuation = 1.0 / (1.0 + 0.000018 * lightDistance * lightDistance);
  float specularPower = mix(72.0, 7.0, roughness);
  float specularFactor = pow(max(dot(normal, halfDirection), 0.0), specularPower);
  specularFactor *= (1.0 - roughness) * 0.16;
  float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.2) * 0.055;

  vec3 ambient = baseColor * vec3(0.31, 0.30, 0.36);
  vec3 diffuse = baseColor * uLightColor * diffuseFactor * attenuation * uLightIntensity;
  vec3 specular = uLightColor * specularFactor * attenuation * uLightIntensity;
  vec3 color = ambient + diffuse + specular + baseColor * rim;
  color = color / (color + vec3(1.0));
  color = linearToSrgb(color);
  gl_FragColor = vec4(color, sampledColor.a * uOpacity);
}
`;
