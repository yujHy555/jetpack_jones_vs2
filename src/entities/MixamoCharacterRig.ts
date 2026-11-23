import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PlayerState } from './Player';

type AnimKey = 'idle' | 'walk' | 'run' | 'jump' | 'fly' | 'shoot' | 'death' | 'crouch_walk' | 'slide' | 'jetpack_land';
export type JetpackModelId = 'mk79' | 'economist';

/**
 * Next-Gen Triple-AAA Mixamo Character Rig & 1979 Retro Chrome Jetpack
 * - Loads skinned T-Pose.fbx + baked PBR Diffuse & Normal maps
 * - Auto-normalizes height & foot grounding to match the exact 1.92m platformer collider
 * - Strips horizontal root motion from Mixamo hips tracks (zero sliding / drift)
 * - Smooth cross-fading AnimationMixer with velocity-synced stride speed
 * - Distinct athletic 2nd Jump (no spin: crisp air-surge tuck + dual-ring shockwave + nozzle burst)
 * - Sculptural 1979 Retro Chrome Jetpack mounted directly onto Spine2 with glowing Mach cones & LEDs
 */
export class MixamoCharacterRig {
  public readonly container: THREE.Group;
  private readonly visualPivot: THREE.Group;
  private model: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<AnimKey, THREE.AnimationAction>> = {};
  private lowerActions: Partial<Record<AnimKey, THREE.AnimationAction>> = {};
  private shootUpperAction: THREE.AnimationAction | null = null;
  private activeKey: AnimKey | null = null;
  private activeLowerKey: AnimKey | null = null;
  private shootAnimTimer: number = 0;
  private shootUpperWeight: number = 0;
  private shootHolsterTimer: number = 0;
  private muzzleFlashTimer: number = 0;
  private shootAimStartTime: number = 0.45;
  private targetAimAngle: number = 0; // World-space aim angle in XY plane (0 = +X right, PI = -X left)
  private landAnimTimer: number = 0;

  // Scratch vectors/quaternions for zero-GC world-space shooting arm alignment
  private readonly _pArm = new THREE.Vector3();
  private readonly _pHand = new THREE.Vector3();
  private readonly _curDir = new THREE.Vector3();
  private readonly _desDir = new THREE.Vector3();
  private readonly _qDelta = new THREE.Quaternion();
  private readonly _qParentWorld = new THREE.Quaternion();
  private readonly _qParentInv = new THREE.Quaternion();
  private readonly _qLocalDelta = new THREE.Quaternion();
  private readonly _qIdent = new THREE.Quaternion();

  // Colt Peacemaker Revolver Assembly (mounted to Mixamo RightHand during shooting!)
  private gunPivot: THREE.Group | null = null;
  private gunMuzzleTip: THREE.Object3D | null = null;
  private gunMuzzleFlash: THREE.Mesh | null = null;

  public isLoaded: boolean = false;
  public onLoaded?: () => void;
  public onProgress?: (pct: number, label: string) => void;
  public onFootstep?: (mode: 'walk' | 'run' | 'crouch') => void;
  private prevFootCycleNorm: number = -1;
  private prevFootMode: 'walk' | 'run' | 'crouch' | null = null;
  public readyPromise: Promise<void>;

  // Pre-allocated scratch math for zero-GC per-frame gun basis & forward-cone alignment
  private readonly _gunWorldUp = new THREE.Vector3(0, 1, 0);
  private readonly _gunSide = new THREE.Vector3();
  private readonly _gunUp = new THREE.Vector3();
  private readonly _gunBasisMat = new THREE.Matrix4();
  private readonly _qGunWorld = new THREE.Quaternion();
  private readonly _charFwd = new THREE.Vector3();
  private readonly _charRight = new THREE.Vector3();
  public use3DForwardAim: boolean = false;

  // Bone anchors
  private rightShoulderBone: THREE.Object3D | null = null;
  private rightArmBone: THREE.Object3D | null = null;
  private rightForeArmBone: THREE.Object3D | null = null;
  private spineRootBone: THREE.Object3D | null = null;
  private rightHandBone: THREE.Object3D | null = null;
  private spineBone: THREE.Object3D | null = null;
  private leftFootBone: THREE.Object3D | null = null;
  private rightFootBone: THREE.Object3D | null = null;
  private readonly _qFootSlope = new THREE.Quaternion();
  private readonly _footAxisX = new THREE.Vector3(1, 0, 0);
  private readonly tmpWorldPos = new THREE.Vector3();

  // 1979 Retro Chrome Jetpack Assembly ("MK-79") + Older Vintage Industrial Model ("The Economist")
  private jetpackGroup: THREE.Group | null = null;
  private economistJetpackGroup: THREE.Group | null = null;
  public currentJetpackModel: JetpackModelId = 'mk79';
  private nozzleLeft: THREE.Object3D | null = null;
  private nozzleRight: THREE.Object3D | null = null;
  private mk79NozzleL: THREE.Object3D | null = null;
  private mk79NozzleR: THREE.Object3D | null = null;
  private econNozzleL: THREE.Object3D | null = null;
  private econNozzleR: THREE.Object3D | null = null;
  private flameOuterL: THREE.Mesh | null = null;
  private flameOuterR: THREE.Mesh | null = null;
  private flameCoreL: THREE.Mesh | null = null;
  private flameCoreR: THREE.Mesh | null = null;
  private nozzleGlowMat: THREE.MeshBasicMaterial | null = null;
  private ledLeftMat: THREE.MeshBasicMaterial | null = null;
  private ledRightMat: THREE.MeshBasicMaterial | null = null;
  private jetpackClock: number = 0;

  // Procedural Next-Gen Polish State
  private squashY: number = 1.0;
  private squashVel: number = 0.0;
  private leanPitch: number = 0.0;
  private slopePitchSmooth: number = 0.0;
  private slopeRollSmooth: number = 0.0;
  private doubleJumpSurgeTimer: number = 0.0;
  private crouchBlend: number = 0.0;
  private baseModelY: number = 0.0;
  private baseScale: number = 1.0;

  // Dual-Ring Double-Jump Air-Burst VFX (Outer Cyan + Inner 1979 Gold)
  private ringMesh: THREE.Mesh;
  private ringInnerMesh: THREE.Mesh;
  private ringAge: number = 99;
  private ringMat: THREE.MeshBasicMaterial;
  private ringInnerMat: THREE.MeshBasicMaterial;

