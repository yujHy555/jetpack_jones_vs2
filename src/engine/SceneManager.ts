import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export class SceneManager {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
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

    // Cel-Shading & Flat Vibrant Lighting: disabled heavy 3D shadow maps in favor of clean round toon shadows
    this.renderer.shadowMap.enabled = false;

    // Bright Flat Cel-Shading Environment Lighting
    this.ambientLight = new THREE.AmbientLight(0xffffff, 3.4);
    this.scene.add(this.ambientLight);

    // Gentle front-top fill wash for vivid cartoon colors without harsh dark shading
    this.keyLight = new THREE.DirectionalLight(0xfff8ee, 1.4);
    this.keyLight.position.set(0.5, 20, 10);
    this.keyLight.castShadow = false;
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
    // Render Pixel-Art RT at exact 220p arcade resolution (~85k pixels total -> ultra-fast 120+ FPS!)
    const rtH = 220;
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
        uPixelHeight: { value: 220.0 },
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

          // Clean outer-silhouette pixel-edge outline (avoids darkening internal clothing folds!)
          float cL = luma(col);
          float lR = luma(pow(max(texture2D(tDiffuse, pixUv + vec2(stepUv.x, 0.0)).rgb, vec3(0.001)), vec3(0.86)) * 1.15);
          float lD = luma(pow(max(texture2D(tDiffuse, pixUv + vec2(0.0, -stepUv.y)).rgb, vec3(0.001)), vec3(0.86)) * 1.15);
          float edge = abs(lR - cL) + abs(lD - cL);
          float outlineMask = smoothstep(0.20, 0.48, edge);
          col = mix(col, col * 0.45, outlineMask * 0.52);

          // Vibrant 16-bit color pop + zero-branch ordered dithering + 16-level quantization
          col = mix(vec3(cL), col, 1.18);
          float dither = (orderedDither(pixCoord) - 0.5) * (1.0 / 16.0);
          vec3 quant = floor(clamp(col + dither, 0.0, 1.0) * 16.0 + 0.5) / 16.0;

          // Subtle arcade pixel-row micro-scanline sheen
          float scan = 0.97 + 0.03 * sin(vUv.y * uPixelHeight * 6.2831853);
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
    if (this.pixelRT) {
      const rtH = 220;
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
      this.ambientLight.color.setHex(0xffeedd);
      this.ambientLight.intensity = 2.6;
      this.keyLight.color.setHex(0xffaa85);
      this.keyLight.intensity = 1.8;
      this.rimLight.color.setHex(0x44ccff);
      this.rimLight.intensity = 1.2;
    } else if (lvl === 2) {
      this.ambientLight.color.setHex(0xffffff);
      this.ambientLight.intensity = 2.8;
      this.keyLight.color.setHex(0xfff8ee);
      this.keyLight.intensity = 1.4;
      this.rimLight.color.setHex(0x88eeff);
      this.rimLight.intensity = 1.0;
    } else {
      this.ambientLight.color.setHex(0xffffff);
      this.ambientLight.intensity = 2.8;
      this.keyLight.color.setHex(0xfff8ee);
      this.keyLight.intensity = 1.4;
      this.rimLight.color.setHex(0x88eeff);
      this.rimLight.intensity = 1.0;
    }
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

  public render() {
    // 0.00ms overhead bypass when BOTH Pixel-Art Shader and Hangar DOF are OFF!
    if (!this.pixelArtEnabled && !this.dofEnabled) {
      this.renderer.render(this.scene, this.camera);
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
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.pixelPostScene, this.pixelPostCam);
  }
}
