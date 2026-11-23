import * as THREE from 'three';
import { SceneManager } from './engine/SceneManager';
import { InputManager } from './engine/InputManager';
import { AudioManager } from './engine/AudioManager';
import { Player } from './entities/Player';
import { ObstacleManager, ObstacleType, PickupType } from './level/Obstacles';
import { ParallaxLayers } from './level/ParallaxLayers';
import { LevelGenerator } from './level/LevelGenerator';
import { PixelPortalManager } from './level/PixelPortalManager';
import { HUD } from './ui/HUD';
import { MeteorManager, MeteorType } from './entities/MeteorManager';
import { EnemyBlob } from './entities/EnemyBlob';
import { HangarCustomizer } from './ui/HangarCustomizer';
import { JetpackModelId } from './entities/MixamoCharacterRig';
import { Level2FreeRoam } from './level/Level2FreeRoam';
import { MicroDebrisVFX } from './entities/MicroDebrisVFX';

enum GameState {
  START,
  CUSTOMIZE,
  PLAYING,
  GAMEOVER
}

class Game {
  private sceneManager: SceneManager;
  private inputManager: InputManager;
  private audioManager: AudioManager;
  private player: Player;
  private obstacleManager: ObstacleManager;
  private parallaxLayers: ParallaxLayers;
  private levelGenerator: LevelGenerator;
  private pixelPortalManager: PixelPortalManager;
  private level2FreeRoam: Level2FreeRoam;
  private level2EnemiesSpawned: boolean = false;
  private level2DroneSlots: { x: number; y: number; z: number; patrol: number; drone: any; respawnTimer: number }[] = [];
  private microDebris: MicroDebrisVFX;
  private level1Completed: boolean = false;
  private hangarCustomizer: HangarCustomizer;
  private hangarPixelStyle: boolean = true;
  private hangarJetpackBtnHeld: boolean = false;
  private hud: HUD;
  private meteorManager: MeteorManager;

  private state: GameState = GameState.START;
  private score: number = 0;
  private clock: THREE.Clock;

  // Settings & Customization
  private autoAimEnabled: boolean = true;
  private crtOverlayEnabled: boolean = true;
  private touchSize: 'compact' | 'normal' | 'large' = 'normal';
  private touchOpacity: number = 85;

  // Lock-on Target Tracking & Next-Gen Raycast Laser Sight Beam
  private lockedEnemy: any = null;
  private lockOnMesh!: THREE.Group;
  private rayBeamGroup!: THREE.Group;
  private rayBeamCore!: THREE.Mesh;
  private rayBeamSheath!: THREE.Mesh;
  private rayBeamSheathMat!: THREE.ShaderMaterial;
  private rayImpactDot!: THREE.Mesh;
  private rayBeamFlashTimer: number = 0;
  private readonly _beamStart = new THREE.Vector3();
  private readonly _beamEnd = new THREE.Vector3();
  private readonly _beamDir = new THREE.Vector3();
  private readonly _beamUp = new THREE.Vector3(0, 1, 0);
  private readonly _lockTargetPos = new THREE.Vector3();
  private readonly _unitX = new THREE.Vector3(1, 0, 0);
  private readonly _tmpDir = new THREE.Vector3();
  private reticleEl: HTMLElement | null = null;
  private reticleLocked: boolean = false;

  // Always-Visible FPS Counter Telemetry
  private fpsValueEl: HTMLElement | null = null;
  private fpsMsEl: HTMLElement | null = null;
  private fpsDotEl: HTMLElement | null = null;
  private fpsBoxEl: HTMLElement | null = null;
  private fpsFrames: number = 0;
  private fpsAccumMs: number = 0;
  private lastRafTime: number = 0;

  // Startup Shoot Lockout & Cinematic Death Polish (Hit-Stop + Slow-Mo)
  private startShootLockout: number = 0;
  private hitStopTimer: number = 0;
  private deathSlowMoTimer: number = 0;

  constructor() {
    this.sceneManager = new SceneManager();
    this.inputManager = new InputManager();
    this.audioManager = new AudioManager();
    this.hud = new HUD();
    this.clock = new THREE.Clock();

    this.fpsValueEl = document.getElementById('fps-value');
    this.fpsMsEl = document.getElementById('fps-ms');
    this.fpsDotEl = document.getElementById('fps-dot');
    this.fpsBoxEl = document.getElementById('fps-counter');
    this.reticleEl = document.getElementById('reticle');

    this.player = new Player(this.sceneManager.scene);
    this.player.onFootstep = (mode) => this.audioManager.playFootstep(mode);
    this.player.onJump = (isDouble) => this.audioManager.playJump(isDouble);
    this.player.onSlide = () => this.audioManager.playSlide();
    this.player.onLand = (impact) => this.audioManager.playGroundLanding(impact);
    this.player.onDeath = () => this.onPlayerFatalImpact();
    this.player.onShieldDeflect = () => this.audioManager.playShieldDeflect();
    this.player.onRadioTransmit = () => this.audioManager.playRadioWavePing();
    this.player.onBallBounce = (s) => this.audioManager.playBallBounce(s);
    this.obstacleManager = new ObstacleManager(this.sceneManager.scene);
    this.parallaxLayers = new ParallaxLayers(this.sceneManager.scene);
    this.levelGenerator = new LevelGenerator(this.obstacleManager, this.sceneManager.scene);
    this.pixelPortalManager = new PixelPortalManager(this.sceneManager.scene);
    this.pixelPortalManager.onPixelModeChange = (enabled) => {
      this.sceneManager.setPixelArtMode(enabled, true);
      this.player.setPixelMode(enabled);
      this.audioManager.playPortalWarp(enabled);
      this.showUpgradeBanner(
        enabled
          ? '👾 PIXEL DIMENSION — ADVANCED 16-BIT PIXEL SHADER ACTIVE!'
          : '✨ HD REALITY — FULL 3D SHADER RESTORED!'
      );
    };
    this.hangarCustomizer = new HangarCustomizer(this.sceneManager.scene, this.sceneManager.renderer);
    this.hangarCustomizer.onLand = (impact) => this.audioManager.playGroundLanding(impact);
    this.hangarCustomizer.onCrtStatic = (dur) => this.audioManager.playCrtStaticNoise(dur);
    this.level2FreeRoam = new Level2FreeRoam(this.sceneManager.scene);
    this.microDebris = new MicroDebrisVFX(this.sceneManager.scene);
    this.obstacleManager.onBulletImpact = (x, y, color) => {
      if (this.levelGenerator.currentLevel !== 2) {
        this.microDebris.burst(x, y, 0, color, -3.70, 0, 1, 1.0);
      }
    };
    this.meteorManager = new MeteorManager(this.sceneManager.scene);
    this.meteorManager.onSedimentWarning = () => {
      this.audioManager.playRadioCrackleSedimentWarning();
      this.hud.showRadioWarningBanner('WARNING — INCOMING PLANET SEDIMENT');
    };

    this.setupLockOnSystem();
    this.setupUIEvents();
    this.setupMainMenu();
    this.setupSettingsModal();
    this.setupControlsModal();
    this.setupControlsZoomPopup();
    this.setupHangarUI();
    this.showMainMenu();

    (window as any).__JETPACK_GAME__ = this;

    // Preload ALL 3D assets, animations, revolver & compile ALL WebGL shaders BEFORE starting the loop!
    this.bootAndPreload();
  }

  private async bootAndPreload() {
    const barEl = document.getElementById('boot-progress-bar');
    const statusEl = document.getElementById('boot-status-text');
    const preloaderEl = document.getElementById('boot-preloader');

    const setProgress = (pct: number, label: string) => {
      if (barEl) barEl.style.width = `${Math.max(4, Math.min(100, pct))}%`;
      if (statusEl) statusEl.textContent = `${label} ${Math.round(pct)}%`;
    };

    setProgress(8, 'LOADING 1979 FLIGHT SYSTEMS...');
    try {
      await Promise.all([
        this.player.whenReady((pct, label) => setProgress(pct, label)),
        this.sceneManager.whenLevelHDRIReady(),
        this.hangarCustomizer.whenHDRIReady()
      ]);
    } catch (e) {
      console.warn('[Boot] Asset preload warning:', e);
    }

    setProgress(92, 'COMPILING GPU & PIXEL-ART SHADERS...');
    // Yield one frame so the progress bar paints at 92% before synchronous GPU shader compilation
    await new Promise((r) => requestAnimationFrame(r));
    EnemyBlob.warmup(this.sceneManager.scene, this.sceneManager.renderer, this.sceneManager.camera);
    this.sceneManager.warmupShaders();

    setProgress(100, 'SYSTEMS ONLINE — READY FOR LAUNCH');
    await new Promise((r) => setTimeout(r, 120));

    if (preloaderEl) {
      preloaderEl.style.opacity = '0';
      preloaderEl.style.pointerEvents = 'none';
      setTimeout(() => preloaderEl.remove(), 380);
    }

    // Reset clock cleanly so frame 1 has zero dt jump!
    this.clock.getDelta();
    this.lastRafTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  private onPlayerFatalImpact() {
    this.hitStopTimer = 0.075;
    this.deathSlowMoTimer = 0.72;
    this.sceneManager.cameraZoomOffset = -3.4;
    this.sceneManager.triggerShake(0.68, 0.45);
    this.audioManager.setJetpackThrust(false);
    this.audioManager.playHitImpact();
    this.triggerDeathImpactFlash();
  }

  private triggerDeathImpactFlash() {
    let flash = document.getElementById('death-impact-flash');
    if (!flash) {
      flash = document.createElement('div');
      flash.id = 'death-impact-flash';
      flash.style.cssText = `
        position: fixed;
        inset: 0;
        z-index: 4500;
        pointer-events: none;
        background: radial-gradient(circle at center, rgba(255, 127, 42, 0.14) 28%, rgba(255, 42, 109, 0.62) 100%);
        opacity: 0;
        transition: opacity 0.42s ease-out;
      `;
      document.body.appendChild(flash);
    }
    flash.style.transition = 'none';
    flash.style.opacity = '1';
    void flash.offsetWidth;
    flash.style.transition = 'opacity 0.52s ease-out';
    flash.style.opacity = '0';
  }

  private setupUIEvents() {
    const camSlider = document.getElementById('slider-handheld') as HTMLInputElement;
    const camLabel = document.getElementById('label-handheld');
    if (camSlider && camLabel) {
      camSlider.addEventListener('input', () => {
        const val = parseInt(camSlider.value, 10);
        this.sceneManager.handheldIntensity = val / 100;
        camLabel.textContent = `${val}%`;
      });
    }

    const camBtn = document.getElementById('btn-handheld');
    if (camBtn) {
      camBtn.addEventListener('click', () => {
        const enabled = this.sceneManager.toggleHandheld();
        camBtn.textContent = enabled ? '🎥 ON [H]' : '🎥 OFF [H]';
      });
    }

    const fsBtn = document.getElementById('btn-fullscreen');
    if (fsBtn) {
      fsBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      });
    }

    const syncAudioButtons = (enabled: boolean) => {
      const topAudio = document.getElementById('btn-audio');
      if (topAudio) topAudio.textContent = enabled ? '🔊 SFX ON' : '🔇 SFX OFF';
      const alwaysMute = document.getElementById('btn-always-mute');
      if (alwaysMute) {
        alwaysMute.textContent = enabled ? '🔊 AUDIO ON' : '🔇 MUTED';
        alwaysMute.style.borderColor = enabled ? '#00f5ff' : '#ff4466';
        alwaysMute.style.color = enabled ? '#00f5ff' : '#ff6677';
        alwaysMute.style.boxShadow = enabled
          ? '0 0 10px rgba(0, 245, 255, 0.28)'
          : '0 0 10px rgba(255, 68, 102, 0.35)';
      }
    };

    const audioBtn = document.getElementById('btn-audio');
    if (audioBtn) {
      audioBtn.addEventListener('click', () => {
        const enabled = this.audioManager.toggle();
        syncAudioButtons(enabled);
        this.updateSettingsUI();
      });
    }