  constructor(private readonly scene: THREE.Scene) {
    this.container = new THREE.Group();
    this.container.name = 'MixamoJonesContainer';

    this.visualPivot = new THREE.Group();
    this.visualPivot.name = 'MixamoJonesVisualPivot';
    this.container.add(this.visualPivot);

    // Outer Cyan Shockwave Ring
    const ringGeo = new THREE.RingGeometry(0.20, 0.44, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0x00f5ff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.ringMesh = new THREE.Mesh(ringGeo, this.ringMat);
    this.ringMesh.visible = false;
    this.scene.add(this.ringMesh);

    // Inner Retro Gold Air-Burst Ring
    const innerGeo = new THREE.RingGeometry(0.10, 0.24, 32);
    innerGeo.rotateX(-Math.PI / 2);
    this.ringInnerMat = new THREE.MeshBasicMaterial({
      color: 0xffaa33,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.ringInnerMesh = new THREE.Mesh(innerGeo, this.ringInnerMat);
    this.ringInnerMesh.visible = false;
    this.scene.add(this.ringInnerMesh);

    this.readyPromise = this.loadAssets();
  }

  private async loadAssets() {
    const fbxLoader = new FBXLoader();
    const texLoader = new THREE.TextureLoader();

    const baseUrl = '/models/jones';
    const totalSteps = 13; // base rig + PBR + Colt + 10 clips
    let completedSteps = 0;
    const reportProgress = (label: string) => {
      completedSteps = Math.min(totalSteps, completedSteps + 1);
      this.onProgress?.(Math.round((completedSteps / totalSteps) * 88), label);
    };

    try {
      this.onProgress?.(5, 'LOADING JONES 3D CHARACTER & PBR TEXTURES...');
      const [baseModel, diffuseTex, normalTex] = await Promise.all([
        fbxLoader.loadAsync(`${baseUrl}/T-Pose.fbx`),
        texLoader.loadAsync(`${baseUrl}/Wolf3D_Outfit_Footwear_Bake1_PBR_Diffuse.1001.png`),
        texLoader.loadAsync(`${baseUrl}/Wolf3D_Outfit_Footwear_Bake1_PBR_Normal.1001.png`)
      ]);
      reportProgress('JONES RIG & TEXTURES READY');

      diffuseTex.colorSpace = THREE.SRGBColorSpace;
      diffuseTex.anisotropy = 8;
      diffuseTex.needsUpdate = true;

      normalTex.anisotropy = 8;
      normalTex.needsUpdate = true;

      const characterMat = new THREE.MeshStandardMaterial({
        map: diffuseTex,
        normalMap: normalTex,
        normalScale: new THREE.Vector2(0.85, 0.85),
        roughness: 0.72,
        metalness: 0.06,
        envMapIntensity: 0.35
      });

      baseModel.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.material = characterMat;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.frustumCulled = false;
        }
        const n = obj.name.toLowerCase();
        if (!this.rightHandBone && (n.includes('righthand') || n.endsWith('right_hand'))) {
          this.rightHandBone = obj;
        }
        if (!this.rightShoulderBone && (n.includes('rightshoulder') || n.endsWith('right_shoulder'))) {
          this.rightShoulderBone = obj;
        }
        if (!this.rightArmBone && (n.includes('rightarm') || n.endsWith('right_arm')) && !n.includes('fore')) {
          this.rightArmBone = obj;
        }
        if (!this.rightForeArmBone && (n.includes('rightforearm') || n.endsWith('right_forearm'))) {
          this.rightForeArmBone = obj;
        }
        if (!this.spineRootBone && (n.endsWith('spine') || n.endsWith(':spine')) && !n.includes('spine1') && !n.includes('spine2')) {
          this.spineRootBone = obj;
        }
        if (!this.spineBone && n.includes('spine2')) {
          this.spineBone = obj;
        }
        if (!this.leftFootBone && (n.includes('leftfoot') || n.endsWith('left_foot')) && !n.includes('toe')) {
          this.leftFootBone = obj;
        }
        if (!this.rightFootBone && (n.includes('rightfoot') || n.endsWith('right_foot')) && !n.includes('toe')) {
          this.rightFootBone = obj;
        }
      });
      if (!this.spineBone) {
        baseModel.traverse((obj) => {
          if (!this.spineBone && obj.name.toLowerCase().includes('spine1')) {
            this.spineBone = obj;
          }
        });
      }

      // Auto-normalize height to 1.92m and flush-ground feet at y = 0
      baseModel.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(baseModel);
      const size = new THREE.Vector3();
      box.getSize(size);
      const rawHeight = Math.max(0.01, size.y);
      const targetHeight = 1.92;
      this.baseScale = targetHeight / rawHeight;

      baseModel.scale.setScalar(this.baseScale);
      baseModel.updateMatrixWorld(true);

      const scaledBox = new THREE.Box3().setFromObject(baseModel);
      this.baseModelY = -scaledBox.min.y;
      baseModel.position.set(0, this.baseModelY, 0);

      // Mixamo characters face +Z by default; rotate +90° around Y so facingRight (rigRoot.rotY = 0) faces +X!
      baseModel.rotation.y = Math.PI / 2;

      this.model = baseModel;
      this.visualPivot.add(baseModel);

      // Mount sculptural 1979 Retro Chrome Jetpack onto Spine2
      this.build1979RetroChromeJetpack();

      // Load & mount Colt Peacemaker revolver onto Mixamo RightHand (awaited so it's 100% ready before frame 1!)
      const coltPromise = this.loadColtPeacemaker(`${baseUrl}/colt_peacemaker.glb`).then(() => {
        reportProgress('COLT PEACEMAKER CALIBRATED');
      });

      this.mixer = new THREE.AnimationMixer(baseModel);

      // Load all Mixamo animation clips in parallel (including Jetpack Fly, Landing, Shoot, Death, Crouch Walk & Running Slide!)
      const clipFiles: Record<AnimKey, string> = {
        idle: `${baseUrl}/Idle_2.fbx`,
        walk: `${baseUrl}/Walking.fbx`,
        run: `${baseUrl}/Running.fbx`,
        jump: `${baseUrl}/Jumping.fbx`,
        fly: `${baseUrl}/jetpack_fly.fbx`,
        jetpack_land: `${baseUrl}/jetpack_landing.fbx`,
        shoot: `${baseUrl}/shoot.fbx`,
        death: `${baseUrl}/death.fbx`,
        crouch_walk: `${baseUrl}/crouch_walk.fbx`,
        slide: `${baseUrl}/slide.fbx`
      };

      const entries = Object.entries(clipFiles) as [AnimKey, string][];
      await Promise.all([
        coltPromise,
        ...entries.map(async ([key, url]) => {
          try {
            const animObj = await fbxLoader.loadAsync(url);
            if (animObj.animations && animObj.animations.length > 0) {
              const clip = this.sanitizeMixamoClip(animObj.animations[0], key);
              const action = this.mixer!.clipAction(clip);
              if (key === 'jump' || key === 'shoot' || key === 'death' || key === 'slide' || key === 'jetpack_land') {
                action.setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true;
              } else {
                action.setLoop(THREE.LoopRepeat, Infinity);
              }
              this.actions[key] = action;

              // Build Upper-Body Shoot overlay AND Lower-Body locomotion companions so shooting has 100% upper-body authority
              // over Jetpack Flying, Running, Sliding, Walking, Jumping, and Crouching (zero 50/50 arm-swing fighting!)
              if (key === 'shoot') {
                // Skip the Mixamo raise-arm wind-up completely -> start directly at the extended straight-arm firing pose!
                this.shootAimStartTime = clip.duration * 0.46;
                const upperClip = this.extractUpperBodyClip(clip, 'shoot_upper');
                if (upperClip.tracks.length > 0) {
                  const upperAct = this.mixer!.clipAction(upperClip);
                  upperAct.setLoop(THREE.LoopOnce, 1);
                  upperAct.clampWhenFinished = true;
                  upperAct.enabled = true;
                  upperAct.setEffectiveWeight(0);
                  this.shootUpperAction = upperAct;
                }
              } else if (key !== 'death') {
                const lowerClip = this.extractLowerBodyClip(clip, `${key}_lower`);
                if (lowerClip.tracks.length > 0) {
                  const lowerAct = this.mixer!.clipAction(lowerClip);
                  if (key === 'jump' || key === 'slide') {
                    lowerAct.setLoop(THREE.LoopOnce, 1);
                    lowerAct.clampWhenFinished = true;
                  } else {
                    lowerAct.setLoop(THREE.LoopRepeat, Infinity);
                  }
                  lowerAct.enabled = true;
                  lowerAct.setEffectiveWeight(0);
                  this.lowerActions[key] = lowerAct;
                }
              }
            }
          } catch (err) {
            console.warn(`[MixamoCharacterRig] Failed to load clip "${key}" from ${url}:`, err);
          } finally {
            reportProgress(`ANIMATION READY: ${key.toUpperCase()}`);
          }
        })
      ]);

      // Start right at the clean straight-arm Colt aiming/recoil frame (28% into shoot.fbx)
      if (this.actions.shoot) {
        this.shootAimStartTime = this.actions.shoot.getClip().duration * 0.28;
      }

      this.playAction('idle', 0.05);
      this.isLoaded = true;
      this.onLoaded?.();
      console.log('⚡ [MixamoCharacterRig] Jones + 1979 Retro Chrome Jetpack ready!', Object.keys(this.actions));
    } catch (err) {
      console.error('[MixamoCharacterRig] Failed to load T-Pose.fbx or PBR maps:', err);
    }
  }

