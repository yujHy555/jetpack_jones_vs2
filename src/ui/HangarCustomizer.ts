import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { GROUND_Y } from '../entities/Player';

/**
 * Triple-AAA 1979 Retro-Space Hangar Character Customization Stage
 * - Loads /hdri/the_lost_city_2k.hdr (HDRI IBL reflections + panoramic HDRI background!)
 * - Combines HDRI with Golden Directional Sun Light + Dual Blue CRT Screen PointLights
 * - Sculptural Rotating Turntable Disc under Jones (auto-spin + click/touch drag 360°)
 * - Flanking 1979 Mainframe Computers with GPU-Animated Blue CRT Screens casting blue light onto Jones
 * - Renders through SceneManager's 16-Bit Pixel-Art Shader so the HDRI + Hangar get the full Pixel-Art effect!
 */
export class HangarCustomizer {
  public readonly group: THREE.Group;
  public readonly runwayComputersGroup: THREE.Group;
  private turntableDisc: THREE.Group;
  private crtMaterials: THREE.ShaderMaterial[] = [];
  private hangarCrtStates: { mat: THREE.ShaderMaterial; cooldown: number; glitchTimer: number }[] = [];
  private laserGridMat!: THREE.ShaderMaterial;

  // Audio / Polish Callbacks
  public onLand?: (impactStrength: number) => void;
  public onCrtStatic?: (durationSec: number) => void;

  // Zero-Gravity Floor-to-Sky Particles (slow rise -> sudden vertical warp-shoot & disappear!)
  private static readonly ZEROG_COUNT = 90;
  private zeroGGeo!: THREE.BufferGeometry;
  private zeroGPos = new Float32Array(HangarCustomizer.ZEROG_COUNT * 3);
  private zeroGVelY = new Float32Array(HangarCustomizer.ZEROG_COUNT);
  private zeroGAge = new Float32Array(HangarCustomizer.ZEROG_COUNT);
  private zeroGTriggerTime = new Float32Array(HangarCustomizer.ZEROG_COUNT);
  private zeroGMaxLife = new Float32Array(HangarCustomizer.ZEROG_COUNT);
  private zeroGSeed = new Float32Array(HangarCustomizer.ZEROG_COUNT);
  private zeroGAlpha = new Float32Array(HangarCustomizer.ZEROG_COUNT);
  private zeroGSize = new Float32Array(HangarCustomizer.ZEROG_COUNT);
  private zeroGBaseX = new Float32Array(HangarCustomizer.ZEROG_COUNT);
  private zeroGBaseZ = new Float32Array(HangarCustomizer.ZEROG_COUNT);

  // Gamepad Right-Stick 360° Orbit Camera centered on Jones!
  private camOrbitYaw: number = 0.14;
  private camOrbitPitch: number = 0.10;

  // Hangar Jetpack Test Hover State
  public hoverHeight: number = 0;
  private hoverVel: number = 0;
  private wasAirborneInHangar: boolean = false;

  // Exposed Floor Cable Spark Pool (Single-Draw-Call GPU Points, zero per-frame allocations!)
  private static readonly SPARK_COUNT = 72;
  private sparkGeo!: THREE.BufferGeometry;
  private sparkPos = new Float32Array(HangarCustomizer.SPARK_COUNT * 3);
  private sparkVel = new Float32Array(HangarCustomizer.SPARK_COUNT * 3);
  private sparkAge = new Float32Array(HangarCustomizer.SPARK_COUNT).fill(99);
  private sparkMax = new Float32Array(HangarCustomizer.SPARK_COUNT).fill(1);
  private sparkAlpha = new Float32Array(HangarCustomizer.SPARK_COUNT);
  private sparkCursor = 0;
  private brokenCableSites: {
    pos: THREE.Vector3;
    cooldown: number;
    flashMesh: THREE.Mesh;
    flashTimer: number;
  }[] = [];

  // Pre-allocated lights (created once at boot so ZERO runtime shader recompiles!)
  private sunLight: THREE.DirectionalLight;
  private crtBlueLightL: THREE.PointLight;
  private crtBlueLightR: THREE.PointLight;
  private runwayBlueLight: THREE.PointLight;
  private runwayComputerXs: number[] = [24.0, 58.0, 96.0];

  // HDRI resources (loaded once during boot/on-demand, cached forever)
  private hdrTexture: THREE.DataTexture | null = null;
  private hdrEnvMap: THREE.Texture | null = null;
  private hdrReadyPromise: Promise<void>;

  // Saved gameplay scene environment/background/lights to restore cleanly on Hangar exit
  private savedBg: THREE.Color | THREE.Texture | null = null;
  private savedEnv: THREE.Texture | null = null;
  private savedFog: THREE.Fog | THREE.FogExp2 | null = null;
  private savedExposure: number = 1.35;

  // Interactive Turntable Rotation State
  public isActive: boolean = false;
  public turntableAngle: number = -0.65; // Start at flattering 3/4 hero angle showing both Jones & Jetpack!
  public autoSpinSpeed: number = 0.78; // Brisk, smooth turntable rotation!
  private isDragging: boolean = false;
  private lastPointerX: number = 0;