    const alwaysMuteBtn = document.getElementById('btn-always-mute');
    if (alwaysMuteBtn) {
      alwaysMuteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const enabled = this.audioManager.toggle();
        syncAudioButtons(enabled);
        this.updateSettingsUI();
      });
    }

    const shieldBtn = document.getElementById('btn-shield');
    if (shieldBtn) {
      shieldBtn.addEventListener('click', () => this.toggleForcefield());
    }

    const modeBtn = document.getElementById('btn-forcefield-mode');
    if (modeBtn) {
      modeBtn.addEventListener('click', () => this.toggleForcefieldMode());
    }

    const touchShield = document.getElementById('btn-touch-shield');
    if (touchShield) {
      touchShield.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.toggleForcefield();
      });
    }

    const touchMode = document.getElementById('btn-touch-mode');
    if (touchMode) {
      touchMode.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.toggleForcefieldMode();
      });
    }

    this.updateForcefieldUI();

    const levelBtn = document.getElementById('btn-level');
    if (levelBtn) {
      levelBtn.addEventListener('click', () => {
        const nextLevel = this.levelGenerator.currentLevel === 1 ? 2 : 1;
        this.switchLevel(nextLevel);
      });
    }

    const camViewBtn = document.getElementById('btn-cam-view');
    if (camViewBtn) {
      camViewBtn.addEventListener('click', () => {
        const mode = this.sceneManager.toggleLevel2CameraMode();
        camViewBtn.textContent = mode === 'orthographic' ? '📐 ORTHO CAM [V]' : '🎥 3RD PERSON [V]';
      });
    }

    const l2PixelBtn = document.getElementById('btn-l2-pixel');
    if (l2PixelBtn) {
      l2PixelBtn.addEventListener('click', () => {
        const next = !this.sceneManager.pixelArtEnabled;
        this.sceneManager.setPixelArtMode(next, true);
        this.player.setPixelMode(next);
        l2PixelBtn.textContent = next ? '👾 PIXEL: ON' : '👾 PIXEL: OFF';
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyL') {
        const nextLevel = this.levelGenerator.currentLevel === 1 ? 2 : 1;
        this.switchLevel(nextLevel);
      }
    });

    (window as any).__game = this;
  }

  public showMainMenu() {
    this.state = GameState.START;
    this.inputManager.gameplayInputEnabled = false;
    this.sceneManager.cameraZoomOffset = 0;

    // Always restore Level 1 in the Main Menu background with the exact default straight-on camera!
    this.level1Completed = false;
    this.sceneManager.setLevel(1);
    this.levelGenerator.setLevel(1);
    this.parallaxLayers.setLevel(1);
    this.player.setFreeRoamAimMode(false);
    this.parallaxLayers.group.visible = true;
    this.pixelPortalManager.setVisible(true);
    this.obstacleManager.setAllVisible(true);
    this.level2FreeRoam.setVisible(false);
    this.levelGenerator.setFinishGateVisible(true);
    this.hangarCustomizer.runwayComputersGroup.visible = true;
    this.sceneManager.setPixelArtMode(false, false);
    this.player.setPixelMode(false);

    const camViewBtn = document.getElementById('btn-cam-view');
    if (camViewBtn) camViewBtn.style.display = 'none';
    const l2PixelBtn = document.getElementById('btn-l2-pixel');
    if (l2PixelBtn) {
      l2PixelBtn.style.display = 'none';
      l2PixelBtn.textContent = '👾 PIXEL: OFF';
    }

    const menuEl = document.getElementById('main-menu-overlay');
    if (menuEl) menuEl.classList.remove('hidden');
    const hudEl = document.getElementById('hud');
    if (hudEl) hudEl.style.display = 'none';
    const topCtrl = document.querySelector('.top-controls') as HTMLElement;
    if (topCtrl) topCtrl.style.display = 'none';
    const touchEl = document.getElementById('touch-controls');
    if (touchEl) touchEl.style.display = 'none';
    const reticleEl = document.getElementById('reticle');
    if (reticleEl) reticleEl.style.display = 'none';
    this.hud.hideOverlay();

    this.player.reset(0, -3.70, 0);
    this.sceneManager.resetLevel1Camera(0, -3.70);
  }

  public hideMainMenu() {
    const menuEl = document.getElementById('main-menu-overlay');
    if (menuEl) menuEl.classList.add('hidden');
    const hudEl = document.getElementById('hud');
    if (hudEl) hudEl.style.display = '';
    const topCtrl = document.querySelector('.top-controls') as HTMLElement;
    if (topCtrl) topCtrl.style.display = '';
    const touchEl = document.getElementById('touch-controls');
    if (touchEl) touchEl.style.display = '';
    const reticleEl = document.getElementById('reticle');
    if (reticleEl) reticleEl.style.display = 'none';
  }

  public returnToMainMenu() {
    this.closeSettingsModal();
    this.closeControlsModal();
    this.hud.hideOverlay();
    this.showMainMenu();
  }

  private setupMainMenu() {
    const btnPlay = document.getElementById('menu-btn-play');
    if (btnPlay) {
      const startHandler = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        this.startGame();
      };
      btnPlay.addEventListener('click', startHandler);
      btnPlay.addEventListener('touchstart', startHandler, { passive: false });
    }

    const btnOptions = document.getElementById('menu-btn-options');
    if (btnOptions) {
      btnOptions.addEventListener('click', (e) => {
        e.preventDefault();
        this.openSettingsModal();
      });
    }

    const btnControls = document.getElementById('menu-btn-controls');
    if (btnControls) {
      btnControls.addEventListener('click', (e) => {
        e.preventDefault();
        this.openControlsModal();
      });
    }

    const btnExit = document.getElementById('menu-btn-exit');
    if (btnExit) {
      btnExit.addEventListener('click', (e) => {
        e.preventDefault();
        if (confirm('Reboot Jones Navigation System?')) {
          window.location.reload();
        }
      });
    }
  }

  private setupControlsZoomPopup() {
    const modal = document.getElementById('controls-zoom-modal');
    const zoomImg = document.getElementById('controls-zoom-img') as HTMLImageElement | null;
    const closeBtn = document.getElementById('btn-close-controls-zoom');
    const kbThumb = document.getElementById('thumb-controls-keyboard') as HTMLImageElement | null;
    const gpThumb = document.getElementById('thumb-controls-gamepad') as HTMLImageElement | null;
    if (!modal || !zoomImg) return;

    const openZoom = (src: string, alt: string) => {
      zoomImg.src = src;
      zoomImg.alt = alt;
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
    };

    const closeZoom = () => {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
    };

    if (kbThumb) {
      kbThumb.addEventListener('click', (e) => {
        e.stopPropagation();
        openZoom(kbThumb.src, 'Keyboard Controls Diagram');
      });
    }
    if (gpThumb) {
      gpThumb.addEventListener('click', (e) => {
        e.stopPropagation();
        openZoom(gpThumb.src, 'Gamepad Controls Diagram');
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeZoom();
      });
    }
    // Clicking the dark backdrop outside the card also closes cleanly
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeZoom();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && modal.classList.contains('open')) {
        closeZoom();
      }
    });
  }

  private setupHangarUI() {
    const btnMenuHangar = document.getElementById('menu-btn-hangar');
    const btnHudHangar = document.getElementById('btn-hangar');
    const btnBack = document.getElementById('btn-hangar-back');
    const btnLaunch = document.getElementById('btn-hangar-launch');
    const btnMk79 = document.getElementById('btn-jp-mk79');
    const btnEcon = document.getElementById('btn-jp-economist');
    const btnPixelToggle = document.getElementById('btn-hangar-pixel-toggle');
    const btnJetpackTest = document.getElementById('btn-hangar-jetpack-test');

    const startTest = (e: Event) => {
      e.preventDefault();
      this.hangarJetpackBtnHeld = true;
    };
    const endTest = () => {
      this.hangarJetpackBtnHeld = false;
    };
    if (btnJetpackTest) {
      btnJetpackTest.addEventListener('pointerdown', startTest);
      btnJetpackTest.addEventListener('pointerup', endTest);
      btnJetpackTest.addEventListener('pointerleave', endTest);
      btnJetpackTest.addEventListener('pointercancel', endTest);
    }

    const selectJetpack = (model: JetpackModelId) => {
      this.player.setJetpackModel(model);
      btnMk79?.classList.toggle('selected', model === 'mk79');
      btnEcon?.classList.toggle('selected', model === 'economist');
    };

    btnMenuHangar?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openHangar();
    });
    btnHudHangar?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.openHangar();
    });
    btnMk79?.addEventListener('click', () => selectJetpack('mk79'));
    btnEcon?.addEventListener('click', () => selectJetpack('economist'));
    btnPixelToggle?.addEventListener('click', () => {
      this.hangarPixelStyle = !this.hangarPixelStyle;
      this.sceneManager.setPixelArtMode(this.hangarPixelStyle, false);
      this.player.setPixelMode(this.hangarPixelStyle);
      if (btnPixelToggle) {
        btnPixelToggle.textContent = this.hangarPixelStyle
          ? '👾 HDRI STYLE: 16-BIT PIXEL ART'
          : '✨ HDRI STYLE: FULL HD HDRI';
      }
    });
    btnBack?.addEventListener('click', () => this.closeHangar(false));
    btnLaunch?.addEventListener('click', () => this.closeHangar(true));
  }

  public openHangar() {
    this.state = GameState.CUSTOMIZE;
    this.inputManager.gameplayInputEnabled = false;
    this.audioManager.setJetpackThrust(false);

    // Hide main menu, gameplay HUD & level geometry so the Hangar + HDRI + Rotating Disc shine cleanly!
    document.getElementById('main-menu-overlay')?.classList.add('hidden');
    const hudEl = document.getElementById('hud');
    if (hudEl) hudEl.style.display = 'none';
    const topCtrl = document.querySelector('.top-controls') as HTMLElement | null;
    if (topCtrl) topCtrl.style.display = 'none';
    const touchEl = document.getElementById('touch-controls');
    if (touchEl) touchEl.style.display = 'none';
    document.getElementById('hangar-overlay')?.classList.remove('hidden');

    this.parallaxLayers.group.visible = false;
    this.pixelPortalManager.setVisible(false);
    this.obstacleManager.setAllVisible(false);
    this.level2FreeRoam.setVisible(false);
    this.levelGenerator.setFinishGateVisible(false);

    this.player.reset(0, -3.70);
    this.player.mesh.position.set(0, -3.70, 0);
    this.hangarCustomizer.enter(
      this.sceneManager.camera,
      this.sceneManager.keyLight,
      this.sceneManager.ambientLight
    );
    // Apply 16-bit Pixel-Art Shader cleanly with NO depth of field (crisp edge-to-edge!)
    this.sceneManager.setPixelArtMode(this.hangarPixelStyle, false);
    this.sceneManager.setDepthOfField(false);
    this.player.setPixelMode(this.hangarPixelStyle);
  }

  public closeHangar(launchGame: boolean) {
    this.hangarJetpackBtnHeld = false;
    this.audioManager.setJetpackThrust(false);
    document.getElementById('hangar-overlay')?.classList.add('hidden');
    this.hangarCustomizer.exit(this.sceneManager.keyLight, this.sceneManager.ambientLight);
    this.player.mesh.rotation.y = 0;

    const isL2 = this.levelGenerator.currentLevel === 2;
    this.parallaxLayers.group.visible = !isL2;
    this.pixelPortalManager.setVisible(!isL2);
    this.obstacleManager.setAllVisible(!isL2);
    this.level2FreeRoam.setVisible(isL2);
    this.levelGenerator.setFinishGateVisible(!isL2);
    this.sceneManager.setPixelArtMode(false, false);
    this.sceneManager.setDepthOfField(false);
    this.player.setPixelMode(false);

    if (!isL2) {
      this.sceneManager.resetLevel1Camera(0, -3.70);
    }

    if (launchGame) {
      this.startGame();
    } else {
      this.showMainMenu();
    }
  }

  public openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.remove('hidden');
    this.updateSettingsUI();
  }

  public closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.classList.add('hidden');
  }

  public openControlsModal() {
    const modal = document.getElementById('controls-modal');
    if (modal) modal.classList.remove('hidden');
  }

  public closeControlsModal() {
    const modal = document.getElementById('controls-modal');
    if (modal) modal.classList.add('hidden');
  }

  private updateSettingsUI() {
    // 1. Audio
    const optAudioToggle = document.getElementById('opt-audio-toggle');
    if (optAudioToggle) {
      optAudioToggle.textContent = this.audioManager.enabled ? '🔊 ENABLED' : '🔇 MUTED';
      optAudioToggle.classList.toggle('active', this.audioManager.enabled);
    }
    const optAudioVol = document.getElementById('opt-audio-volume') as HTMLInputElement;
    const optAudioVolBadge = document.getElementById('opt-audio-volume-badge');
    if (optAudioVol && optAudioVolBadge) {
      const pct = Math.round(this.audioManager.masterVolume * 100);
      optAudioVol.value = pct.toString();
      optAudioVolBadge.textContent = `${pct}%`;
    }

    // 2. Targeting Assist
    const optAutoaim = document.getElementById('opt-autoaim-toggle');
    if (optAutoaim) {
      optAutoaim.textContent = this.autoAimEnabled ? '🎯 ON' : '⭕ OFF';
      optAutoaim.classList.toggle('active', this.autoAimEnabled);
    }

    // 3. Touch Size
    const btnCompact = document.getElementById('opt-touch-size-compact');
    const btnNormal = document.getElementById('opt-touch-size-normal');
    const btnLarge = document.getElementById('opt-touch-size-large');
    if (btnCompact && btnNormal && btnLarge) {
      btnCompact.classList.toggle('active', this.touchSize === 'compact');
      btnNormal.classList.toggle('active', this.touchSize === 'normal');
      btnLarge.classList.toggle('active', this.touchSize === 'large');
    }

    // Touch Opacity
    const optTouchOp = document.getElementById('opt-touch-opacity') as HTMLInputElement;
    const optTouchOpBadge = document.getElementById('opt-touch-opacity-badge');
    if (optTouchOp && optTouchOpBadge) {
      optTouchOp.value = this.touchOpacity.toString();
      optTouchOpBadge.textContent = `${this.touchOpacity}%`;
    }

    // 4. Graphics & Cam
    const optCamToggle = document.getElementById('opt-cam-toggle');
    if (optCamToggle) {
      optCamToggle.textContent = this.sceneManager.handheldEnabled ? '🎥 ON' : '🎥 OFF';
      optCamToggle.classList.toggle('active', this.sceneManager.handheldEnabled);
    }
    const optCamIntensity = document.getElementById('opt-cam-intensity') as HTMLInputElement;
    const optCamIntensityBadge = document.getElementById('opt-cam-intensity-badge');
    if (optCamIntensity && optCamIntensityBadge) {
      const pct = Math.round(this.sceneManager.handheldIntensity * 100);
      optCamIntensity.value = pct.toString();
      optCamIntensityBadge.textContent = `${pct}%`;
    }

    const optCrtToggle = document.getElementById('opt-crt-toggle');
    if (optCrtToggle) {
      optCrtToggle.textContent = this.crtOverlayEnabled ? '📺 ON' : '📺 OFF';
      optCrtToggle.classList.toggle('active', this.crtOverlayEnabled);
    }

    // 5. Level
    const optLevelBtn = document.getElementById('opt-level-btn');
    if (optLevelBtn) {
      const lvl = this.levelGenerator.currentLevel;
      if (lvl === 1) optLevelBtn.textContent = '🏭 LEVEL 1: INDUSTRIAL';
      else if (lvl === 2) optLevelBtn.textContent = '🪐 LEVEL 2: ALIEN WORLD';
      else optLevelBtn.textContent = '🔴 LEVEL 3: DESOLATE MARS';
    }
  }

  private setupSettingsModal() {
    // Top Bar Settings Button
    const btnTopSettings = document.getElementById('btn-top-settings');
    if (btnTopSettings) {
      btnTopSettings.addEventListener('click', () => this.openSettingsModal());
    }

    // Close buttons
    const btnClose = document.getElementById('btn-close-settings');
    if (btnClose) btnClose.addEventListener('click', () => this.closeSettingsModal());
    const btnSaveClose = document.getElementById('opt-btn-save-close');
    if (btnSaveClose) btnSaveClose.addEventListener('click', () => this.closeSettingsModal());

    // Return to main menu
    const btnMainMenu = document.getElementById('opt-btn-main-menu');
    if (btnMainMenu) {
      btnMainMenu.addEventListener('click', () => this.returnToMainMenu());
    }

    // Audio SFX toggle
    const optAudioToggle = document.getElementById('opt-audio-toggle');
    if (optAudioToggle) {
      optAudioToggle.addEventListener('click', () => {
        const enabled = this.audioManager.toggle();
        const topAudio = document.getElementById('btn-audio');
        if (topAudio) topAudio.textContent = enabled ? '🔊 SFX ON' : '🔇 SFX OFF';
        const alwaysMute = document.getElementById('btn-always-mute');
        if (alwaysMute) {
          alwaysMute.textContent = enabled ? '🔊 AUDIO ON' : '🔇 MUTED';
          alwaysMute.style.borderColor = enabled ? '#00f5ff' : '#ff4466';
          alwaysMute.style.color = enabled ? '#00f5ff' : '#ff6677';
        }
        this.updateSettingsUI();
      });
    }

    // Audio volume slider
    const optAudioVol = document.getElementById('opt-audio-volume') as HTMLInputElement;
    if (optAudioVol) {
      optAudioVol.addEventListener('input', () => {
        const val = parseInt(optAudioVol.value, 10);
        this.audioManager.setVolume(val / 100);
        const badge = document.getElementById('opt-audio-volume-badge');
        if (badge) badge.textContent = `${val}%`;
      });
    }

    // Auto-Aim Assist Toggle
    const optAutoaim = document.getElementById('opt-autoaim-toggle');
    if (optAutoaim) {
      optAutoaim.addEventListener('click', () => {
        this.autoAimEnabled = !this.autoAimEnabled;
        this.updateSettingsUI();
      });
    }

    // Touch Button Sizes
    const touchControls = document.getElementById('touch-controls');
    const setTouchSize = (size: 'compact' | 'normal' | 'large') => {
      this.touchSize = size;
      if (touchControls) {
        touchControls.classList.remove('touch-size-compact', 'touch-size-large');
        if (size === 'compact') touchControls.classList.add('touch-size-compact');
        if (size === 'large') touchControls.classList.add('touch-size-large');
      }
      this.updateSettingsUI();
    };

    document.getElementById('opt-touch-size-compact')?.addEventListener('click', () => setTouchSize('compact'));
    document.getElementById('opt-touch-size-normal')?.addEventListener('click', () => setTouchSize('normal'));
    document.getElementById('opt-touch-size-large')?.addEventListener('click', () => setTouchSize('large'));

    // Touch Opacity Slider
    const optTouchOp = document.getElementById('opt-touch-opacity') as HTMLInputElement;
    if (optTouchOp) {
      optTouchOp.addEventListener('input', () => {
        const val = parseInt(optTouchOp.value, 10);
        this.touchOpacity = val;
        if (touchControls) {
          touchControls.style.opacity = (val / 100).toString();
        }
        const badge = document.getElementById('opt-touch-opacity-badge');
        if (badge) badge.textContent = `${val}%`;
      });
    }

    // Handheld Cam Sway Toggle
    const optCamToggle = document.getElementById('opt-cam-toggle');
    if (optCamToggle) {
      optCamToggle.addEventListener('click', () => {
        const enabled = this.sceneManager.toggleHandheld();
        const topCam = document.getElementById('btn-handheld');
        if (topCam) topCam.textContent = enabled ? '🎥 ON [H]' : '🎥 OFF [H]';
        this.updateSettingsUI();
      });
    }

    // Handheld Cam Intensity Slider
    const optCamIntensity = document.getElementById('opt-cam-intensity') as HTMLInputElement;
    if (optCamIntensity) {
      optCamIntensity.addEventListener('input', () => {
        const val = parseInt(optCamIntensity.value, 10);
        this.sceneManager.handheldIntensity = val / 100;
        const badge = document.getElementById('opt-cam-intensity-badge');
        if (badge) badge.textContent = `${val}%`;
        const topSlider = document.getElementById('slider-handheld') as HTMLInputElement;
        const topLabel = document.getElementById('label-handheld');
        if (topSlider) topSlider.value = val.toString();
        if (topLabel) topLabel.textContent = `${val}%`;
      });
    }

    // CRT Scanlines Toggle
    const optCrtToggle = document.getElementById('opt-crt-toggle');
    if (optCrtToggle) {
      optCrtToggle.addEventListener('click', () => {
        this.crtOverlayEnabled = !this.crtOverlayEnabled;
        const crt = document.querySelector('.crt-overlay') as HTMLElement;
        if (crt) crt.style.display = this.crtOverlayEnabled ? 'block' : 'none';
        this.updateSettingsUI();
      });
    }

    // Fullscreen Toggle
    const optFsBtn = document.getElementById('opt-fullscreen-btn');
    if (optFsBtn) {
      optFsBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      });
    }

    // Level Select in Settings
    const optLevelBtn = document.getElementById('opt-level-btn');
    if (optLevelBtn) {
      optLevelBtn.addEventListener('click', () => {
        const next = (this.levelGenerator.currentLevel % 3) + 1;
        this.switchLevel(next);
        this.updateSettingsUI();
      });
    }
  }

  private setupControlsModal() {
    const btnClose = document.getElementById('btn-close-controls');
    if (btnClose) btnClose.addEventListener('click', () => this.closeControlsModal());
    const btnOk = document.getElementById('btn-controls-ok');
    if (btnOk) btnOk.addEventListener('click', () => this.closeControlsModal());
  }

  public switchLevel(lvl: number) {
    this.level1Completed = false;
    this.sceneManager.setLevel(lvl);
    this.levelGenerator.setLevel(lvl);
    this.parallaxLayers.setLevel(lvl);
    this.player.isIsometric = false;

    const isLevel2 = lvl === 2;
    this.player.setFreeRoamAimMode(isLevel2);
    this.parallaxLayers.group.visible = !isLevel2;
    this.pixelPortalManager.setVisible(!isLevel2);
    this.obstacleManager.setAllVisible(!isLevel2);
    this.level2FreeRoam.setVisible(isLevel2);
    this.levelGenerator.setFinishGateVisible(!isLevel2);
    this.hangarCustomizer.runwayComputersGroup.visible = !isLevel2;

    // Hold Level 2 enemies back until Jones explores past x >= 21.5 (after Conveyor & 30° Ramp!)
    this.level2EnemiesSpawned = false;
    this.level2DroneSlots = [
      { x: 32.0, y: 1.2, z: -3.2, patrol: 4.0, drone: null, respawnTimer: 0 },
      { x: 38.0, y: 0.6, z:  0.0, patrol: 3.8, drone: null, respawnTimer: 0 },
      { x: 35.0, y: 2.2, z:  3.4, patrol: 4.2, drone: null, respawnTimer: 0 },
      { x: 42.0, y: 1.4, z: -1.2, patrol: 3.5, drone: null, respawnTimer: 0 }
    ];

    // Spawn Jones directly on the Moving Conveyor Belt in Level 2 (y = -3.56, z = 0)!
    this.player.reset(0, isLevel2 ? -3.56 : -3.70, 0);
    this.score = 0;

    const camViewBtn = document.getElementById('btn-cam-view');
    if (camViewBtn) {
      camViewBtn.style.display = isLevel2 ? '' : 'none';
      camViewBtn.textContent = this.sceneManager.level2CamMode === 'orthographic'
        ? '📐 ORTHO CAM [V]'
        : '🎥 3RD PERSON [V]';
    }
    const l2PixelBtn = document.getElementById('btn-l2-pixel');
    if (l2PixelBtn) {
      l2PixelBtn.style.display = isLevel2 ? '' : 'none';
      l2PixelBtn.textContent = this.sceneManager.pixelArtEnabled ? '👾 PIXEL: ON' : '👾 PIXEL: OFF';
    }
    if (!isLevel2) {
      this.sceneManager.resetLevel1Camera(0, -3.70);
    }

    const levelBtn = document.getElementById('btn-level');
    if (levelBtn) {
      if (lvl === 1) {
        levelBtn.textContent = '🪐 LEVEL 2: 3D FREE ROAM [L]';
        levelBtn.style.color = '#38d2ff';
        levelBtn.style.borderColor = '#2574e8';
      } else {
        levelBtn.textContent = '🏭 LEVEL 1: RUNWAY [L]';
        levelBtn.style.color = '#39ff14';
        levelBtn.style.borderColor = '#39ff14';
      }
    }

    const optLevelBtn = document.getElementById('opt-level-btn');
    if (optLevelBtn) {
      optLevelBtn.textContent = isLevel2 ? '🚀 LEVEL 2: 3D FREE ROAM' : '🏭 LEVEL 1: INDUSTRIAL';
    }

    let levelName = 'LEVEL 1: INDUSTRIAL RUNWAY';
    if (isLevel2) levelName = 'LEVEL 2: 3D FREE ROAM · CONVEYOR & 30° RAMP [V: CAM]';
    this.showUpgradeBanner(`★ SWITCHED TO ${levelName} ★`);
  }

  private showUpgradeBanner(msg: string) {
    let banner = document.getElementById('hud-upgrade-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'hud-upgrade-banner';
      banner.style.position = 'fixed';
      banner.style.top = '72px';
      banner.style.left = '50%';
      banner.style.transform = 'translateX(-50%)';
      banner.style.background = 'rgba(0, 18, 25, 0.94)';
      banner.style.border = '2px solid #00f5ff';
      banner.style.boxShadow = '0 0 25px rgba(0, 245, 255, 0.7)';
      banner.style.color = '#00f5ff';
      banner.style.padding = '12px 24px';
      banner.style.fontFamily = "'Press Start 2P', monospace";
      banner.style.fontSize = '12px';
      banner.style.zIndex = '250';
      banner.style.borderRadius = '8px';
      banner.style.textAlign = 'center';
      banner.style.pointerEvents = 'none';
      banner.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
      document.body.appendChild(banner);
    }
    banner.textContent = msg;
    banner.style.opacity = '1';
    banner.style.transform = 'translateX(-50%) scale(1.05)';
    setTimeout(() => {
      if (banner) {
        banner.style.opacity = '0';
        banner.style.transform = 'translateX(-50%) scale(0.9)';
      }
    }, 3200);
  }

  private startGame() {
    this.hideMainMenu();
    this.state = GameState.PLAYING;
    this.score = 0;
    this.hitStopTimer = 0;
    this.deathSlowMoTimer = 0;
    this.startShootLockout = 0.35; // Guarantees zero accidental shot on start/load!
    this.sceneManager.cameraZoomOffset = 0;
    this.player.reset(0, this.levelGenerator.currentLevel === 2 ? -3.56 : -3.70, 0); // Start in idle on solid ground / conveyor
    this.levelGenerator.reset(0);
    this.pixelPortalManager.reset(0);
    if (this.levelGenerator.currentLevel === 2) {
      this.level2EnemiesSpawned = false;
      this.level2DroneSlots = [
        { x: 32.0, y: 1.2, z: -3.2, patrol: 4.0, drone: null, respawnTimer: 0 },
        { x: 38.0, y: 0.6, z:  0.0, patrol: 3.8, drone: null, respawnTimer: 0 },
        { x: 35.0, y: 2.2, z:  3.4, patrol: 4.2, drone: null, respawnTimer: 0 },
        { x: 42.0, y: 1.4, z: -1.2, patrol: 3.5, drone: null, respawnTimer: 0 }
      ];
    }
    if (this.levelGenerator.currentLevel === 1) {
      const staticBlockers = this.obstacleManager.obstacles
        .filter((obs) => obs.active && obs.type !== ObstacleType.ALIEN_CYBER_SENTINEL)
        .map((obs) => ({
          x: obs.group.position.x,
          y: obs.group.position.y,
          halfW: obs.collider.halfSize ? obs.collider.halfSize.x : (obs.collider.radius ?? 0.8),
          halfH: obs.collider.halfSize ? obs.collider.halfSize.y : (obs.collider.radius ?? 0.8)
        }));
      this.pixelPortalManager.ensureClearOfPlatforms(this.obstacleManager.getPlatforms(), staticBlockers, -9999);
    }
    this.sceneManager.setPixelArtMode(false, false);
    this.player.setPixelMode(false);
    this.meteorManager.reset();
    // Flush any buffered menu click / button press so Jones never shoots or jumps on load!
    this.inputManager.gameplayInputEnabled = true;
    this.inputManager.consumeShootTrigger();
    this.inputManager.consumeJumpTrigger();
  }

  private updateForcefieldUI() {
    const active = this.player.shieldActive;
    const mode = this.player.forcefieldMode;
    const shieldBtn = document.getElementById('btn-shield');
    if (shieldBtn) {
      shieldBtn.textContent = active ? '⚡ FORCEFIELD: ON [B]' : '🛡️ FORCEFIELD: OFF [B]';
      shieldBtn.style.color = active ? '#00f5ff' : '#aaa';
      shieldBtn.style.borderColor = active ? '#00f5ff' : '#666';
    }
    const modeBtn = document.getElementById('btn-forcefield-mode');
    if (modeBtn) {
      modeBtn.textContent = mode === 'ball' ? 'MODE: ⚽ BALL' : 'MODE: 🛡️ BUBBLE';
      modeBtn.style.color = mode === 'ball' ? '#ffaa00' : '#00f5ff';
      modeBtn.style.borderColor = mode === 'ball' ? '#ffaa00' : '#00f5ff';
    }
    const touchShield = document.getElementById('btn-touch-shield');
    if (touchShield) {
      touchShield.style.background = active
        ? 'radial-gradient(circle at 35% 35%, rgba(0, 245, 255, 0.8), rgba(0, 50, 100, 0.9))'
        : '';
      touchShield.style.borderColor = active ? '#00f5ff' : '';
    }
    const touchMode = document.getElementById('btn-touch-mode');
    if (touchMode) {
      const span = touchMode.querySelector('span');
      if (span) span.textContent = mode === 'ball' ? 'BALL' : 'BUBBLE';
    }
  }

  private toggleForcefield() {
    const active = this.player.toggleShield();
    this.audioManager.playShieldToggle(active);
    this.updateForcefieldUI();
  }

  private toggleForcefieldMode() {
    this.player.toggleForcefieldMode();
    this.audioManager.playShieldToggle(this.player.shieldActive);
    this.updateForcefieldUI();
  }

  private onGameOver() {
    this.state = GameState.GAMEOVER;
    this.inputManager.gameplayInputEnabled = false;
    this.sceneManager.cameraZoomOffset = 0;
    this.audioManager.setJetpackThrust(false);
    this.audioManager.playExplosion();
    this.sceneManager.triggerShake(0.5, 0.4);
    this.hud.showGameOver(
      this.score,
      () => this.startGame(),
      () => this.returnToMainMenu()
    );
  }

  private loop(currentTime: number) {
    requestAnimationFrame((t) => this.loop(t));

    // Always-visible 1979 FPS Telemetry Counter (updates every 250ms, zero layout thrash)
    const frameMs = this.lastRafTime > 0 ? (currentTime - this.lastRafTime) : 16.67;
    this.lastRafTime = currentTime;
    this.fpsFrames++;
    this.fpsAccumMs += frameMs;
    if (this.fpsAccumMs >= 250) {
      const avgMs = this.fpsAccumMs / Math.max(1, this.fpsFrames);
      const fps = Math.round(1000 / Math.max(1, avgMs));
      if (this.fpsValueEl) this.fpsValueEl.textContent = `${fps} FPS`;
      if (this.fpsMsEl) this.fpsMsEl.textContent = `${avgMs.toFixed(1)}ms`;
      const color = fps >= 50 ? '#a6ff38' : (fps >= 30 ? '#ff9e44' : '#ff4d88');
      if (this.fpsBoxEl) {
        this.fpsBoxEl.style.color = color;
        this.fpsBoxEl.style.borderColor = color;
      }
      if (this.fpsDotEl) {
        this.fpsDotEl.style.background = color;
        this.fpsDotEl.style.boxShadow = `0 0 8px ${color}`;
      }
      this.fpsFrames = 0;
      this.fpsAccumMs = 0;
    }

    const rawDt = Math.min(this.clock.getDelta(), 0.05);

    // Hit-stop freeze frame on fatal death impact (extra punchy AAA feel!)
    if (this.hitStopTimer > 0) {
      this.hitStopTimer = Math.max(0, this.hitStopTimer - rawDt);
      this.sceneManager.render();
      return;
    }

    // Smooth dramatic slow-mo time dilation during the opening of Jones's death animation!
    let timeScale = 1.0;
    if (this.deathSlowMoTimer > 0) {
      this.deathSlowMoTimer = Math.max(0, this.deathSlowMoTimer - rawDt);
      const t = this.deathSlowMoTimer / 0.72;
      timeScale = THREE.MathUtils.lerp(1.0, 0.36, Math.min(1, t * 1.4));
    } else if (!this.player.isDying) {
      this.sceneManager.cameraZoomOffset = THREE.MathUtils.lerp(this.sceneManager.cameraZoomOffset, 0, Math.min(1, rawDt * 5.0));
    }

    const dt = rawDt * timeScale;
    const totalTime = this.clock.getElapsedTime();

    const isLevel2 = this.state === GameState.PLAYING && this.levelGenerator.currentLevel === 2;
    this.inputManager.update(isLevel2);
    // Project mouse cursor to 3D world plane
    this.inputManager.updateAimWorldTarget(
      this.sceneManager.camera,
      this.player.position.y
    );
    // Update Smart Target Lock-On System
    this.updateLockOnSystem(dt, totalTime);

    if (this.state === GameState.PLAYING) {
      // Guarantee shooting/movement input is ALWAYS active whenever PLAYING (never stuck false after switchLevel!)
      this.inputManager.gameplayInputEnabled = true;
      // Post-start shoot lockout guarantees player NEVER shoots automatically on load/start
      if (this.startShootLockout > 0) {
        this.startShootLockout = Math.max(0, this.startShootLockout - rawDt);
        this.inputManager.consumeShootTrigger();
      } else if (this.inputManager.consumeShootTrigger()) {
        // 1. Pure Raycast Auto-Lock Shoot Trigger (Works identically on Mouse, Keyboard & Gamepad!)
        const fired = this.player.shoot(
          this.lockedEnemy ? this.inputManager.mouseWorldTarget : undefined
        );
        if (fired) {
          this.rayBeamFlashTimer = 0.26;
          this.audioManager.playLaser();
          this.sceneManager.triggerShake(0.08, 0.08); // Satisfying gun recoil shake
          if (isLevel2 && this.lockedEnemy) {
            this.sceneManager.triggerCinematicShootFocus(this.inputManager.mouseWorldTarget, 1.25);
          }
        }
      }

      // Handheld Camera Toggle ([H] key)
      if (this.inputManager.consumeHandheldToggleTrigger()) {
        const enabled = this.sceneManager.toggleHandheld();
        const camBtn = document.getElementById('btn-handheld');
        if (camBtn) camBtn.textContent = enabled ? '🎥 CAM: ON [H]' : '🎥 CAM: OFF [H]';
      }

      // Level 2 Camera Mode Toggle ([V] key: 3rd Person <-> Orthographic!)
      if (isLevel2 && this.inputManager.consumeCameraViewToggleTrigger()) {
        const mode = this.sceneManager.toggleLevel2CameraMode();
        const camViewBtn = document.getElementById('btn-cam-view');
        if (camViewBtn) {
          camViewBtn.textContent = mode === 'orthographic' ? '📐 ORTHO CAM [V]' : '🎥 3RD PERSON [V]';
        }
        this.showUpgradeBanner(mode === 'orthographic' ? '📐 ORTHOGRAPHIC CAMERA ACTIVE' : '🎥 3RD-PERSON FOLLOW CAMERA ACTIVE');
      }

      // Force Field Toggle ([B] key)
      if (this.inputManager.consumeShieldTrigger()) {
        this.toggleForcefield();
      }

      // 2. Audio Jetpack Thruster Sound (shifts to warm hover stabilizer hum during the 1s hang!)
      const isJetpacking = this.inputManager.jetpack && this.player.fuel > 0;
      const isHovering = !isJetpacking && this.player.isHoverHanging;
      this.audioManager.setJetpackThrust(isJetpacking || isHovering, isHovering);

      if (this.player.fuel < 18 && this.player.fuel > 0 && Math.sin(totalTime * 8) > 0.8) {
        this.audioManager.playWarning();
      }

      // 3. Update Player Entity
      const jumpPressed = this.inputManager.consumeJumpTrigger();
      const slidePressed = this.inputManager.consumeSlideTrigger();
      if (isLevel2) {
        // LEVEL 2: NEXT-GEN 3D FREE-ROAM + CONVEYOR BELT + 30° RAMP + TIGHT WALLS + REAL SHADOWS + TEST DRONES!
        this.level2FreeRoam.update(dt);
        this.obstacleManager.update(dt, totalTime, this.player.position.x, this.player.position.y, this.player.position.z, true);
        const camYaw = this.sceneManager.level2CamMode === 'orthographic'
          ? Math.PI * 0.25
          : this.sceneManager.level2OrbitYaw;
        this.player.updateFreeRoam3D(
          dt,
          this.inputManager.moveX,
          this.inputManager.moveZ,
          this.inputManager.run,
          jumpPressed,
          this.inputManager.jetpack,
          this.inputManager.crouch,
          this.inputManager.jumpHeld,
          this.inputManager.jetpackThrottle,
          this.inputManager.jetpackDirectTrigger,
          (px, py, pz, nx, nz, r) => this.level2FreeRoam.resolveHorizontalAndSurface(px, py, pz, nx, nz, r),
          camYaw,
          slidePressed,
          this.lockedEnemy ? this.inputManager.mouseWorldTarget : undefined
        );
        // Spawn Level 2 Alien Drone Squadron dropping dramatically FROM ABOVE once Jones advances past x >= 21.5!
        if (!this.level2EnemiesSpawned && this.player.position.x >= 21.5) {
          this.level2EnemiesSpawned = true;
          this.showUpgradeBanner('⚠️ ALIEN DRONE SQUADRON DROPPING IN FROM ABOVE!');
          for (let i = 0; i < this.level2DroneSlots.length; i++) {
            const slot = this.level2DroneSlots[i];
            const d = this.obstacleManager.spawnDrone(slot.x, slot.y, slot.patrol);
            d.position.z = slot.z;
            d.triggerDropInFromAbove(19.0 + i * 2.4, i * 0.22, 1.45);
            slot.drone = d;
            slot.respawnTimer = 0;
          }
        }

        // Level 2 Per-Drone 30-Second Sky-Drop Respawn Loop!
        if (this.level2EnemiesSpawned) {
          for (const slot of this.level2DroneSlots) {
            if (slot.drone) {
              if (!slot.drone.active && !slot.drone.isDying) {
                slot.drone = null;
                slot.respawnTimer = 30.0;
              }
            } else if (slot.respawnTimer > 0) {
              slot.respawnTimer -= dt;
              if (slot.respawnTimer <= 0) {
                const d = this.obstacleManager.spawnDrone(slot.x, slot.y, slot.patrol);
                d.position.z = slot.z;
                d.triggerDropInFromAbove(20.0, 0, 1.45);
                slot.drone = d;
                slot.respawnTimer = 0;
              }
            }
          }
        }

        // Full-Body 3D Collision Resolution for Level 2 Alien Drones (dome + pods + 1.78m tentacles!)
        // Prevents ANY part of a drone from passing through the 30° ramp, elevated deck, conveyor, or floor!
        for (const drone of this.obstacleManager.drones) {
          if (!drone.active) continue;
          const prevDX = drone.position.x - drone.velocity.x * dt;
          const prevDY = drone.position.y - drone.velocity.y * dt;
          const prevDZ = drone.position.z - drone.velocity.z * dt;
          const res = this.level2FreeRoam.resolveFlyingEntity(
            prevDX, prevDY, prevDZ,
            drone.position.x, drone.position.y, drone.position.z,
            0.78,
            1.88
          );
          drone.position.set(res.x, res.y, res.z);
          drone.setShadowSurfaceY(res.surfaceHeight);
        }

        // Check 3D bullet hits against Level 2 surfaces (Swept Segment against Floor, Conveyor, 30° Ramp, Deck) AND Drones -> Micro-Debris Explosion!
        for (const laser of this.player.lasers) {
          if (!laser.active) continue;
          const prevLX = laser.position.x - laser.velocity.x * dt;
          const prevLY = laser.position.y - laser.velocity.y * dt;
          const prevLZ = laser.position.z - laser.velocity.z * dt;
          const hitSurf = this.level2FreeRoam.raycastSurfaceHit(
            prevLX, prevLY, prevLZ,
            laser.position.x, laser.position.y, laser.position.z
          );
          if (hitSurf) {
            laser.active = false;
            laser.mesh.visible = false;
            this.microDebris.burst(hitSurf.x, hitSurf.y, hitSurf.z, 0x38d2ff, hitSurf.surfaceHeight, 0, 1, 1.05);
            continue;
          }
          const lSurf = this.level2FreeRoam.getSurfaceInfo(laser.position.x, laser.position.z, 0.05);
          for (const drone of this.obstacleManager.drones) {
            if (!drone.active) continue;
            const d3 = laser.position.distanceTo(drone.position);
            if (d3 < 1.15) {
              laser.active = false;
              laser.mesh.visible = false;
              this.obstacleManager.spawnBulletImpact(laser.position.x, laser.position.y, 0x00f5ff);
              this.microDebris.burst(laser.position.x, laser.position.y, laser.position.z, 0xff7f2a, lSurf.height, -Math.sign(laser.velocity.x), 0.7, 1.2);
              this.audioManager.playEnemyImpact();
              const killed = drone.takeDamage(1);
              if (killed) {
                this.microDebris.burst(drone.position.x, drone.position.y, drone.position.z, 0xffaa22, lSurf.height, 0, 1, 1.8);
                this.audioManager.playExplosion();
                this.sceneManager.triggerShake(0.32, 0.22);
                this.score += 300;
              }
              break;
            }
          }
        }
        // Check Alien Drone lasers hitting Level 2 surfaces (Swept Segment — NEVER clips through ramp/deck/floor!) AND Jones!
        const pCenterY = this.player.position.y + (this.player.isCrouching ? 0.65 : 1.0);
        for (const drone of this.obstacleManager.drones) {
          for (const rLaser of drone.lasers) {
            if (!rLaser.active) continue;
            const prevRX = rLaser.position.x - rLaser.velocity.x * dt;
            const prevRY = rLaser.position.y - rLaser.velocity.y * dt;
            const prevRZ = rLaser.position.z - rLaser.velocity.z * dt;
            const hitSurf = this.level2FreeRoam.raycastSurfaceHit(
              prevRX, prevRY, prevRZ,
              rLaser.position.x, rLaser.position.y, rLaser.position.z
            );
            if (hitSurf) {
              rLaser.active = false;
              rLaser.mesh.visible = false;
              this.microDebris.burst(hitSurf.x, hitSurf.y, hitSurf.z, 0xff2244, hitSurf.surfaceHeight, 0, 1, 1.15);
              continue;
            }
            const distToPlayer = Math.hypot(
              rLaser.position.x - this.player.position.x,
              rLaser.position.y - pCenterY,
              rLaser.position.z - this.player.position.z
            );
            if (this.player.shieldActive && distToPlayer < 1.65) {
              rLaser.velocity.negate().multiplyScalar(1.25);
              this._tmpDir.copy(rLaser.velocity).normalize();
              rLaser.mesh.quaternion.setFromUnitVectors(this._unitX, this._tmpDir);
              this.player.takeDamage(0, Math.sign(rLaser.velocity.x) || 1);
              this.audioManager.playShieldDeflect();
              this.sceneManager.triggerShake(0.16, 0.10);
            } else if (distToPlayer < 0.62) {
              rLaser.active = false;
              rLaser.mesh.visible = false;
              if (this.player.invulnerableTime <= 0) {
                this.player.takeDamage(18, Math.sign(rLaser.velocity.x) || 1);
                this.audioManager.playHitImpact();
                this.sceneManager.triggerShake(0.30, 0.20);
              }
            }
          }
        }
        // Check Level 2 Alien Drone body contact vs Jones (when not dying)
        if (!this.player.isDying && this.player.invulnerableTime <= 0) {
          for (const drone of this.obstacleManager.drones) {
            if (!drone.active) continue;
            const dBody = Math.hypot(
              drone.position.x - this.player.position.x,
              drone.position.y - pCenterY,
              drone.position.z - this.player.position.z
            );
            if (dBody < 1.15) {
              const knock = this.player.position.x >= drone.position.x ? 1 : -1;
              this.player.takeDamage(20, knock);
              this.audioManager.playHitImpact();
              this.sceneManager.triggerShake(0.32, 0.22);
              break;
            }
          }
        }
        if (this.player.isDying) {
          this.audioManager.setJetpackThrust(false);
        }
        if (this.player.isDead) {
          this.onGameOver();
        }
        this.microDebris.update(dt);
        // Left-Mouse Drag + Gamepad Right-Stick rotate the Level 2 camera around Jones!
        const mouseOrbit = this.inputManager.consumeMouseOrbitDelta();
        if (mouseOrbit.dx !== 0 || mouseOrbit.dy !== 0) {
          this.sceneManager.cancelCinematicShootFocus();
          this.sceneManager.level2OrbitYaw -= mouseOrbit.dx * 0.008;
          this.sceneManager.level2OrbitPitch = THREE.MathUtils.clamp(
            this.sceneManager.level2OrbitPitch + mouseOrbit.dy * 0.006,
            0.08,
            0.72
          );
        }
        const rsX = this.inputManager.hasGamepadAim ? this.inputManager.rightStickAimX : 0;
        const rsY = this.inputManager.hasGamepadAim ? this.inputManager.rightStickAimY : 0;
        this.sceneManager.updateCameraFreeRoam(
          this.player.position.x,
          this.player.position.y,
          this.player.position.z,
          dt,
          rsX,
          rsY,
          (px, py, pz, dx, dy, dz) => this.level2FreeRoam.resolveCameraPosition(px, py, pz, dx, dy, dz)
        );
        this.hud.update(this.score, this.player.life, this.player.fuel);
        this.sceneManager.render(false);
        return;
      }

      const platforms = this.obstacleManager.getPlatforms();

      // Determine if Jones is under fire or under pressure for antennae radio signals
      const underPressure =
        this.player.life < 55 ||
        this.player.invulnerableTime > 0 ||
        this.obstacleManager.drones.some(
          d => d.active && Math.hypot(d.position.x - this.player.position.x, d.position.y - this.player.position.y) < 10.0
        );

      // Hide floating mouse cursor reticle (Pure Raycast Auto-Lock system!)
      document.getElementById('reticle')?.classList.remove('active');

      // Wire ultra-subtle console haptic tap ONLY during active gameplay (strictly silent at Menu/GameOver!)
      if (!this.player.onHaptic) {
        this.player.onHaptic = (ms, w, s) => {
          if (this.state === GameState.PLAYING) {
            this.inputManager.triggerRumble(ms, w, s);
          }
        };
      }

      // Pass locked raycast target for real-time arm aim tracking whenever Jones is shooting/drawn!
      const hasLockedTarget = Boolean(this.lockedEnemy);

      this.player.update(
        dt,
        this.inputManager.moveX,
        this.inputManager.run,
        jumpPressed,
        this.inputManager.jetpack,
        platforms,
        this.inputManager.mouseWorldTarget,
        hasLockedTarget,
        this.inputManager.crouch,
        underPressure,
        this.inputManager.jumpHeld,
        this.inputManager.jetpackThrottle,
        this.inputManager.jetpackDirectTrigger,
        false,
        slidePressed
      );

      // Update Falling Meteor & Shatter Shrapnel System
      this.meteorManager.update(
        dt,
        this.player,
        this.obstacleManager,
        (type) => this.audioManager.playMeteorShatter(type === MeteorType.CRYSTAL)
      );

      // 4. Update Level, Pixel Portals (doors stay 100% FIXED after initial level load — ZERO mid-level teleporting!)
      this.levelGenerator.update(this.player.position.x);
      this.pixelPortalManager.update(dt, totalTime, this.player.position.x, this.player.position.y);
      this.obstacleManager.update(dt, totalTime, this.player.position.x, this.player.position.y);
      this.parallaxLayers.update(this.player.position.x, this.player.position.y, totalTime);
      this.hangarCustomizer.update(dt, totalTime, this.player.position.x);

      // 5. Collision Checks & Micro-Debris Shader Simulation
      this.checkCollisions(dt);
      this.microDebris.update(dt);

      // 6. Score tracking & Level 1 Finish Gate Trigger (x >= 120m -> launches Level 2 3D Free-Roam!)
      if (this.player.position.x * 10 > this.score) {
        this.score = Math.floor(this.player.position.x * 10);
      }
      if (this.levelGenerator.currentLevel === 1 && !this.level1Completed && this.player.position.x >= this.levelGenerator.level1EndX) {
        this.level1Completed = true;
        this.audioManager.playPortalWarp(true);
        this.showUpgradeBanner('🏆 LEVEL 1 COMPLETE! LAUNCHING LEVEL 2 — 3D FREE ROAM!');
        setTimeout(() => {
          if (this.state === GameState.PLAYING && this.levelGenerator.currentLevel === 1) {
            this.switchLevel(2);
          }
        }, 1250);
      }

      // 7. Check Player Death Animation & Game Over Transition
      if (this.player.isDying) {
        this.audioManager.setJetpackThrust(false);
      }
      if (this.player.isDead) {
        this.onGameOver();
      }
    } else if (this.state === GameState.CUSTOMIZE) {
      // Triple-AAA Hangar Showcase: Rotating Disc + Controlled Jetpack Hover Test + 1m x 1m Blue Laser Grid + Right-Stick 360° Orbit!
      const isHovering = this.inputManager.jetpack || this.hangarJetpackBtnHeld;
      this.audioManager.setJetpackThrust(isHovering, isHovering);
      const rsX = this.inputManager.hasGamepadAim ? this.inputManager.rightStickAimX : 0;
      const rsY = this.inputManager.hasGamepadAim ? this.inputManager.rightStickAimY : 0;
      this.hangarCustomizer.update(dt, totalTime, 0, this.player.mesh, this.sceneManager.camera, isHovering, rsX, rsY);
      this.player.updateHangarShowcase(dt, isHovering, this.hangarCustomizer.hoverHeight);
      this.sceneManager.render(true);
      return;
    } else {
      // Idle scene animation on start screen
      this.parallaxLayers.update(0, -3.70, totalTime);
      this.obstacleManager.update(dt, totalTime, 0, 0);
      this.hangarCustomizer.update(dt, totalTime, 0);
      const platforms = this.obstacleManager.getPlatforms();
      this.player.update(
        dt,
        0,
        false,
        false,
        false,
        platforms,
        this.inputManager.mouseWorldTarget,
        this.inputManager.hasMouse
      );
    }

    // 8. Update Camera with unrestricted tracking & screen shake
    this.sceneManager.updateCamera(this.player.position.x, this.player.position.y, dt);
    this.hud.update(this.score, this.player.life, this.player.fuel);

    // 9. Render Frame
    this.sceneManager.render();
  }

  private checkCollisions(dt: number = 0.016) {
    const pPos = this.player.position;
    const pCenterY = pPos.y + 1.0;
    const pRadius = 0.45;
    const platforms = this.obstacleManager.getPlatforms();

    // A. Player vs Mechanical Obstacles (Gears, Pistons, Tubes)
    for (const obs of this.obstacleManager.obstacles) {
      if (!obs.active) continue;
      if (obs.type === ObstacleType.HAZARD_PLATFORM) continue;

      let hit = false;
      const obsPos = obs.group.position;

      // Cover Barriers are in platforms list (getPlatforms), so player lands & walks on them natively
      if (obs.type === ObstacleType.COVER_BARRIER) {
        continue;
      } else if (obs.type === ObstacleType.LASER_GATE) {
        const half = obs.collider.halfSize || new THREE.Vector2(1.3, 1.2);
        const center = obs.collider.center || new THREE.Vector2(obsPos.x, obsPos.y + 1.2);

        const gateMinX = center.x - half.x;
        const gateMaxX = center.x + half.x;
        const gateMinY = center.y - half.y;
        const gateMaxY = center.y + half.y;

        const playerMinX = pPos.x - 0.30;
        const playerMaxX = pPos.x + 0.30;
        const playerMinY = pPos.y;
        const playerMaxY = pPos.y + 1.85;

        const overlapX = playerMinX <= gateMaxX && playerMaxX >= gateMinX;
        const overlapY = playerMinY <= gateMaxY && playerMaxY >= gateMinY;

        if (overlapX && overlapY) {
          if (this.player.invulnerableTime <= 0) {
            const knockX = pPos.x < center.x ? -1 : 1;
            this.player.takeDamage(20, knockX);
            this.audioManager.playHitImpact();
            this.sceneManager.triggerShake(0.35, 0.20);
          }
          // Wall barrier blocks horizontal walking - force player to fly over!
          if (pPos.x < center.x) {
            pPos.x = gateMinX - 0.32;
            this.player.velocity.x = Math.min(0, this.player.velocity.x);
          } else {
            pPos.x = gateMaxX + 0.32;
            this.player.velocity.x = Math.max(0, this.player.velocity.x);
          }
          continue;
        }
      } else if (obs.type === ObstacleType.PISTON) {
        // ACCURATE PISTON / MECHANICAL PRESS COLLISION
        // Only the downward crushing hammer kills/damages the player; player can land safely on top!
        const half = obs.collider.halfSize || new THREE.Vector2(0.9, 0.45);
        const center = obs.collider.center || new THREE.Vector2(obsPos.x, obsPos.y);

        const hammerMinX = center.x - half.x;
        const hammerMaxX = center.x + half.x;
        const hammerMinY = center.y - half.y;
        const hammerMaxY = center.y + half.y;

        const playerMinX = pPos.x - 0.35;
        const playerMaxX = pPos.x + 0.35;
        const playerMinY = pPos.y;
        const playerMaxY = pPos.y + (this.player.isCrouching ? 1.10 : 1.85);

        const overlapX = playerMinX <= hammerMaxX && playerMaxX >= hammerMinX;
        const overlapY = playerMinY <= hammerMaxY && playerMaxY >= hammerMinY;

        if (overlapX && overlapY) {
          // If player landed safely on top surface of hammer and is not squashed from above
          if (playerMinY >= hammerMaxY - 0.20 && !obs.isCrushing) {
            pPos.y = hammerMaxY;
            this.player.velocity.y = Math.max(0, this.player.velocity.y);
            this.player.isGrounded = true;
            continue;
          }

          if (this.player.invulnerableTime <= 0) {
            const knockX = pPos.x < center.x ? -1 : 1;
            this.player.crushHit(35, knockX);
            this.audioManager.playCrushHit();
            this.sceneManager.triggerShake(0.50, 0.32);
          }
          continue;
        }
      } else if (obs.type === ObstacleType.SKY_MAZE_WALL) {
        // DEADLY SKY MAZE WALL: Instant death upon contact with any maze wall!
        const half = obs.collider.halfSize || new THREE.Vector2(0.5, 0.5);
        const center = obs.collider.center || new THREE.Vector2(obsPos.x, obsPos.y);

        const wallMinX = center.x - half.x;
        const wallMaxX = center.x + half.x;
        const wallMinY = center.y - half.y;
        const wallMaxY = center.y + half.y;

        const playerMinX = pPos.x - 0.32;
        const playerMaxX = pPos.x + 0.32;
        const playerMinY = pPos.y;
        const playerMaxY = pPos.y + (this.player.isCrouching ? 1.10 : 1.85);

        const overlapX = playerMinX <= wallMaxX && playerMaxX >= wallMinX;
        const overlapY = playerMinY <= wallMaxY && playerMaxY >= wallMinY;

        if (overlapX && overlapY) {
          if (!this.player.isDying) {
            this.player.shieldActive = false; // Overwhelms forcefield
            this.player.life = 0;
            const knockX = pPos.x < center.x ? -1 : 1;
            this.player.triggerDeath(knockX);
            this.audioManager.playExplosion();
            this.audioManager.playHitImpact();
            this.sceneManager.triggerShake(0.70, 0.45);
          }
          continue;
        }
      } else if (obs.collider.type === 'circle') {
        const distSq = (pPos.x - obsPos.x) ** 2 + (pCenterY - obsPos.y) ** 2;
        const totalRadius = pRadius + (obs.collider.radius || 1.0);
        if (distSq < totalRadius * totalRadius) {
          hit = true;
        }
      } else if (obs.collider.type === 'box') {
        const half = obs.collider.halfSize || new THREE.Vector2(1, 1);
        const center = obs.collider.center || new THREE.Vector2(obsPos.x, obsPos.y);
        const minX = center.x - half.x;
        const maxX = center.x + half.x;
        const minY = center.y - half.y;
        const maxY = center.y + half.y;

        const closestX = Math.max(minX, Math.min(pPos.x, maxX));
        const closestY = Math.max(minY, Math.min(pCenterY, maxY));
        const distSq = (pPos.x - closestX) ** 2 + (pCenterY - closestY) ** 2;

        if (distSq < pRadius * pRadius) {
          hit = true;
        }
      }

      if (hit) {
        // Push player outside solid obstacle so player CANNOT intersect with it
        if (obs.collider.type === 'box') {
          const half = obs.collider.halfSize || new THREE.Vector2(1, 1);
          const center = obs.collider.center || new THREE.Vector2(obsPos.x, obsPos.y);
          if (pPos.x < center.x) {
            this.player.position.x = center.x - half.x - 0.35;
          } else {
            this.player.position.x = center.x + half.x + 0.35;
          }
          this.player.velocity.x = 0;
        }

        if (this.player.invulnerableTime <= 0) {
          const knockX = obsPos.x > pPos.x ? -1 : 1;
          this.player.takeDamage(25, knockX);
          this.audioManager.playHitImpact();
          this.sceneManager.triggerShake(0.38, 0.28);
        }
      }
    }

    // B. Player vs Alien Blob Enemies & Flying Drones
    for (const enemy of this.obstacleManager.enemies) {
      if (!enemy.active) continue;

      const distSq = (pPos.x - enemy.position.x) ** 2 + (pCenterY - (enemy.position.y + 0.4)) ** 2;
      const combinedRadius = pRadius + enemy.radius;

      if (distSq < combinedRadius * combinedRadius) {
        if (this.player.invulnerableTime <= 0) {
          const knockX = enemy.position.x > pPos.x ? -1 : 1;
          this.player.takeDamage(20, knockX);
          this.audioManager.playHitImpact();
          this.sceneManager.triggerShake(0.32, 0.22);
          enemy.velocity.x = (enemy.position.x > pPos.x ? 1 : -1) * 4.0;
        }
      }
    }

    // Drone Bots vs Player (Body collision & Red Laser Bolts)
    for (const drone of this.obstacleManager.drones) {
      if (!drone.active) continue;

      // Drone Body vs Player
      const distSq = (pPos.x - drone.position.x) ** 2 + (pCenterY - drone.position.y) ** 2;
      if (distSq < (pRadius + drone.radius) ** 2) {
        if (this.player.invulnerableTime <= 0) {
          const knockX = drone.position.x > pPos.x ? -1 : 1;
          this.player.takeDamage(15, knockX);
          this.audioManager.playHitImpact();
          this.sceneManager.triggerShake(0.30, 0.20);
        }
      }

      // Drone Red Lasers vs Platforms, Ground, Crates, Cover Barriers, and Player (Tight Bounding Radius)
      for (const rLaser of drone.lasers) {
        if (!rLaser.active) continue;

        const rR = 0.05; // Tight, accurate bullet radius

        // 1. Check against Solid Platforms
        let hitSolid = false;
        for (const plat of platforms) {
          const platHalfW = plat.width / 2;
          const platHalfH = plat.height / 2;
          if (
            rLaser.position.x + rR >= plat.x - platHalfW &&
            rLaser.position.x - rR <= plat.x + platHalfW &&
            rLaser.position.y + rR >= plat.y - platHalfH &&
            rLaser.position.y - rR <= plat.y + platHalfH
          ) {
            hitSolid = true;
            break;
          }
        }

        // 2. Check against Ground Floor
        if (!hitSolid && rLaser.position.y <= -3.70) {
          hitSolid = true;
        }

        // 3. Check against Supply Crates
        if (!hitSolid) {
          for (const crate of this.obstacleManager.crates) {
            if (!crate.active || crate.isDestroyed) continue;
            if (
              rLaser.position.x + rR >= crate.position.x - crate.halfW &&
              rLaser.position.x - rR <= crate.position.x + crate.halfW &&
              rLaser.position.y + rR >= crate.position.y - crate.halfH &&
              rLaser.position.y - rR <= crate.position.y + crate.halfH
            ) {
              hitSolid = true;
              crate.takeDamage(1, Math.sign(rLaser.velocity.x) || 1);
              break;
            }
          }
        }

        // 4. Check against Cover Barriers & Level Obstacles (Tactical Cover Block)
        if (!hitSolid) {
          for (const obs of this.obstacleManager.obstacles) {
            if (!obs.active) continue;
            if (obs.type === ObstacleType.HAZARD_PLATFORM) continue;
            
            if (obs.type === ObstacleType.GEAR) {
              const gDistSq = (rLaser.position.x - obs.group.position.x) ** 2 + (rLaser.position.y - obs.group.position.y) ** 2;
              const gRadius = obs.collider.radius || 2.2;
              if (gDistSq <= gRadius * gRadius) {
                hitSolid = true;
                break;
              }
            } else if (
              obs.type === ObstacleType.COVER_BARRIER ||
              obs.type === ObstacleType.LASER_GATE ||
              obs.type === ObstacleType.PISTON ||
              obs.type === ObstacleType.SKY_MAZE_WALL
            ) {
              const half = obs.collider.halfSize || new THREE.Vector2(0.8, 0.625);
              const center = obs.collider.center || new THREE.Vector2(obs.group.position.x, obs.group.position.y + half.y);
              if (
                rLaser.position.x + rR >= center.x - half.x &&
                rLaser.position.x - rR <= center.x + half.x &&
                rLaser.position.y + rR >= center.y - half.y &&
                rLaser.position.y - rR <= center.y + half.y
              ) {
                hitSolid = true;
                break;
              }
            }
          }
        }

        if (hitSolid) {
          this.obstacleManager.spawnBulletImpact(rLaser.position.x, rLaser.position.y, drone.isAlien ? 0x39ff14 : 0xff2222);
          this.player.emitSparks(rLaser.position.x, rLaser.position.y, 0, 6);
          rLaser.active = false;
          rLaser.mesh.visible = false;
          continue;
        }

        // 5. Red Laser vs Player (takes crouch height & Bubble Force Field Ricochet into account)
        const playerCurrentHeight = this.player.isCrouching ? 1.10 : 1.85;
        const playerCenterY = pPos.y + playerCurrentHeight / 2;

        // BUBBLE FORCE FIELD: Ricochets & Deflects Bullets Away on Contact!
        if (this.player.shieldActive) {
          const shieldCenterY = pPos.y + (this.player.isCrouching ? 0.70 : 1.05);
          const sDistSq = (pPos.x - rLaser.position.x) ** 2 + (shieldCenterY - rLaser.position.y) ** 2;
          const shieldRadius = 1.65;

          if (sDistSq <= shieldRadius * shieldRadius) {
            // Calculate outward normal from bubble center to impact point
            const dist = Math.sqrt(sDistSq) || 1;
            const normX = (rLaser.position.x - pPos.x) / dist;
            const normY = (rLaser.position.y - shieldCenterY) / dist;

            // Reflect bullet velocity vector: v = v - 2*(v·n)*n with bounce boost
            const dot = rLaser.velocity.x * normX + rLaser.velocity.y * normY;
            rLaser.velocity.x = (rLaser.velocity.x - 2 * dot * normX) * 1.30 + (Math.random() - 0.5) * 3.5;
            rLaser.velocity.y = (rLaser.velocity.y - 2 * dot * normY) * 1.30 + (Math.random() - 0.5) * 3.5;

            // Push bullet outside shield boundary
            rLaser.position.x = pPos.x + normX * (shieldRadius + 0.15);
            rLaser.position.y = shieldCenterY + normY * (shieldRadius + 0.15);
            rLaser.mesh.position.copy(rLaser.position);
            rLaser.mesh.rotation.z = Math.atan2(rLaser.velocity.y, rLaser.velocity.x);

            // Trigger dazzling ricochet sparks and deflect effects
            this.player.takeDamage(0, normX > 0 ? -1 : 1);
            this.player.emitSparks(rLaser.position.x, rLaser.position.y, 0, 8);
            this.obstacleManager.spawnBulletImpact(rLaser.position.x, rLaser.position.y, 0x00ffff);
            this.audioManager.playShieldDeflect();
            this.sceneManager.triggerShake(0.18, 0.12);
            continue;
          }
        }

        const lDistSq = (pPos.x - rLaser.position.x) ** 2 + (playerCenterY - rLaser.position.y) ** 2;
        const hitRadius = this.player.isCrouching ? 0.38 : 0.48;

        if (lDistSq < hitRadius * hitRadius) {
          rLaser.active = false;
          rLaser.mesh.visible = false;

          if (this.player.invulnerableTime <= 0) {
            const knockX = rLaser.velocity.x > 0 ? 1 : -1;
            this.player.takeDamage(20, knockX);
            this.audioManager.playHitImpact();
            this.sceneManager.triggerShake(0.35, 0.24);
          }
        }
      }
    }

    // Interactive Physics Supply Crates vs Player (Smooth Horizontal Push Momentum)
    for (const crate of this.obstacleManager.crates) {
      if (!crate.active || crate.isDestroyed) continue;
      const dx = pPos.x - crate.position.x;
      const overlapX = (pRadius + crate.halfW) - Math.abs(dx);

      // Only push horizontally when beside the crate, never when standing smoothly on top
      if (overlapX > 0 && pPos.y < crate.position.y + crate.halfH - 0.16 && pPos.y + 1.85 > crate.position.y - crate.halfH) {
        const pushDir = Math.sign(dx) || 1;
        if (pushDir < 0) {
          pPos.x = crate.position.x - (pRadius + crate.halfW);
          crate.velocity.x += Math.max(1.8, Math.abs(this.player.velocity.x) * 0.85);
        } else {
          pPos.x = crate.position.x + (pRadius + crate.halfW);
          crate.velocity.x -= Math.max(1.8, Math.abs(this.player.velocity.x) * 0.85);
        }
        this.player.velocity.x *= 0.55;
      }
    }

    // C. Lasers in 360° vs Destructible Obstacles, Alien Blobs & Flying Drones
    for (const laser of this.player.lasers) {
      if (!laser.active) continue;

      // 1. Check against Alien Blob Enemies
      for (const enemy of this.obstacleManager.enemies) {
        if (!enemy.active) continue;

        const distSq = (laser.position.x - enemy.position.x) ** 2 + (laser.position.y - (enemy.position.y + 0.4)) ** 2;
        if (distSq < (enemy.radius + 0.2) ** 2) {
          this.obstacleManager.spawnBulletImpact(laser.position.x, laser.position.y, 0x00f5ff);
          laser.active = false;
          laser.mesh.visible = false;
          this.audioManager.playEnemyImpact();
          const died = enemy.takeDamage(1);
          this.sceneManager.triggerShake(0.20, 0.14);

          if (died) {
            this.audioManager.playAlienSquish();
            this.sceneManager.triggerShake(0.35, 0.22);
            this.score += 300;
          }
          break;
        }
      }

      if (!laser.active) continue;

      // 2. Check against Flying Attack Drone Bots
      for (const drone of this.obstacleManager.drones) {
        if (!drone.active) continue;

        const distSq = (laser.position.x - drone.position.x) ** 2 + (laser.position.y - drone.position.y) ** 2;
        if (distSq < (drone.radius + 0.28) ** 2) {
          this.obstacleManager.spawnBulletImpact(laser.position.x, laser.position.y, 0x00f5ff);
          laser.active = false;
          laser.mesh.visible = false;
          this.audioManager.playEnemyImpact();
          const died = drone.takeDamage(1);
          this.sceneManager.triggerShake(0.22, 0.16);

          if (died) {
            this.audioManager.playExplosion();
            this.sceneManager.triggerShake(0.38, 0.26);
            this.score += 350;
            if (this.lockedEnemy === drone) {
              this.lockedEnemy = null;
              if (this.lockOnMesh) this.lockOnMesh.visible = false;
              document.getElementById('reticle')?.classList.remove('locked');
            }
          }
          break;
        }
      }

      if (!laser.active) continue;

      // 3. Check against Physics Supply Crates (Tight Bounding Box)
      for (const crate of this.obstacleManager.crates) {
        if (!crate.active || crate.isDestroyed) continue;

        if (
          Math.abs(laser.position.x - crate.position.x) < crate.halfW + 0.05 &&
          Math.abs(laser.position.y - crate.position.y) < crate.halfH + 0.05
        ) {
          this.obstacleManager.spawnBulletImpact(laser.position.x, laser.position.y, 0x00f5ff);
          laser.active = false;
          laser.mesh.visible = false;
          this.audioManager.playEnemyImpact();
          const destroyed = crate.takeDamage(1, Math.sign(laser.velocity.x) || 1);
          this.sceneManager.triggerShake(0.18, 0.12);

          if (destroyed) {
            this.audioManager.playExplosion();
            this.sceneManager.triggerShake(0.32, 0.20);
            this.score += 200;
          }
          break;
        }
      }

      if (!laser.active) continue;

      // 4. Check against Destructible Obstacles & Alien Plants (Tight Bounding Box)
      for (const obs of this.obstacleManager.obstacles) {
        if (!obs.active || !obs.destructible) continue;

        const center = obs.collider.center || obs.group.position;
        const half = obs.collider.halfSize || new THREE.Vector2(0.65, 1.7);
        if (
          Math.abs(laser.position.x - center.x) < half.x + 0.08 &&
          Math.abs(laser.position.y - center.y) < half.y + 0.08
        ) {
          this.obstacleManager.spawnBulletImpact(laser.position.x, laser.position.y, 0x00f5ff);
          laser.active = false;
          laser.mesh.visible = false;
          obs.health -= 1;
          this.sceneManager.triggerShake(0.14, 0.1);

          if (obs.health <= 0) {
            this.obstacleManager.removeObstacle(obs);
            this.audioManager.playExplosion();
            this.sceneManager.triggerShake(0.3, 0.22);
            this.score += 250;
          }
          break;
        }
      }

      if (!laser.active) continue;

      // 5. Check against Solid Platforms & Ground Floor (Swept ray interval prevents any penetration)
      const bR = 0.08;
      const lx = laser.position.x;
      const ly = laser.position.y;
      const lPrevX = lx - laser.velocity.x * dt * 0.75;
      const lPrevY = ly - laser.velocity.y * dt * 0.75;
      const rayMinX = Math.min(lx, lPrevX) - bR;
      const rayMaxX = Math.max(lx, lPrevX) + bR;
      const rayMinY = Math.min(ly, lPrevY) - bR;
      const rayMaxY = Math.max(ly, lPrevY) + bR;

      for (const plat of platforms) {
        const platHalfW = plat.width / 2;
        const platHalfH = plat.height / 2;
        if (
          rayMaxX >= plat.x - platHalfW &&
          rayMinX <= plat.x + platHalfW &&
          rayMaxY >= plat.y - platHalfH &&
          rayMinY <= plat.y + platHalfH
        ) {
          this.obstacleManager.spawnBulletImpact(laser.position.x, laser.position.y, 0x00f5ff);
          this.player.emitSparks(laser.position.x, laser.position.y, 0, 7);
          laser.active = false;
          laser.mesh.visible = false;
          this.audioManager.playEnemyImpact();
          break;
        }
      }

      if (laser.active && laser.position.y <= -3.70) {
        this.obstacleManager.spawnBulletImpact(laser.position.x, -3.70, 0x00f5ff);
        this.player.emitSparks(laser.position.x, -3.70, 0, 7);
        laser.active = false;
        laser.mesh.visible = false;
        this.audioManager.playEnemyImpact();
      }

      // 6. Check against Solid Level Objects & Scene Obstacles (Barriers, Gates, Pistons, Gears, Sky Maze Walls)
      if (laser.active) {
        for (const obs of this.obstacleManager.obstacles) {
          if (!obs.active) continue;
          if (obs.type === ObstacleType.HAZARD_PLATFORM || obs.destructible) continue;

          if (obs.type === ObstacleType.GEAR) {
            const gDistSq = (laser.position.x - obs.group.position.x) ** 2 + (laser.position.y - obs.group.position.y) ** 2;
            const gRadius = obs.collider.radius || 2.2;
            if (gDistSq <= gRadius * gRadius) {
              this.obstacleManager.spawnBulletImpact(laser.position.x, laser.position.y, 0x00f5ff);
              this.player.emitSparks(laser.position.x, laser.position.y, 0, 8);
              laser.active = false;
              laser.mesh.visible = false;
              this.audioManager.playEnemyImpact();
              break;
            }
          } else if (
            obs.type === ObstacleType.COVER_BARRIER ||
            obs.type === ObstacleType.LASER_GATE ||
            obs.type === ObstacleType.PISTON ||
            obs.type === ObstacleType.SKY_MAZE_WALL
          ) {
            const half = obs.collider.halfSize || new THREE.Vector2(0.8, 0.625);
            const center = obs.collider.center || new THREE.Vector2(obs.group.position.x, obs.group.position.y + half.y);
            if (
              rayMaxX >= center.x - half.x &&
              rayMinX <= center.x + half.x &&
              rayMaxY >= center.y - half.y &&
              rayMinY <= center.y + half.y
            ) {
              this.obstacleManager.spawnBulletImpact(laser.position.x, laser.position.y, 0x00f5ff);
              this.player.emitSparks(laser.position.x, laser.position.y, 0, 8);
              laser.active = false;
              laser.mesh.visible = false;
              this.audioManager.playEnemyImpact();
              break;
            }
          }
        }
      }
    }

    // D. Player vs Pickups (Fuel & Coins)
    for (const p of this.obstacleManager.pickups) {
      if (!p.active) continue;

      const distSq = (pPos.x - p.position.x) ** 2 + (pCenterY - p.position.y) ** 2;
      const combinedRadius = pRadius + p.radius;

      if (distSq < combinedRadius * combinedRadius) {
        this.obstacleManager.spawnPickupFX(p.position.x, p.position.y, p.type);
        this.obstacleManager.removePickup(p);

        if (p.type === PickupType.FUEL) {
          this.audioManager.playPickup();
          this.player.addFuel(35);
          this.score += 100;
        } else if (p.type === PickupType.COIN) {
          this.audioManager.playCoin();
          this.score += 500;
        } else if (p.type === PickupType.JETPACK_UPGRADE) {
          this.audioManager.playPickup();
          this.audioManager.playShieldToggle(true);
          this.player.upgradeJetpack();
          this.score += 1500;
          this.showUpgradeBanner('★ METALLIC RETRO JETPACK UNLOCKED! BIGGER BLUE FLAME & ULTRA AGILITY! ★');
        }
      }
    }
  }

  /**
   * High-Tech Sci-Fi Lock-On Reticle System
   * Features:
   * - Outer neon amber tracking ring
   * - Inner pulsating diamond reticle
   * - 4 corner targeting brackets
   */
  private setupLockOnSystem() {
    this.lockOnMesh = new THREE.Group();
    this.lockOnMesh.visible = false;
    this.sceneManager.scene.add(this.lockOnMesh);

    // Distinct Tactical Sunset-Amber/Crimson Fresnel Pulse Sphere (completely different from Jones's cyan geodesic bubble!)
    const lockOrbGeo = new THREE.SphereGeometry(0.64, 24, 18);
    const lockOrbMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
      uniforms: {
        uColorInner: { value: new THREE.Color(0xff4422) },
        uColorRim: { value: new THREE.Color(0xffb833) }
      },
      vertexShader: `
        varying vec3 vNormalW;
        varying vec3 vViewDir;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vViewDir = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        precision mediump float;
        uniform vec3 uColorInner;
        uniform vec3 uColorRim;
        varying vec3 vNormalW;
        varying vec3 vViewDir;
        void main() {
          float ndotv = max(0.0, dot(normalize(vNormalW), normalize(vViewDir)));
          float fresnel = pow(1.0 - ndotv, 2.6);
          vec3 col = mix(uColorInner, uColorRim, fresnel);
          float alpha = fresnel * 0.72 + 0.04;
          gl_FragColor = vec4(col * 1.35, alpha);
        }
      `
    });
    lockOrbMat.customProgramCacheKey = () => 'TacticalLockOnSphereV1';
    this.lockOnMesh.add(new THREE.Mesh(lockOrbGeo, lockOrbMat));

    // Twin sleek opposing precision arc crescents orbiting the target sphere
    const arcGeo = new THREE.TorusGeometry(0.72, 0.018, 8, 24, Math.PI * 0.65);
    const arcMat = new THREE.MeshBasicMaterial({
      color: 0xffaa22,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const arcA = new THREE.Mesh(arcGeo, arcMat);
    arcA.rotation.x = Math.PI * 0.35;
    this.lockOnMesh.add(arcA);

    const arcB = new THREE.Mesh(arcGeo, arcMat);
    arcB.rotation.x = -Math.PI * 0.35;
    arcB.rotation.z = Math.PI;
    this.lockOnMesh.add(arcB);

    // Next-Gen Triple-AAA Holographic Raycast Targeting Laser Beam (Colt Barrel -> Locked Target)
    this.rayBeamGroup = new THREE.Group();
    this.rayBeamGroup.visible = false;
    this.sceneManager.scene.add(this.rayBeamGroup);

    // 1. Razor-sharp incandescent white-cyan inner core
    const coreGeo = new THREE.CylinderGeometry(0.011, 0.011, 1.0, 8, 1, true);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xe8ffff,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.rayBeamCore = new THREE.Mesh(coreGeo, coreMat);
    this.rayBeamCore.renderOrder = 10;
    this.rayBeamGroup.add(this.rayBeamCore);

    // 2. Animated GLSL Holographic Outer Energy Sheath with flowing digital telemetry pulses
    const sheathGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.0, 12, 1, true);
    this.rayBeamSheathMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uLength: { value: 5.0 },
        uFlash: { value: 0 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uLength;
        uniform float uFlash;
        void main() {
          // Flowing high-speed energy pulses racing from Colt barrel (vUv.y = 0) -> locked target (vUv.y = 1)
          float flow1 = sin((vUv.y * uLength * 3.8) - uTime * 22.0) * 0.5 + 0.5;
          float flow2 = sin((vUv.y * uLength * 9.0) - uTime * 38.0) * 0.5 + 0.5;
          float pulse = 0.45 + 0.40 * pow(flow1, 2.0) + 0.25 * pow(flow2, 3.0);

          // Crisp radial & endpoint feathering
          float edgeFade = smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);

          // Electric Cyan tracking -> Blazing Gold-Crimson overdrive flash when firing!
          vec3 trackCol = vec3(0.04, 0.92, 1.0);
          vec3 fireCol  = vec3(1.0, 0.48, 0.16);
          vec3 col = mix(trackCol, fireCol, uFlash);

          float alpha = (0.38 + 0.48 * uFlash) * pulse * edgeFade;
          gl_FragColor = vec4(col * (1.25 + 0.9 * uFlash), alpha);
        }
      `
    });
    this.rayBeamSheath = new THREE.Mesh(sheathGeo, this.rayBeamSheathMat);
    this.rayBeamSheath.renderOrder = 9;
    this.rayBeamGroup.add(this.rayBeamSheath);

    // 3. Glowing Target Impact Laser Contact Dot
    const dotGeo = new THREE.SphereGeometry(0.11, 12, 12);
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0x66ffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.rayImpactDot = new THREE.Mesh(dotGeo, dotMat);
    this.rayImpactDot.renderOrder = 11;
    this.rayBeamGroup.add(this.rayImpactDot);
  }

  /**
   * 2D Slab Raycast Segment-vs-AABB Line-of-Sight check against solid platforms/cover
   */
  private hasClearRaycastLineOfSight(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    platforms: { x: number; y: number; width: number; height: number }[]
  ): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    for (const p of platforms) {
      const minX = p.x - p.width * 0.5;
      const maxX = p.x + p.width * 0.5;
      const minY = p.y - p.height * 0.5;
      const maxY = p.y + p.height * 0.5;

      let tMin = 0.02;
      let tMax = 0.98;

      if (Math.abs(dx) < 1e-6) {
        if (x0 < minX || x0 > maxX) continue;
      } else {
        let tx1 = (minX - x0) / dx;
        let tx2 = (maxX - x0) / dx;
        if (tx1 > tx2) { const tmp = tx1; tx1 = tx2; tx2 = tmp; }
        tMin = Math.max(tMin, tx1);
        tMax = Math.min(tMax, tx2);
        if (tMin > tMax) continue;
      }

      if (Math.abs(dy) < 1e-6) {
        if (y0 < minY || y0 > maxY) continue;
      } else {
        let ty1 = (minY - y0) / dy;
        let ty2 = (maxY - y0) / dy;
        if (ty1 > ty2) { const tmp = ty1; ty1 = ty2; ty2 = tmp; }
        tMin = Math.max(tMin, ty1);
        tMax = Math.min(tMax, ty2);
        if (tMin > tMax) continue;
      }

      // Ray hits solid platform between Jones and the target -> blocked!
      if (tMin <= tMax) return false;
    }
    return true;
  }

  /**
   * Pure Raycast Auto-Lock Targeting System:
   * Casts clear line-of-sight rays from Jones's shoulder to all active enemies/targets,
   * automatically locks onto the closest visible enemy, and aims Jones's Colt arm directly at it!
   */
  private updateLockOnSystem(dt: number, totalTime: number) {
    if (this.state !== GameState.PLAYING || this.player.isDying) {
      if (this.lockOnMesh) this.lockOnMesh.visible = false;
      if (this.rayBeamGroup) this.rayBeamGroup.visible = false;
      this.lockedEnemy = null;
      if (this.reticleLocked && this.reticleEl) {
        this.reticleEl.classList.remove('locked');
        this.reticleLocked = false;
      }
      return;
    }

    const isL2 = this.levelGenerator.currentLevel === 2;
    const originX = this.player.position.x;
    const originY = this.player.position.y + 1.48;
    const originZ = this.player.position.z;
    const lookDir = this.player.facingRight ? 1 : -1;
    const platforms = isL2 ? [] : this.obstacleManager.getPlatforms();

    const maxForwardRange = isL2 ? 56.0 : 44.0;
    const maxBehindRange = isL2 ? 56.0 : 18.0;

    let closestEnemy: any = null;
    let bestScore = Infinity;
    let bestPosX = 0;
    let bestPosY = 0;
    let bestPosZ = 0;

    const evaluateCandidate = (cand: any, tx: number, ty: number, tz: number = 0, priorityBias: number = 0) => {
      const dx = tx - originX;
      const dy = ty - originY;
      const dz = tz - originZ;
      const dist = Math.hypot(dx, dy, dz);
      const inFront = isL2 ? true : (dx * lookDir >= -0.6);
      const maxRange = inFront ? maxForwardRange : maxBehindRange;
      if (dist > maxRange || dist < 0.35) return;

      const score = dist + (inFront ? 0 : 4.5) + priorityBias;
      if (score >= bestScore) return;

      if (!isL2 && !this.hasClearRaycastLineOfSight(originX, originY, tx, ty, platforms)) return;

      bestScore = score;
      closestEnemy = cand;
      bestPosX = tx;
      bestPosY = ty;
      bestPosZ = tz;
    };

    for (const drone of this.obstacleManager.drones) {
      if (!drone.active) continue;
      evaluateCandidate(drone, drone.position.x, drone.position.y, drone.position.z, -0.5);
    }

    if (!isL2) {
      for (const enemy of this.obstacleManager.enemies) {
        if (!enemy.active) continue;
        evaluateCandidate(enemy, enemy.position.x, enemy.position.y + 0.45, 0, 0);
      }

      for (const obs of this.obstacleManager.obstacles) {
        if (!obs.active || obs.type !== ObstacleType.ALIEN_CYBER_SENTINEL) continue;
        evaluateCandidate(obs, obs.group.position.x, obs.group.position.y + 0.65, 0, 0);
      }

      for (const crate of this.obstacleManager.crates) {
        if (!crate.active || crate.isDestroyed) continue;
        evaluateCandidate(crate, crate.position.x, crate.position.y, 0, 2.0);
      }
    }

    if (this.rayBeamFlashTimer > 0) {
      this.rayBeamFlashTimer = Math.max(0, this.rayBeamFlashTimer - dt);
    }

    if (closestEnemy) {
      this.lockedEnemy = closestEnemy;
      this.inputManager.mouseWorldTarget.set(bestPosX, bestPosY, bestPosZ);

      // Smoothly snap subtle pulsing lock-on sphere directly around the enemy (Zero-GC!)
      this._lockTargetPos.set(bestPosX, bestPosY, bestPosZ);
      this.lockOnMesh.position.lerp(this._lockTargetPos, Math.min(1, dt * 22.0));
      this.lockOnMesh.rotation.y += dt * 2.2;
      this.lockOnMesh.rotation.x += dt * 1.1;

      this.lockOnMesh.visible = true;
      const pulse = 0.96 + Math.sin(totalTime * 9.0) * 0.08;
      this.lockOnMesh.scale.setScalar(pulse);

      // Show Next-Gen Triple-AAA Raycast Laser Beam ONLY when the player presses Shoot!
      if (this.rayBeamGroup) {
        if (this.rayBeamFlashTimer > 0) {
          this.player.getMuzzleWorldPosition(this._beamStart);
          this._beamStart.z = 0.08;
          this._beamEnd.set(bestPosX, bestPosY, 0.08);
          this._beamDir.subVectors(this._beamEnd, this._beamStart);
          const len = this._beamDir.length();
          if (len > 0.2) {
            this._beamDir.divideScalar(len);
            const midX = (this._beamStart.x + this._beamEnd.x) * 0.5;
            const midY = (this._beamStart.y + this._beamEnd.y) * 0.5;

            const flashNorm = this.rayBeamFlashTimer / 0.26;
            const coreScale = 0.5 + flashNorm * 1.1;
            this.rayBeamCore.position.set(midX, midY, 0.08);
            this.rayBeamCore.scale.set(coreScale, len, coreScale);
            this.rayBeamCore.quaternion.setFromUnitVectors(this._beamUp, this._beamDir);
            (this.rayBeamCore.material as THREE.MeshBasicMaterial).opacity = flashNorm * 0.95;

            const sheathWidth = 0.6 + flashNorm * 1.3;
            this.rayBeamSheath.position.set(midX, midY, 0.08);
            this.rayBeamSheath.scale.set(sheathWidth, len, sheathWidth);
            this.rayBeamSheath.quaternion.setFromUnitVectors(this._beamUp, this._beamDir);

            this.rayBeamSheathMat.uniforms.uTime.value = totalTime;
            this.rayBeamSheathMat.uniforms.uLength.value = len;
            this.rayBeamSheathMat.uniforms.uFlash.value = flashNorm;

            this.rayImpactDot.position.set(bestPosX, bestPosY, 0.14);
            const dotScale = (0.7 + flashNorm * 1.1);
            this.rayImpactDot.scale.setScalar(dotScale);
            (this.rayImpactDot.material as THREE.MeshBasicMaterial).opacity = flashNorm;

            this.rayBeamGroup.visible = true;
          } else {
            this.rayBeamGroup.visible = false;
          }
        } else {
          this.rayBeamGroup.visible = false;
        }
      }

      document.getElementById('reticle')?.classList.add('locked');
    } else {
      this.lockedEnemy = null;
      this.lockOnMesh.visible = false;
      if (this.rayBeamGroup) this.rayBeamGroup.visible = false;
      document.getElementById('reticle')?.classList.remove('locked');
    }
  }
}

// Robust app initialization
function startApp() {
  const g = new Game();
  (window as any).game = g;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
