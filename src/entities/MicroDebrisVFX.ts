import * as THREE from 'three';

/**
 * Next-Gen Triple-AAA GPU Micro-Debris Explosion System
 * - Single-draw-call InstancedMesh (160 faceted angular micro-shards) with custom blackbody-cooling GLSL shader!
 * - Single-draw-call GPU Plasma Spark & Shock Flash Points layer!
 * - Zero per-frame heap allocations, fast 0.00ms idle bypass when inactive.
 * - Bounces realistically off ground/surface heights and cools from molten incandescent -> scorched metallic chunks!
 */
export class MicroDebrisVFX {
  private static readonly SHARD_COUNT = 160;
  private static readonly SPARK_COUNT = 140;

  // 1. Instanced 3D Faceted Micro-Debris Shards (1 draw call!)
  private shardMesh: THREE.InstancedMesh;
  private shardHeatAttr: THREE.InstancedBufferAttribute;
  private shardTintAttr: THREE.InstancedBufferAttribute;
  private shardHeat = new Float32Array(MicroDebrisVFX.SHARD_COUNT);
  private shardTint = new Float32Array(MicroDebrisVFX.SHARD_COUNT * 3);
  private shardPos = new Float32Array(MicroDebrisVFX.SHARD_COUNT * 3);
  private shardVel = new Float32Array(MicroDebrisVFX.SHARD_COUNT * 3);
  private shardRot = new Float32Array(MicroDebrisVFX.SHARD_COUNT * 3);
  private shardRotVel = new Float32Array(MicroDebrisVFX.SHARD_COUNT * 3);
  private shardScale = new Float32Array(MicroDebrisVFX.SHARD_COUNT * 3);
  private shardFloorY = new Float32Array(MicroDebrisVFX.SHARD_COUNT);
  private shardAge = new Float32Array(MicroDebrisVFX.SHARD_COUNT).fill(99);
  private shardMax = new Float32Array(MicroDebrisVFX.SHARD_COUNT).fill(1);
  private shardCursor = 0;

  // 2. Incandescent Micro-Spark Spray (1 draw call!)
  private sparkPoints: THREE.Points;
  private sparkGeo: THREE.BufferGeometry;
  private sparkPos = new Float32Array(MicroDebrisVFX.SPARK_COUNT * 3);
  private sparkVel = new Float32Array(MicroDebrisVFX.SPARK_COUNT * 3);
  private sparkCol = new Float32Array(MicroDebrisVFX.SPARK_COUNT * 3);
  private sparkAge = new Float32Array(MicroDebrisVFX.SPARK_COUNT).fill(99);
  private sparkMax = new Float32Array(MicroDebrisVFX.SPARK_COUNT).fill(1);
  private sparkAlpha = new Float32Array(MicroDebrisVFX.SPARK_COUNT);
  private sparkCursor = 0;

  private anyAlive = false;
  private readonly _dummy = new THREE.Object3D();
  private readonly _tmpColor = new THREE.Color();