  constructor(private readonly scene: THREE.Scene, private readonly renderer: THREE.WebGLRenderer) {
    this.group = new THREE.Group();
    this.group.name = 'HangarCustomizerStage';
    this.group.visible = false;
    this.scene.add(this.group);

    this.runwayComputersGroup = new THREE.Group();
    this.runwayComputersGroup.name = 'RunwayBlueCRTComputers';
    this.scene.add(this.runwayComputersGroup);

    // 1. Pre-allocated Triple-AAA Combined Lighting (Shadow-Casting Sun Light + Dual Blue CRT Bounce Lights)
    // Intensity starts at 0 during normal gameplay -> zero light count changes!
    this.sunLight = new THREE.DirectionalLight(0xffe0aa, 0);
    this.sunLight.position.set(4.5, 8.5, 5.5);
    this.sunLight.target.position.set(0, GROUND_Y + 0.8, 0);
    this.sunLight.castShadow = false; // Enabled strictly in Hangar Mode (tight 1024x1024 shadow frustum!)
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 22;
    this.sunLight.shadow.camera.left = -4.5;
    this.sunLight.shadow.camera.right = 4.5;
    this.sunLight.shadow.camera.top = 4.5;
    this.sunLight.shadow.camera.bottom = -4.5;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.crtBlueLightL = new THREE.PointLight(0x1cb8ff, 0, 9.5, 1.5);
    this.crtBlueLightL.position.set(-2.05, GROUND_Y + 1.45, -0.85);
    this.scene.add(this.crtBlueLightL);

    this.crtBlueLightR = new THREE.PointLight(0x28c8ff, 0, 9.5, 1.5);
    this.crtBlueLightR.position.set(2.05, GROUND_Y + 1.45, -0.85);
    this.scene.add(this.crtBlueLightR);

    // Shared pre-allocated blue CRT light that tracks the nearest runway computer during gameplay!
    this.runwayBlueLight = new THREE.PointLight(0x22baff, 5.5, 9.0, 1.6);
    this.runwayBlueLight.position.set(this.runwayComputerXs[0], GROUND_Y + 1.4, -1.2);
    this.scene.add(this.runwayBlueLight);

    // 2. Sculptural 1979 Rotating Turntable Pedestal Disc (top surface flush at GROUND_Y!)
    this.turntableDisc = this.buildRotatingTurntable();
    this.turntableDisc.position.set(0, GROUND_Y, 0);
    this.group.add(this.turntableDisc);

    // 2b. Glowing Electric-Blue 1m x 1m Laser Grid Floor beneath the pedestal!
    const laserGridFloor = this.buildBlueLaserGridFloor();
    laserGridFloor.position.set(0, GROUND_Y - 0.32, 0);
    this.group.add(laserGridFloor);

    // 3. Flanking 1979 Retro Mainframe Computers with Animated Glowing Blue CRT Screens!
    const compLeft = this.buildRetroBlueCRTComputer(0.0);
    compLeft.position.set(-2.35, GROUND_Y - 0.14, -1.25);
    compLeft.rotation.y = 0.52;
    this.group.add(compLeft);

    const compRight = this.buildRetroBlueCRTComputer(2.1);
    compRight.position.set(2.35, GROUND_Y - 0.14, -1.25);
    compRight.rotation.y = -0.52;
    this.group.add(compRight);

    // 3b. Industrial Power/Data Cables from CRT Screens -> Rotating Disc + Broken Sparking Floor Cables!
    this.buildHangarCablesAndSparks();

    // 3c. Zero-Gravity Floor-to-Sky Particles (slow drift up -> sudden rapid vertical shoot & disappear!)
    this.buildZeroGParticles();

    // 4. Also place Animated Blue-CRT Computers along the main gameplay runway so they cast blue light onto Jones!
    for (let i = 0; i < this.runwayComputerXs.length; i++) {
      const rc = this.buildRetroBlueCRTComputer(i * 1.7 + 0.5);
      rc.position.set(this.runwayComputerXs[i], GROUND_Y, -2.05);
      rc.rotation.y = 0.08 * (i % 2 === 0 ? 1 : -1);
      this.runwayComputersGroup.add(rc);
    }

    // 5. Load Triple-AAA HDRI: the_lost_city_2k.hdr
    this.hdrReadyPromise = this.loadHDRI();
    this.setupDragRotation();
  }

  public whenHDRIReady(): Promise<void> {
    return this.hdrReadyPromise;
  }

  private async loadHDRI(): Promise<void> {
    try {
      const loader = new RGBELoader();
      const hdr = await loader.loadAsync('/hdri/the_lost_city_2k.hdr');
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      this.hdrTexture = hdr;

      const pmrem = new THREE.PMREMGenerator(this.renderer);
      pmrem.compileEquirectangularShader();
      this.hdrEnvMap = pmrem.fromEquirectangular(hdr).texture;
      pmrem.dispose();
    } catch (err) {
      console.warn('[HangarCustomizer] Failed to load the_lost_city_2k.hdr:', err);
    }
  }

