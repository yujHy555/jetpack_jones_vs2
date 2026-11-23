import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GROUND_Y } from './Player';

export interface CarInputState {
  throttle: number;   // 0..1 forward
  brake: number;      // 0..1 brake / reverse
  steer: number;      // -1 (right) .. +1 (left)
  drift: boolean;     // Space / Shift / Gamepad B/RB
  boost: boolean;     // Shift / F / Gamepad Y/LB
}

interface WheelRig {
  steerPivot: THREE.Group;
  spinPivot: THREE.Group;
  isFront: boolean;
  isRear: boolean;
  localOffset: THREE.Vector3;
}

interface SkidRibbon {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  positions: Float32Array;
  colors: Float32Array;
  alphas: Float32Array;
  headQuad: number;
  hasPrev: boolean;
  prevLeft: THREE.Vector3;
  prevRight: THREE.Vector3;
}

interface SmokePuff {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vel: THREE.Vector3;
  age: number;
  maxLife: number;
  baseScale: number;
  active: boolean;
}

/**
 * Triple-AAA Arcade Drift Car Rig (`car_01.glb`)
 * - Auto-rigs body + 4 independent wheel hubs (front steering + 4-wheel velocity-matched spin)
 * - OutRun / Burnout / Forza Horizon arcade drift physics with lateral slip, counter-steer & drift mini-turbo
 * - Spring-damped chassis roll, acceleration squat & braking nose-dive
 * - Next-Gen Dual Continuous Ribbon Skid-Mark System (2 draw calls, zero GC, vertex-alpha slip shading)
 * - Billowing GPU Drift Tire Smoke & Twin Turbo Exhaust Flames
 */
export class ArcadeCarRig {
  public group: THREE.Group;
  private bodyPivot: THREE.Group;
  private vfxGroup: THREE.Group;
  public isLoaded: boolean = false;

  // Physics State
  public position: THREE.Vector3 = new THREE.Vector3(0, GROUND_Y, 0);
  public heading: number = 0; // Radians around Y (0 = facing +Z)
  public velX: number = 0;
  public velY: number = 0;
  public velZ: number = 0;
  public forwardSpeed: number = 0;
  public lateralSpeed: number = 0;
  public steerAngle: number = 0;
  public driftAmount: number = 0;    // 0..1 live slip intensity
  public driftCharge: number = 0;    // 0..1 mini-turbo charge built while drifting
  public boostTimer: number = 0;
  public speedKmh: number = 0;
  public isAirborne: boolean = false;
  public onCurbIntensity: number = 0;
  public onLand?: (impactSpeed: number) => void;

  // Chassis Suspension Spring State
  private rollAngle: number = 0;
  private pitchAngle: number = 0;
  private terrainPitch: number = 0;
  private terrainRoll: number = 0;
  private suspensionBounceY: number = 0;
  private suspensionBounceVel: number = 0;
  private prevWheelSurfaceH: number[] = [GROUND_Y, GROUND_Y, GROUND_Y, GROUND_Y];
  private wheelSpin: number = 0;
  private readonly wheelRadius: number = 0.353;

  // Rigged Wheels
  private wheels: WheelRig[] = [];
  private rearWheels: WheelRig[] = [];

  // Exhaust Turbo Flames & Pure Soft Emission Tail-Light Glows (NO rectangular planes!)
  private exhaustFlames: THREE.Mesh[] = [];
  private brakeGlowSprites: THREE.Sprite[] = [];

  // Next-Gen Continuous Ribbon Skid Marks (Rear-Left + Rear-Right = 2 draw calls total!)
  private static readonly MAX_SKID_QUADS = 340;
  private skidRibbons: SkidRibbon[] = [];
  private skidEmitAccum: number = 0;

  // Drift Tire Smoke Pool
  private smokePool: SmokePuff[] = [];
  private smokeEmitAccum: number = 0;

  // Next-Gen Single-Draw-Call GPU Undercarriage Landing Sparks Shader (96 sparks, 0 GC!)
  private static readonly MAX_LAND_SPARKS = 96;
  private landSparkPoints!: THREE.Points;
  private landSparkGeo!: THREE.BufferGeometry;
  private landSparkPos = new Float32Array(ArcadeCarRig.MAX_LAND_SPARKS * 3);
  private landSparkVel = new Float32Array(ArcadeCarRig.MAX_LAND_SPARKS * 3);
  private landSparkHeat = new Float32Array(ArcadeCarRig.MAX_LAND_SPARKS);
  private landSparkAge = new Float32Array(ArcadeCarRig.MAX_LAND_SPARKS).fill(99);
  private landSparkMax = new Float32Array(ArcadeCarRig.MAX_LAND_SPARKS).fill(1);
  private landSparkFloorY = new Float32Array(ArcadeCarRig.MAX_LAND_SPARKS).fill(GROUND_Y);
  private landSparkCursor: number = 0;
  private landSparksAlive: boolean = false;

  // Zero-GC Scratch Math
  private readonly _wheelWorld = new THREE.Vector3();
  private readonly _rightVec = new THREE.Vector3();
  private readonly _curL = new THREE.Vector3();
  private readonly _curR = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    this.group.name = 'ArcadeCarRoot';
    this.group.position.copy(this.position);
    this.group.visible = false;
    scene.add(this.group);

    this.bodyPivot = new THREE.Group();
    this.bodyPivot.name = 'ArcadeCarBodyPivot';
    this.group.add(this.bodyPivot);