  /**
   * Builds a sculptural 1979 Retro-Futuristic Mirror-Chrome Jetpack
   * and mounts it cleanly onto Mixamo Spine2 so it tracks torso motion 1:1.
   */
  private build1979RetroChromeJetpack() {
    const jp = new THREE.Group();
    jp.name = 'Retro1979ChromeJetpack';

    // Materials: Mirror Chrome, Brushed Titanium, 1979 Racing Red-Orange, Vintage Cream Stripe
    const mirrorChrome = new THREE.MeshStandardMaterial({
      color: 0xeaf0f6,
      metalness: 0.96,
      roughness: 0.08
    });
    const brushedMetal = new THREE.MeshStandardMaterial({
      color: 0x8a95a3,
      metalness: 0.85,
      roughness: 0.28
    });
    const darkTitanium = new THREE.MeshStandardMaterial({
      color: 0x22262e,
      metalness: 0.65,
      roughness: 0.42
    });
    const retroRed = new THREE.MeshStandardMaterial({
      color: 0xe63b1e,
      metalness: 0.25,
      roughness: 0.25
    });
    const retroCream = new THREE.MeshStandardMaterial({
      color: 0xfff3db,
      metalness: 0.15,
      roughness: 0.30
    });

    this.nozzleGlowMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.35
    });

    // Twin Mirror-Chrome Propellant Tanks (Left & Right — generous radial clearances = ZERO Z-fighting!)
    const tankGeo = new THREE.CylinderGeometry(0.088, 0.088, 0.36, 20);
    const capGeo = new THREE.SphereGeometry(0.088, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const bandRedGeo = new THREE.CylinderGeometry(0.095, 0.095, 0.046, 20);
    const bandCreamGeo = new THREE.CylinderGeometry(0.094, 0.094, 0.018, 20);
    const strapGeo = new THREE.CylinderGeometry(0.099, 0.099, 0.022, 20);
    const bellGeo = new THREE.CylinderGeometry(0.046, 0.076, 0.11, 18, 1, true);
    const glowRingGeo = new THREE.TorusGeometry(0.056, 0.012, 10, 20);
    glowRingGeo.rotateX(Math.PI / 2);

    // Animated Mach-Diamond Plasma Cones (Outer Cyan Sheath + Inner White-Hot Core)
    const outerFlameGeo = new THREE.ConeGeometry(0.068, 0.42, 14, 1, true);
    outerFlameGeo.translate(0, -0.21, 0);
    const innerFlameGeo = new THREE.ConeGeometry(0.036, 0.28, 12, 1, true);
    innerFlameGeo.translate(0, -0.14, 0);

    const outerFlameMat = new THREE.MeshBasicMaterial({
      color: 0x18e0ff,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const innerFlameMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const tankOffsets = [-0.115, 0.115];
    tankOffsets.forEach((tx, idx) => {
      const tankGroup = new THREE.Group();
      tankGroup.position.set(tx, 0, 0);

      const body = new THREE.Mesh(tankGeo, mirrorChrome);
      body.castShadow = true;
      tankGroup.add(body);

      const topCap = new THREE.Mesh(capGeo, mirrorChrome);
      topCap.position.y = 0.18;
      tankGroup.add(topCap);

      const botCap = new THREE.Mesh(capGeo, brushedMetal);
      botCap.rotation.x = Math.PI;
      botCap.position.y = -0.18;
      tankGroup.add(botCap);

      // 1979 Vintage Racing Stripes
      const redBand = new THREE.Mesh(bandRedGeo, retroRed);
      redBand.position.y = 0.075;
      tankGroup.add(redBand);

      const creamBand = new THREE.Mesh(bandCreamGeo, retroCream);
      creamBand.position.y = 0.038;
      tankGroup.add(creamBand);

      // Brushed Titanium Clamps
      const strapTop = new THREE.Mesh(strapGeo, darkTitanium);
      strapTop.position.y = 0.135;
      tankGroup.add(strapTop);

      const strapBot = new THREE.Mesh(strapGeo, darkTitanium);
      strapBot.position.y = -0.11;
      tankGroup.add(strapBot);

      // Flared Bell Thruster Nozzle
      const nozzle = new THREE.Group();
      nozzle.position.set(0, -0.25, -0.01);
      nozzle.rotation.x = -0.10; // Slight rear vector cant

      const bell = new THREE.Mesh(bellGeo, darkTitanium);
      nozzle.add(bell);

      const bellRim = new THREE.Mesh(glowRingGeo, this.nozzleGlowMat!);
      bellRim.position.y = -0.048;
      nozzle.add(bellRim);

      // Mach-Diamond Thruster Flame Cones
      const fOuter = new THREE.Mesh(outerFlameGeo, outerFlameMat);
      fOuter.position.y = -0.05;
      fOuter.visible = false;
      nozzle.add(fOuter);

      const fCore = new THREE.Mesh(innerFlameGeo, innerFlameMat);
      fCore.position.y = -0.045;
      fCore.visible = false;
      nozzle.add(fCore);

      // Exact tip anchor for GPU particle emission
      const tip = new THREE.Object3D();
      tip.position.set(0, -0.06, 0);
      nozzle.add(tip);

      if (idx === 0) {
        this.nozzleLeft = tip;
        this.flameOuterL = fOuter;
        this.flameCoreL = fCore;
      } else {
        this.nozzleRight = tip;
        this.flameOuterR = fOuter;
        this.flameCoreR = fCore;
      }

      tankGroup.add(nozzle);
      jp.add(tankGroup);
    });

    // Central Brushed-Steel Manifold Bridge
    const manifold = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.24, 0.11), brushedMetal);
    manifold.position.set(0, 0.01, -0.01);
    manifold.castShadow = true;
    jp.add(manifold);

    // Top Chrome Exhaust Fin / Handlebar Arch
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.016, 10, 20, Math.PI), mirrorChrome);
    arch.position.set(0, 0.18, -0.01);
    jp.add(arch);

    // 1979 Analog Pressure Gauge Dial on back of manifold (clean Z separation = ZERO Z-fighting!)
    const dialBezel = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.018, 18), mirrorChrome);
    dialBezel.rotation.x = Math.PI / 2;
    dialBezel.position.set(0, 0.04, -0.068);
    jp.add(dialBezel);

    const dialFace = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.008, 18), retroCream);
    dialFace.rotation.x = Math.PI / 2;
    dialFace.position.set(0, 0.04, -0.079);
    jp.add(dialFace);

    // Twin Blinking 1979 Status LEDs
    const ledGeo = new THREE.SphereGeometry(0.014, 10, 10);
    this.ledLeftMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
    this.ledRightMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });

    const ledL = new THREE.Mesh(ledGeo, this.ledLeftMat);
    ledL.position.set(-0.042, -0.045, -0.076);
    jp.add(ledL);

    const ledR = new THREE.Mesh(ledGeo, this.ledRightMat);
    ledR.position.set(0.042, -0.045, -0.076);
    jp.add(ledR);

    // Retro Swept Stabilizer Finlets (Left & Right)
    const finGeo = new THREE.BoxGeometry(0.095, 0.13, 0.016);
    const finL = new THREE.Mesh(finGeo, mirrorChrome);
    finL.position.set(-0.22, -0.04, -0.02);
    finL.rotation.z = 0.35;
    jp.add(finL);

    const finR = new THREE.Mesh(finGeo, mirrorChrome);
    finR.position.set(0.22, -0.04, -0.02);
    finR.rotation.z = -0.35;
    jp.add(finR);

    // Mount cleanly onto Spine2 (tight against upper back so jetpack moves 1:1 with torso and never floats!)
    if (this.spineBone) {
      const inv = 1.0 / Math.max(0.0001, this.baseScale);
      jp.scale.setScalar(inv);
      // Mixamo Spine2: +Y = up, -Z = directly behind upper back
      jp.position.set(0, 0.04 * inv, -0.155 * inv);
      this.spineBone.add(jp);
    } else if (this.model) {
      jp.position.set(0, 1.25 / this.baseScale, -0.18 / this.baseScale);
      jp.scale.setScalar(1.0 / this.baseScale);
      this.model.add(jp);
    }

    this.jetpackGroup = jp;
    this.mk79NozzleL = this.nozzleLeft;
    this.mk79NozzleR = this.nozzleRight;

    // Also build the older vintage budget model: "THE ECONOMIST" (1968 boxy riveted steel & brass!)
    this.buildEconomistVintageJetpack();
    this.setJetpackModel(this.currentJetpackModel);
  }

  /**
   * Builds "THE ECONOMIST" — an older, boxy, riveted 1968 utilitarian industrial jetpack:
   * weathered olive-drab steel tank, hammered brass boiler cap, exposed copper fuel lines,
   * welded dark-iron square exhaust shrouds, oversized analog pressure dial & patched bolts!
   */
  private buildEconomistVintageJetpack() {
    const ep = new THREE.Group();
    ep.name = 'TheEconomistVintageJetpack';

    const oliveSteel = new THREE.MeshStandardMaterial({
      color: 0x5c6650,
      metalness: 0.48,
      roughness: 0.62
    });
    const dullIron = new THREE.MeshStandardMaterial({
      color: 0x33302c,
      metalness: 0.62,
      roughness: 0.54
    });
    const vintageBrass = new THREE.MeshStandardMaterial({
      color: 0xb0863a,
      metalness: 0.78,
      roughness: 0.34
    });
    const copperPipe = new THREE.MeshStandardMaterial({
      color: 0xb86535,
      metalness: 0.80,
      roughness: 0.32
    });
    const creamDial = new THREE.MeshStandardMaterial({
      color: 0xeadfc4,
      roughness: 0.45,
      metalness: 0.05
    });
    const hazardOchre = new THREE.MeshStandardMaterial({
      color: 0xd97a26,
      roughness: 0.55,
      metalness: 0.12
    });

    // 1. Boxy Rectangular Main Riveted Fuel Tank (classic utilitarian older-model silhouette!)
    const mainTank = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.44, 0.16), oliveSteel);
    mainTank.position.set(0, 0.02, -0.02);
    ep.add(mainTank);

    // Welded iron reinforcement strap bands around the boxy tank (clear of warning plate = ZERO Z-fighting!)
    const bandGeo = new THREE.BoxGeometry(0.365, 0.034, 0.184);
    for (const by of [0.168, -0.145]) {
      const band = new THREE.Mesh(bandGeo, dullIron);
      band.position.set(0, by, -0.02);
      ep.add(band);
    }

    // 8 Chunky Corner Rivet Bolts on the rear face (cleanly offset from tank back at -0.100)
    const boltGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.012, 6);
    boltGeo.rotateX(Math.PI / 2);
    for (const bx of [-0.14, 0.14]) {
      for (const by of [0.205, 0.06, -0.06, -0.185]) {
        const bolt = new THREE.Mesh(boltGeo, vintageBrass);
        bolt.position.set(bx, by, -0.112);
        ep.add(bolt);
      }
    }

    // 2. Top Cylindrical Brass Auxiliary Reserve Boiler Drum
    const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.30, 14), vintageBrass);
    boiler.rotation.z = Math.PI / 2;
    boiler.position.set(0, 0.275, -0.02);
    ep.add(boiler);

    // Pressure relief valve cap on top
    const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.028, 0.05, 10), copperPipe);
    valve.position.set(0.09, 0.34, -0.02);
    ep.add(valve);

    // 3. Exposed External Copper Fuel Feed Pipes on both sides
    const pipeGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.34, 8);
    for (const sx of [-0.195, 0.195]) {
      const pipe = new THREE.Mesh(pipeGeo, copperPipe);
      pipe.position.set(sx, 0.02, -0.01);
      ep.add(pipe);

      const elbowTop = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.036, 0.036), vintageBrass);
      elbowTop.position.set(sx * 0.9, 0.18, -0.01);
      ep.add(elbowTop);

      const elbowBot = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.036, 0.036), vintageBrass);
      elbowBot.position.set(sx * 0.9, -0.14, -0.01);
      ep.add(elbowBot);
    }

    // 4. Oversized Analog Brass Boiler Gauge on back + Vintage Ochre Warning Plate (strict Z-layering = ZERO Z-fighting!)
    const gaugeRim = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.022, 16), vintageBrass);
    gaugeRim.rotation.x = Math.PI / 2;
    gaugeRim.position.set(0, 0.065, -0.114);
    ep.add(gaugeRim);

    const gaugeFace = new THREE.Mesh(new THREE.CylinderGeometry(0.050, 0.050, 0.008, 16), creamDial);
    gaugeFace.rotation.x = Math.PI / 2;
    gaugeFace.position.set(0, 0.065, -0.128);
    ep.add(gaugeFace);

    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.040, 0.006), dullIron);
    needle.position.set(0.008, 0.072, -0.136);
    needle.rotation.z = -0.45;
    ep.add(needle);

    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.060, 0.010), hazardOchre);
    plate.position.set(0, -0.055, -0.112);
    ep.add(plate);

    // 5. Chunky Welded Square Dark-Iron Exhaust Nozzles (Left & Right)
    for (const side of [-1, 1]) {
      const x = side * 0.11;
      const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, 0.11), dullIron);
      shroud.position.set(x, -0.26, -0.02);
      shroud.rotation.z = side * 0.08;
      ep.add(shroud);

      const innerBell = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.048, 0.07, 10), copperPipe);
      innerBell.position.set(x, -0.34, -0.02);
      ep.add(innerBell);

      const anchor = new THREE.Object3D();
      anchor.position.set(x, -0.38, -0.02);
      ep.add(anchor);
      if (side < 0) this.econNozzleL = anchor;
      else this.econNozzleR = anchor;
    }

    // Mount cleanly onto Spine2 at identical torso offset
    if (this.spineBone) {
      const inv = 1.0 / Math.max(0.0001, this.baseScale);
      ep.scale.setScalar(inv);
      ep.position.set(0, 0.04 * inv, -0.165 * inv);
      this.spineBone.add(ep);
    } else if (this.model) {
      ep.position.set(0, 1.25 / this.baseScale, -0.18 / this.baseScale);
      ep.scale.setScalar(1.0 / this.baseScale);
      this.model.add(ep);
    }

    ep.visible = false;
    this.economistJetpackGroup = ep;
  }

  /**
   * Switches Jones's equipped jetpack between "MK-79 Chrome" and "The Economist" (persisted into gameplay!)
   */
  public setJetpackModel(model: JetpackModelId) {
    this.currentJetpackModel = model;
    const isEcon = model === 'economist';
    if (this.jetpackGroup) this.jetpackGroup.visible = !isEcon;
    if (this.economistJetpackGroup) this.economistJetpackGroup.visible = isEcon;
    this.nozzleLeft = isEcon ? (this.econNozzleL ?? this.mk79NozzleL) : this.mk79NozzleL;
    this.nozzleRight = isEcon ? (this.econNozzleR ?? this.mk79NozzleR) : this.mk79NozzleR;
  }

  /**
   * Returns exact world-space positions of both chrome thruster nozzles
   */
  public getNozzleWorldPositions(outL: THREE.Vector3, outR: THREE.Vector3, fallbackCenter: THREE.Vector3): boolean {
    if (this.isLoaded && this.nozzleLeft && this.nozzleRight) {
      this.nozzleLeft.getWorldPosition(outL);
      this.nozzleRight.getWorldPosition(outR);
      return true;
    }
    outL.set(fallbackCenter.x - 0.18, fallbackCenter.y + 0.95, fallbackCenter.z - 0.12);
    outR.set(fallbackCenter.x - 0.18, fallbackCenter.y + 0.95, fallbackCenter.z + 0.12);
    return false;
  }

  private sanitizeMixamoClip(clip: THREE.AnimationClip, name: string): THREE.AnimationClip {
    const cloned = clip.clone();
    cloned.name = name;

    for (const track of cloned.tracks) {
      const lower = track.name.toLowerCase();
      if (lower.includes('hips.position') && track instanceof THREE.VectorKeyframeTrack) {
        const vals = track.values;
        if (vals.length >= 3) {
          const baseX = vals[0];
          const baseZ = vals[2];
          for (let i = 0; i < vals.length; i += 3) {
            vals[i] = baseX;
            vals[i + 2] = baseZ;
          }
        }
      }
    }
    return cloned;
  }

  /**
   * Loads low_poly_colt_peacemaker.glb and mounts it precisely in Mixamo RightHand
   * with an exact muzzle-tip anchor at the end of the barrel.
   */
  private async loadColtPeacemaker(url: string) {
    if (!this.rightHandBone) return;
    try {
      const gltfLoader = new GLTFLoader();
      const gltf = await gltfLoader.loadAsync(url);
      const gunScene = gltf.scene;

      gunScene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          m.castShadow = true;
          m.receiveShadow = true;
          m.frustumCulled = false;
        }
      });

      // Verified GLB bounds in world/scene space:
      // X = barrel length (-0.168 grip -> +0.130 muzzle tip), Y = height (-0.100 grip bottom -> +0.034 barrel top)
      // Shift gun so grip center (-0.105, -0.048, 0) sits right inside Jones's palm!
      gunScene.position.set(0.105, 0.048, 0);

      // Exact barrel tip anchor in gun-local space (matches +0.130 + 0.105 = +0.235 along +X, +0.022 + 0.048 = +0.070 along +Y)
      const muzzleTip = new THREE.Object3D();
      muzzleTip.name = 'ColtMuzzleTip';
      muzzleTip.position.set(0.242, 0.070, 0);

      // Crisp incandescent muzzle-flash star/orb right at the barrel tip
      const flashGeo = new THREE.SphereGeometry(0.036, 10, 10);
      const flashMat = new THREE.MeshBasicMaterial({
        color: 0x55f8ff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const flashMesh = new THREE.Mesh(flashGeo, flashMat);
      flashMesh.visible = false;
      muzzleTip.add(flashMesh);

      const gunHolder = new THREE.Group();
      gunHolder.name = 'ColtPeacemakerHolder';
      gunHolder.add(gunScene);
      gunHolder.add(muzzleTip);

      // Orient in Mixamo RightHand bone space:
      // +Y runs from wrist down fingers -> align barrel (+X) along +Y (forward when arm extends in shoot.fbx!)
      const inv = 1.18 / Math.max(0.0001, this.baseScale);
      const pivot = new THREE.Group();
      pivot.name = 'ColtPeacemakerPivot';
      pivot.scale.setScalar(inv);
      // Seat palm grip offset slightly toward fingers (+Y) and palm (+Z)
      pivot.position.set(0.01 * inv, 0.075 * inv, 0.025 * inv);
      // Rotate +X barrel -> +Y (along extended hand/arm) and top of barrel (+Y) -> +Z (thumb-up)
      pivot.rotation.set(0, -Math.PI / 2, Math.PI / 2);
      pivot.add(gunHolder);
      pivot.visible = false; // Holstered until shooting!

      this.rightHandBone.add(pivot);
      this.gunPivot = pivot;
      this.gunMuzzleTip = muzzleTip;
      this.gunMuzzleFlash = flashMesh;
    } catch (err) {
      console.warn('[MixamoCharacterRig] Failed to load Colt Peacemaker GLB:', err);
    }
  }

  /**
   * Returns exact 3D world position at the very end of the Colt Peacemaker barrel!
   */
  public getMuzzleWorldPosition(fallback: THREE.Vector3): THREE.Vector3 {
    if (this.isLoaded && this.gunMuzzleTip) {
      this.gunMuzzleTip.getWorldPosition(this.tmpWorldPos);
      return this.tmpWorldPos;
    }
    return this.getRightHandWorldPosition(fallback);
  }

  // Only RightArm + RightForeArm + RightHand + Fingers quaternion tracks are overridden by shoot.fbx!
  // Keeping RightShoulder, Torso, Jetpack, Head, and ALL .position tracks intact 100% eliminates stretching & shoulder distortion!
  private static readonly UPPER_BODY_KEYWORDS = [
    'rightarm', 'rightforearm', 'righthand',
    'right_arm', 'right_forearm', 'right_hand'
  ];

  private isUpperBodyTrack(trackName: string): boolean {
    const lower = trackName.toLowerCase();
    if (lower.includes('hips')) return false;
    return MixamoCharacterRig.UPPER_BODY_KEYWORDS.some((kw) => lower.includes(kw));
  }

  /**
   * Filters shoot.fbx to RightArm/ForeArm/Hand ROTATION (.quaternion) tracks ONLY.
   */
  private extractUpperBodyClip(clip: THREE.AnimationClip, name: string): THREE.AnimationClip {
    const tracks = clip.tracks
      .filter((t) => this.isUpperBodyTrack(t.name) && t.name.endsWith('.quaternion'))
      .map((t) => t.clone());
    return new THREE.AnimationClip(name, clip.duration, tracks);
  }

  /**
   * Keeps ALL body tracks AND ALL .position/.scale tracks intact, stripping ONLY the
   * RightArm/ForeArm/Hand .quaternion tracks so bone lengths NEVER collapse or stretch!
   */
  private extractLowerBodyClip(clip: THREE.AnimationClip, name: string): THREE.AnimationClip {
    const tracks = clip.tracks
      .filter((t) => !(this.isUpperBodyTrack(t.name) && t.name.endsWith('.quaternion')))
      .map((t) => t.clone());
    return new THREE.AnimationClip(name, clip.duration, tracks);
  }

  private stopAllLowerActions() {
    for (const k of Object.keys(this.lowerActions) as AnimKey[]) {
      const a = this.lowerActions[k];
      if (a) {
        a.setEffectiveWeight(0);
        a.stop();
      }
    }
    this.activeLowerKey = null;
  }

  /**
   * Triggers snappy Mixamo Running Slide animation
   */
  public triggerSlide() {
    if (!this.isLoaded) return;
    if (this.actions.slide) {
      this.actions.slide.reset();
      this.actions.slide.timeScale = 0.92;
      this.playAction('slide', 0.07, true);
    }
    this.squashY = 0.88;
    this.squashVel = 0;
  }

  /**
   * Called by Player.shoot() to snap INSTANTLY (0ms wind-up!) into the crisp straight-arm
   * Colt Peacemaker firing pose aimed directly along aimAngleWorld!
   */
  public triggerShoot(aimAngleWorld?: number) {
    if (!this.isLoaded) return;
    if (aimAngleWorld !== undefined) {
      this.targetAimAngle = aimAngleWorld;
    }
    this.shootAnimTimer = 0.42;
    this.shootHolsterTimer = 1.25;
    this.muzzleFlashTimer = 0.065;
    if (this.gunPivot) this.gunPivot.visible = true;
    if (this.gunMuzzleFlash) {
      this.gunMuzzleFlash.visible = true;
      this.gunMuzzleFlash.scale.setScalar(1.35);
    }

    const startAt = this.shootAimStartTime;

    if (this.shootUpperAction) {
      // Unified 100% right-arm firing pose across ALL states (Idle, Walk, Run, Slide, Jump, Fly!)
      this.shootUpperAction.reset();
      this.shootUpperAction.time = startAt;
      this.shootUpperAction.timeScale = 1.25;
      this.shootUpperAction.enabled = true;
      this.shootUpperAction.play();
      this.shootUpperWeight = 1.0;
      this.shootUpperAction.setEffectiveWeight(1.0);

      if (this.activeKey && this.activeKey !== 'death') {
        const fullAct = this.actions[this.activeKey];
        const lowerAct = this.lowerActions[this.activeKey];
        if (fullAct && lowerAct) {
          // Stop any active crossFadeTo weight interpolants on ALL full-body actions so they NEVER fight shootUpperAction!
          for (const k of Object.keys(this.actions) as AnimKey[]) {
            const a = this.actions[k];
            if (a && k !== this.activeKey) {
              a.stopFading();
              a.setEffectiveWeight(0);
            }
          }
          fullAct.stopFading();
          this.stopAllLowerActions();
          lowerAct.reset();
          lowerAct.time = fullAct.time;
          lowerAct.timeScale = fullAct.timeScale;
          lowerAct.enabled = true;
          lowerAct.play();
          lowerAct.setEffectiveWeight(1.0);
          fullAct.setEffectiveWeight(0.0);
          this.activeLowerKey = this.activeKey;
        }
      }
    }

    // Evaluate mixer + exact world-space arm aim alignment immediately so barrel points right at target on frame 0!
    if (this.mixer) {
      this.mixer.update(0);
      this.applyShootForwardAlignment();
    }
  }

  /**
   * Exact World-Space Straight-Arm Aim Alignment (Both Left & Right Directions):
   * Straightens RightForeArm 100% and rotates RightArm cleanly in world space so the entire
   * arm (shoulder -> hand) AND the Colt Peacemaker barrel point dead-straight along _desDir
   * whether facing right (+X) or left (-X), compensating for torso lean, flight banking, and turn-around.
   */
  public isAimingGun(): boolean {
    return this.shootUpperWeight > 0.05 || this.shootAnimTimer > 0 || this.shootHolsterTimer > 0;
  }

  private applyShootForwardAlignment() {
    if (this.shootUpperWeight <= 0.01 || !this.rightArmBone || !this.rightHandBone || !this.rightArmBone.parent) {
      return;
    }

    // 100% straight elbow + ergonomic neutral wrist at full shoot weight so the arm & hand NEVER pinch or distort!
    if (this.rightForeArmBone) {
      this.rightForeArmBone.quaternion.slerp(this._qIdent, this.shootUpperWeight);
    }
    if (this.rightHandBone) {
      this.rightHandBone.quaternion.slerp(this._qIdent, this.shootUpperWeight * 0.85);
    }

    // Update FULL ancestor chain (player mesh -> rigRoot.rotation.y -> container -> visualPivot -> bones)
    // so facing left (-X) and right (+X) + leanPitch are 100% up-to-date on this exact frame!
    this.container.updateWorldMatrix(true, true);
    this.rightArmBone.getWorldPosition(this._pArm);
    this.rightHandBone.getWorldPosition(this._pHand);
    this._curDir.subVectors(this._pHand, this._pArm);
    if (this._curDir.lengthSq() < 0.0001) return;
    this._curDir.normalize();

    // Compute Jones's true 3D world forward (+X of container) & right-shoulder outward (+Z of container)
    // so his right shooting arm NEVER bends backward or clips through his torso/chest!
    this._charFwd.set(1, 0, 0).transformDirection(this.container.matrixWorld).normalize();
    this._charRight.set(0, 0, 1).transformDirection(this.container.matrixWorld).normalize();

    if (this.use3DForwardAim) {
      // 3D Free-Roam: aim straight along Jones's 3D facing direction + direct vertical pitch toward locked target!
      const clampedPitch = THREE.MathUtils.clamp(this.targetAimAngle, -0.62, 0.72);
      const cosP = Math.cos(clampedPitch);
      const sinP = Math.sin(clampedPitch);
      this._desDir.copy(this._charFwd).setY(0);
      if (this._desDir.lengthSq() > 0.0001) this._desDir.normalize();
      this._desDir.multiplyScalar(cosP).setY(sinP).addScaledVector(this._charRight, 0.11).normalize();
    } else {
      // 2D Side-Scroller: target aim direction in world XY plane
      const fwdX = Math.cos(this.targetAimAngle);
      const fwdY = THREE.MathUtils.clamp(Math.sin(this.targetAimAngle), -0.68, 0.68);
      this._desDir.set(fwdX, fwdY, 0).normalize();
      // Guard against arm ever crossing through chest if turning around mid-shot!
      if (this._desDir.dot(this._charFwd) < 0.35) {
        this._desDir.copy(this._charFwd).setY(fwdY).normalize();
      }
      // Subtle outward shoulder clearance so the forearm & sleeve stay completely clear of his ribcage
      this._desDir.addScaledVector(this._charRight, 0.06).normalize();
    }

    // Exact shortest-arc world rotation from current arm direction -> desired straight aim direction
    this._qDelta.setFromUnitVectors(this._curDir, this._desDir);
    if (this.shootUpperWeight < 0.999) {
      this._qDelta.slerpQuaternions(this._qIdent, this._qDelta, this.shootUpperWeight);
    }

    this.rightArmBone.parent.getWorldQuaternion(this._qParentWorld);
    this._qParentInv.copy(this._qParentWorld).invert();
    this._qLocalDelta.copy(this._qParentInv).multiply(this._qDelta).multiply(this._qParentWorld);
    this.rightArmBone.quaternion.premultiply(this._qLocalDelta);
    this.rightArmBone.scale.set(1, 1, 1);
    if (this.rightForeArmBone) this.rightForeArmBone.scale.set(1, 1, 1);
    if (this.rightHandBone) this.rightHandBone.scale.set(1, 1, 1);
    this.rightArmBone.updateMatrixWorld(true);

    // Lock the Colt Peacemaker barrel itself dead-parallel to _desDir (0.0° tilt, parallel to ground when shooting straight!)
    // with the top sight upright toward world +Y in BOTH left and right facing directions! (Zero-GC scratch math!)
    if (this.gunPivot && this.gunPivot.visible && this.gunPivot.parent) {
      const fwd = this._desDir;
      this._gunSide.crossVectors(fwd, this._gunWorldUp);
      if (this._gunSide.lengthSq() < 0.0001) this._gunSide.set(0, 0, 1);
      this._gunSide.normalize();
      this._gunUp.crossVectors(this._gunSide, fwd).normalize();

      // Basis matrix where col0(+X) = fwd, col1(+Y) = up, col2(+Z) = side (det = +1 for both +X and -X)
      this._gunBasisMat.makeBasis(fwd, this._gunUp, this._gunSide);
      this._qGunWorld.setFromRotationMatrix(this._gunBasisMat);

      this.gunPivot.parent.getWorldQuaternion(this._qParentWorld);
      this._qParentInv.copy(this._qParentWorld).invert();
      this.gunPivot.quaternion.copy(this._qParentInv).multiply(this._qGunWorld);
      this.gunPivot.updateMatrixWorld(true);
    }
  }

  /**
   * Plays dramatic Mixamo Standing React Death Backward animation cleanly in ALL styles (HD + Pixel-Art!)
   */
  public triggerDeath() {
    if (!this.isLoaded) return;
    this.shootAnimTimer = 0;
    this.shootUpperWeight = 0;
    this.shootHolsterTimer = 0;
    this.muzzleFlashTimer = 0;
    if (this.gunPivot) this.gunPivot.visible = false;
    if (this.gunMuzzleFlash) this.gunMuzzleFlash.visible = false;
    this.doubleJumpSurgeTimer = 0;
    this.crouchBlend = 0;
    this.leanPitch = 0;
    this.visualPivot.rotation.z = 0;
    this.visualPivot.scale.set(1, 1, 1);
    if (this.shootUpperAction) {
      this.shootUpperAction.setEffectiveWeight(0);
      this.shootUpperAction.stop();
    }
    this.stopAllLowerActions();
    // Stop EVERY competing full-body clip so death.fbx ALWAYS has 100% authority from frame 0!
    for (const k of Object.keys(this.actions) as AnimKey[]) {
      const act = this.actions[k];
      if (act && k !== 'death') {
        act.setEffectiveWeight(0);
        act.stop();
      }
    }
    if (this.actions.death) {
      const deathAct = this.actions.death;
      deathAct.reset();
      deathAct.enabled = true;
      deathAct.setEffectiveWeight(1.0);
      deathAct.timeScale = 1.05;
      deathAct.setLoop(THREE.LoopOnce, 1);
      deathAct.clampWhenFinished = true;
      deathAct.play();
      this.activeKey = 'death';
      this.mixer?.update(0);
    }
  }

  /**
   * Advances Mixamo death clip while shutting down thruster cones cleanly
   */
  public updateDeath(dt: number) {
    this.jetpackClock += dt;
    if (!this.isLoaded || !this.mixer) return;
    this.mixer.update(dt);

    // Keep visualPivot cleanly upright & un-squashed so the Mixamo death animation drives the full collapse
    this.visualPivot.rotation.z = THREE.MathUtils.lerp(this.visualPivot.rotation.z, 0, Math.min(1, dt * 14));
    this.visualPivot.scale.lerp(new THREE.Vector3(1, 1, 1), Math.min(1, dt * 14));
    this.visualPivot.position.set(0, 0, 0);

    if (this.flameOuterL) this.flameOuterL.visible = false;
    if (this.flameOuterR) this.flameOuterR.visible = false;
    if (this.flameCoreL) this.flameCoreL.visible = false;
    if (this.flameCoreR) this.flameCoreR.visible = false;
    if (this.nozzleGlowMat) this.nozzleGlowMat.opacity = 0.08;
    if (this.ledLeftMat && this.ledRightMat) {
      const errBlink = Math.sin(this.jetpackClock * 18.0) > 0;
      this.ledLeftMat.color.setHex(errBlink ? 0xff2200 : 0x330000);
      this.ledRightMat.color.setHex(errBlink ? 0x330000 : 0xff2200);
    }
  }

  /**
   * Cleanly resets Mixamo rig back to Idle on Respawn / Play Again
   */
  public reset() {
    this.shootAnimTimer = 0;
    this.shootUpperWeight = 0;
    this.shootHolsterTimer = 0;
    this.muzzleFlashTimer = 0;
    if (this.gunPivot) this.gunPivot.visible = false;
    if (this.gunMuzzleFlash) this.gunMuzzleFlash.visible = false;
    this.doubleJumpSurgeTimer = 0;
    this.crouchBlend = 0;
    this.squashY = 1.0;
    this.squashVel = 0;
    this.leanPitch = 0;
    this.visualPivot.rotation.set(0, 0, 0);
    this.visualPivot.scale.set(1, 1, 1);
    this.visualPivot.position.set(0, 0, 0);
    if (this.shootUpperAction) {
      this.shootUpperAction.setEffectiveWeight(0);
      this.shootUpperAction.stop();
    }
    this.stopAllLowerActions();
    if (this.isLoaded) {
      this.playAction('idle', 0.05, true);
    }
  }

  private playAction(key: AnimKey, fadeSeconds: number = 0.14, forceRestart: boolean = false) {
    const next = this.actions[key];
    if (!next) return;

    if (this.activeKey === key && !forceRestart) return;

    const prev = this.activeKey ? this.actions[this.activeKey] : null;
    next.enabled = true;

    if (forceRestart || key === 'jump') {
      next.reset();
    }

    if (prev && prev !== next) {
      next.play();
      prev.crossFadeTo(next, fadeSeconds, false);
    } else {
      next.fadeIn(fadeSeconds).play();
    }

    this.activeKey = key;
  }

  /**
   * Called by Player.ts on Ground Jump or Mid-Air Double Jump (NO 360° spin!)
   * 2nd jump has a distinct athletic knee-tuck launch, heroic air-surge tilt, and dual-ring air burst!
   */
  public triggerJump(isDoubleJump: boolean, worldPos?: THREE.Vector3) {
    if (!this.isLoaded) return;

    const jumpAct = this.actions.jump;
    if (jumpAct) {
      jumpAct.reset();
      jumpAct.time = isDoubleJump ? 0.16 : 0.03;
      jumpAct.timeScale = isDoubleJump ? 1.28 : 1.02;
      this.playAction('jump', isDoubleJump ? 0.06 : 0.08, true);
    }

    // Distinct volume-preserving stretch pop (crisper on 2nd jump!)
    this.squashY = isDoubleJump ? 1.22 : 1.12;
    this.squashVel = 0;

    if (isDoubleJump) {
      this.doubleJumpSurgeTimer = 0.28; // Subtle athletic forward/upward surge lean (no spin!)
      if (worldPos) {
        this.ringMesh.position.set(worldPos.x, worldPos.y + 0.12, worldPos.z);
        this.ringMesh.scale.setScalar(0.32);
        this.ringMesh.visible = true;
        this.ringMat.opacity = 0.90;

        this.ringInnerMesh.position.set(worldPos.x, worldPos.y + 0.16, worldPos.z);
        this.ringInnerMesh.scale.setScalar(0.24);
        this.ringInnerMesh.visible = true;
        this.ringInnerMat.opacity = 0.95;

        this.ringAge = 0;
      }
    }
  }

  public triggerLand(impactStrength: number, fromJetpack: boolean = false) {
    this.doubleJumpSurgeTimer = 0;
    this.squashY = 1.0 - THREE.MathUtils.clamp(impactStrength * 0.12, 0.04, 0.12);
    this.squashVel = 0;
    if (fromJetpack && this.actions.jetpack_land) {
      // If already in jetpack_land from aerial descent, finish the touchdown smoothly (short 0.16s settle);
      // otherwise seek straight to the boot-contact phase so it NEVER replays the mid-air descent while grounded!
      this.landAnimTimer = 0.16;
      if (this.activeKey !== 'jetpack_land') {
        const landAct = this.actions.jetpack_land;
        landAct.reset();
        landAct.time = Math.min(0.28, landAct.getClip().duration * 0.34);
        landAct.timeScale = 1.45;
        this.playAction('jetpack_land', 0.08, true);
      } else {
        this.actions.jetpack_land.timeScale = 1.45;
      }
    } else {
      this.landAnimTimer = 0;
    }
  }

  public update(
    dt: number,
    state: PlayerState,
    vx: number,
    vy: number,
    isGrounded: boolean,
    isCrouching: boolean,
    jetpackThrottle: number = 0,
    heightAboveGround: number = 0,
    usedJetpackThisAir: boolean = false,
    aimAngleWorld?: number,
    isManualAiming: boolean = false,
    isHoverHanging: boolean = false,
    slopePitch: number = 0,
    slopeRoll: number = 0
  ) {
    this.jetpackClock += dt;
    if (aimAngleWorld !== undefined) {
      this.targetAimAngle = aimAngleWorld;
    }
    // Tilting Gamepad Right Stick draws the Colt Peacemaker immediately so you can aim before firing!
    if (isManualAiming) {
      this.shootHolsterTimer = Math.max(this.shootHolsterTimer, 0.35);
      if (this.shootAnimTimer <= 0 && this.shootUpperAction && this.shootUpperWeight < 0.2) {
        this.shootUpperAction.reset();
        this.shootUpperAction.time = this.shootAimStartTime;
        this.shootUpperAction.timeScale = 0;
        this.shootUpperAction.enabled = true;
        this.shootUpperAction.play();
      }
    }

    // Update dual-ring double-jump shockwave
    if (this.ringMesh.visible) {
      this.ringAge += dt;
      const t = this.ringAge / 0.30;
      if (t >= 1.0) {
        this.ringMesh.visible = false;
        this.ringInnerMesh.visible = false;
      } else {
        const sOuter = 0.32 + t * 2.7;
        this.ringMesh.scale.set(sOuter, sOuter, sOuter);
        this.ringMat.opacity = (1.0 - t) * (1.0 - t) * 0.88;

        const sInner = 0.24 + t * 1.9;
        this.ringInnerMesh.scale.set(sInner, sInner, sInner);
        this.ringInnerMat.opacity = (1.0 - t) * (1.0 - t) * 0.92;
      }
    }

    if (!this.isLoaded || !this.mixer || !this.model) return;

    const absVx = Math.abs(vx);

    // Tick shoot timer, landing recovery timer, Colt holster visibility, muzzle flash & upper-body shoot overlay
    if (this.shootAnimTimer > 0) {
      this.shootAnimTimer = Math.max(0, this.shootAnimTimer - dt);
    }
    if (this.landAnimTimer > 0) {
      this.landAnimTimer = Math.max(0, this.landAnimTimer - dt);
      // Movement-cancelable! Pushing into a run/walk/jump/slide immediately cancels landing recovery cleanly
      if (state !== PlayerState.IDLE && state !== PlayerState.CROUCH) {
        this.landAnimTimer = 0;
      }
    }
    if (this.shootHolsterTimer > 0) {
      this.shootHolsterTimer = Math.max(0, this.shootHolsterTimer - dt);
      if (this.gunPivot) this.gunPivot.visible = true;
    } else if (this.gunPivot) {
      this.gunPivot.visible = false;
    }
    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);
      if (this.gunMuzzleFlash) {
        const f = this.muzzleFlashTimer / 0.065;
        this.gunMuzzleFlash.visible = f > 0.01;
        this.gunMuzzleFlash.scale.setScalar(0.6 + f * 1.1);
      }
    } else if (this.gunMuzzleFlash) {
      this.gunMuzzleFlash.visible = false;
    }
    if (this.shootUpperAction) {
      // Keep right arm raised & strictly inside the straight-arm firing pose the ENTIRE time the Colt is drawn!
      const isGunAiming = (this.shootAnimTimer > 0 || this.shootHolsterTimer > 0) && this.activeKey !== 'death';
      const targetUpper = isGunAiming ? 1.0 : 0.0;
      if (isGunAiming) {
        if (!this.shootUpperAction.isRunning()) {
          this.shootUpperAction.enabled = true;
          this.shootUpperAction.play();
        }
        // Clamp time strictly inside the crisp raised-arm firing recoil window so it NEVER drops to his side!
        const maxShootTime = this.shootAimStartTime + 0.14;
        if (this.shootAnimTimer <= 0 || this.shootUpperAction.time >= maxShootTime) {
          this.shootUpperAction.time = this.shootAimStartTime;
          this.shootUpperAction.timeScale = 0;
        }
      }
      this.shootUpperWeight = isGunAiming
        ? 1.0
        : THREE.MathUtils.lerp(this.shootUpperWeight, 0.0, Math.min(1, dt * 12));
      this.shootUpperAction.setEffectiveWeight(this.shootUpperWeight);
      if (this.shootUpperWeight < 0.01 && targetUpper === 0) {
        this.shootUpperAction.stop();
        this.stopAllLowerActions();
        if (this.activeKey && this.actions[this.activeKey]) {
          this.actions[this.activeKey]!.setEffectiveWeight(1.0);
        }
      }
    }

    // 1. Mixamo clip selection & velocity-synced stride
    switch (state) {
      case PlayerState.IDLE:
        if (this.shootAnimTimer > 0 && this.activeKey === 'shoot') {
          // Hold crisp full-body shoot clip while firing from standstill
          break;
        }
        if (this.landAnimTimer > 0 && this.activeKey === 'jetpack_land') {
          // Finish heroic jetpack touchdown recovery smoothly before blending into Idle
          break;
        }
        // Silky-smooth 0.42s deceleration settle from Walk/Run -> Idle (ZERO snap!)
        this.playAction('idle', 0.42);
        if (this.actions.idle) this.actions.idle.timeScale = 1.0;
        break;

      case PlayerState.WALK:
        this.playAction('walk', 0.30);
        if (this.actions.walk) {
          // 1:1 stride-matched walk cadence with smooth minimum cadence so Walk -> Idle blends fluidly!
          this.actions.walk.timeScale = THREE.MathUtils.clamp(absVx / 2.6, 0.38, 1.95);
        }
        break;

      case PlayerState.CROUCH_WALK:
        if (this.actions.crouch_walk) {
          this.playAction('crouch_walk', 0.22);
          this.actions.crouch_walk.timeScale = THREE.MathUtils.clamp(absVx / 2.4, 0.32, 1.85);
        } else {
          this.playAction('walk', 0.24);
          if (this.actions.walk) this.actions.walk.timeScale = 0.7;
        }
        break;

      case PlayerState.RUN:
        this.playAction('run', 0.28);
        if (this.actions.run) {
          this.actions.run.timeScale = THREE.MathUtils.clamp(absVx / 6.2, 0.55, 1.85);
        }
        break;

      case PlayerState.JETPACK:
        if (this.actions.fly) {
          this.playAction('fly', 0.11);
          this.actions.fly.timeScale = 0.85 + 0.35 * Math.max(0, Math.min(1, jetpackThrottle));
        } else if (this.activeKey !== 'jump') {
          this.playAction('jump', 0.10);
        }
        break;

      case PlayerState.JUMP:
      case PlayerState.FALL:
        // After jetpack flight: anticipate landing EARLY while descending (< 3.8m above ground)
        // so Jones's boots reach touchdown posture right ON impact instead of late!
        if (state === PlayerState.FALL && usedJetpackThisAir) {
          if (heightAboveGround > 0.05 && heightAboveGround < 3.8 && vy < -0.5 && this.actions.jetpack_land) {
            if (this.activeKey !== 'jetpack_land') {
              this.actions.jetpack_land.reset();
              this.actions.jetpack_land.timeScale = 1.40;
              this.playAction('jetpack_land', 0.08, true);
            }
            break;
          } else if (this.actions.fly) {
            this.playAction('fly', 0.12);
            this.actions.fly.timeScale = 0.72;
            break;
          }
        }
        if (this.activeKey !== 'jump') {
          this.playAction('jump', 0.10);
          if (this.actions.jump && state === PlayerState.FALL) {
            this.actions.jump.time = Math.min(0.45, this.actions.jump.getClip().duration * 0.45);
          }
        }
        if (this.actions.jump) {
          this.actions.jump.timeScale = vy < -1.0 ? 0.65 : 1.05;
        }
        break;

      case PlayerState.SLIDE:
        if (this.actions.slide) {
          if (this.activeKey !== 'slide') {
            this.actions.slide.reset();
            this.actions.slide.timeScale = 1.25;
            this.playAction('slide', 0.07, true);
          }
        } else if (this.actions.crouch_walk) {
          this.playAction('crouch_walk', 0.08);
        }
        break;

      case PlayerState.CROUCH:
        if (this.actions.crouch_walk) {
          this.playAction('crouch_walk', 0.12);
          // Hold clean crouched stance smoothly when standing still under low clearance
          this.actions.crouch_walk.timeScale = 0.0;
        } else {
          this.playAction('idle', 0.12);
          if (this.actions.idle) this.actions.idle.timeScale = 0.85;
        }
        break;
    }

    // 1b. Split-Body Upper/Lower Synchronization during Run/Walk/Fly/Slide/Jump Shooting:
    // Zeroes ALL full-body actions while shooting so state transitions NEVER pull Jones's arm down to his side!
    if (this.shootUpperWeight > 0.01 && this.activeKey && this.activeKey !== 'shoot' && this.activeKey !== 'death') {
      const fullAct = this.actions[this.activeKey];
      const lowerAct = this.lowerActions[this.activeKey];
      if (fullAct && lowerAct) {
        // Silence any cross-fading full-body clips cleanly (stopFading prevents crossFadeTo from overriding weights inside mixer.update!)
        for (const k of Object.keys(this.actions) as AnimKey[]) {
          const a = this.actions[k];
          if (a && k !== this.activeKey) {
            a.stopFading();
            a.setEffectiveWeight(0);
          }
        }
        fullAct.stopFading();
        if (this.activeLowerKey !== this.activeKey) {
          const prevLower = this.activeLowerKey ? this.lowerActions[this.activeLowerKey] : null;
          // Stop any third stale lower-body action so only prevLower -> lowerAct ever blends!
          for (const k of Object.keys(this.lowerActions) as AnimKey[]) {
            const la = this.lowerActions[k];
            if (la && k !== this.activeKey && k !== this.activeLowerKey) {
              la.stopFading();
              la.setEffectiveWeight(0);
              la.stop();
            }
          }
          lowerAct.stopFading();
          lowerAct.reset();
          lowerAct.time = fullAct.time;
          lowerAct.enabled = true;
          lowerAct.setEffectiveWeight(1.0);
          lowerAct.play();
          if (prevLower && prevLower !== lowerAct && prevLower.isRunning() && prevLower.getEffectiveWeight() > 0.05) {
            const fadeDur = this.activeKey === 'idle' ? 0.34 : 0.22;
            prevLower.crossFadeTo(lowerAct, fadeDur, false);
          } else {
            if (prevLower && prevLower !== lowerAct) {
              prevLower.stopFading();
              prevLower.setEffectiveWeight(0);
              prevLower.stop();
            }
            lowerAct.setEffectiveWeight(this.shootUpperWeight);
          }
          this.activeLowerKey = this.activeKey;
        }
        lowerAct.timeScale = fullAct.timeScale;
        if (!fullAct.isRunning()) {
          fullAct.enabled = true;
          fullAct.play();
        }
        fullAct.setEffectiveWeight(Math.max(0.0, 1.0 - this.shootUpperWeight));
      }
    } else if (this.activeLowerKey) {
      this.stopAllLowerActions();
      if (this.activeKey && this.actions[this.activeKey]) {
        const fullAct = this.actions[this.activeKey]!;
        fullAct.stopFading();
        fullAct.enabled = true;
        fullAct.setEffectiveWeight(1.0);
        if (!fullAct.isRunning()) fullAct.play();
      }
    } else if (this.activeKey && this.actions[this.activeKey]) {
      // Safety guarantee: active full-body clip is ALWAYS enabled & running when not shooting (zero straight-leg sliding!)
      const fullAct = this.actions[this.activeKey]!;
      if (!fullAct.enabled || !fullAct.isRunning()) {
        fullAct.enabled = true;
        fullAct.setEffectiveWeight(1.0);
        fullAct.play();
      }
    }

    this.mixer.update(dt);

    // 1c. Frame-Accurate Walking, Running & Crouch-Walking Footstep Sync!
    // Triggers left & right boot strikes at the exact Mixamo foot-plant phases (0.22 & 0.72 of the clip cycle)
    const footMode: 'walk' | 'run' | 'crouch' | null =
      isGrounded && absVx > 0.35
        ? (state === PlayerState.RUN
            ? 'run'
            : (state === PlayerState.WALK
                ? 'walk'
                : (state === PlayerState.CROUCH_WALK ? 'crouch' : null)))
        : null;
    if (footMode) {
      const clipKey: AnimKey = footMode === 'run' ? 'run' : (footMode === 'walk' ? 'walk' : 'crouch_walk');
      const act = this.lowerActions[clipKey]?.isRunning() ? this.lowerActions[clipKey] : this.actions[clipKey];
      const dur = act ? act.getClip().duration : 0;
      if (act && dur > 0.05) {
        const norm = ((act.time % dur) + dur) % dur / dur;
        if (this.prevFootMode === footMode && this.prevFootCycleNorm >= 0) {
          const prev = this.prevFootCycleNorm;
          const crossedA = (prev < 0.22 && norm >= 0.22) || (prev > norm && (0.22 >= prev || 0.22 <= norm));
          const crossedB = (prev < 0.72 && norm >= 0.72) || (prev > norm && (0.72 >= prev || 0.72 <= norm));
          if (crossedA || crossedB) {
            this.onFootstep?.(footMode);
          }
        }
        this.prevFootCycleNorm = norm;
        this.prevFootMode = footMode;
      }
    } else {
      this.prevFootCycleNorm = -1;
      this.prevFootMode = null;
    }

    // 2. Spring-damped Squash & Stretch
    const springK = 185.0;
    const damping = 16.5;
    const accel = (1.0 - this.squashY) * springK - this.squashVel * damping;
    this.squashVel += accel * dt;
    this.squashY += this.squashVel * dt;
    this.squashY = THREE.MathUtils.clamp(this.squashY, 0.78, 1.26);

    // 3. Keep Mixamo skeletal rig scale strictly uniform (1,1,1) in BOTH Level 1 & Level 2
    // so non-uniform squash/stretch NEVER introduces shear or stretching into the rotated arm/wrist/hand bones!
    const targetCrouch = isCrouching && !this.actions.crouch_walk ? 1.0 : 0.0;
    this.crouchBlend = THREE.MathUtils.lerp(this.crouchBlend, targetCrouch, Math.min(1, dt * 16));
    this.visualPivot.scale.set(1, 1, 1);

    // 4. Dynamic Flight Banking, Sprint Lean & Subtle 2nd-Jump Air Surge (NO 360° spin!)
    let targetLean = 0;
    if (this.doubleJumpSurgeTimer > 0) {
      this.doubleJumpSurgeTimer = Math.max(0, this.doubleJumpSurgeTimer - dt);
      const surgeT = this.doubleJumpSurgeTimer / 0.28;
      targetLean = -0.17 * surgeT; // Clean athletic surge lean
    } else if (state === PlayerState.JETPACK) {
      // Bank gracefully into horizontal velocity while jetpack flying!
      targetLean = -0.10 - THREE.MathUtils.clamp(absVx * 0.022, 0, 0.20);
    } else if (state === PlayerState.RUN) {
      targetLean = -0.10;
    } else if (!isGrounded) {
      targetLean = THREE.MathUtils.clamp(-vy * 0.012, -0.12, 0.10);
    }
    this.leanPitch = THREE.MathUtils.lerp(this.leanPitch, targetLean, Math.min(1, dt * 8.0));
    // TRUE TRIPLE-AAA NEXT-GEN SLOPE ALIGNMENT (Exact Mathematical Ramp Plane Match!):
    // 1. visualPivot.rotation.z matches 100% of the ramp's forward slope angle (+30° uphill / -30° downhill)
    //    so EVERY point along Jones's walking/running stride plane (dx = s*cos(θ), dy = s*sin(θ)) lies
    //    MATHEMATICALLY ON THE EXACT 30° RAMP SURFACE (dy/dx = tan(30°)) -> ZERO foot penetration!
    // 2. visualPivot.rotation.x is locked to 0 -> ZERO side-to-side swaying on the ramp!
    // 3. Spine counter-pitches upright by -68% of the slope angle so Jones's upper torso & head stay
    //    naturally vertical while his legs & boots climb the 30° slope flush with the tiles!
    const rawSlope = isGrounded ? THREE.MathUtils.clamp(slopePitch, -0.65, 0.65) : 0;
    this.slopePitchSmooth = THREE.MathUtils.lerp(this.slopePitchSmooth, rawSlope, Math.min(1, dt * 16));
    this.slopeRollSmooth = 0;

    const onSlope = Math.abs(this.slopePitchSmooth) > 0.03;
    // On a slope, do NOT let sprint leanPitch dip the feet into the ramp!
    this.visualPivot.rotation.z = onSlope ? this.slopePitchSmooth : this.leanPitch;
    this.visualPivot.rotation.x = 0;
    // Tiny +0.035m boot-sole clearance on slopes so toes never touch beneath the tile surface
    this.visualPivot.position.set(0, onSlope ? 0.035 : 0, 0);

    // Counter-pitch upper spine upright so Jones's torso/head stay naturally vertical while legs match 100% of the 30° ramp!
    if (this.spineRootBone && Math.abs(this.slopePitchSmooth) > 0.01) {
      // Mixamo Spine local +X pitches torso forward; positive slopePitchSmooth tilts visualPivot back, so pitch spine forward (+)
      this._qFootSlope.setFromAxisAngle(this._footAxisX, this.slopePitchSmooth * 0.68);
      this.spineRootBone.quaternion.multiply(this._qFootSlope);
    }

    // 4b. Apply world-space straight-arm & parallel-barrel aim AFTER squash/stretch and leanPitch
    // so the shooting arm and Colt barrel stay 100% straight & horizontal in BOTH left & right directions!
    this.applyShootForwardAlignment();

    // 5. Animate 1979 Retro Chrome Jetpack Mach Cones, Nozzle Heat Glow & Status LEDs
    // During the 1s post-release hover-hang, boosters stay lit and shift to a warm golden-amber hover stabilizer color!
    const thrust = Math.max(0, Math.min(1, jetpackThrottle));
    const isThrusting = thrust > 0.02 || isHoverHanging || this.doubleJumpSurgeTimer > 0.14;
    const effThrust = this.doubleJumpSurgeTimer > 0.14
      ? Math.max(thrust, 0.85)
      : (isHoverHanging ? Math.max(0.42, thrust * 2.0) : thrust);

    if (this.flameOuterL && this.flameOuterR && this.flameCoreL && this.flameCoreR) {
      this.flameOuterL.visible = isThrusting;
      this.flameOuterR.visible = isThrusting;
      this.flameCoreL.visible = isThrusting;
      this.flameCoreR.visible = isThrusting;

      if (isThrusting) {
        const flicker = isHoverHanging
          ? (0.94 + 0.10 * Math.sin(this.jetpackClock * 36.0))
          : (0.88 + 0.24 * Math.sin(this.jetpackClock * 68.0));
        const lenScale = (isHoverHanging ? 0.58 : (0.45 + 0.85 * effThrust)) * flicker;
        const radScale = 0.78 + 0.35 * effThrust;

        this.flameOuterL.scale.set(radScale, lenScale, radScale);
        this.flameOuterR.scale.set(radScale, lenScale * (0.94 + 0.12 * Math.cos(this.jetpackClock * 53.0)), radScale);
        this.flameCoreL.scale.set(radScale * 0.9, lenScale * 0.92, radScale * 0.9);
        this.flameCoreR.scale.set(radScale * 0.9, lenScale * 0.88, radScale * 0.9);

        const outerMat = this.flameOuterL.material as THREE.MeshBasicMaterial;
        const coreMat = this.flameCoreL.material as THREE.MeshBasicMaterial;
        outerMat.color.setHex(isHoverHanging ? 0xff9922 : 0x18e0ff); // Warm amber-gold hover vs electric cyan flight!
        coreMat.color.setHex(isHoverHanging ? 0xfff3cc : 0xffffff);
        outerMat.opacity = 0.62 * effThrust + 0.18;
        coreMat.opacity = 0.85 * effThrust + 0.12;
      }
    }

    if (this.nozzleGlowMat) {
      this.nozzleGlowMat.opacity = isThrusting ? 0.95 : 0.22;
      this.nozzleGlowMat.color.setHex(isHoverHanging ? 0xffaa22 : (isThrusting ? 0x38f6ff : 0xff7722));
    }

    if (this.ledLeftMat && this.ledRightMat) {
      if (isThrusting) {
        const fastPulse = Math.sin(this.jetpackClock * 26.0) > 0;
        this.ledLeftMat.color.setHex(fastPulse ? 0x00ffff : 0xffffff);
        this.ledRightMat.color.setHex(fastPulse ? 0xffffff : 0x00ffff);
      } else {
        const blink = Math.sin(this.jetpackClock * 3.8) > 0;
        this.ledLeftMat.color.setHex(blink ? 0x00ff88 : 0x114422);
        this.ledRightMat.color.setHex(blink ? 0x442200 : 0xffaa00);
      }
    }
  }

  public getRightHandWorldPosition(fallback: THREE.Vector3): THREE.Vector3 {
    if (this.isLoaded && this.rightHandBone) {
      this.rightHandBone.getWorldPosition(this.tmpWorldPos);
      return this.tmpWorldPos;
    }
    return fallback;
  }

  public getJetpackGroup(): THREE.Group | null {
    return this.jetpackGroup;
  }
}