  private buildRotatingTurntable(): THREE.Group {
    const disc = new THREE.Group();

    const brushedChrome = new THREE.MeshStandardMaterial({
      color: 0xdce4ec,
      metalness: 0.88,
      roughness: 0.20
    });
    const retroBrown = new THREE.MeshStandardMaterial({
      color: 0x5c3622,
      metalness: 0.35,
      roughness: 0.45
    });
    const lightGreenDeck = new THREE.MeshStandardMaterial({
      color: 0x92f28a, // Crisp lighter mint-lime green cylinder standing floor (matte so real cast shadow pops!)
      metalness: 0.04,
      roughness: 0.78,
      envMapIntensity: 0.24
    });
    const limeRingMat = new THREE.MeshBasicMaterial({ color: 0xa6ff38 });
    const orangeRingMat = new THREE.MeshBasicMaterial({ color: 0xff7f2a });
    const pinkRingMat = new THREE.MeshBasicMaterial({ color: 0xff6cb5 });

    // Top flat standing plate (y = 0 is exact top surface so Jones's feet sit 100% flush + receives real shadow!)
    const topPlate = new THREE.Mesh(new THREE.CylinderGeometry(1.38, 1.44, 0.10, 40), lightGreenDeck);
    topPlate.position.y = -0.05;
    topPlate.receiveShadow = true;
    disc.add(topPlate);

    // Chrome inner trim ring
    const innerTrim = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.025, 10, 40), brushedChrome);
    innerTrim.rotation.x = Math.PI / 2;
    innerTrim.position.y = 0.005;
    disc.add(innerTrim);

    // Glowing Acid-Lime Outer Neon Perimeter Ring
    const outerLime = new THREE.Mesh(new THREE.TorusGeometry(1.42, 0.032, 10, 48), limeRingMat);
    outerLime.rotation.x = Math.PI / 2;
    outerLime.position.y = -0.02;
    disc.add(outerLime);

    // Lower heavy 1979 Saddle-Brown Pedestal Plinth
    const lowerPlinth = new THREE.Mesh(new THREE.CylinderGeometry(1.56, 1.72, 0.22, 32), retroBrown);
    lowerPlinth.position.y = -0.21;
    disc.add(lowerPlinth);

    // Sunset-Orange & Flamingo-Pink Rotating Index Markers around the turntable rim (makes rotation visually unmistakable!)
    const markerGeo = new THREE.BoxGeometry(0.18, 0.06, 0.08);
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const mat = i % 3 === 0 ? orangeRingMat : (i % 3 === 1 ? pinkRingMat : brushedChrome);
      const m = new THREE.Mesh(markerGeo, mat);
      m.position.set(Math.cos(ang) * 1.48, -0.10, Math.sin(ang) * 1.48);
      m.rotation.y = -ang;
      disc.add(m);
    }

    return disc;
  }

  /**
   * Builds a crisp 1m x 1m Electric-Blue Holographic Laser Grid Floor (1 single draw call!)
   */
  private buildBlueLaserGridFloor(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(52, 52);
    geo.rotateX(-Math.PI / 2);

    this.laserGridMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        precision mediump float;
        varying vec3 vWorldPos;
        uniform float uTime;

        void main() {
          // Exact 1.0m x 1.0m world-space laser grid lines!
          vec2 coord = vWorldPos.xz;
          vec2 cell = abs(fract(coord - 0.5) - 0.5);
          float dLine = min(cell.x, cell.y);

          // Razor-sharp laser core + soft electric-blue bloom halo
          float core = 1.0 - smoothstep(0.0, 0.022, dLine);
          float glow = (1.0 - smoothstep(0.0, 0.095, dLine)) * 0.45;

          // Intersection node pips every 1m
          float node = (1.0 - smoothstep(0.0, 0.055, length(cell))) * 0.85;

          // Subtle outward-pulsing radial radar ring centered on the rotating disc
          float dist = length(coord);
          float pulseWave = smoothstep(0.45, 0.0, abs(fract(dist * 0.14 - uTime * 0.35) - 0.5) * 2.0) * 0.38;

          // Smooth circular distance fade into the Lost City HDRI horizon
          float fade = 1.0 - smoothstep(6.0, 22.0, dist);

          vec3 laserBlue = vec3(0.10, 0.68, 1.0);
          vec3 hotCyan   = vec3(0.65, 0.96, 1.0);
          vec3 col = mix(laserBlue, hotCyan, clamp(core * 0.8 + node * 0.6, 0.0, 1.0));

          float intensity = (core * 1.15 + glow + node + pulseWave * (core + glow)) * fade;
          if (intensity <= 0.005) discard;
          gl_FragColor = vec4(col * (1.2 + pulseWave * 0.5), clamp(intensity, 0.0, 0.95));
        }
      `
    });
    this.laserGridMat.customProgramCacheKey = () => 'HangarBlueLaserGrid1mV1';

    const mesh = new THREE.Mesh(geo, this.laserGridMat);
    mesh.renderOrder = 2;
    return mesh;
  }

  /**
   * Builds 1979 industrial cables connecting both CRT consoles to the rotating disc pedestal,
   * plus floor cables with exposed/broken copper-core sections that randomly emit electric spark bursts!
   */
  private buildHangarCablesAndSparks() {
    const floorY = GROUND_Y - 0.29;
    const cableGroup = new THREE.Group();

    const rubberMat = new THREE.MeshStandardMaterial({ color: 0x221f26, roughness: 0.72, metalness: 0.18 });
    const orangeConduitMat = new THREE.MeshStandardMaterial({ color: 0xd96822, roughness: 0.48, metalness: 0.25 });
    const brownArmoredMat = new THREE.MeshStandardMaterial({ color: 0x5c3a24, roughness: 0.56, metalness: 0.30 });
    const copperWireMat = new THREE.MeshStandardMaterial({ color: 0xe68b3e, roughness: 0.28, metalness: 0.88, emissive: 0x3a1804 });
    const collarMat = new THREE.MeshStandardMaterial({ color: 0x8e9aa8, roughness: 0.32, metalness: 0.82 });

    const addCable = (pts: [number, number, number][], radius: number, mat: THREE.Material) => {
      const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
      const tubeGeo = new THREE.TubeGeometry(curve, 24, radius, 8, false);
      cableGroup.add(new THREE.Mesh(tubeGeo, mat));
    };

    // 1. Thick Screen-to-Disc Umbilical Cables (Left CRT Screen & Console -> Rotating Disc Pedestal)
    addCable([
      [-2.15, GROUND_Y + 1.02, -0.98],
      [-2.05, GROUND_Y + 0.42, -0.82],
      [-1.92, floorY + 0.04, -0.62],
      [-1.58, floorY + 0.05, -0.34],
      [-1.44, GROUND_Y - 0.14, -0.22]
    ], 0.042, rubberMat);
    addCable([
      [-2.02, GROUND_Y + 0.92, -1.08],
      [-1.90, GROUND_Y + 0.32, -0.94],
      [-1.76, floorY + 0.03, -0.78],
      [-1.46, floorY + 0.04, -0.52],
      [-1.36, GROUND_Y - 0.15, -0.42]
    ], 0.028, orangeConduitMat);

    // 2. Thick Screen-to-Disc Umbilical Cables (Right CRT Screen & Console -> Rotating Disc Pedestal)
    addCable([
      [2.15, GROUND_Y + 1.02, -0.98],
      [2.05, GROUND_Y + 0.42, -0.82],
      [1.92, floorY + 0.04, -0.62],
      [1.58, floorY + 0.05, -0.34],
      [1.44, GROUND_Y - 0.14, -0.22]
    ], 0.042, rubberMat);
    addCable([
      [2.02, GROUND_Y + 0.92, -1.08],
      [1.90, GROUND_Y + 0.32, -0.94],
      [1.76, floorY + 0.03, -0.78],
      [1.46, floorY + 0.04, -0.52],
      [1.36, GROUND_Y - 0.15, -0.42]
    ], 0.028, brownArmoredMat);

    // Pedestal Heavy Cable Socket Junction Plugs
    const socketGeo = new THREE.CylinderGeometry(0.085, 0.10, 0.14, 10);
    socketGeo.rotateZ(Math.PI / 2);
    for (const sx of [-1.52, 1.52]) {
      const sock = new THREE.Mesh(socketGeo, collarMat);
      sock.position.set(sx, GROUND_Y - 0.16, -0.28);
      cableGroup.add(sock);
    }

    // 3. Floor Cables Snaking Across the 1m x 1m Blue Laser Grid With Exposed Broken Sparking Sections!
    // Front-Left floor cable (breaks at [-1.25, floorY + 0.03, 1.38])
    addCable([
      [-3.6, floorY + 0.03, 1.85],
      [-2.35, floorY + 0.03, 1.62],
      [-1.34, floorY + 0.03, 1.40]
    ], 0.040, rubberMat);
    addCable([
      [-1.16, floorY + 0.03, 1.36],
      [-0.65, floorY + 0.03, 1.24],
      [-0.25, GROUND_Y - 0.22, 1.48]
    ], 0.040, rubberMat);

    // Front-Right floor cable (breaks at [1.35, floorY + 0.03, 1.22])
    addCable([
      [3.4, floorY + 0.03, 1.68],
      [2.25, floorY + 0.03, 1.44],
      [1.44, floorY + 0.03, 1.24]
    ], 0.038, orangeConduitMat);
    addCable([
      [1.26, floorY + 0.03, 1.20],
      [0.72, floorY + 0.03, 1.38],
      [0.35, GROUND_Y - 0.22, 1.48]
    ], 0.038, orangeConduitMat);

    // Mid-Left & Mid-Right auxiliary sparking breaks along the computer floor runs
    const brokenPoints: [number, number, number][] = [
      [-1.25, floorY + 0.035, 1.38],
      [1.35, floorY + 0.035, 1.22],
      [-1.82, floorY + 0.045, -0.58],
      [1.82, floorY + 0.045, -0.58]
    ];

    const cuffGeo = new THREE.CylinderGeometry(0.052, 0.052, 0.06, 8);
    cuffGeo.rotateZ(Math.PI / 2);
    const strandGeo = new THREE.CylinderGeometry(0.008, 0.005, 0.14, 5);
    const flashGeo = new THREE.SphereGeometry(0.11, 8, 8);

    for (let i = 0; i < brokenPoints.length; i++) {
      const [bx, by, bz] = brokenPoints[i];
      const siteGroup = new THREE.Group();
      siteGroup.position.set(bx, by, bz);

      // Torn insulation collars on both sides of the exposed gap
      const cuffL = new THREE.Mesh(cuffGeo, collarMat);
      cuffL.position.x = -0.09;
      siteGroup.add(cuffL);
      const cuffR = new THREE.Mesh(cuffGeo, collarMat);
      cuffR.position.x = 0.09;
      siteGroup.add(cuffR);

      // Frayed exposed copper wire strands poking out of the break
      for (let s = 0; s < 5; s++) {
        const strand = new THREE.Mesh(strandGeo, copperWireMat);
        strand.position.set((s - 2) * 0.028, 0.025, (Math.random() - 0.5) * 0.03);
        strand.rotation.set(
          (Math.random() - 0.5) * 1.1,
          (Math.random() - 0.5) * 1.2,
          (Math.random() - 0.5) * 1.4
        );
        siteGroup.add(strand);
      }

      // Bright electric arc flash core (lights up briefly on each spark crackle!)
      const flashMat = new THREE.MeshBasicMaterial({
        color: 0xa6f4ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const flashMesh = new THREE.Mesh(flashGeo, flashMat);
      flashMesh.position.y = 0.03;
      siteGroup.add(flashMesh);

      cableGroup.add(siteGroup);
      this.brokenCableSites.push({
        pos: new THREE.Vector3(bx, by + 0.03, bz),
        cooldown: 0.35 + i * 0.45 + Math.random() * 0.8,
        flashMesh,
        flashTimer: 0
      });
    }

    this.group.add(cableGroup);

    // 4. Single-Draw-Call GPU Spark Particle System for Broken Cable Arcs!
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparkGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.sparkAlpha, 1));

    const sparkMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) }
      },
      vertexShader: `
        attribute float aAlpha;
        varying float vAlpha;
        uniform float uPixelRatio;
        void main() {
          vAlpha = aAlpha;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPos;
          gl_PointSize = min(22.0, (24.0 * uPixelRatio) / max(1.0, -mvPos.z)) * (0.45 + 0.55 * aAlpha);
        }
      `,
      fragmentShader: `
        precision mediump float;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.01) discard;
          vec2 uv = gl_PointCoord - vec2(0.5);
          float r2 = dot(uv, uv) * 4.0;
          if (r2 > 1.0) discard;
          float core = exp(-r2 * 5.0);
          vec3 col = mix(vec3(0.25, 0.82, 1.0), vec3(1.0, 0.96, 0.72), core);
          gl_FragColor = vec4(col * 1.6, vAlpha * (1.0 - r2));
        }
      `
    });
    sparkMat.customProgramCacheKey = () => 'HangarCableSparksV1';

    const sparkPoints = new THREE.Points(this.sparkGeo, sparkMat);
    sparkPoints.frustumCulled = false;
    sparkPoints.renderOrder = 7;
    this.group.add(sparkPoints);
  }

  private emitCableSparkBurst(origin: THREE.Vector3) {
    const count = 8 + Math.floor(Math.random() * 7);
    for (let k = 0; k < count; k++) {
      const i = this.sparkCursor;
      this.sparkCursor = (this.sparkCursor + 1) % HangarCustomizer.SPARK_COUNT;
      const i3 = i * 3;
      this.sparkPos[i3] = origin.x + (Math.random() - 0.5) * 0.08;
      this.sparkPos[i3 + 1] = origin.y + 0.02;
      this.sparkPos[i3 + 2] = origin.z + (Math.random() - 0.5) * 0.08;

      const ang = Math.random() * Math.PI * 2;
      const spd = 0.9 + Math.random() * 2.4;
      this.sparkVel[i3] = Math.cos(ang) * spd;
      this.sparkVel[i3 + 1] = 1.6 + Math.random() * 2.6;
      this.sparkVel[i3 + 2] = Math.sin(ang) * spd;
      this.sparkAge[i] = 0;
      this.sparkMax[i] = 0.24 + Math.random() * 0.34;
      this.sparkAlpha[i] = 1.0;
    }
  }

  private updateCableSparks(dt: number) {
    const floorY = GROUND_Y - 0.31;

    // 1. Trigger random crackling spark bursts at the 4 exposed broken wire sections
    for (const site of this.brokenCableSites) {
      site.cooldown -= dt;
      if (site.cooldown <= 0) {
        this.emitCableSparkBurst(site.pos);
        site.flashTimer = 0.14;
        // Occasional rapid double-crackle, otherwise 0.7s..2.5s pause
        site.cooldown = Math.random() < 0.28 ? (0.14 + Math.random() * 0.18) : (0.75 + Math.random() * 1.85);
      }
      if (site.flashTimer > 0) {
        site.flashTimer = Math.max(0, site.flashTimer - dt);
        const f = site.flashTimer / 0.14;
        (site.flashMesh.material as THREE.MeshBasicMaterial).opacity = f * 0.95;
        site.flashMesh.scale.setScalar(0.55 + f * 1.15);
      } else {
        (site.flashMesh.material as THREE.MeshBasicMaterial).opacity = 0;
      }
    }

    // 2. Simulate arcing sparks with gravity + crisp floor bounce
    const n = HangarCustomizer.SPARK_COUNT;
    for (let i = 0; i < n; i++) {
      const age = this.sparkAge[i];
      const max = this.sparkMax[i];
      if (age >= max) {
        this.sparkAlpha[i] = 0;
        continue;
      }
      const nextAge = age + dt;
      this.sparkAge[i] = nextAge;
      const i3 = i * 3;
      this.sparkVel[i3 + 1] -= 9.8 * dt;
      this.sparkPos[i3] += this.sparkVel[i3] * dt;
      this.sparkPos[i3 + 1] += this.sparkVel[i3 + 1] * dt;
      this.sparkPos[i3 + 2] += this.sparkVel[i3 + 2] * dt;

      if (this.sparkPos[i3 + 1] < floorY) {
        this.sparkPos[i3 + 1] = floorY;
        this.sparkVel[i3 + 1] = Math.abs(this.sparkVel[i3 + 1]) * 0.42;
        this.sparkVel[i3] *= 0.78;
        this.sparkVel[i3 + 2] *= 0.78;
      }

      const t = nextAge / max;
      this.sparkAlpha[i] = (1.0 - t) * (1.0 - t);
    }

    (this.sparkGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.sparkGeo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  /**
   * Builds 90 Zero-Gravity Floor-to-Sky Particles (1 single GPU draw call, zero per-frame allocations):
   * Each particle starts on the floor at a varied (x, z) offset, slowly rises in zero-G,
   * and then suddenly rockets vertically upward at high speed before vanishing!
   */
  private buildZeroGParticles() {
    const n = HangarCustomizer.ZEROG_COUNT;
    for (let i = 0; i < n; i++) {
      this.respawnZeroGParticle(i, true);
    }

    this.zeroGGeo = new THREE.BufferGeometry();
    this.zeroGGeo.setAttribute('position', new THREE.BufferAttribute(this.zeroGPos, 3));
    this.zeroGGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.zeroGAlpha, 1));
    this.zeroGGeo.setAttribute('aSize', new THREE.BufferAttribute(this.zeroGSize, 1));
    this.zeroGGeo.setAttribute('aSeed', new THREE.BufferAttribute(this.zeroGSeed, 1));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) }
      },
      vertexShader: `
        attribute float aAlpha;
        attribute float aSize;
        attribute float aSeed;
        varying float vAlpha;
        varying float vSeed;
        uniform float uPixelRatio;
        void main() {
          vAlpha = aAlpha;
          vSeed = aSeed;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPos;
          gl_PointSize = min(20.0, aSize * uPixelRatio * (34.0 / max(1.0, -mvPos.z)));
        }
      `,
      fragmentShader: `
        precision mediump float;
        varying float vAlpha;
        varying float vSeed;
        void main() {
          if (vAlpha <= 0.01) discard;
          vec2 uv = gl_PointCoord - vec2(0.5);
          float r2 = dot(uv, uv) * 4.0;
          if (r2 > 1.0) discard;
          float core = exp(-r2 * 5.2);
          // 1979 neon cyan / acid-lime / warm-white zero-G motes
          vec3 c1 = vec3(0.22, 0.85, 1.0);
          vec3 c2 = vec3(0.66, 1.0, 0.30);
          vec3 baseCol = mix(c1, c2, step(0.62, vSeed));
          vec3 col = mix(baseCol, vec3(1.0, 0.99, 0.92), core * 0.75);
          gl_FragColor = vec4(col * 1.45, vAlpha * (1.0 - r2));
        }
      `
    });
    mat.customProgramCacheKey = () => 'HangarZeroGParticlesV1';

    const points = new THREE.Points(this.zeroGGeo, mat);
    points.frustumCulled = false;
    points.renderOrder = 6;
    this.group.add(points);
  }

  private respawnZeroGParticle(i: number, staggeredInit: boolean) {
    const floorY = GROUND_Y - 0.30;
    // Varied radial & angular floor offsets around the Hangar (0.9m .. 7.8m)
    const ang = Math.random() * Math.PI * 2;
    const rad = 0.9 + Math.sqrt(Math.random()) * 6.9;
    const bx = Math.cos(ang) * rad;
    const bz = Math.sin(ang) * rad;
    const i3 = i * 3;

    this.zeroGBaseX[i] = bx;
    this.zeroGBaseZ[i] = bz;
    this.zeroGPos[i3] = bx;
    this.zeroGPos[i3 + 1] = floorY;
    this.zeroGPos[i3 + 2] = bz;

    // Slow zero-G rise speed, varied wait-before-shoot duration, and rapid warp-out lifetime
    this.zeroGVelY[i] = 0.16 + Math.random() * 0.28;
    const triggerT = 1.2 + Math.random() * 2.2;
    this.zeroGTriggerTime[i] = triggerT;
    this.zeroGMaxLife[i] = triggerT + 0.52 + Math.random() * 0.28;
    this.zeroGAge[i] = staggeredInit ? Math.random() * this.zeroGMaxLife[i] : 0;
    this.zeroGSeed[i] = Math.random();
    this.zeroGSize[i] = 0.55 + Math.random() * 0.75;
    this.zeroGAlpha[i] = 0;

    if (staggeredInit && this.zeroGAge[i] > 0) {
      // Pre-advance height so particles are already gracefully scattered on frame 0
      const a = this.zeroGAge[i];
      if (a < triggerT) {
        this.zeroGPos[i3 + 1] = floorY + a * this.zeroGVelY[i];
      } else {
        const dtShoot = a - triggerT;
        this.zeroGPos[i3 + 1] = floorY + triggerT * this.zeroGVelY[i] + 18.0 * dtShoot * dtShoot;
      }
    }
  }

  private updateZeroGParticles(dt: number, totalTime: number) {
    const n = HangarCustomizer.ZEROG_COUNT;
    for (let i = 0; i < n; i++) {
      this.zeroGAge[i] += dt;
      const age = this.zeroGAge[i];
      const maxL = this.zeroGMaxLife[i];
      if (age >= maxL) {
        this.respawnZeroGParticle(i, false);
        continue;
      }

      const trig = this.zeroGTriggerTime[i];
      const i3 = i * 3;
      const seed = this.zeroGSeed[i];

      if (age < trig) {
        // Phase 1: Slow zero-gravity rise off the floor with gentle organic lateral float
        this.zeroGPos[i3] = this.zeroGBaseX[i] + Math.sin(totalTime * 1.4 + seed * 12.0) * 0.14;
        this.zeroGPos[i3 + 1] += this.zeroGVelY[i] * dt;
        this.zeroGPos[i3 + 2] = this.zeroGBaseZ[i] + Math.cos(totalTime * 1.2 + seed * 9.0) * 0.14;
        const fadeIn = Math.min(1.0, age / 0.35);
        this.zeroGAlpha[i] = fadeIn * 0.85;
      } else {
        // Phase 2: Sudden high-pace vertical shoot straight upward to disappear!
        const shootNorm = (age - trig) / Math.max(0.05, maxL - trig);
        const burstVy = 12.0 + shootNorm * 24.0;
        this.zeroGPos[i3 + 1] += burstVy * dt;
        // Bright flash right as it shoots, then fades smoothly to 0
        this.zeroGAlpha[i] = (1.0 - shootNorm) * (1.0 - shootNorm) * 1.15;
      }
    }

    (this.zeroGGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.zeroGGeo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  private buildRetroBlueCRTComputer(seed: number): THREE.Group {
    const comp = new THREE.Group();

    const chassisBrown = new THREE.MeshStandardMaterial({
      color: 0x5c3622,
      metalness: 0.25,
      roughness: 0.55
    });
    const creamBezel = new THREE.MeshStandardMaterial({
      color: 0xd9ccb2,
      metalness: 0.12,
      roughness: 0.48
    });
    const darkPanel = new THREE.MeshStandardMaterial({
      color: 0x1d1a22,
      metalness: 0.45,
      roughness: 0.40
    });
    const orangeKey = new THREE.MeshBasicMaterial({ color: 0xff7f2a });
    const limeLed = new THREE.MeshBasicMaterial({ color: 0xa6ff38 });

    // 1. Lower Mainframe Desk Pedestal Cabinet
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.92, 0.72), chassisBrown);
    desk.position.set(0, 0.46, 0);
    comp.add(desk);

    // Slanted Retro Keyboard Deck
    const kbDeck = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.10, 0.34), darkPanel);
    kbDeck.position.set(0, 0.94, 0.24);
    kbDeck.rotation.x = 0.22;
    comp.add(kbDeck);

    // Status LEDs on front panel
    for (let i = 0; i < 4; i++) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.02), i % 2 === 0 ? limeLed : orangeKey);
      led.position.set(-0.36 + i * 0.10, 0.78, 0.365);
      comp.add(led);
    }

    // 2. Chunky 1979 CRT Monitor Housing sitting on top of the console
    const monBox = new THREE.Mesh(new THREE.BoxGeometry(1.04, 0.84, 0.66), creamBezel);
    monBox.position.set(0, 1.38, -0.04);
    comp.add(monBox);

    const screenRecess = new THREE.Mesh(new THREE.BoxGeometry(0.90, 0.68, 0.04), darkPanel);
    screenRecess.position.set(0, 1.39, 0.28);
    comp.add(screenRecess);

    // 3. Custom GPU-Animated Glowing Blue CRT Screen Shader (oscilloscope waves + telemetry grid + TEST SIGNAL LOST glitch!)
    const crtMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: seed },
        uGlitch: { value: 0.0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision mediump float;
        varying vec2 vUv;
        uniform float uTime;
        uniform float uSeed;
        uniform float uGlitch;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        void main() {
          vec2 uv = vUv;
          float t = uTime + uSeed * 3.1;

          // Horizontal sync tear when signal is losing lock
          if (uGlitch > 0.01) {
            float tear = (hash21(vec2(floor(uv.y * 18.0), floor(uTime * 30.0))) - 0.5) * 0.14 * uGlitch;
            uv.x = fract(uv.x + tear);
          }

          // Deep electric cobalt CRT phosphor background
          vec3 bg = vec3(0.02, 0.14, 0.34);

          // Crisp telemetry grid
          vec2 g = abs(fract(uv * vec2(10.0, 7.0) - 0.5) - 0.5);
          float grid = (1.0 - smoothstep(0.0, 0.045, min(g.x, g.y))) * 0.35;

          // Dual animated glowing cyan-blue oscilloscope waveforms
          float wave1Y = 0.56 + 0.14 * sin(uv.x * 16.0 - t * 4.5) * cos(uv.x * 5.0 + t * 1.4);
          float wave2Y = 0.34 + 0.10 * sin(uv.x * 22.0 + t * 6.0);
          float w1 = smoothstep(0.035, 0.0, abs(uv.y - wave1Y));
          float w2 = smoothstep(0.028, 0.0, abs(uv.y - wave2Y)) * 0.75;

          // Scrolling vertical radar sweep bar + blinking data bars on bottom
          float sweepX = fract(t * 0.38);
          float sweep = smoothstep(0.14, 0.0, abs(uv.x - sweepX)) * 0.45;
          float bars = step(0.14, uv.y) * step(uv.y, 0.22) * step(0.35, fract(uv.x * 12.0 + floor(t * 3.0) * 0.27)) * 0.65;

          // Classic CRT scanlines + soft tube vignette
          float scan = 0.86 + 0.14 * sin(uv.y * 110.0);
          float vig = smoothstep(0.0, 0.12, uv.x) * smoothstep(1.0, 0.88, uv.x)
                    * smoothstep(0.0, 0.12, uv.y) * smoothstep(1.0, 0.88, uv.y);

          vec3 col = bg;
          col += vec3(0.08, 0.55, 1.0) * (grid + sweep);
          col += vec3(0.45, 0.92, 1.0) * (w1 + w2 + bars);

          // 1979 "TEST SIGNAL LOST" SMPTE Color Bars + Snow White-Noise Static Overlay!
          if (uGlitch > 0.01) {
            float band = floor(uv.x * 7.0);
            vec3 barCol = vec3(0.85);
            if (band < 1.0) barCol = vec3(0.92, 0.92, 0.92);
            else if (band < 2.0) barCol = vec3(0.95, 0.88, 0.15);
            else if (band < 3.0) barCol = vec3(0.12, 0.88, 0.92);
            else if (band < 4.0) barCol = vec3(0.20, 0.90, 0.25);
            else if (band < 5.0) barCol = vec3(0.92, 0.22, 0.82);
            else if (band < 6.0) barCol = vec3(0.92, 0.18, 0.18);
            else barCol = vec3(0.14, 0.28, 0.95);

            float snow = hash21(floor(uv * vec2(64.0, 48.0)) + floor(uTime * 48.0));
            vec3 testPattern = mix(barCol, vec3(snow), 0.48);
            // Dark center "NO SIGNAL" black horizontal band flicker
            float noSigBar = step(0.40, uv.y) * step(uv.y, 0.60);
            testPattern = mix(testPattern, vec3(snow * 0.35 + 0.05), noSigBar * 0.72);
            col = mix(col, testPattern, uGlitch);
          }

          col *= scan * (0.45 + 0.55 * vig);

          gl_FragColor = vec4(col * 1.45, 1.0);
        }
      `
    });
    crtMat.customProgramCacheKey = () => 'RetroBlueCRTScreenV2';
    this.crtMaterials.push(crtMat);
    // Register the two Hangar screens (seed 0.0 & 2.1) for random signal-lost test-pattern flashes
    if (seed === 0.0 || seed === 2.1) {
      this.hangarCrtStates.push({
        mat: crtMat,
        cooldown: 2.8 + seed * 1.6,
        glitchTimer: 0
      });
    }

    const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.60), crtMat);
    screenMesh.position.set(0, 1.39, 0.305);
    comp.add(screenMesh);

    return comp;
  }

  private setupDragRotation() {
    window.addEventListener('pointerdown', (e) => {
      if (!this.isActive) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('#hangar-panel, button')) return;
      this.isDragging = true;
      this.lastPointerX = e.clientX;
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.isActive || !this.isDragging) return;
      const dx = e.clientX - this.lastPointerX;
      this.lastPointerX = e.clientX;
      this.turntableAngle += dx * 0.012;
    });
    window.addEventListener('pointerup', () => {
      this.isDragging = false;
    });
  }

  public enter(
    camera: THREE.PerspectiveCamera,
    keyLight: THREE.DirectionalLight,
    ambientLight: THREE.AmbientLight
  ) {
    if (this.isActive) return;
    this.isActive = true;
    this.hoverHeight = 0;
    this.hoverVel = 0;
    this.camOrbitYaw = 0.14;
    this.camOrbitPitch = 0.10;
    this.group.visible = true;
    this.runwayComputersGroup.visible = false;

    // Save gameplay scene background / env / fog / exposure
    this.savedBg = this.scene.background;
    this.savedEnv = this.scene.environment;
    this.savedFog = this.scene.fog;
    this.savedExposure = this.renderer.toneMappingExposure;

    // Apply Triple-AAA the_lost_city_2k HDRI as BOTH Environment IBL + Panoramic Background!
    if (this.hdrEnvMap) {
      this.scene.environment = this.hdrEnvMap;
    }
    if (this.hdrTexture) {
      this.scene.background = this.hdrTexture;
      this.scene.backgroundIntensity = 1.05;
    }
    this.scene.fog = null;
    this.renderer.toneMappingExposure = 1.15;

    // Triple-AAA Combined Lighting: Prominent Shadow-Casting Golden Sun Light + HDRI IBL + Dual Blue CRT Bounce Lights!
    ambientLight.intensity = 0.36;
    keyLight.intensity = 0.22;
    keyLight.castShadow = false;
    this.sunLight.intensity = 3.25;
    this.sunLight.castShadow = true;
    this.crtBlueLightL.intensity = 8.5;
    this.crtBlueLightR.intensity = 8.5;
    this.runwayBlueLight.intensity = 0;

    // Hero Showcase Camera framing Jones on the Rotating Disc + Flanking Blue CRT Computers + Lost City HDRI!
    camera.position.set(0.65, GROUND_Y + 1.55, 5.15);
    camera.lookAt(0.45, GROUND_Y + 1.05, 0);
  }

  public exit(keyLight: THREE.DirectionalLight, ambientLight: THREE.AmbientLight) {
    if (!this.isActive) return;
    this.isActive = false;
    this.isDragging = false;
    this.group.visible = false;
    this.runwayComputersGroup.visible = true;

    // Restore gameplay scene background / env / fog / lighting
    this.scene.background = this.savedBg;
    this.scene.environment = this.savedEnv;
    this.scene.fog = this.savedFog;
    this.renderer.toneMappingExposure = this.savedExposure;

    ambientLight.intensity = 3.4;
    keyLight.intensity = 1.4;
    this.sunLight.intensity = 0;
    this.sunLight.castShadow = false;
    this.crtBlueLightL.intensity = 0;
    this.crtBlueLightR.intensity = 0;
    this.runwayBlueLight.intensity = 5.5;
  }

  /**
   * Updates animated CRT screens (both Hangar & Gameplay Runway), 1m x 1m Blue Laser Grid,
   * constant-speed turntable rotation, controlled Hangar Jetpack Hover preview,
   * Zero-G particles, and Gamepad Right-Stick 360° orbit camera centered on Jones!
   */
  public update(
    dt: number,
    totalTime: number,
    playerX: number,
    playerGroup?: THREE.Object3D,
    camera?: THREE.PerspectiveCamera,
    isJetpackHovering: boolean = false,
    rightStickX: number = 0,
    rightStickY: number = 0
  ) {
    // Always animate blue CRT screen shaders smoothly
    for (const mat of this.crtMaterials) {
      mat.uniforms.uTime.value = totalTime;
    }

    if (this.isActive) {
      if (this.laserGridMat) {
        this.laserGridMat.uniforms.uTime.value = totalTime;
      }

      // Constant smooth rotation speed on both disc AND hovering Jones!
      if (!this.isDragging) {
        this.turntableAngle += dt * this.autoSpinSpeed;
      }
      this.turntableDisc.rotation.y = this.turntableAngle;

      // Controlled low hover (+0.82m above disc) when jetpack is held; smooth drop back to idle on release!
      if (isJetpackHovering) {
        this.wasAirborneInHangar = true;
        const targetH = 0.82 + Math.sin(totalTime * 4.2) * 0.045;
        this.hoverHeight = THREE.MathUtils.lerp(this.hoverHeight, targetH, Math.min(1, dt * 6.5));
        this.hoverVel = 0;
      } else if (this.hoverHeight > 0.001) {
        this.wasAirborneInHangar = true;
        this.hoverVel -= 14.0 * dt;
        const impactVel = Math.abs(this.hoverVel);
        this.hoverHeight = Math.max(0, this.hoverHeight + this.hoverVel * dt);
        if (this.hoverHeight <= 0.001) {
          this.hoverHeight = 0;
          this.hoverVel = 0;
          if (this.wasAirborneInHangar) {
            this.wasAirborneInHangar = false;
            this.onLand?.(THREE.MathUtils.clamp(impactVel / 6.0, 0.68, 1.0));
          }
        }
      } else if (this.wasAirborneInHangar) {
        // Fallback guarantee: if hover was tapped briefly, ALWAYS play landing SFX on touchdown!
        this.wasAirborneInHangar = false;
        this.onLand?.(0.72);
      }

      if (playerGroup) {
        playerGroup.position.set(0, GROUND_Y + this.hoverHeight, 0);
        playerGroup.rotation.y = this.turntableAngle;
      }

      // Random "Test Signal Lost" CRT glitch flashes + subtle white-noise static SFX!
      let glitchL = 0;
      let glitchR = 0;
      for (let i = 0; i < this.hangarCrtStates.length; i++) {
        const st = this.hangarCrtStates[i];
        if (st.glitchTimer > 0) {
          st.glitchTimer = Math.max(0, st.glitchTimer - dt);
          const gVal = st.glitchTimer > 0 ? 1.0 : 0.0;
          st.mat.uniforms.uGlitch.value = gVal;
          if (i === 0) glitchL = gVal;
          else glitchR = gVal;
        } else {
          st.mat.uniforms.uGlitch.value = 0.0;
          st.cooldown -= dt;
          if (st.cooldown <= 0) {
            const dur = 0.28 + Math.random() * 0.28;
            st.glitchTimer = dur;
            st.cooldown = 3.8 + Math.random() * 5.2;
            st.mat.uniforms.uGlitch.value = 1.0;
            this.onCrtStatic?.(dur);
          }
        }
      }

      // Subtle animated blue CRT flicker cast onto Jones's suit & jetpack (dimmed slightly during static drop)!
      const flickerL = (7.8 + Math.sin(totalTime * 11.0) * 1.1 + Math.cos(totalTime * 23.0) * 0.5) * (glitchL > 0.5 ? 0.65 : 1.0);
      const flickerR = (7.8 + Math.cos(totalTime * 9.5) * 1.1 + Math.sin(totalTime * 19.0) * 0.5) * (glitchR > 0.5 ? 0.65 : 1.0);
      this.crtBlueLightL.intensity = flickerL;
      this.crtBlueLightR.intensity = flickerR;

      // Update random electric sparks from broken floor cables + zero-gravity floor-to-sky particles!
      this.updateCableSparks(dt);
      this.updateZeroGParticles(dt, totalTime);

      if (camera) {
        // Gamepad Right-Stick 360° camera orbit around Jones's center point!
        if (Math.abs(rightStickX) > 0.01) {
          this.camOrbitYaw -= rightStickX * dt * 2.1;
        }
        if (Math.abs(rightStickY) > 0.01) {
          this.camOrbitPitch = THREE.MathUtils.clamp(this.camOrbitPitch - rightStickY * dt * 1.4, -0.16, 0.62);
        }

        const radius = 5.25;
        const targetY = GROUND_Y + 1.05 + this.hoverHeight * 0.45;
        const cosP = Math.cos(this.camOrbitPitch);
        const breathX = Math.sin(totalTime * 0.55) * 0.06;
        const breathY = Math.cos(totalTime * 0.7) * 0.04;

        const camX = Math.sin(this.camOrbitYaw) * cosP * radius + breathX;
        const camY = targetY + Math.sin(this.camOrbitPitch) * radius + breathY;
        const camZ = Math.cos(this.camOrbitYaw) * cosP * radius;

        camera.position.set(camX, camY, camZ);
        camera.lookAt(0, targetY, 0);
      }
    } else {
      // Gameplay mode: position the shared blue CRT PointLight on the nearest runway computer to cast blue light onto Jones!
      let nearestX = this.runwayComputerXs[0];
      let bestDist = Infinity;
      for (const cx of this.runwayComputerXs) {
        const d = Math.abs(cx - playerX);
        if (d < bestDist) {
          bestDist = d;
          nearestX = cx;
        }
      }
      this.runwayBlueLight.position.set(nearestX, GROUND_Y + 1.45, -1.25);
      this.runwayBlueLight.intensity = bestDist < 12 ? (6.5 + Math.sin(totalTime * 10.0) * 0.9) : 0;
    }
  }
}