    this.vfxGroup = new THREE.Group();
    this.vfxGroup.name = 'ArcadeCarVFX';
    this.vfxGroup.visible = false;
    scene.add(this.vfxGroup);

    this.initSkidMarkRibbons();
    this.initTireSmokePool();
    this.initLandingSparksShader();
    this.initExhaustAndLights();
    this.loadCarModel('/models/car/car_01.glb');
  }

  public setVisible(visible: boolean) {
    this.group.visible = visible;
    this.vfxGroup.visible = visible;
  }

  public reset(x: number = 0, z: number = 0, heading: number = 0) {
    this.position.set(x, GROUND_Y, z);
    this.heading = heading;
    this.velX = 0;
    this.velY = 0;
    this.velZ = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.steerAngle = 0;
    this.driftAmount = 0;
    this.driftCharge = 0;
    this.boostTimer = 0;
    this.speedKmh = 0;
    this.isAirborne = false;
    this.onCurbIntensity = 0;
    this.rollAngle = 0;
    this.pitchAngle = 0;
    this.terrainPitch = 0;
    this.terrainRoll = 0;
    this.suspensionBounceY = 0;
    this.suspensionBounceVel = 0;
    this.prevWheelSurfaceH.fill(GROUND_Y);
    this.group.position.copy(this.position);
    this.group.rotation.set(0, this.heading, 0);
    this.bodyPivot.rotation.set(0, 0, 0);
    this.bodyPivot.position.set(0, 0, 0);
    this.clearSkidMarks();
    for (const s of this.smokePool) {
      s.active = false;
      s.mesh.visible = false;
    }
  }

  private async loadCarModel(url: string) {
    const loader = new GLTFLoader();
    const texLoader = new THREE.TextureLoader();
    try {
      const [gltf, bodyDiffuseTex] = await Promise.all([
        loader.loadAsync(url),
        texLoader.loadAsync('/models/car/car_body_diffuse.jpg?v=2').catch(() => null)
      ]);
      if (bodyDiffuseTex) {
        bodyDiffuseTex.flipY = false; // glTF UV convention!
        bodyDiffuseTex.colorSpace = THREE.SRGBColorSpace;
        bodyDiffuseTex.anisotropy = 8;
        bodyDiffuseTex.needsUpdate = true;
      }
      const root = gltf.scene;

      const wheelNodes: THREE.Object3D[] = [];
      const bodyNodes: THREE.Object3D[] = [];

      // Separate car body and the 4 wheel nodes cleanly
      const children = [...root.children];
      for (const child of children) {
        const nameLower = child.name.toLowerCase();
        child.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const m = obj as THREE.Mesh;
            m.castShadow = true;
            m.receiveShadow = true;
            m.frustumCulled = false;
            const mat = m.material as THREE.MeshStandardMaterial;
            if (mat && 'envMapIntensity' in mat) {
              mat.envMapIntensity = 0.65;
              if (bodyDiffuseTex && mat.name.toLowerCase().includes('body')) {
                mat.map = bodyDiffuseTex;
                mat.needsUpdate = true;
              }
            }
          }
        });
        if (nameLower.includes('wheel')) {
          wheelNodes.push(child);
        } else {
          bodyNodes.push(child);
        }
      }

      for (const b of bodyNodes) {
        this.bodyPivot.add(b);
      }

      // Mount each of the 4 wheels inside a clean (steerPivot -> spinPivot -> wheelMesh) hierarchy!
      // Verified GLB coordinates: Front axle Z = +1.635, Rear axle Z = -1.468, Y = 0.350, X = ±0.914
      for (const wNode of wheelNodes) {
        const hubPos = wNode.position.clone();
        const isFront = hubPos.z > 0;
        const isRear = !isFront;

        const steerPivot = new THREE.Group();
        steerPivot.name = `WheelSteer_${wNode.name}`;
        steerPivot.position.copy(hubPos);

        const spinPivot = new THREE.Group();
        spinPivot.name = `WheelSpin_${wNode.name}`;
        steerPivot.add(spinPivot);

        // Zero local translation on the wheel mesh since steerPivot is already at the exact hub center!
        wNode.position.set(0, 0, 0);
        spinPivot.add(wNode);
        this.group.add(steerPivot);

        const rig: WheelRig = {
          steerPivot,
          spinPivot,
          isFront,
          isRear,
          localOffset: hubPos
        };
        this.wheels.push(rig);
        if (isRear) {
          this.rearWheels.push(rig);
        }
      }

      // Sort rear wheels left (+X) then right (-X) to match skidRibbons[0], [1]
      this.rearWheels.sort((a, b) => b.localOffset.x - a.localOffset.x);
      this.isLoaded = true;
    } catch (err) {
      console.error('[ArcadeCarRig] Failed to load car_01.glb:', err);
    }
  }

  private initExhaustAndLights() {
    // Twin Rear Turbo Exhaust Flames (at Z = -2.62, X = ±0.48, Y = 0.34)
    const flameGeo = new THREE.ConeGeometry(0.11, 0.85, 10, 1, true);
    flameGeo.rotateX(-Math.PI / 2); // Point backward along -Z!
    flameGeo.translate(0, 0, -0.42);
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xff8822,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    for (const ex of [-0.52, 0.52]) {
      const f = new THREE.Mesh(flameGeo, flameMat);
      f.position.set(ex, 0.34, -2.56);
      f.visible = false;
      this.bodyPivot.add(f);
      this.exhaustFlames.push(f);
    }

    // Pure Soft Radial Tail-Light Emission Bloom (NO hard red rectangular planes!)
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 64;
    glowCanvas.height = 64;
    const gCtx = glowCanvas.getContext('2d')!;
    const gRad = gCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
    gRad.addColorStop(0.0, 'rgba(255, 110, 90, 1.0)');
    gRad.addColorStop(0.32, 'rgba(255, 24, 38, 0.78)');
    gRad.addColorStop(0.68, 'rgba(210, 0, 20, 0.22)');
    gRad.addColorStop(1.0, 'rgba(180, 0, 0, 0.0)');
    gCtx.fillStyle = gRad;
    gCtx.fillRect(0, 0, 64, 64);
    const glowTex = new THREE.CanvasTexture(glowCanvas);

    for (const tx of [-0.74, 0.74]) {
      const sMat = new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xff2233,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const sprite = new THREE.Sprite(sMat);
      sprite.position.set(tx, 0.78, -2.66);
      sprite.scale.set(0.68, 0.42, 1);
      this.bodyPivot.add(sprite);
      this.brakeGlowSprites.push(sprite);
    }
  }

  /**
   * Next-Gen Dual Continuous Ribbon Skid-Mark System
   * Pre-allocated ring buffer of 340 quads per rear wheel with smooth vertex-alpha rubber shading!
   */
  private initSkidMarkRibbons() {
    const maxQuads = ArcadeCarRig.MAX_SKID_QUADS;
    const vertCount = maxQuads * 6; // 2 triangles per quad

    // Custom vertex-alpha dark rubber skid-mark shader (crisp asphalt grip marks, zero z-fighting!)
    const skidMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
      vertexShader: `
        attribute float aAlpha;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vAlpha = aAlpha;
          vColor = color;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision mediump float;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          if (vAlpha < 0.01) discard;
          gl_FragColor = vec4(vColor, vAlpha);
        }
      `,
      vertexColors: true
    });
    skidMat.customProgramCacheKey = () => 'ArcadeCarSkidRibbonV1';

    for (let w = 0; w < 2; w++) {
      const geo = new THREE.BufferGeometry();
      const positions = new Float32Array(vertCount * 3);
      const colors = new Float32Array(vertCount * 3);
      const alphas = new Float32Array(vertCount);

      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

      const mesh = new THREE.Mesh(geo, skidMat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.vfxGroup.add(mesh);

      this.skidRibbons.push({
        mesh,
        geo,
        positions,
        colors,
        alphas,
        headQuad: 0,
        hasPrev: false,
        prevLeft: new THREE.Vector3(),
        prevRight: new THREE.Vector3()
      });
    }
  }

  public clearSkidMarks() {
    for (const r of this.skidRibbons) {
      r.alphas.fill(0);
      r.headQuad = 0;
      r.hasPrev = false;
      (r.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private pushSkidQuad(ribbon: SkidRibbon, intensity: number, wheelCenterWorld: THREE.Vector3, rightDir: THREE.Vector3, surfaceY: number = GROUND_Y) {
    const halfTireW = 0.145;
    const y = surfaceY + 0.022;

    this._curL.set(
      wheelCenterWorld.x + rightDir.x * halfTireW,
      y,
      wheelCenterWorld.z + rightDir.z * halfTireW
    );
    this._curR.set(
      wheelCenterWorld.x - rightDir.x * halfTireW,
      y,
      wheelCenterWorld.z - rightDir.z * halfTireW
    );

    if (!ribbon.hasPrev) {
      ribbon.prevLeft.copy(this._curL);
      ribbon.prevRight.copy(this._curR);
      ribbon.hasPrev = true;
      return;
    }

    // Skip if barely moved
    const distSq = ribbon.prevLeft.distanceToSquared(this._curL);
    if (distSq < 0.025) return;
    // Break ribbon cleanly on teleport/reset
    if (distSq > 9.0) {
      ribbon.prevLeft.copy(this._curL);
      ribbon.prevRight.copy(this._curR);
      return;
    }

    const q = ribbon.headQuad;
    const baseV = q * 6;
    const p = ribbon.positions;
    const c = ribbon.colors;
    const a = ribbon.alphas;

    const pL = ribbon.prevLeft;
    const pR = ribbon.prevRight;
    const cL = this._curL;
    const cR = this._curR;

    // Tri 1: pL, pR, cL | Tri 2: pR, cR, cL
    const verts = [pL, pR, cL, pR, cR, cL];
    const alphaVal = THREE.MathUtils.clamp(intensity * 0.78, 0.10, 0.82);
    // Hot drift rubber dark charcoal (with subtle warm scorch tint on mega drifts)
    const rCol = 0.05 + intensity * 0.03;
    const gCol = 0.05;
    const bCol = 0.06;

    for (let i = 0; i < 6; i++) {
      const vi = baseV + i;
      const v3 = vi * 3;
      p[v3] = verts[i].x;
      p[v3 + 1] = verts[i].y;
      p[v3 + 2] = verts[i].z;
      c[v3] = rCol;
      c[v3 + 1] = gCol;
      c[v3 + 2] = bCol;
      a[vi] = alphaVal;
    }

    ribbon.prevLeft.copy(cL);
    ribbon.prevRight.copy(cR);
    ribbon.headQuad = (ribbon.headQuad + 1) % ArcadeCarRig.MAX_SKID_QUADS;

    (ribbon.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (ribbon.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (ribbon.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  private initTireSmokePool() {
    // Soft radial cloud canvas texture for lush billowing tire smoke
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    grad.addColorStop(0, 'rgba(245, 245, 250, 0.85)');
    grad.addColorStop(0.45, 'rgba(220, 224, 232, 0.45)');
    grad.addColorStop(1, 'rgba(200, 205, 215, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);

    const tex = new THREE.CanvasTexture(canvas);
    const geo = new THREE.PlaneGeometry(1.0, 1.0);

    for (let i = 0; i < 72; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.vfxGroup.add(mesh);
      this.smokePool.push({
        mesh,
        mat,
        vel: new THREE.Vector3(),
        age: 0,
        maxLife: 0.7,
        baseScale: 0.55,
        active: false
      });
    }
  }

  /**
   * Next-Gen Single-Draw-Call GPU Blackbody-Cooling Undercarriage Landing Sparks Shader
   * Shoots glowing molten sparks outward to BOTH sides of the car when landing from ramps!
   */
  private initLandingSparksShader() {
    const N = ArcadeCarRig.MAX_LAND_SPARKS;
    this.landSparkGeo = new THREE.BufferGeometry();
    this.landSparkGeo.setAttribute('position', new THREE.BufferAttribute(this.landSparkPos, 3));
    this.landSparkGeo.setAttribute('aHeat', new THREE.BufferAttribute(this.landSparkHeat, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        attribute float aHeat;
        varying float vHeat;
        void main() {
          vHeat = aHeat;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPos;
          float sz = mix(10.0, 26.0, aHeat) * (16.0 / max(1.0, -mvPos.z));
          gl_PointSize = aHeat > 0.01 ? clamp(sz, 2.0, 32.0) : 0.0;
        }
      `,
      fragmentShader: `
        precision mediump float;
        varying float vHeat;
        void main() {
          if (vHeat <= 0.01) discard;
          vec2 uv = gl_PointCoord - 0.5;
          float r2 = dot(uv, uv);
          if (r2 > 0.25) discard;
          float core = exp(-r2 * 24.0);
          float halo = smoothstep(0.25, 0.0, r2);
          // Blackbody cooling: white-hot -> molten gold -> fiery orange-red embers!
          vec3 coolCol = vec3(1.0, 0.28, 0.04);
          vec3 midCol  = vec3(1.0, 0.78, 0.18);
          vec3 hotCol  = vec3(1.0, 0.98, 0.88);
          vec3 col = vHeat > 0.55
            ? mix(midCol, hotCol, (vHeat - 0.55) / 0.45)
            : mix(coolCol, midCol, vHeat / 0.55);
          float alpha = clamp((core * 1.15 + halo * 0.55) * vHeat, 0.0, 1.0);
          gl_FragColor = vec4(col, alpha);
        }
      `
    });
    mat.customProgramCacheKey = () => 'CarLandingSparksV1';

    this.landSparkPoints = new THREE.Points(this.landSparkGeo, mat);
    this.landSparkPoints.frustumCulled = false;
    this.landSparkPoints.visible = false;
    this.vfxGroup.add(this.landSparkPoints);
    for (let i = 0; i < N; i++) {
      this.landSparkPos[i * 3 + 1] = -9999;
      this.landSparkHeat[i] = 0;
    }
  }

  private emitLandingSparksBothSides(
    surfaceY: number,
    fwdX: number,
    fwdZ: number,
    rightX: number,
    rightZ: number,
    impactSpeed: number
  ) {
    const N = ArcadeCarRig.MAX_LAND_SPARKS;
    const count = Math.min(64, Math.floor(28 + impactSpeed * 3.5));
    const power = THREE.MathUtils.clamp(impactSpeed / 8.0, 0.65, 1.65);

    for (let k = 0; k < count; k++) {
      const i = this.landSparkCursor;
      this.landSparkCursor = (this.landSparkCursor + 1) % N;

      // Alternate left (+1) and right (-1) sides of the car undercarriage!
      const side = (k % 2 === 0) ? 1 : -1;
      const along = (Math.random() - 0.5) * 3.4; // Spread along chassis sills
      const outOffset = side * (1.05 + Math.random() * 0.2);

      const p3 = i * 3;
      this.landSparkPos[p3]     = this.position.x + rightX * outOffset + fwdX * along;
      this.landSparkPos[p3 + 1] = surfaceY + 0.14 + Math.random() * 0.12;
      this.landSparkPos[p3 + 2] = this.position.z + rightZ * outOffset + fwdZ * along;

      const sideSpd = (5.5 + Math.random() * 7.5) * power * side;
      const fwdCarry = 0.55 + Math.random() * 0.35;
      this.landSparkVel[p3]     = this.velX * fwdCarry + rightX * sideSpd + (Math.random() - 0.5) * 2.0;
      this.landSparkVel[p3 + 1] = (2.2 + Math.random() * 4.4) * power;
      this.landSparkVel[p3 + 2] = this.velZ * fwdCarry + rightZ * sideSpd + (Math.random() - 0.5) * 2.0;

      this.landSparkAge[i] = 0;
      this.landSparkMax[i] = 0.35 + Math.random() * 0.42;
      this.landSparkHeat[i] = 1.0;
      this.landSparkFloorY[i] = surfaceY + 0.03;
    }

    this.landSparksAlive = true;
    this.landSparkPoints.visible = true;
  }

  private updateLandingSparks(dt: number) {
    if (!this.landSparksAlive) return;
    const N = ArcadeCarRig.MAX_LAND_SPARKS;
    let any = false;
    for (let i = 0; i < N; i++) {
      if (this.landSparkAge[i] >= this.landSparkMax[i]) {
        if (this.landSparkHeat[i] > 0) {
          this.landSparkHeat[i] = 0;
          this.landSparkPos[i * 3 + 1] = -9999;
        }
        continue;
      }
      this.landSparkAge[i] += dt;
      const prog = this.landSparkAge[i] / this.landSparkMax[i];
      if (prog >= 1.0) {
        this.landSparkHeat[i] = 0;
        this.landSparkPos[i * 3 + 1] = -9999;
        continue;
      }
      any = true;
      const p3 = i * 3;
      this.landSparkVel[p3 + 1] -= 22.0 * dt;
      this.landSparkPos[p3]     += this.landSparkVel[p3] * dt;
      this.landSparkPos[p3 + 1] += this.landSparkVel[p3 + 1] * dt;
      this.landSparkPos[p3 + 2] += this.landSparkVel[p3 + 2] * dt;

      // Crisp spark bounce off asphalt!
      if (this.landSparkPos[p3 + 1] < this.landSparkFloorY[i]) {
        this.landSparkPos[p3 + 1] = this.landSparkFloorY[i];
        this.landSparkVel[p3 + 1] = Math.abs(this.landSparkVel[p3 + 1]) * 0.48;
        this.landSparkVel[p3] *= 0.82;
        this.landSparkVel[p3 + 2] *= 0.82;
      }
      this.landSparkHeat[i] = Math.pow(1.0 - prog, 0.85);
    }
    this.landSparksAlive = any;
    this.landSparkPoints.visible = any;
    (this.landSparkGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.landSparkGeo.attributes.aHeat as THREE.BufferAttribute).needsUpdate = true;
  }

  private emitTireSmoke(wx: number, wy: number, wz: number, intensity: number) {
    const puff = this.smokePool.find((p) => !p.active);
    if (!puff) return;
    puff.active = true;
    puff.age = 0;
    puff.maxLife = 0.55 + Math.random() * 0.45;
    puff.baseScale = 0.42 + intensity * 0.35 + Math.random() * 0.25;
    puff.mesh.position.set(
      wx + (Math.random() - 0.5) * 0.25,
      wy + 0.16,
      wz + (Math.random() - 0.5) * 0.25
    );
    puff.vel.set(
      this.velX * 0.18 + (Math.random() - 0.5) * 2.2,
      1.2 + Math.random() * 1.4,
      this.velZ * 0.18 + (Math.random() - 0.5) * 2.2
    );
    puff.mesh.scale.setScalar(puff.baseScale);
    puff.mesh.visible = true;
  }

  public update(
    dt: number,
    input: CarInputState,
    cameraPos: THREE.Vector3,
    arenaLimit: number = 96.0,
    getSurfaceInfo?: (x: number, z: number) => { height: number; isCurb: boolean },
    resolveHorizontal?: (prevX: number, prevY: number, prevZ: number, nextX: number, nextZ: number, radius?: number) => {
      x: number;
      z: number;
      hitWall: boolean;
      normalX: number;
      normalZ: number;
    }
  ) {
    const safeDt = Math.min(dt, 0.05);

    // Forward (+Z local) & Right (+X local) unit vectors in world XZ plane
    const fwdX = Math.sin(this.heading);
    const fwdZ = Math.cos(this.heading);
    const rightX = Math.cos(this.heading);
    const rightZ = -Math.sin(this.heading);

    // Decompose current world velocity into car-local forward & lateral components
    let vFwd = this.velX * fwdX + this.velZ * fwdZ;
    let vLat = this.velX * rightX + this.velZ * rightZ;

    // 1. Arcade Acceleration, Braking, Reverse & Turbo Boost
    if (this.boostTimer > 0) {
      this.boostTimer = Math.max(0, this.boostTimer - safeDt);
    }
    const isBoosting = this.boostTimer > 0 || (input.boost && input.throttle > 0.1 && this.driftCharge > 0.25);
    if (input.boost && this.driftCharge > 0.25 && this.boostTimer <= 0) {
      this.boostTimer = 0.65 + this.driftCharge * 0.85;
      this.driftCharge = 0;
    }

    const maxSpeed = isBoosting ? 46.0 : 34.0;
    const maxReverse = -13.0;
    const accelRate = isBoosting ? 36.0 : 22.5;
    const brakeRate = 32.0;

    let longAccel = 0;
    if (input.throttle > 0.01) {
      if (vFwd < -0.5) {
        longAccel = brakeRate * input.throttle;
      } else {
        const speedRatio = THREE.MathUtils.clamp(vFwd / maxSpeed, 0, 1);
        longAccel = accelRate * (1.0 - speedRatio * 0.58) * input.throttle;
      }
    }
    if (input.brake > 0.01) {
      if (vFwd > 0.8) {
        longAccel -= brakeRate * input.brake;
      } else {
        longAccel -= 15.0 * input.brake;
      }
    }
    if (isBoosting) {
      longAccel += 14.0;
    }

    // Natural free-rolling coasting drag (NO automatic braking when letting off the gas!)
    const drag = (input.throttle < 0.02 && input.brake < 0.02) ? 0.36 : 0.24;
    vFwd += longAccel * safeDt;
    vFwd *= Math.max(0, 1.0 - drag * safeDt);
    if (Math.abs(vFwd) < 0.08 && input.throttle < 0.02 && input.brake < 0.02) vFwd = 0;
    vFwd = THREE.MathUtils.clamp(vFwd, maxReverse, maxSpeed);

    // 2. Responsive Arcade Steering + Drift Initiation & Counter-Steer!
    const speedAbs = Math.abs(vFwd);
    const speedFactor = THREE.MathUtils.clamp(speedAbs / 5.5, 0, 1);
    const highSpeedSteerScale = THREE.MathUtils.lerp(1.0, 0.72, THREE.MathUtils.clamp(speedAbs / 34.0, 0, 1));
    const targetSteerAngle = input.steer * 0.52 * highSpeedSteerScale;
    this.steerAngle = THREE.MathUtils.lerp(this.steerAngle, targetSteerAngle, Math.min(1, safeDt * 12.0));

    const wantsDrift = (input.drift && speedAbs > 6.5) || (Math.abs(vLat) > 4.2 && speedAbs > 8.0);
    const dirSign = vFwd >= -0.2 ? 1 : -1;

    // Yaw rate: punchier during drift so you can hold epic sweeping power-slides!
    const baseTurnRate = wantsDrift ? 2.85 : 2.25;
    const yawRate = input.steer * baseTurnRate * speedFactor * dirSign;
    this.heading += yawRate * safeDt;

    // Recompute forward & right after yaw step
    const newFwdX = Math.sin(this.heading);
    const newFwdZ = Math.cos(this.heading);
    const newRightX = Math.cos(this.heading);
    const newRightZ = -Math.sin(this.heading);

    // Kick the rear out slightly when initiating a handbrake drift!
    if (input.drift && speedAbs > 8.0 && Math.abs(input.steer) > 0.15) {
      vLat -= input.steer * 14.5 * safeDt;
      // Preserve speed through arcade drift so drifting feels fast & rewarding!
      vFwd = Math.max(vFwd, Math.min(maxSpeed * 0.86, speedAbs * 0.996));
    }

    // Lateral Grip: crisp grip normally, lush controlled slip while drifting!
    const lateralGrip = input.drift ? 1.85 : (Math.abs(vLat) > 3.5 ? 3.8 : 9.8);
    vLat *= Math.max(0, 1.0 - lateralGrip * safeDt);
    vLat = THREE.MathUtils.clamp(vLat, -18.5, 18.5);

    // Reconstruct world velocity
    this.velX = newFwdX * vFwd + newRightX * vLat;
    this.velZ = newFwdZ * vFwd + newRightZ * vLat;
    this.forwardSpeed = vFwd;
    this.lateralSpeed = vLat;
    this.speedKmh = Math.round(Math.hypot(this.velX, this.velZ) * 3.6);

    // Integrate world position + solid ramp side-wall collisions + perimeter boundary bounce!
    const prevX = this.position.x;
    const prevZ = this.position.z;
    let nextX = prevX + this.velX * safeDt;
    let nextZ = prevZ + this.velZ * safeDt;

    if (resolveHorizontal) {
      const res = resolveHorizontal(prevX, this.position.y, prevZ, nextX, nextZ, this.heading);
      nextX = res.x;
      nextZ = res.z;
      if (res.hitWall) {
        // Slide cleanly along the solid ramp side/back wall and gently deflect heading parallel so it NEVER wedges!
        const dotIn = this.velX * res.normalX + this.velZ * res.normalZ;
        if (dotIn < 0) {
          this.velX -= res.normalX * dotIn * 1.15;
          this.velZ -= res.normalZ * dotIn * 1.15;
          this.velX *= 0.88;
          this.velZ *= 0.88;
        }
      }
    }

    this.position.x = nextX;
    this.position.z = nextZ;
    if (Math.abs(this.position.x) > arenaLimit) {
      this.position.x = Math.sign(this.position.x) * arenaLimit;
      this.velX *= -0.42;
    }
    if (Math.abs(this.position.z) > arenaLimit) {
      this.position.z = Math.sign(this.position.z) * arenaLimit;
      this.velZ *= -0.42;
    }

    // Compute live drift intensity (0..1) and build Drift Mini-Turbo charge!
    const slipRatio = THREE.MathUtils.clamp((Math.abs(vLat) - 1.8) / 8.5, 0, 1);
    const hardBrakeSlip = (input.brake > 0.5 && speedAbs > 10.0) ? 0.65 : 0;
    const handbrakeSlip = (input.drift && speedAbs > 5.0) ? 0.60 : 0;
    const targetDrift = Math.max(slipRatio, hardBrakeSlip, handbrakeSlip);
    this.driftAmount = THREE.MathUtils.lerp(this.driftAmount, targetDrift, Math.min(1, safeDt * 12.0));

    if (slipRatio > 0.30 && speedAbs > 9.0) {
      this.driftCharge = Math.min(1.0, this.driftCharge + safeDt * 0.45);
    } else if (!input.drift && this.driftCharge > 0.48) {
      // Automatic arcade Drift Mini-Turbo release when straightening out of a sick drift!
      this.boostTimer = Math.max(this.boostTimer, 0.55 + this.driftCharge * 0.65);
      this.driftCharge = 0;
    } else {
      this.driftCharge = Math.max(0, this.driftCharge - safeDt * 0.35);
    }

    // 3. 4-Wheel Surface Sampling (Raised FIA Curbs + 2 Stunt/Testing Ramps + 3D Airborne Jumps!)
    const sampleSurf = (wx: number, wz: number) => getSurfaceInfo ? getSurfaceInfo(wx, wz) : { height: GROUND_Y, isCurb: false };
    // Wheel local offsets: FL(+0.91,+1.63), FR(-0.91,+1.63), RL(+0.91,-1.47), RR(-0.91,-1.47)
    const wOffsets = [
      [ 0.91,  1.63],
      [-0.91,  1.63],
      [ 0.91, -1.47],
      [-0.91, -1.47]
    ];
    let hFL = GROUND_Y, hFR = GROUND_Y, hRL = GROUND_Y, hRR = GROUND_Y;
    let curbHits = 0;
    let bumpImpulse = 0;

    for (let i = 0; i < 4; i++) {
      const lx = wOffsets[i][0];
      const lz = wOffsets[i][1];
      const wx = this.position.x + newRightX * lx + newFwdX * lz;
      const wz = this.position.z + newRightZ * lx + newFwdZ * lz;
      const s = sampleSurf(wx, wz);
      // Guard: never allow a wheel grazing the outer ramp wall to snap vertically > 0.55m above chassis height!
      const h = (s.height > this.position.y + 0.55) ? this.position.y : s.height;
      if (i === 0) hFL = h;
      else if (i === 1) hFR = h;
      else if (i === 2) hRL = h;
      else hRR = h;
      if (s.isCurb) curbHits++;
      // Tactile suspension bump impulse whenever a wheel climbs onto or drops off a raised curb!
      const dh = h - this.prevWheelSurfaceH[i];
      if (!this.isAirborne && Math.abs(dh) > 0.04 && Math.abs(dh) < 0.35 && speedAbs > 2.5) {
        bumpImpulse += dh * (0.45 + Math.min(1, speedAbs / 24.0) * 0.65);
      }
      this.prevWheelSurfaceH[i] = h;
    }

    this.onCurbIntensity = curbHits > 0 ? Math.min(1, curbHits * 0.55) : 0;
    const avgFrontH = (hFL + hFR) * 0.5;
    const avgRearH = (hRL + hRR) * 0.5;
    const avgLeftH = (hFL + hRL) * 0.5;
    const avgRightH = (hFR + hRR) * 0.5;
    // Also sample center chassis so the car belly/bumpers NEVER penetrate the ramp entry or crest!
    const centerH = sampleSurf(this.position.x, this.position.z).height;
    const avgWheelH = (hFL + hFR + hRL + hRR) * 0.25;
    const onSlopeBoost = Math.abs(avgFrontH - avgRearH) > 0.08 ? 0.06 : 0;
    const targetGroundY = Math.max(avgWheelH, centerH) + onSlopeBoost;
    const targetTerrainPitch = Math.atan2(avgRearH - avgFrontH, 3.10); // Nose-up = negative rotX in +Z forward space!
    const targetTerrainRoll = Math.atan2(avgRightH - avgLeftH, 1.82);

    // Vertical Ramp Launch & Airborne Gravity Physics!
    const prevY = this.position.y;
    const wasAirborne = this.isAirborne;
    if (!this.isAirborne) {
      const slopeRise = (targetGroundY - prevY) / Math.max(0.008, safeDt);
      if (targetGroundY < prevY - 0.16 && this.velY > 1.2) {
        // Launched cleanly off the lip of a stunt ramp into airborne flight!
        this.isAirborne = true;
      } else if (targetGroundY < prevY - 0.28) {
        // Dropped off a high tabletop edge!
        this.isAirborne = true;
        this.velY = Math.max(this.velY, 0);
      } else {
        this.position.y = targetGroundY;
        this.velY = THREE.MathUtils.lerp(this.velY, THREE.MathUtils.clamp(slopeRise, -4, 15), Math.min(1, safeDt * 18));
      }
    }

    if (this.isAirborne) {
      this.velY -= 24.0 * safeDt;
      this.position.y += this.velY * safeDt;
      if (this.position.y <= targetGroundY) {
        const impactSpd = Math.abs(this.velY);
        this.position.y = targetGroundY;
        this.velY = 0;
        this.isAirborne = false;
        // Spring-damped suspension compression + dual-side GPU undercarriage sparks + thud on landing!
        this.suspensionBounceVel -= Math.min(2.4, impactSpd * 0.22);
        if (wasAirborne && impactSpd > 2.2) {
          this.emitLandingSparksBothSides(targetGroundY, newFwdX, newFwdZ, newRightX, newRightZ, impactSpd);
          this.onLand?.(impactSpd);
        }
      }
    }

    // Spring-damper for curb jolts & landing compression
    if (Math.abs(bumpImpulse) > 0.001) {
      this.suspensionBounceVel += THREE.MathUtils.clamp(bumpImpulse * 3.8, -1.6, 1.6);
    }
    const springAcc = -this.suspensionBounceY * 95.0 - this.suspensionBounceVel * 11.5;
    this.suspensionBounceVel += springAcc * safeDt;
    this.suspensionBounceY = THREE.MathUtils.clamp(this.suspensionBounceY + this.suspensionBounceVel * safeDt, -0.14, 0.14);

    // Smooth terrain pitch/roll alignment (levels out gracefully in mid-air!)
    const desiredPitch = this.isAirborne ? THREE.MathUtils.clamp(-this.velY * 0.028, -0.32, 0.28) : targetTerrainPitch;
    const desiredRoll = this.isAirborne ? 0 : targetTerrainRoll;
    this.terrainPitch = THREE.MathUtils.lerp(this.terrainPitch, desiredPitch, Math.min(1, safeDt * 12.0));
    this.terrainRoll = THREE.MathUtils.lerp(this.terrainRoll, desiredRoll, Math.min(1, safeDt * 14.0));

    // Apply Car Transform + Spring-Damped Suspension Body Roll & Pitch!
    this.group.position.set(this.position.x, this.position.y, this.position.z);
    this.group.rotation.order = 'YXZ';
    this.group.rotation.set(this.terrainPitch, this.heading, this.terrainRoll);

    const targetRoll = THREE.MathUtils.clamp(-vLat * 0.011 - input.steer * speedFactor * 0.045, -0.11, 0.11);
    const targetPitch = THREE.MathUtils.clamp(-longAccel * 0.0022, -0.055, 0.055);
    this.rollAngle = THREE.MathUtils.lerp(this.rollAngle, targetRoll, Math.min(1, safeDt * 10.0));
    this.pitchAngle = THREE.MathUtils.lerp(this.pitchAngle, targetPitch, Math.min(1, safeDt * 11.0));
    this.bodyPivot.rotation.set(this.pitchAngle, 0, this.rollAngle);
    const curbRumbleVib = (!this.isAirborne && this.onCurbIntensity > 0 && speedAbs > 2)
      ? Math.sin(performance.now() * 0.085) * 0.024 * this.onCurbIntensity
      : 0;
    this.bodyPivot.position.y = this.suspensionBounceY + curbRumbleVib + Math.sin(performance.now() * 0.032) * (0.004 + this.driftAmount * 0.009);

    // 4. Animate 4 Wheels (Front Steering + 4-Wheel Spin)
    const wheelSpinSpeed = (vFwd / this.wheelRadius) * (input.drift && input.throttle > 0.2 ? 1.35 : 1.0);
    this.wheelSpin += wheelSpinSpeed * safeDt;
    for (const w of this.wheels) {
      if (w.isFront) {
        w.steerPivot.rotation.y = this.steerAngle;
      }
      w.spinPivot.rotation.x = this.wheelSpin;
    }

    // 5. Pure Radial Tail-Light Emission Bloom & Twin Turbo Exhaust Flames
    const brakingNow = input.brake > 0.1 || input.drift;
    for (const sp of this.brakeGlowSprites) {
      const sm = sp.material as THREE.SpriteMaterial;
      sm.opacity = brakingNow ? 0.96 : 0.30;
      const s = brakingNow ? 1.25 : 0.85;
      sp.scale.set(0.68 * s, 0.42 * s, 1);
    }
    const showFlames = isBoosting || (this.driftCharge > 0.55 && input.throttle > 0.3);
    for (const f of this.exhaustFlames) {
      f.visible = showFlames;
      if (showFlames) {
        const flick = 0.8 + Math.random() * 0.55;
        f.scale.set(isBoosting ? 1.25 : 0.85, isBoosting ? 1.25 : 0.85, (isBoosting ? 1.55 : 0.9) * flick);
        (f.material as THREE.MeshBasicMaterial).color.setHex(isBoosting ? 0x22e8ff : 0xff7722);
      }
    }

    // 6. Next-Gen Continuous Skid Marks & Billowing Drift Tire Smoke (only when tires touch ground!)
    this.group.updateMatrixWorld(true);
    this._rightVec.set(newRightX, 0, newRightZ);
    const shouldSkid = !this.isAirborne && this.driftAmount > 0.22 && speedAbs > 3.5;

    this.skidEmitAccum += safeDt;
    if (shouldSkid && this.skidEmitAccum >= 0.016) {
      this.skidEmitAccum = 0;
      for (let i = 0; i < Math.min(2, this.rearWheels.length); i++) {
        this.rearWheels[i].steerPivot.getWorldPosition(this._wheelWorld);
        const wSurf = sampleSurf(this._wheelWorld.x, this._wheelWorld.z);
        this.pushSkidQuad(this.skidRibbons[i], this.driftAmount, this._wheelWorld, this._rightVec, wSurf.height);
      }
    } else if (!shouldSkid) {
      for (const r of this.skidRibbons) {
        r.hasPrev = false;
      }
    }

    this.smokeEmitAccum += safeDt;
    if (shouldSkid && this.driftAmount > 0.28 && this.smokeEmitAccum >= 0.028) {
      this.smokeEmitAccum = 0;
      for (let i = 0; i < Math.min(2, this.rearWheels.length); i++) {
        this.rearWheels[i].steerPivot.getWorldPosition(this._wheelWorld);
        const wSurf = sampleSurf(this._wheelWorld.x, this._wheelWorld.z);
        this.emitTireSmoke(this._wheelWorld.x, wSurf.height, this._wheelWorld.z, this.driftAmount);
      }
    }

    // Update active tire smoke puffs (billboard cleanly toward camera)
    for (const s of this.smokePool) {
      if (!s.active) continue;
      s.age += safeDt;
      if (s.age >= s.maxLife) {
        s.active = false;
        s.mesh.visible = false;
        continue;
      }
      const p = s.age / s.maxLife;
      s.mesh.position.addScaledVector(s.vel, safeDt);
      s.vel.multiplyScalar(Math.max(0, 1.0 - safeDt * 2.5));
      const sc = s.baseScale * (1.0 + p * 3.2);
      s.mesh.scale.setScalar(sc);
      s.mat.opacity = (1.0 - p) * (1.0 - p) * 0.58;
      s.mesh.lookAt(cameraPos);
    }

    // Update GPU Undercarriage Landing Sparks (0.00ms when inactive!)
    this.updateLandingSparks(safeDt);
  }
}
