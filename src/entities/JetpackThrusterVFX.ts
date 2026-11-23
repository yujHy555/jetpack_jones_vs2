import * as THREE from 'three';

/**
 * Next-Gen GPU-Optimized Jetpack Thruster Particle System
 * - 2 single-draw-call custom-GLSL THREE.Points layers (Plasma Embers + Silky Volumetric Plume)
 * - Zero per-frame heap allocations (pre-allocated TypedArrays & ring-buffer pools)
 * - Ground-wash radial deflection when hovering near platforms/floor
 * - Distinct micro-thruster burst for Double Jump!
 */
export class JetpackThrusterVFX {
  private static readonly PLASMA_COUNT = 180;
  private static readonly PLUME_COUNT = 260;

  // Layer 1: Incandescent Plasma & Embers (Additive GPU Points)
  private plasmaPoints: THREE.Points;
  private plasmaGeo: THREE.BufferGeometry;
  private plasmaPos: Float32Array;
  private plasmaVel: Float32Array;
  private plasmaAge: Float32Array;
  private plasmaMax: Float32Array;
  private plasmaSize: Float32Array;
  private plasmaAlpha: Float32Array;
  private plasmaTemp: Float32Array; // 1.0 = white-cyan core, 0.0 = warm amber tail
  private plasmaCursor = 0;
  private plasmaAccum = 0;
  private plasmaMat!: THREE.ShaderMaterial;
  private plumeMat!: THREE.ShaderMaterial;

  // Layer 2: Silky Atmospheric Exhaust Plume (Soft Translucent GPU Points)
  private plumePoints: THREE.Points;
  private plumeGeo: THREE.BufferGeometry;
  private plumePos: Float32Array;
  private plumeVel: Float32Array;
  private plumeAge: Float32Array;
  private plumeMax: Float32Array;
  private plumeSize: Float32Array;
  private plumeAlpha: Float32Array;
  private plumeSeed: Float32Array;
  private plumeCursor = 0;
  private plumeAccum = 0;
  private anyAlive = false;

