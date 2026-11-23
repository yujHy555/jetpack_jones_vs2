import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export class SceneManager {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  public orthoCamera: THREE.OrthographicCamera;
  public level2CamMode: 'third_person' | 'orthographic' = 'third_person';
  public level2OrbitYaw: number = 0;
  public level2OrbitPitch: number = 0.28;
  public renderer: THREE.WebGLRenderer;
  private canvas: HTMLCanvasElement;

  // Level Panoramic HDRI Background & Environment (nowhere_road_2k.hdr)
  private levelHdrTexture: THREE.DataTexture | null = null;
  private levelHdrEnvMap: THREE.Texture | null = null;
  private levelHdrReadyPromise: Promise<void>;

  // Cinematic lighting
  public keyLight: THREE.DirectionalLight;
  public rimLight: THREE.DirectionalLight;
  public ambientLight: THREE.AmbientLight;

  // Camera Tracking & Screen Shake
  private shakeIntensity: number = 0;
  private shakeDuration: number = 0;

  // Level 2 Cinematic Lock-On Shoot Framing (3rd-Person Temporary Enemy Alignment)
  private cinematicFocusTimer: number = 0;
  private cinematicTarget: THREE.Vector3 = new THREE.Vector3();
  private cinematicLookPos: THREE.Vector3 = new THREE.Vector3();
  private cinematicLookInit: boolean = false;

  // Handheld Camera Mode
  public handheldEnabled: boolean = true;
  public handheldIntensity: number = 0.7; // 0.0 (static) to 1.0 (full organic handheld sway)
  private handheldTime: number = 0;
  public baseZ: number = 17.5; // Pulled back for spacious panoramic view of the levels and flight areas
  public cameraZoomOffset: number = 0; // Dramatic zoom-in offset (e.g. during cinematic death slow-mo)
  public currentLevel: number = 1;
  public isIsometric: boolean = false;

  // Next-Gen Advanced Pixel-Art + Hangar Depth-of-Field Post-Process Pipeline (0.00ms cost when OFF!)
  public pixelArtEnabled: boolean = false;
  public dofEnabled: boolean = false;
  private dofFocusDist: number = 5.25;
  private pixelArtBlend: number = 0;
  private pixelArtFlash: number = 0;
  private pixelClock: number = 0;
  private pixelRT!: THREE.WebGLRenderTarget;
  private dofRT!: THREE.WebGLRenderTarget;
  private pixelPostScene!: THREE.Scene;
  private pixelPostCam!: THREE.OrthographicCamera;
  private pixelPostMat!: THREE.ShaderMaterial;

  constructor() {
    this.canvas = document.getElementById('canvas3d') as HTMLCanvasElement;
    this.scene = new THREE.Scene();

    // Scene background: Clean dark fallback until nowhere_road_2k.hdr loads (zero fog so HDRI horizon stays crystal-clear!)
    this.scene.background = new THREE.Color(0x1b1620);
    this.scene.fog = null;

    // Camera setup - locked horizontal perspective for 2.5D platformer
    // Pulled back (Z = 17.5) for spacious panoramic view of the levels and flight areas
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(46, aspect, 0.1, 140);
    this.camera.position.set(0, 0, this.baseZ);

    // Triple-AAA Orthographic Camera for Level 2 Isometric/Tactical View
    const orthoHalfH = 7.2;
    this.orthoCamera = new THREE.OrthographicCamera(
      -orthoHalfH * aspect,
      orthoHalfH * aspect,
      orthoHalfH,
      -orthoHalfH,
      -40,
      160
    );
    this.orthoCamera.position.set(14, 14, 14);
    this.orthoCamera.lookAt(0, -3.7, 0);

    // WebGL Renderer configuration
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;

    // Triple-AAA Highly Optimized Real-Time Shadows (PCFSoftShadowMap, tight frustum enabled in Level 2 & Hangar!)
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Bright Flat Cel-Shading Environment Lighting
    this.ambientLight = new THREE.AmbientLight(0xffffff, 3.4);
    this.scene.add(this.ambientLight);

    // Gentle front-top fill wash + tight optimized shadow camera for Level 2 real character shadows
    this.keyLight = new THREE.DirectionalLight(0xfff8ee, 1.4);
    this.keyLight.position.set(0.5, 20, 10);
    this.keyLight.castShadow = false; // Activated cleanly in Level 2 for 0ms cost in Level 1!
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.near = 2;
    this.keyLight.shadow.camera.far = 38;
    this.keyLight.shadow.camera.left = -10;
    this.keyLight.shadow.camera.right = 10;
    this.keyLight.shadow.camera.top = 10;
    this.keyLight.shadow.camera.bottom = -10;
    this.keyLight.shadow.bias = -0.0005;
    this.keyLight.shadow.normalBias = 0.025;
    this.scene.add(this.keyLight);
    this.scene.add(this.keyLight.target);

    // Crisp cartoon cyan rim accent
    this.rimLight = new THREE.DirectionalLight(0x88eeff, 1.0);
    this.rimLight.position.set(-6, -2, -2);
    this.scene.add(this.rimLight);

    this.initPixelArtPipeline();
    this.levelHdrReadyPromise = this.loadLevelHDRI();

    window.addEventListener('resize', () => this.onWindowResize());
  }

  public whenLevelHDRIReady(): Promise<void> {
    return this.levelHdrReadyPromise;
  }

  private async loadLevelHDRI(): Promise<void> {
    try {
      const loader = new RGBELoader();
      const hdr = await loader.loadAsync('/hdri/nowhere_road_2k.hdr');
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      this.levelHdrTexture = hdr;

      const pmrem = new THREE.PMREMGenerator(this.renderer);
      pmrem.compileEquirectangularShader();
      this.levelHdrEnvMap = pmrem.fromEquirectangular(hdr).texture;
      pmrem.dispose();

      // Apply nowhere_road_2k.hdr as the level background & PBR reflections!
      this.scene.background = this.levelHdrTexture;
      this.scene.backgroundIntensity = 1.0;
      this.scene.environment = this.levelHdrEnvMap;
      this.scene.fog = null;
    } catch (err) {
      console.warn('[SceneManager] Failed to load nowhere_road_2k.hdr:', err);
    }
  }

  /**
   * Initializes a zero-overhead-when-off Advanced Pixel-Art Post-Processing Shader:
   * - Aspect-corrected 220p arcade pixel grid
   * - 4x4 Ordered Bayer Dithering
   * - Vibrant 16-bit Perceptual Color Quantization
   * - 4-Neighbor Sobel Luminance Pixel-Edge Ink Outlines
   * - Subtle CRT Micro-Scanline Sheen & Portal Warp Flash
   */
  private initPixelArtPipeline() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const aspect = w / h;
    // Render Pixel-Art RT at crisp 320p arcade resolution (clearer detail, same Triple-AAA 1-pass speed!)
    const rtH = 320;
    const rtW = Math.max(1, Math.round(rtH * aspect));
    this.pixelRT = new THREE.WebGLRenderTarget(rtW, rtH, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false
    });
    this.pixelRT.depthTexture = new THREE.DepthTexture(rtW, rtH);
    this.pixelRT.depthTexture.type = THREE.UnsignedShortType;

    // Crisp HD RenderTarget with DepthTexture for Hangar Bokeh Depth-of-Field when HD HDRI preview is active
    const hdH = Math.min(720, h);
    const hdW = Math.max(1, Math.round(hdH * aspect));
    this.dofRT = new THREE.WebGLRenderTarget(hdW, hdH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false
    });
    this.dofRT.depthTexture = new THREE.DepthTexture(hdW, hdH);
    this.dofRT.depthTexture.type = THREE.UnsignedShortType;

    this.pixelPostScene = new THREE.Scene();
    this.pixelPostCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.pixelPostMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.pixelRT.texture },
        tDepth: { value: this.pixelRT.depthTexture },
        uResolution: { value: new THREE.Vector2(w, h) },
        uPixelHeight: { value: 320.0 },
        uBlend: { value: 0.0 },
        uFlash: { value: 0.0 },
        uTime: { value: 0.0 },
        uDofStrength: { value: 0.0 },
        uFocusDist: { value: 5.25 },
        uNear: { value: this.camera.near },
        uFar: { value: this.camera.far }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform vec2 uResolution;
        uniform float uPixelHeight;
        uniform float uBlend;
        uniform float uFlash;
        uniform float uTime;
        uniform float uDofStrength;
        uniform float uFocusDist;
        uniform float uNear;
        uniform float uFar;
        varying vec2 vUv;

        float linearizeDepth(float d) {
          float z = d * 2.0 - 1.0;
          return (2.0 * uNear * uFar) / max(0.0001, (uFar + uNear - z * (uFar - uNear)));
        }

        // Zero-branch ALU ordered dither pattern (ultra-fast on all GPUs!)
        float orderedDither(vec2 p) {
          vec2 c = mod(floor(p), 2.0);
          vec2 c2 = mod(floor(p * 0.5), 2.0);
          float d1 = mod(c.x + c.y * 2.0, 4.0) * 0.25;
          float d2 = mod(c2.x + c2.y * 2.0, 4.0) * 0.0625;
          return d1 + d2;
        }

        float luma(vec3 c) {
          return dot(c, vec3(0.2126, 0.7152, 0.0722));
        }

        // 8-tap circular Bokeh Depth of Field focused sharply on Jones (uFocusDist)!
        vec3 sampleDof(vec2 uv, float blurRadius) {
          vec3 acc = texture2D(tDiffuse, uv).rgb * 0.20;
          float aspect = uResolution.x / max(1.0, uResolution.y);
          vec2 r = vec2(blurRadius / aspect, blurRadius);
          acc += texture2D(tDiffuse, uv + vec2( 1.0,  0.0) * r).rgb * 0.10;
          acc += texture2D(tDiffuse, uv + vec2(-1.0,  0.0) * r).rgb * 0.10;
          acc += texture2D(tDiffuse, uv + vec2( 0.0,  1.0) * r).rgb * 0.10;
          acc += texture2D(tDiffuse, uv + vec2( 0.0, -1.0) * r).rgb * 0.10;
          acc += texture2D(tDiffuse, uv + vec2( 0.707,  0.707) * r).rgb * 0.10;
          acc += texture2D(tDiffuse, uv + vec2(-0.707,  0.707) * r).rgb * 0.10;
          acc += texture2D(tDiffuse, uv + vec2( 0.707, -0.707) * r).rgb * 0.10;
          acc += texture2D(tDiffuse, uv + vec2(-0.707, -0.707) * r).rgb * 0.10;
          return acc;
        }

        void main() {
          float aspect = uResolution.x / max(1.0, uResolution.y);
          vec2 grid = vec2(floor(uPixelHeight * aspect), uPixelHeight);
          vec2 pixCoord = floor(vUv * grid);
          vec2 pixUv = (pixCoord + 0.5) / grid;
          vec2 stepUv = 1.0 / grid;

          vec2 sampleUv = uBlend > 0.5 ? pixUv : vUv;
          vec3 col = texture2D(tDiffuse, sampleUv).rgb;

          // Cinematic Depth of Field focused strictly on Jones in the Customize Hangar!
          if (uDofStrength > 0.01) {
            float rawD = texture2D(tDepth, sampleUv).r;
            float eyeD = linearizeDepth(rawD);
            // Razor-sharp focus band around Jones (depth 3.8m..6.5m), smoothly blurring HDRI sky & far background!
            float coc = smoothstep(1.15, 5.8, abs(eyeD - uFocusDist));
            if (rawD >= 0.999) coc = 1.0; // HDRI Skybox always gets lush soft bokeh!
            float blurR = coc * uDofStrength * (uBlend > 0.5 ? 0.014 : 0.018);
            if (blurR > 0.001) {
              col = sampleDof(sampleUv, blurR);
            }
          }

          // HD DOF-only mode (when Hangar user toggles HD HDRI preview!)
          if (uBlend < 0.5) {
            gl_FragColor = vec4(col, 1.0);
            return;
          }

          // Bright shadow-lift so Jones's outfit, face & chrome jetpack stay vivid and NEVER look dark!
          col = pow(max(col, vec3(0.001)), vec3(0.86)) * 1.15;

          // Clean, refined outer-silhouette pixel-edge outline (crisper detail without muddying faces/jetpacks!)
          float cL = luma(col);
          float lR = luma(pow(max(texture2D(tDiffuse, pixUv + vec2(stepUv.x, 0.0)).rgb, vec3(0.001)), vec3(0.86)) * 1.15);
          float lD = luma(pow(max(texture2D(tDiffuse, pixUv + vec2(0.0, -stepUv.y)).rgb, vec3(0.001)), vec3(0.86)) * 1.15);
          float edge = abs(lR - cL) + abs(lD - cL);
          float outlineMask = smoothstep(0.24, 0.56, edge);
          col = mix(col, col * 0.52, outlineMask * 0.38);

          // Vibrant clearer 24-level pixel-art color quantization + refined ordered dithering
          col = mix(vec3(cL), col, 1.15);
          float dither = (orderedDither(pixCoord) - 0.5) * (1.0 / 24.0);
          vec3 quant = floor(clamp(col + dither, 0.0, 1.0) * 24.0 + 0.5) / 24.0;

          // Ultra-subtle crisp scanline sheen
          float scan = 0.985 + 0.015 * sin(vUv.y * uPixelHeight * 6.2831853);
          vec3 finalCol = quant * scan;

          // Crisp cyan-magenta dimensional portal transition flash
          if (uFlash > 0.001) {
            vec3 flashTint = mix(vec3(0.0, 0.95, 1.0), vec3(1.0, 0.25, 0.85), sin(vUv.x * 6.0 + uTime * 12.0) * 0.5 + 0.5);
            finalCol = mix(finalCol, flashTint, uFlash * 0.42);
          }

          gl_FragColor = vec4(finalCol, 1.0);
        }
      `
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.pixelPostMat);
    this.pixelPostScene.add(quad);

    // Pre-compile pixel-art post-process shader once at boot so crossing Door 1 has ZERO freeze/hitch!
    this.renderer.compile(this.pixelPostScene, this.pixelPostCam);
  }

  public setPixelArtMode(enabled: boolean, flash: boolean = true) {
    this.pixelArtEnabled = enabled;
    // Instant snap between Pixel Art and 3D HD on the exact frame Jones crosses the portal!
    this.pixelArtBlend = enabled ? 1.0 : 0.0;
    if (flash) {
      this.pixelArtFlash = 0.85;
    }
  }

  public setDepthOfField(enabled: boolean, focusDist: number = 5.25) {
    this.dofEnabled = enabled;
    this.dofFocusDist = focusDist;
  }

  private onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    const aspect = width / Math.max(1, height);
    const orthoHalfH = 7.2;
    this.orthoCamera.left = -orthoHalfH * aspect;
    this.orthoCamera.right = orthoHalfH * aspect;
    this.orthoCamera.top = orthoHalfH;
    this.orthoCamera.bottom = -orthoHalfH;
    this.orthoCamera.updateProjectionMatrix();
    if (this.pixelRT) {
      const rtH = 320;
      const rtW = Math.max(1, Math.round(rtH * aspect));
      this.pixelRT.setSize(rtW, rtH);
    }
    if (this.dofRT) {
      const hdH = Math.min(720, height);
      const hdW = Math.max(1, Math.round(hdH * aspect));
      this.dofRT.setSize(hdW, hdH);
    }
    if (this.pixelPostMat) {
      this.pixelPostMat.uniforms.uResolution.value.set(width, height);
    }
  }

  public toggleHandheld(): boolean {
    this.handheldEnabled = !this.handheldEnabled;
    return this.handheldEnabled;
  }

  public triggerShake(intensity: number = 0.2, duration: number = 0.18) {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeDuration = duration;
  }

  public setLevel(lvl: number) {
    this.currentLevel = lvl;
    this.isIsometric = false;
    this.camera.rotation.set(0, 0, 0);

    // Always keep nowhere_road_2k.hdr as the clean panoramic level background!
    if (this.levelHdrTexture) {
      this.scene.background = this.levelHdrTexture;
      this.scene.backgroundIntensity = 1.0;
    }
    if (this.levelHdrEnvMap) {
      this.scene.environment = this.levelHdrEnvMap;
    }
    this.scene.fog = null;

    if (lvl === 3) {
      this.scene.environmentIntensity = 0.85;
      this.ambientLight.color.setHex(0xffeedd);
      this.ambientLight.intensity = 2.6;
      this.keyLight.color.setHex(0xffaa85);
      this.keyLight.intensity = 1.8;
      this.rimLight.color.setHex(0x44ccff);
      this.rimLight.intensity = 1.2;
    } else if (lvl === 2) {
      // High-contrast Triple-AAA sun/ambient balance + restrained IBL so Jones never glows & his cast shadow is rich & dark!
      this.scene.environmentIntensity = 0.30;
      this.ambientLight.color.setHex(0xcfdfff);
      this.ambientLight.intensity = 0.36;
      this.keyLight.color.setHex(0xfff4dc);
      this.keyLight.intensity = 2.65;
      this.keyLight.castShadow = true; // Real AAA character shadows in Level 2!
      this.keyLight.shadow.bias = -0.0004;
      this.keyLight.shadow.normalBias = 0.018;
      this.rimLight.color.setHex(0x88ccff);
      this.rimLight.intensity = 0.28;
    } else {
      this.scene.environmentIntensity = 0.85;
      this.ambientLight.color.setHex(0xffffff);
      this.ambientLight.intensity = 2.8;
      this.keyLight.color.setHex(0xfff8ee);
      this.keyLight.intensity = 1.4;
      this.keyLight.castShadow = false;
      this.rimLight.color.setHex(0x88eeff);
      this.rimLight.intensity = 1.0;
    }
  }

  /**
   * Resets Level 1 camera strictly to its default straight-on 2.5D pose so Hangar orbit NEVER influences Level 1!
   */
  public resetLevel1Camera(targetX: number = 0, targetY: number = -3.70) {
    this.camera.up.set(0, 1, 0);
    this.camera.quaternion.identity();
    this.camera.rotation.set(0, 0, 0);
    this.camera.position.set(targetX + 1.8, Math.max(-1.5, targetY + 1.2), this.baseZ);
  }

  /**
   * Unified 2.5D Panoramic Side-scrolling Camera Tracking (Levels 1, 2, and 3)
   */
  public updateCamera(targetX: number, targetY: number, dt: number) {
    const targetCamX = targetX + 1.8;
    const targetCamY = Math.max(-1.5, targetY + 1.2); // Never cuts off top in air!

    this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, targetCamX, dt * 6.5);
    this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, targetCamY, dt * 6.5);
    this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, this.baseZ + this.cameraZoomOffset, dt * 6.5);

    // Always keep Level 1 2.5D camera strictly forward-aligned (never carries Hangar yaw!)
    this.camera.rotation.y = 0;

    // Subtle Organic Handheld Camera Breathing & Sway (scaled by user slider)
    if (this.handheldEnabled && this.handheldIntensity > 0) {
      this.handheldTime += dt;
      const mult = this.handheldIntensity;
      const hx = (Math.sin(this.handheldTime * 1.1) * 0.05 + Math.sin(this.handheldTime * 2.3 + 1.2) * 0.025) * mult;
      const hy = (Math.cos(this.handheldTime * 0.9) * 0.06 + Math.sin(this.handheldTime * 1.7 + 0.8) * 0.025) * mult;
      const rotZ = Math.sin(this.handheldTime * 0.75) * 0.0055 * mult;
      const rotX = Math.cos(this.handheldTime * 0.85) * 0.0045 * mult;

      this.camera.position.x += hx;
      this.camera.position.y += hy;
      this.camera.rotation.z = THREE.MathUtils.lerp(this.camera.rotation.z, rotZ, dt * 5.0);
      this.camera.rotation.x = THREE.MathUtils.lerp(this.camera.rotation.x, rotX, dt * 5.0);
    } else {
      this.camera.rotation.z = THREE.MathUtils.lerp(this.camera.rotation.z, 0, dt * 5.0);
      this.camera.rotation.x = THREE.MathUtils.lerp(this.camera.rotation.x, 0, dt * 5.0);
    }

    // Apply Screen Shake if active
    if (this.shakeDuration > 0) {
      this.shakeDuration -= dt;
      const shakeAmt = this.shakeIntensity * (this.shakeDuration / 0.18);
      this.camera.position.x += (Math.random() - 0.5) * shakeAmt;
      this.camera.position.y += (Math.random() - 0.5) * shakeAmt;
      if (this.shakeDuration <= 0) this.shakeIntensity = 0;
    }

    // Keep key light directly overhead for simple, short, soft shadows
    this.keyLight.position.x = this.camera.position.x + 0.5;
    this.keyLight.position.y = this.camera.position.y + 18;
    this.keyLight.position.z = 6;
    this.keyLight.target.position.set(this.camera.position.x, this.camera.position.y - 2, 0);

    // Keep Pixel-Art blend locked instantly to pixelArtEnabled; fade brief portal flash cleanly
    this.pixelClock += dt;
    this.pixelArtBlend = this.pixelArtEnabled ? 1.0 : 0.0;
    if (this.pixelArtFlash > 0) {
      this.pixelArtFlash = Math.max(0, this.pixelArtFlash - dt * 5.0);
    }
  }

  /**
   * Pre-compiles ALL WebGL shaders (main 3D scene + 16-bit Pixel-Art post-process pipeline)
   * BEFORE the preloader hides so frame 1 and portal crossings have ZERO shader-compile stutter!
   */
  public warmupShaders() {
    this.renderer.compile(this.scene, this.camera);
    this.renderer.compile(this.pixelPostScene, this.pixelPostCam);
    // Warm up the pixelRT framebuffer & post-process program once silently
    this.renderer.setRenderTarget(this.pixelRT);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.pixelPostScene, this.pixelPostCam);
    // Leave main HD scene rendered on screen cleanly
    this.renderer.render(this.scene, this.camera);
  }

  public toggleLevel2CameraMode(): 'third_person' | 'orthographic' {
    this.level2CamMode = this.level2CamMode === 'third_person' ? 'orthographic' : 'third_person';
    return this.level2CamMode;
  }

  public getActiveCamera(isHangar: boolean = false): THREE.Camera {
    if (!isHangar && this.currentLevel === 2 && this.level2CamMode === 'orthographic') {
      return this.orthoCamera;
    }
    return this.camera;
  }

  /**
   * Temporarily aligns the 3rd-person camera into a dramatic over-the-shoulder cinematic angle
   * framing Jones and the locked-on enemy being shot!
   */
  public triggerCinematicShootFocus(enemyWorldPos: THREE.Vector3, duration: number = 1.25) {
    if (this.level2CamMode !== 'third_person') return;
    this.cinematicTarget.copy(enemyWorldPos);
    this.cinematicFocusTimer = duration;
  }

  public cancelCinematicShootFocus() {
    this.cinematicFocusTimer = 0;
  }

  /**
   * Level 2 Triple-AAA Dual Camera System:
   * - 'third_person': Smooth dynamic 3rd-person follow camera behind/above Jones with optional orbit,
   *   cinematic lock-on shoot framing, AND anti-clipping collision against ramps/blocks/floor!
   * - 'orthographic': Crisp Triple-AAA isometric orthographic camera tracking Jones smoothly across the 3D plane!
   */
  public updateCameraFreeRoam(
    targetX: number,
    targetY: number,
    targetZ: number,
    dt: number,
    rightStickX: number = 0,
    rightStickY: number = 0,
    resolveCollision?: (px: number, py: number, pz: number, dx: number, dy: number, dz: number) => { x: number; y: number; z: number }
  ) {
    const manualOrbit = Math.abs(rightStickX) > 0.01 || Math.abs(rightStickY) > 0.01;
    if (manualOrbit) {
      this.cinematicFocusTimer = 0;
      this.level2OrbitYaw -= rightStickX * dt * 2.0;
      this.level2OrbitPitch = THREE.MathUtils.clamp(this.level2OrbitPitch - rightStickY * dt * 1.2, 0.08, 0.72);
    }

    const focusY = targetY + 1.20;
    if (this.level2CamMode === 'orthographic') {
      // Triple-AAA Isometric Orthographic Tracking Camera
      const goalX = targetX + 12.0;
      const goalY = focusY + 11.5;
      const goalZ = targetZ + 12.0;
      this.orthoCamera.position.x = THREE.MathUtils.lerp(this.orthoCamera.position.x, goalX, Math.min(1, dt * 6.5));
      this.orthoCamera.position.y = THREE.MathUtils.lerp(this.orthoCamera.position.y, goalY, Math.min(1, dt * 6.5));
      this.orthoCamera.position.z = THREE.MathUtils.lerp(this.orthoCamera.position.z, goalZ, Math.min(1, dt * 6.5));
      this.orthoCamera.lookAt(targetX, focusY, targetZ);
    } else {
      // Optional Temporary Cinematic Over-The-Shoulder Framing when shooting a locked-on enemy!
      let desiredLookX = targetX;
      let desiredLookY = focusY;
      let desiredLookZ = targetZ;
      let camDist = 10.5;

      if (this.cinematicFocusTimer > 0) {
        this.cinematicFocusTimer = Math.max(0, this.cinematicFocusTimer - dt);
        const dx = targetX - this.cinematicTarget.x;
        const dz = targetZ - this.cinematicTarget.z;
        if (dx * dx + dz * dz > 0.5) {
          // Place camera DIRECTLY behind Jones looking straight toward the enemy with a crisp closer zoom-in!
          const idealYaw = Math.atan2(dx, dz);
          let yawDiff = ((idealYaw - this.level2OrbitYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
          this.level2OrbitYaw += yawDiff * Math.min(1, dt * 5.6);
          this.level2OrbitPitch = THREE.MathUtils.lerp(this.level2OrbitPitch, 0.16, Math.min(1, dt * 5.0));
          camDist = 7.4; // Closer cinematic zoom-in right behind Jones!
          // Frame Jones cleanly in foreground looking straight at the target enemy
          desiredLookX = THREE.MathUtils.lerp(targetX, this.cinematicTarget.x, 0.35);
          desiredLookY = THREE.MathUtils.lerp(focusY, this.cinematicTarget.y, 0.28);
          desiredLookZ = THREE.MathUtils.lerp(targetZ, this.cinematicTarget.z, 0.35);
        }
      }

      // Triple-AAA 3rd-Person Perspective Follow Camera + Anti-Clipping Collision Arm!
      const cosP = Math.cos(this.level2OrbitPitch);
      let goalX = targetX + Math.sin(this.level2OrbitYaw) * cosP * camDist;
      let goalY = focusY + Math.sin(this.level2OrbitPitch) * camDist;
      let goalZ = targetZ + Math.cos(this.level2OrbitYaw) * cosP * camDist;

      if (resolveCollision) {
        const safe = resolveCollision(targetX, focusY + 0.25, targetZ, goalX, goalY, goalZ);
        goalX = safe.x;
        goalY = safe.y;
        goalZ = safe.z;
      }

      this.camera.position.x = THREE.MathUtils.lerp(this.camera.position.x, goalX, Math.min(1, dt * 8.0));
      this.camera.position.y = THREE.MathUtils.lerp(this.camera.position.y, goalY, Math.min(1, dt * 8.0));
      this.camera.position.z = THREE.MathUtils.lerp(this.camera.position.z, goalZ, Math.min(1, dt * 8.0));

      if (!this.cinematicLookInit) {
        this.cinematicLookPos.set(desiredLookX, desiredLookY, desiredLookZ);
        this.cinematicLookInit = true;
      } else {
        this.cinematicLookPos.x = THREE.MathUtils.lerp(this.cinematicLookPos.x, desiredLookX, Math.min(1, dt * 7.5));
        this.cinematicLookPos.y = THREE.MathUtils.lerp(this.cinematicLookPos.y, desiredLookY, Math.min(1, dt * 7.5));
        this.cinematicLookPos.z = THREE.MathUtils.lerp(this.cinematicLookPos.z, desiredLookZ, Math.min(1, dt * 7.5));
      }
      this.camera.lookAt(this.cinematicLookPos);
    }

    // Keep overhead keyLight centered on Jones
    this.keyLight.position.set(targetX + 4, targetY + 18, targetZ + 8);
    this.keyLight.target.position.set(targetX, targetY, targetZ);

    this.pixelClock += dt;
    this.pixelArtBlend = this.pixelArtEnabled ? 1.0 : 0.0;
    if (this.pixelArtFlash > 0) {
      this.pixelArtFlash = Math.max(0, this.pixelArtFlash - dt * 5.0);
    }
  }

  public render(isHangar: boolean = false) {
    const activeCam = this.getActiveCamera(isHangar);
    // 0.00ms overhead bypass when BOTH Pixel-Art Shader and Hangar DOF are OFF!
    if (!this.pixelArtEnabled && !this.dofEnabled) {
      this.renderer.render(this.scene, activeCam);
      return;
    }

    const activeRT = this.pixelArtEnabled ? this.pixelRT : this.dofRT;
    this.pixelPostMat.uniforms.tDiffuse.value = activeRT.texture;
    this.pixelPostMat.uniforms.tDepth.value = activeRT.depthTexture;
    this.pixelPostMat.uniforms.uBlend.value = this.pixelArtEnabled ? 1.0 : 0.0;
    this.pixelPostMat.uniforms.uFlash.value = this.pixelArtFlash;
    this.pixelPostMat.uniforms.uTime.value = this.pixelClock;
    this.pixelPostMat.uniforms.uDofStrength.value = this.dofEnabled ? 1.0 : 0.0;
    this.pixelPostMat.uniforms.uFocusDist.value = this.dofFocusDist;

    this.renderer.setRenderTarget(activeRT);
    this.renderer.render(this.scene, activeCam);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.pixelPostScene, this.pixelPostCam);
  }
}