  constructor(scene: THREE.Scene) {
    // --- Layer 1: Faceted Micro-Debris Shards with Custom Molten-Edge Shader ---
    const shardGeo = new THREE.IcosahedronGeometry(0.068, 0); // Sharp low-poly fractured rock/metal shard!
    this.shardHeatAttr = new THREE.InstancedBufferAttribute(this.shardHeat, 1);
    this.shardTintAttr = new THREE.InstancedBufferAttribute(this.shardTint, 3);
    shardGeo.setAttribute('aHeat', this.shardHeatAttr);
    shardGeo.setAttribute('aTint', this.shardTintAttr);

    const shardMat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float aHeat;
        attribute vec3 aTint;
        varying float vHeat;
        varying vec3 vTint;
        varying vec3 vNormalW;
        varying vec3 vViewDir;

        void main() {
          vHeat = aHeat;
          vTint = aTint;
          vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          vViewDir = normalize(cameraPosition - worldPos.xyz);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        precision mediump float;
        varying float vHeat;
        varying vec3 vTint;
        varying vec3 vNormalW;
        varying vec3 vViewDir;

        void main() {
          vec3 N = normalize(vNormalW);
          vec3 V = normalize(vViewDir);
          vec3 L = normalize(vec3(0.45, 0.85, 0.55));
          float diff = max(0.18, dot(N, L));
          float fresnel = pow(1.0 - max(0.0, dot(N, V)), 2.2);

          // Scorched metallic/ceramic fractured shard base
          vec3 cooledBase = mix(vec3(0.16, 0.18, 0.22), vTint * 0.65, 0.45) * diff;
          // Molten hot blackbody glow cooling from white-hot -> laser tint -> ember
          vec3 moltenCol = mix(vTint, vec3(1.0, 0.98, 0.90), smoothstep(0.45, 1.0, vHeat));
          vec3 col = mix(cooledBase, moltenCol * 1.65, clamp(vHeat * 0.92 + fresnel * vHeat * 0.6, 0.0, 1.0));
          // Crisp metallic edge specular
          col += vec3(0.45, 0.55, 0.65) * fresnel * 0.35;

          gl_FragColor = vec4(col, 1.0);
        }
      `
    });
    shardMat.customProgramCacheKey = () => 'MicroDebrisShardsV1';

    this.shardMesh = new THREE.InstancedMesh(shardGeo, shardMat, MicroDebrisVFX.SHARD_COUNT);
    this.shardMesh.frustumCulled = false;
    this.shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Hide all shards initially
    this._dummy.scale.set(0, 0, 0);
    this._dummy.updateMatrix();
    for (let i = 0; i < MicroDebrisVFX.SHARD_COUNT; i++) {
      this.shardMesh.setMatrixAt(i, this._dummy.matrix);
    }
    this.shardMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.shardMesh);

    // --- Layer 2: High-Velocity Incandescent Impact Micro-Sparks ---
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparkGeo.setAttribute('aColor', new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparkGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.sparkAlpha, 1));

    const sparkMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) }
      },
      vertexShader: `
        attribute vec3 aColor;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float uPixelRatio;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPos;
          gl_PointSize = min(20.0, (28.0 * uPixelRatio) / max(1.0, -mvPos.z)) * (0.35 + 0.65 * aAlpha);
        }
      `,
      fragmentShader: `
        precision mediump float;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.01) discard;
          vec2 uv = gl_PointCoord - vec2(0.5);
          float r2 = dot(uv, uv) * 4.0;
          if (r2 > 1.0) discard;
          float core = exp(-r2 * 5.5);
          vec3 col = mix(vColor, vec3(1.0, 0.99, 0.92), core * 0.8);
          gl_FragColor = vec4(col * 1.7, vAlpha * (1.0 - r2));
        }
      `
    });
    sparkMat.customProgramCacheKey = () => 'MicroDebrisSparksV1';

    this.sparkPoints = new THREE.Points(this.sparkGeo, sparkMat);
    this.sparkPoints.frustumCulled = false;
    this.sparkPoints.renderOrder = 9;
    scene.add(this.sparkPoints);
  }

  /**
   * Triggers a crisp, punchy micro-debris explosion on any hit surface!
   */
  public burst(
    x: number,
    y: number,
    z: number,
    colorHex: number = 0x00f5ff,
    floorY: number = -3.70,
    normalX: number = 0,
    normalY: number = 1,
    intensity: number = 1.0
  ) {
    this._tmpColor.setHex(colorHex);
    const shardCount = Math.round((10 + Math.random() * 6) * intensity);
    const sparkCount = Math.round((12 + Math.random() * 6) * intensity);

    for (let k = 0; k < shardCount; k++) {
      const i = this.shardCursor;
      this.shardCursor = (this.shardCursor + 1) % MicroDebrisVFX.SHARD_COUNT;
      const i3 = i * 3;

      this.shardPos[i3] = x + (Math.random() - 0.5) * 0.14;
      this.shardPos[i3 + 1] = y + (Math.random() - 0.5) * 0.14;
      this.shardPos[i3 + 2] = z + (Math.random() - 0.5) * 0.14;

      const spread = 2.6 + Math.random() * 4.8;
      const ang = Math.random() * Math.PI * 2;
      this.shardVel[i3] = normalX * (2.5 + Math.random() * 3.0) + Math.cos(ang) * spread;
      this.shardVel[i3 + 1] = Math.max(1.5, normalY * (3.2 + Math.random() * 3.5) + Math.random() * 4.2);
      this.shardVel[i3 + 2] = Math.sin(ang) * spread * 0.85;

      this.shardRot[i3] = Math.random() * Math.PI * 2;
      this.shardRot[i3 + 1] = Math.random() * Math.PI * 2;
      this.shardRot[i3 + 2] = Math.random() * Math.PI * 2;
      this.shardRotVel[i3] = (Math.random() - 0.5) * 18.0;
      this.shardRotVel[i3 + 1] = (Math.random() - 0.5) * 18.0;
      this.shardRotVel[i3 + 2] = (Math.random() - 0.5) * 18.0;

      // Angular irregular micro-shard proportions (chips, splinters & flakes!)
      const baseS = (0.55 + Math.random() * 0.95) * intensity;
      this.shardScale[i3] = baseS * (0.6 + Math.random() * 1.1);
      this.shardScale[i3 + 1] = baseS * (0.4 + Math.random() * 0.7);
      this.shardScale[i3 + 2] = baseS * (0.6 + Math.random() * 0.9);

      this.shardFloorY[i] = floorY;
      this.shardAge[i] = 0;
      this.shardMax[i] = 0.48 + Math.random() * 0.42;
      this.shardHeat[i] = 1.0;
      this.shardTint[i3] = this._tmpColor.r;
      this.shardTint[i3 + 1] = this._tmpColor.g;
      this.shardTint[i3 + 2] = this._tmpColor.b;
    }

    for (let k = 0; k < sparkCount; k++) {
      const i = this.sparkCursor;
      this.sparkCursor = (this.sparkCursor + 1) % MicroDebrisVFX.SPARK_COUNT;
      const i3 = i * 3;
      this.sparkPos[i3] = x;
      this.sparkPos[i3 + 1] = y;
      this.sparkPos[i3 + 2] = z;

      const ang = Math.random() * Math.PI * 2;
      const spd = 3.5 + Math.random() * 7.5;
      this.sparkVel[i3] = normalX * 3.0 + Math.cos(ang) * spd;
      this.sparkVel[i3 + 1] = normalY * 2.5 + (Math.random() - 0.15) * spd;
      this.sparkVel[i3 + 2] = Math.sin(ang) * spd * 0.8;

      this.sparkCol[i3] = this._tmpColor.r;
      this.sparkCol[i3 + 1] = this._tmpColor.g;
      this.sparkCol[i3 + 2] = this._tmpColor.b;
      this.sparkAge[i] = 0;
      this.sparkMax[i] = 0.18 + Math.random() * 0.26;
      this.sparkAlpha[i] = 1.0;
    }

    this.anyAlive = true;
  }

  public update(dt: number) {
    if (!this.anyAlive) return;

    let alive = false;

    // 1. Update Instanced Micro-Debris Shards
    for (let i = 0; i < MicroDebrisVFX.SHARD_COUNT; i++) {
      const age = this.shardAge[i];
      const maxL = this.shardMax[i];
      if (age >= maxL) {
        if (this.shardHeat[i] >= 0) {
          this.shardHeat[i] = -1;
          this._dummy.scale.set(0, 0, 0);
          this._dummy.updateMatrix();
          this.shardMesh.setMatrixAt(i, this._dummy.matrix);
        }
        continue;
      }

      alive = true;
      const nextAge = age + dt;
      this.shardAge[i] = nextAge;
      const t = nextAge / maxL;
      const i3 = i * 3;

      this.shardVel[i3 + 1] -= 18.5 * dt;
      this.shardPos[i3] += this.shardVel[i3] * dt;
      this.shardPos[i3 + 1] += this.shardVel[i3 + 1] * dt;
      this.shardPos[i3 + 2] += this.shardVel[i3 + 2] * dt;

      // Crisp bounce off surface!
      const fy = this.shardFloorY[i] + 0.03;
      if (this.shardPos[i3 + 1] < fy) {
        this.shardPos[i3 + 1] = fy;
        this.shardVel[i3 + 1] = Math.abs(this.shardVel[i3 + 1]) * 0.42;
        this.shardVel[i3] *= 0.72;
        this.shardVel[i3 + 2] *= 0.72;
      }

      this.shardRot[i3] += this.shardRotVel[i3] * dt;
      this.shardRot[i3 + 1] += this.shardRotVel[i3 + 1] * dt;
      this.shardRot[i3 + 2] += this.shardRotVel[i3 + 2] * dt;

      // Rapid cooling from incandescent white-hot -> scorched metal, shrinking cleanly at end
      this.shardHeat[i] = Math.max(0, 1.0 - t * 1.9);
      const shrink = t > 0.72 ? (1.0 - (t - 0.72) / 0.28) : 1.0;

      this._dummy.position.set(this.shardPos[i3], this.shardPos[i3 + 1], this.shardPos[i3 + 2]);
      this._dummy.rotation.set(this.shardRot[i3], this.shardRot[i3 + 1], this.shardRot[i3 + 2]);
      this._dummy.scale.set(
        this.shardScale[i3] * shrink,
        this.shardScale[i3 + 1] * shrink,
        this.shardScale[i3 + 2] * shrink
      );
      this._dummy.updateMatrix();
      this.shardMesh.setMatrixAt(i, this._dummy.matrix);
    }

    // 2. Update Micro-Sparks
    for (let i = 0; i < MicroDebrisVFX.SPARK_COUNT; i++) {
      const age = this.sparkAge[i];
      const maxL = this.sparkMax[i];
      if (age >= maxL) {
        this.sparkAlpha[i] = 0;
        continue;
      }
      alive = true;
      const nextAge = age + dt;
      this.sparkAge[i] = nextAge;
      const i3 = i * 3;
      this.sparkVel[i3] *= 0.94;
      this.sparkVel[i3 + 1] = this.sparkVel[i3 + 1] * 0.94 - 9.5 * dt;
      this.sparkVel[i3 + 2] *= 0.94;
      this.sparkPos[i3] += this.sparkVel[i3] * dt;
      this.sparkPos[i3 + 1] += this.sparkVel[i3 + 1] * dt;
      this.sparkPos[i3 + 2] += this.sparkVel[i3 + 2] * dt;

      const t = nextAge / maxL;
      this.sparkAlpha[i] = (1.0 - t) * (1.0 - t);
    }

    this.anyAlive = alive;
    this.shardMesh.instanceMatrix.needsUpdate = true;
    this.shardHeatAttr.needsUpdate = true;
    this.shardTintAttr.needsUpdate = true;
    (this.sparkGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.sparkGeo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.sparkGeo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}