  constructor(scene: THREE.Scene) {
    // --- 1. Plasma & Embers Layer ---
    const pc = JetpackThrusterVFX.PLASMA_COUNT;
    this.plasmaPos = new Float32Array(pc * 3);
    this.plasmaVel = new Float32Array(pc * 3);
    this.plasmaAge = new Float32Array(pc).fill(99);
    this.plasmaMax = new Float32Array(pc).fill(1);
    this.plasmaSize = new Float32Array(pc);
    this.plasmaAlpha = new Float32Array(pc);
    this.plasmaTemp = new Float32Array(pc);

    this.plasmaGeo = new THREE.BufferGeometry();
    this.plasmaGeo.setAttribute('position', new THREE.BufferAttribute(this.plasmaPos, 3));
    this.plasmaGeo.setAttribute('aSize', new THREE.BufferAttribute(this.plasmaSize, 1));
    this.plasmaGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.plasmaAlpha, 1));
    this.plasmaGeo.setAttribute('aTemp', new THREE.BufferAttribute(this.plasmaTemp, 1));

    const plasmaMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uPixelMode: { value: 0.0 }
      },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        attribute float aTemp;
        varying float vAlpha;
        varying float vTemp;
        uniform float uPixelRatio;
        uniform float uPixelMode;
        void main() {
          vAlpha = aAlpha;
          vTemp = aTemp;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPos;
          float modeScale = mix(1.0, 0.28, uPixelMode);
          gl_PointSize = aSize * uPixelRatio * modeScale * (300.0 / max(1.0, -mvPos.z));
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        varying float vTemp;
        void main() {
          if (vAlpha <= 0.004) discard;
          vec2 uv = gl_PointCoord - vec2(0.5);
          float r2 = dot(uv, uv) * 4.0;
          if (r2 > 1.0) discard;

          // Ultra-smooth dual-exponential incandescent plasma glow
          float core = exp(-r2 * 7.5);
          float halo = exp(-r2 * 2.4) * 0.55;
          float intensity = core + halo;

          // Temperature color ramp: amber-gold -> electric cyan -> white-hot core
          vec3 amber = vec3(1.0, 0.55, 0.16);
          vec3 cyan  = vec3(0.18, 0.88, 1.0);
          vec3 hot   = vec3(0.96, 0.99, 1.0);
          vec3 col = mix(amber, cyan, smoothstep(0.15, 0.65, vTemp));
          col = mix(col, hot, smoothstep(0.65, 1.0, vTemp) + core * 0.55);

          gl_FragColor = vec4(col * intensity, vAlpha * (1.0 - r2));
        }
      `
    });

    this.plasmaMat = plasmaMat;
    this.plasmaPoints = new THREE.Points(this.plasmaGeo, plasmaMat);
    this.plasmaPoints.frustumCulled = false;
    this.plasmaPoints.renderOrder = 6;
    scene.add(this.plasmaPoints);

    // --- 2. Silky Volumetric Plume Layer ---
    const sc = JetpackThrusterVFX.PLUME_COUNT;
    this.plumePos = new Float32Array(sc * 3);
    this.plumeVel = new Float32Array(sc * 3);
    this.plumeAge = new Float32Array(sc).fill(99);
    this.plumeMax = new Float32Array(sc).fill(1);
    this.plumeSize = new Float32Array(sc);
    this.plumeAlpha = new Float32Array(sc);
    this.plumeSeed = new Float32Array(sc);

    this.plumeGeo = new THREE.BufferGeometry();
    this.plumeGeo.setAttribute('position', new THREE.BufferAttribute(this.plumePos, 3));
    this.plumeGeo.setAttribute('aSize', new THREE.BufferAttribute(this.plumeSize, 1));
    this.plumeGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.plumeAlpha, 1));
    this.plumeGeo.setAttribute('aSeed', new THREE.BufferAttribute(this.plumeSeed, 1));

    const plumeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uPixelMode: { value: 0.0 }
      },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        attribute float aSeed;
        varying float vAlpha;
        varying float vSeed;
        uniform float uPixelRatio;
        uniform float uPixelMode;
        void main() {
          // Keep smoke much subtler & proportional in 220p Pixel Mode so it never covers Jones!
          vAlpha = aAlpha * mix(1.0, 0.40, uPixelMode);
          vSeed = aSeed;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPos;
          float modeScale = mix(1.0, 0.22, uPixelMode);
          float maxPx = mix(220.0, 34.0, uPixelMode);
          gl_PointSize = min(maxPx, aSize * uPixelRatio * modeScale * (480.0 / max(1.0, -mvPos.z)));
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        varying float vSeed;
        void main() {
          if (vAlpha <= 0.004) discard;
          vec2 uv = gl_PointCoord - vec2(0.5);

          // Rotate puff organically per particle seed
          float a = vSeed * 6.28318;
          float cs = cos(a);
          float sn = sin(a);
          vec2 ruv = vec2(uv.x * cs - uv.y * sn, uv.x * sn + uv.y * cs);

          // 4-lobe billowious cumulus cloud silhouette (fluffy, volumetric, zero hard circles!)
          float d0 = length(ruv) * 2.15;
          float d1 = length(ruv - vec2( 0.16,  0.10)) * 2.55;
          float d2 = length(ruv - vec2(-0.17,  0.07)) * 2.60;
          float d3 = length(ruv - vec2( 0.03, -0.15)) * 2.50;
          float lobe = max(
            max(smoothstep(1.0, 0.08, d0), smoothstep(1.0, 0.12, d1) * 0.92),
            max(smoothstep(1.0, 0.12, d2) * 0.90, smoothstep(1.0, 0.14, d3) * 0.88)
          );
          if (lobe <= 0.005) discard;
          float soft = lobe * lobe * (3.0 - 2.0 * lobe);

          // Volumetric top-lit cloud shading (bright warm-white crown, cool soft-silver underbelly)
          float topLit = clamp(0.58 - uv.y * 1.15, 0.0, 1.0);
          vec3 cloudCrown = vec3(1.0, 0.99, 0.97);
          vec3 cloudBelly = vec3(0.76, 0.80, 0.88);
          vec3 col = mix(cloudBelly, cloudCrown, topLit * 0.72 + smoothstep(0.18, 0.60, vAlpha) * 0.28);

          gl_FragColor = vec4(col, soft * vAlpha);
        }
      `
    });

    this.plumeMat = plumeMat;
    this.plumePoints = new THREE.Points(this.plumeGeo, plumeMat);
    this.plumePoints.frustumCulled = false;
    this.plumePoints.renderOrder = 5;
    scene.add(this.plumePoints);
  }

  public setPixelMode(enabled: boolean) {
    const v = enabled ? 1.0 : 0.0;
    if (this.plasmaMat) this.plasmaMat.uniforms.uPixelMode.value = v;
    if (this.plumeMat) this.plumeMat.uniforms.uPixelMode.value = v;
  }

  private spawnPlasma(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    maxLife: number, size: number, temp: number
  ) {
    const i = this.plasmaCursor;
    this.plasmaCursor = (this.plasmaCursor + 1) % JetpackThrusterVFX.PLASMA_COUNT;
    const i3 = i * 3;
    this.plasmaPos[i3] = x;
    this.plasmaPos[i3 + 1] = y;
    this.plasmaPos[i3 + 2] = z;
    this.plasmaVel[i3] = vx;
    this.plasmaVel[i3 + 1] = vy;
    this.plasmaVel[i3 + 2] = vz;
    this.plasmaAge[i] = 0;
    this.plasmaMax[i] = maxLife;
    this.plasmaSize[i] = size;
    this.plasmaAlpha[i] = 1.0;
    this.plasmaTemp[i] = temp;
    this.anyAlive = true;
  }

  private spawnPlume(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    maxLife: number, size: number
  ) {
    const i = this.plumeCursor;
    this.plumeCursor = (this.plumeCursor + 1) % JetpackThrusterVFX.PLUME_COUNT;
    const i3 = i * 3;
    this.plumePos[i3] = x;
    this.plumePos[i3 + 1] = y;
    this.plumePos[i3 + 2] = z;
    this.plumeVel[i3] = vx;
    this.plumeVel[i3 + 1] = vy;
    this.plumeVel[i3 + 2] = vz;
    this.plumeAge[i] = 0;
    this.plumeMax[i] = maxLife;
    this.plumeSize[i] = size;
    this.plumeAlpha[i] = 0.34;
    this.plumeSeed[i] = Math.random();
    this.anyAlive = true;
  }

  /**
   * Crisp micro-thruster burst for the 2nd Jump (Double Jump)
   */
  public emitDoubleJumpBurst(nozzleL: THREE.Vector3, nozzleR: THREE.Vector3, playerVx: number) {
    const nozzles = [nozzleL, nozzleR];
    for (const n of nozzles) {
      for (let k = 0; k < 11; k++) {
        const spreadX = (Math.random() - 0.5) * 3.4 - playerVx * 0.25;
        const spreadY = -4.5 - Math.random() * 4.5;
        const spreadZ = (Math.random() - 0.5) * 2.2;
        this.spawnPlasma(
          n.x + (Math.random() - 0.5) * 0.06,
          n.y,
          n.z + (Math.random() - 0.5) * 0.06,
          spreadX,
          spreadY,
          spreadZ,
          0.22 + Math.random() * 0.16,
          0.26 + Math.random() * 0.22,
          0.45 + Math.random() * 0.55
        );
      }
      for (let k = 0; k < 7; k++) {
        this.spawnPlume(
          n.x, n.y - 0.08, n.z,
          (Math.random() - 0.5) * 2.8 - playerVx * 0.15,
          -1.8 - Math.random() * 1.8,
          (Math.random() - 0.5) * 1.8,
          0.55 + Math.random() * 0.30,
          0.68 + Math.random() * 0.38
        );
      }
    }
  }

  /**
   * Per-frame GPU particle simulation & emission
   */
  public update(
    dt: number,
    throttle: number, // 0.0 = off, 0.01..1.0 = thrusting
    nozzleL: THREE.Vector3,
    nozzleR: THREE.Vector3,
    playerVx: number,
    playerVy: number,
    surfaceY: number,
    isHyper: boolean,
    isHoverHanging: boolean = false
  ) {
    // Fast 0.00ms idle bypass when not thrusting and all particles have faded out!
    if (throttle <= 0.02 && !isHoverHanging && !this.anyAlive) {
      return;
    }

    // 1. Emit new particles proportional to analog throttle (or HUGE billowious white clouds during 1s hover-hang!)
    if (isHoverHanging) {
      // Giant, billowious Saturn-V style cushion of puffy white clouds beneath both chrome nozzles!
      this.plumeAccum += 135 * dt;
      let flip = false;
      while (this.plumeAccum >= 1) {
        this.plumeAccum -= 1;
        const n = flip ? nozzleL : nozzleR;
        flip = !flip;
        this.spawnPlume(
          n.x + (Math.random() - 0.5) * 0.38,
          n.y - 0.18,
          n.z + (Math.random() - 0.5) * 0.38,
          playerVx * 0.14 + (Math.random() - 0.5) * 3.4,
          -1.5 - Math.random() * 1.6,
          (Math.random() - 0.5) * 2.8,
          0.95 + Math.random() * 0.58,
          1.15 + Math.random() * 0.80
        );
        const lastIdx = (this.plumeCursor + JetpackThrusterVFX.PLUME_COUNT - 1) % JetpackThrusterVFX.PLUME_COUNT;
        this.plumeAlpha[lastIdx] = 0.85;
      }
    } else if (throttle > 0.02) {
      const plasmaRate = (isHyper ? 155 : 115) * (0.45 + 0.55 * throttle);
      const plumeRate = (isHyper ? 85 : 68) * (0.45 + 0.55 * throttle);
      this.plasmaAccum += plasmaRate * dt;
      this.plumeAccum += plumeRate * dt;

      let flip = false;
      while (this.plasmaAccum >= 1) {
        this.plasmaAccum -= 1;
        const n = flip ? nozzleL : nozzleR;
        flip = !flip;
        const jetSpeed = (6.5 + 4.5 * throttle) * (isHyper ? 1.25 : 1.0);
        this.spawnPlasma(
          n.x + (Math.random() - 0.5) * 0.05,
          n.y - 0.02,
          n.z + (Math.random() - 0.5) * 0.05,
          playerVx * 0.28 + (Math.random() - 0.5) * 1.4,
          playerVy * 0.15 - jetSpeed - Math.random() * 2.2,
          (Math.random() - 0.5) * 1.1,
          0.18 + Math.random() * 0.16,
          (0.22 + Math.random() * 0.22) * (0.7 + 0.4 * throttle),
          isHyper ? (0.72 + Math.random() * 0.28) : (0.55 + Math.random() * 0.45)
        );
      }

      while (this.plumeAccum >= 1) {
        this.plumeAccum -= 1;
        const n = flip ? nozzleL : nozzleR;
        flip = !flip;
        this.spawnPlume(
          n.x + (Math.random() - 0.5) * 0.16,
          n.y - 0.18,
          n.z + (Math.random() - 0.5) * 0.16,
          playerVx * 0.16 + (Math.random() - 0.5) * 2.2,
          -2.4 - Math.random() * 2.0 * throttle,
          (Math.random() - 0.5) * 1.8,
          0.65 + Math.random() * 0.42,
          0.62 + Math.random() * 0.46
        );
      }
    }

    // 2. Simulate Plasma & Embers
    let stillAlive = false;
    const pc = JetpackThrusterVFX.PLASMA_COUNT;
    const floorY = surfaceY + 0.06;
    for (let i = 0; i < pc; i++) {
      const age = this.plasmaAge[i];
      const max = this.plasmaMax[i];
      if (age >= max) {
        this.plasmaAlpha[i] = 0;
        continue;
      }
      stillAlive = true;
      const nextAge = age + dt;
      this.plasmaAge[i] = nextAge;
      const t = nextAge / max;
      const i3 = i * 3;

      // Drag + subtle curl
      this.plasmaVel[i3] *= 0.94;
      this.plasmaVel[i3 + 1] *= 0.95;
      this.plasmaVel[i3 + 2] *= 0.94;

      let nx = this.plasmaPos[i3] + this.plasmaVel[i3] * dt;
      let ny = this.plasmaPos[i3 + 1] + this.plasmaVel[i3 + 1] * dt;
      let nz = this.plasmaPos[i3 + 2] + this.plasmaVel[i3 + 2] * dt;

      // Ground-wash radial deflection!
      if (ny < floorY) {
        ny = floorY;
        const fanSpeed = Math.abs(this.plasmaVel[i3 + 1]) * 0.55;
        this.plasmaVel[i3] += (Math.random() - 0.5) * fanSpeed * 1.6;
        this.plasmaVel[i3 + 2] += (Math.random() - 0.5) * fanSpeed * 1.2;
        this.plasmaVel[i3 + 1] = Math.abs(this.plasmaVel[i3 + 1]) * 0.15;
      }

      this.plasmaPos[i3] = nx;
      this.plasmaPos[i3 + 1] = ny;
      this.plasmaPos[i3 + 2] = nz;

      // Cool down temperature over lifetime (white-cyan -> electric cyan -> amber ember)
      this.plasmaTemp[i] = Math.max(0, this.plasmaTemp[i] - dt * 2.4);
      this.plasmaAlpha[i] = (1.0 - t) * (1.0 - t);
    }

    // 3. Simulate Silky Atmospheric Plume
    const sc = JetpackThrusterVFX.PLUME_COUNT;
    for (let i = 0; i < sc; i++) {
      const age = this.plumeAge[i];
      const max = this.plumeMax[i];
      if (age >= max) {
        this.plumeAlpha[i] = 0;
        continue;
      }
      stillAlive = true;
      const nextAge = age + dt;
      this.plumeAge[i] = nextAge;
      const t = nextAge / max;
      const i3 = i * 3;

      this.plumeVel[i3] *= 0.93;
      this.plumeVel[i3 + 1] = this.plumeVel[i3 + 1] * 0.92 + 0.65 * dt; // Gentle buoyancy rise as it cools
      this.plumeVel[i3 + 2] *= 0.93;

      let nx = this.plumePos[i3] + this.plumeVel[i3] * dt;
      let ny = this.plumePos[i3 + 1] + this.plumeVel[i3 + 1] * dt;
      let nz = this.plumePos[i3 + 2] + this.plumeVel[i3 + 2] * dt;

      if (ny < floorY + 0.08) {
        ny = floorY + 0.08;
        this.plumeVel[i3] += (Math.random() - 0.5) * 1.8;
        this.plumeVel[i3 + 1] = Math.max(0.2, this.plumeVel[i3 + 1]);
      }

      this.plumePos[i3] = nx;
      this.plumePos[i3 + 1] = ny;
      this.plumePos[i3 + 2] = nz;

      // Dramatic billowious expansion & velvety bell-curve fade (huge puffy hover & exhaust clouds!)
      this.plumeSize[i] += dt * 2.95;
      const fadeIn = Math.min(1, t * 5.0);
      const fadeOut = (1.0 - t) * (1.0 - t);
      this.plumeAlpha[i] = fadeIn * fadeOut * (this.plumeSize[i] > 1.35 ? 0.68 : 0.48);
    }

    this.anyAlive = stillAlive;
    // Upload buffers to GPU
    (this.plasmaGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.plasmaGeo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.plasmaGeo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (this.plasmaGeo.attributes.aTemp as THREE.BufferAttribute).needsUpdate = true;

    (this.plumeGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.plumeGeo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.plumeGeo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  public reset() {
    this.plasmaAge.fill(99);
    this.plasmaAlpha.fill(0);
    this.plumeAge.fill(99);
    this.plumeAlpha.fill(0);
    this.anyAlive = false;
    (this.plasmaGeo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (this.plumeGeo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}
