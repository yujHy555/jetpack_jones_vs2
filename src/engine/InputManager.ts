import * as THREE from 'three';

/**
 * Cross-platform Input Manager with 360° Mouse Aiming & Reticle Support
 */
export class InputManager {
  public moveX: number = 0; // -1 = Left, 0 = Neutral, +1 = Right
  public moveZ: number = 0; // -1 = Forward / North, +1 = Back / South (Isometric Depth)
  public run: boolean = false;
  public jumpJustPressed: boolean = false;
  public jumpHeld: boolean = false;
  public jetpack: boolean = false;
  public jetpackThrottle: number = 0;       // 0.0 - 1.0 (true analog RT/LT on gamepad!)
  public jetpackDirectTrigger: boolean = false; // True when dedicated RT/LT/RB jetpack trigger is pressed
  public rightStickAimX: number = 0;
  public rightStickAimY: number = 0;
  public hasGamepadAim: boolean = false;
  public isGamepadActive: boolean = false;
  public leftStickAimY: number = 0;
  private prevGamepadJump: boolean = false;
  private prevGamepadShoot: boolean = false;
  private prevGamepadSlide: boolean = false;
  private prevGamepadShield: boolean = false;
  private prevGamepadL3: boolean = false;
  private gamepadSprintToggle: boolean = false;
  private gamepadRapidFireCooldown: number = 0;
  public slideJustPressed: boolean = false;

  // Left-Mouse Drag Camera Rotation (Level 2 Free-Roam!)
  private isLeftMouseDown: boolean = false;
  private leftMouseDragged: boolean = false;
  private lastMouseDragX: number = 0;
  private lastMouseDragY: number = 0;
  public mouseOrbitDeltaX: number = 0;
  public mouseOrbitDeltaY: number = 0;
  private lastRumbleMs: number = 0;
  private touchJumpHeld: boolean = false;
  public shootJustPressed: boolean = false;
  public ragdollJustPressed: boolean = false;
  public handheldToggleJustPressed: boolean = false;
  public cameraViewToggleJustPressed: boolean = false;
  public shieldJustPressed: boolean = false;
  public isFreeRoam3D: boolean = false;
  public crouch: boolean = false;
  public touchCrouch: boolean = false;
  // Strictly gated to GameState.PLAYING so menu/load clicks & keys NEVER buffer a shot!
  public gameplayInputEnabled: boolean = false;

  // Mouse & 360° Aiming
  public mouseScreenX: number = window.innerWidth / 2;
  public mouseScreenY: number = window.innerHeight / 2;
  public mouseWorldTarget: THREE.Vector3 = new THREE.Vector3(10, 0, 0);
  public hasMouse: boolean = false;
  private reticleEl: HTMLElement | null = null;

  private keys: Record<string, boolean> = {};

  // Touch states
  private touchLeft: boolean = false;
  private touchRight: boolean = false;
  private touchRun: boolean = false;
  private touchJetpack: boolean = false;

  constructor() {
    this.reticleEl = document.getElementById('reticle');
    this.setupKeyboard();
    this.setupTouch();
    this.setupMouse();
  }

  private setupKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'KeyA', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
        e.preventDefault();
      }

      const wasPressed = !!this.keys[e.code];
      this.keys[e.code] = true;

      if ((e.code === 'KeyW' || e.code === 'ArrowUp') && !wasPressed && !this.isFreeRoam3D) {
        this.jumpJustPressed = true;
      }

      if ((e.code === 'Space') && !wasPressed) {
        this.jumpJustPressed = true;
      }

      if ((e.code === 'KeyV') && !wasPressed) {
        this.cameraViewToggleJustPressed = true;
      }

      if ((e.code === 'KeyJ' || e.code === 'KeyZ' || e.code === 'Enter') && !wasPressed) {
        if (this.gameplayInputEnabled) {
          this.shootJustPressed = true;
          this.triggerReticlePulse();
        }
      }

      if ((e.code === 'KeyH') && !wasPressed) {
        this.handheldToggleJustPressed = true;
      }

      if ((e.code === 'KeyB') && !wasPressed) {
        this.shieldJustPressed = true;
      }

      if ((e.code === 'KeyF') && !wasPressed) {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  private setupMouse() {
    // Cursor aiming removed: 100% pure Raycast Auto-Lock system!
    // Left-click still fires the Colt cleanly without moving any cursor reticle.
    if (this.reticleEl) {
      this.reticleEl.classList.remove('active');
      this.reticleEl.style.display = 'none';
    }

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        if (!this.gameplayInputEnabled) return;
        // Ignore clicks on Menu / HUD buttons so clicking "PLAY GAME" never fires a shot on load!
        const target = e.target as HTMLElement | null;
        if (target && target.closest('button, input, select, label, #main-menu, #main-menu-overlay, #settings-modal, #controls-modal, #controls-zoom-modal, #pixel-controls-hud, #hangar-overlay, #overlay-screen, #gameover-overlay, #boot-preloader')) {
          return;
        }
        this.isGamepadActive = false;
        if (this.isFreeRoam3D) {
          // In Level 2 3D Free-Roam: Left-Mouse Drag rotates the camera; quick Left-Click shoots!
          this.isLeftMouseDown = true;
          this.leftMouseDragged = false;
          this.lastMouseDragX = e.clientX;
          this.lastMouseDragY = e.clientY;
        } else {
          this.shootJustPressed = true;
        }
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isLeftMouseDown || !this.isFreeRoam3D) return;
      const dx = e.clientX - this.lastMouseDragX;
      const dy = e.clientY - this.lastMouseDragY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        this.leftMouseDragged = true;
      }
      this.lastMouseDragX = e.clientX;
      this.lastMouseDragY = e.clientY;
      this.mouseOrbitDeltaX += dx;
      this.mouseOrbitDeltaY += dy;
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.isLeftMouseDown) {
        this.isLeftMouseDown = false;
        if (this.isFreeRoam3D && !this.leftMouseDragged && this.gameplayInputEnabled) {
          this.shootJustPressed = true;
        }
      }
    });
  }

  private setupTouch() {
    const bindBtn = (id: string, onStart: () => void, onEnd: () => void) => {
      const el = document.getElementById(id);
      if (!el) return;

      const start = (e: Event) => {
        e.preventDefault();
        el.classList.add('active');
        onStart();
      };
      const end = (e: Event) => {
        e.preventDefault();
        el.classList.remove('active');
        onEnd();
      };

      el.addEventListener('touchstart', start, { passive: false });
      el.addEventListener('touchend', end, { passive: false });
      el.addEventListener('touchcancel', end, { passive: false });
      el.addEventListener('mousedown', start);
      el.addEventListener('mouseup', end);
      el.addEventListener('mouseleave', end);
    };

    bindBtn('btn-left', () => { this.touchLeft = true; }, () => { this.touchLeft = false; });
    bindBtn('btn-right', () => { this.touchRight = true; }, () => { this.touchRight = false; });
    bindBtn('btn-run', () => { this.touchRun = !this.touchRun; }, () => {});
    bindBtn('btn-jump', () => { this.jumpJustPressed = true; this.touchJumpHeld = true; }, () => { this.touchJumpHeld = false; });
    bindBtn('btn-jetpack', () => { this.touchJetpack = true; }, () => { this.touchJetpack = false; });
    bindBtn('btn-laser', () => {
      this.shootJustPressed = true;
      this.triggerReticlePulse();
    }, () => {});
    bindBtn('btn-shield', () => { this.shieldJustPressed = true; }, () => {});
    bindBtn('btn-crouch', () => { this.touchCrouch = true; }, () => { this.touchCrouch = false; });
  }

  public triggerReticlePulse() {
    if (this.reticleEl) {
      this.reticleEl.classList.remove('reticle-shoot');
      void this.reticleEl.offsetWidth; // Trigger reflow
      this.reticleEl.classList.add('reticle-shoot');
    }
  }

  /**
   * Projects mouse screen coordinate onto game world plane
   * Projects mouse cursor ray into 3D world space (plane Z = 0)
   */
  public updateAimWorldTarget(camera: THREE.Camera, _groundY: number = 0, _isIsometric: boolean = false) {
    if (!this.hasMouse) return;

    // Normalized Device Coordinates (-1 to +1)
    const ndcX = (this.mouseScreenX / window.innerWidth) * 2 - 1;
    const ndcY = -(this.mouseScreenY / window.innerHeight) * 2 + 1;

    // Unproject to find world ray
    const rayOrigin = new THREE.Vector3(ndcX, ndcY, -1).unproject(camera);
    const rayTarget = new THREE.Vector3(ndcX, ndcY, 1).unproject(camera);
    const rayDir = rayTarget.sub(rayOrigin).normalize();

    // Intersect with plane Z = 0
    if (Math.abs(rayDir.z) > 0.0001) {
      const distance = -rayOrigin.z / rayDir.z;
      this.mouseWorldTarget.copy(rayOrigin).addScaledVector(rayDir, distance);
    }
  }

  public update(isFreeRoam3D: boolean = false) {
    this.isFreeRoam3D = isFreeRoam3D;
    // 1. Horizontal (and 3D Z) Move Input
    let mx = 0;
    let mz = 0;
    if (this.keys['KeyA'] || this.keys['ArrowLeft'] || this.touchLeft) mx -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight'] || this.touchRight) mx += 1;
    if (isFreeRoam3D) {
      if (this.keys['KeyW'] || this.keys['ArrowUp']) mz -= 1;
      if (this.keys['KeyS'] || this.keys['ArrowDown']) mz += 1;
    }

    // Triple-AAA Gamepad Polling (Analog Left Stick, Analog RT/LT Jetpack, Right-Stick 360° Aim, Edge-Detected Actions)
    let padJumpHeld = false;
    let padJetpackThrottle = 0;
    let padJetpackDirect = false;
    let padRun = false;
    let padCrouch = false;
    let padShootHeld = false;
    let padShieldHeld = false;
    this.hasGamepadAim = false;

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of gamepads) {
      if (!pad) continue;

      // 1. Left Stick with radial deadzone (0.14) — smoothly WALKS across full range!
      // Push down Left Stick (L3) or hold LB to RUN/SPRINT!
      const rawLx = pad.axes[0] ?? 0;
      const rawLy = pad.axes[1] ?? 0;
      const deadzone = 0.14;
      if (Math.abs(rawLx) > deadzone) {
        const norm = Math.min(1, (Math.abs(rawLx) - deadzone) / (1 - deadzone));
        const curved = Math.sign(rawLx) * Math.pow(norm, 1.32);
        mx = curved;
        this.isGamepadActive = true;
      }
      // Track upward left-stick tilt for diagonal up-fire (2D) OR full 360° analog Z movement (Level 2 Free-Roam!)
      if (isFreeRoam3D && Math.abs(rawLy) > deadzone) {
        const normZ = Math.min(1, (Math.abs(rawLy) - deadzone) / (1 - deadzone));
        mz = Math.sign(rawLy) * Math.pow(normZ, 1.32);
        this.isGamepadActive = true;
      }
      this.leftStickAimY = !isFreeRoam3D && rawLy < -0.35 ? Math.min(1, (-rawLy - 0.35) / 0.65) : 0;

      // Reset L3 Sprint toggle cleanly when player stops moving the stick
      if (Math.hypot(mx, mz) < 0.12) {
        this.gamepadSprintToggle = false;
      }

      if (pad.buttons[14]?.pressed) { mx = -1; this.isGamepadActive = true; } // D-Pad Left
      if (pad.buttons[15]?.pressed) { mx = 1; this.isGamepadActive = true; }  // D-Pad Right
      if (isFreeRoam3D && pad.buttons[12]?.pressed) { mz = -1; this.isGamepadActive = true; } // D-Pad Up

      // 2. Crouch (D-Pad Down, or Left Stick down in 2D mode)
      if (pad.buttons[13]?.pressed || (!isFreeRoam3D && rawLy > 0.65)) {
        padCrouch = true;
        this.isGamepadActive = true;
      }

      // 3. Jump / Double Jump (A button = buttons[0], edge-detected!)
      if (pad.buttons[0]?.pressed) {
        padJumpHeld = true;
        this.isGamepadActive = true;
        if (!this.prevGamepadJump) this.jumpJustPressed = true;
      }

      // 4. Dedicated Analog Jetpack Triggers: RT (buttons[7]) or LT (buttons[6])
      const rtVal = pad.buttons[7]?.value ?? (pad.buttons[7]?.pressed ? 1 : 0);
      const ltVal = pad.buttons[6]?.value ?? (pad.buttons[6]?.pressed ? 1 : 0);
      const triggerVal = Math.max(rtVal, ltVal);
      if (triggerVal > 0.08) {
        const normTrig = Math.min(1, (triggerVal - 0.08) / 0.92);
        padJetpackThrottle = Math.max(padJetpackThrottle, normTrig);
        padJetpackDirect = true;
        this.isGamepadActive = true;
      }

      // 5. Colt Peacemaker Shoot: X (buttons[2]) — instant tap + crisp rapid-fire hold!
      if (pad.buttons[2]?.pressed) {
        padShootHeld = true;
        this.isGamepadActive = true;
        if (this.gameplayInputEnabled) {
          if (!this.prevGamepadShoot) {
            this.shootJustPressed = true;
            this.gamepadRapidFireCooldown = 0.21;
          } else {
            this.gamepadRapidFireCooldown -= 1 / 60;
            if (this.gamepadRapidFireCooldown <= 0) {
              this.shootJustPressed = true;
              this.gamepadRapidFireCooldown = 0.21;
            }
          }
        }
      }

      // 5b. Dedicated Running Slide: RB (buttons[5]) — edge-detected!
      const rbPressed = !!pad.buttons[5]?.pressed;
      if (rbPressed && !this.prevGamepadSlide && this.gameplayInputEnabled) {
        this.slideJustPressed = true;
        this.isGamepadActive = true;
      }
      this.prevGamepadSlide = rbPressed;

      // 6. Forcefield / Ball Mode Toggle (B = buttons[1] or Y = buttons[3], edge-detected)
      if (pad.buttons[1]?.pressed || pad.buttons[3]?.pressed) {
        padShieldHeld = true;
        this.isGamepadActive = true;
        if (!this.prevGamepadShield) this.shieldJustPressed = true;
      }

      // 7. Sprint Boost: Click or Hold Left Stick (L3 = buttons[10]) or LB (buttons[4])!
      const l3Pressed = !!pad.buttons[10]?.pressed;
      if (l3Pressed && !this.prevGamepadL3) {
        this.gamepadSprintToggle = !this.gamepadSprintToggle;
      }
      this.prevGamepadL3 = l3Pressed;
      if (pad.buttons[4]?.pressed || l3Pressed || this.gamepadSprintToggle) {
        padRun = true;
        this.isGamepadActive = true;
      }

      // 8. Right Stick 360° Free Aiming (axes[2], axes[3])
      const rx = pad.axes[2] ?? 0;
      const ry = pad.axes[3] ?? 0;
      if (Math.hypot(rx, ry) > 0.20) {
        this.rightStickAimX = rx;
        this.rightStickAimY = -ry; // Invert Y so up on stick = aim up in world space
        this.hasGamepadAim = true;
        this.isGamepadActive = true;
      }
    }

    this.prevGamepadJump = padJumpHeld;
    this.prevGamepadShoot = padShootHeld;
    this.prevGamepadShield = padShieldHeld;

    this.moveX = THREE.MathUtils.clamp(mx, -1, 1);
    this.moveZ = isFreeRoam3D ? THREE.MathUtils.clamp(mz, -1, 1) : 0;

    // 2. Sprint / Run (Keyboard Shift, Touch, or Gamepad LB/L3/Full Stick)
    const kbRun = !!(this.keys['ShiftLeft'] || this.keys['ShiftRight']);
    this.run = kbRun || this.touchRun || padRun;

    // 2b. Jump Held (for Triple-AAA variable jump height)
    this.jumpHeld = !!(this.keys['Space'] || (!isFreeRoam3D && (this.keys['KeyW'] || this.keys['ArrowUp'])) || this.touchJumpHeld || padJumpHeld);

    // 3. Jetpack Thrust & Analog Throttle
    // Supports: RT/LT analog triggers (instant), Space hold, Touch jetpack, AND 3rd press+hold of Gamepad A!
    const kbJetpack = !!(this.keys['Space'] || (!isFreeRoam3D && ((this.keys['KeyW'] && !this.jumpJustPressed) || (this.keys['ArrowUp'] && !this.jumpJustPressed))) || this.touchJetpack);
    const padAJetpack = padJumpHeld && !this.jumpJustPressed;
    this.jetpackDirectTrigger = padJetpackDirect || this.touchJetpack;
    this.jetpack = kbJetpack || padJetpackDirect || padAJetpack;
    this.jetpackThrottle = padJetpackDirect ? padJetpackThrottle : ((kbJetpack || padAJetpack) ? 1.0 : 0.0);

    // 4. Crouch Input (Hold S/Down in 2D, or C/Ctrl in 3D Free-Roam, plus Touch or Gamepad D-Down)
    const kbCrouch = isFreeRoam3D
      ? !!(this.keys['KeyC'] || this.keys['ControlLeft'])
      : !!(this.keys['KeyS'] || this.keys['ArrowDown'] || this.keys['KeyC']);
    this.crouch = kbCrouch || this.touchCrouch || padCrouch;
  }

  /**
   * Ultra-subtle, throttled console haptic tap (never buzzes or runs in menus)
   */
  public triggerRumble(durationMs: number = 40, weakMagnitude: number = 0.20, strongMagnitude: number = 0.12) {
    const now = performance.now();
    if (now - this.lastRumbleMs < 180) return; // Prevent rapid continuous buzzing
    this.lastRumbleMs = now;

    const clampedDur = Math.min(45, Math.max(15, durationMs * 0.55));
    const weak = Math.min(0.18, Math.max(0, weakMagnitude * 0.28));
    const strong = Math.min(0.12, Math.max(0, strongMagnitude * 0.18));

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of gamepads) {
      const act = (pad as unknown as { vibrationActuator?: { playEffect?: (type: string, params: Record<string, number>) => Promise<void> } })?.vibrationActuator;
      if (act && typeof act.playEffect === 'function') {
        try {
          act.playEffect('dual-rumble', {
            startDelay: 0,
            duration: clampedDur,
            weakMagnitude: weak,
            strongMagnitude: strong
          });
        } catch { /* ignore */ }
      }
    }
  }

  /**
   * Projects Gamepad Right-Stick 3D aim point onto the on-screen #reticle so controller players
   * see crisp real-time visual aiming feedback!
   */
  public syncGamepadReticle(camera: THREE.PerspectiveCamera, worldAimPos: THREE.Vector3) {
    if (!this.reticleEl) return;
    if (this.hasGamepadAim) {
      const projected = worldAimPos.clone().project(camera);
      const sx = (projected.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-projected.y * 0.5 + 0.5) * window.innerHeight;
      this.reticleEl.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
      this.reticleEl.classList.add('active');
    } else if (this.isGamepadActive) {
      this.reticleEl.classList.remove('active');
    }
  }

  public stopRumble() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of gamepads) {
      const act = (pad as unknown as { vibrationActuator?: { reset?: () => Promise<void>; playEffect?: (type: string, params: Record<string, number>) => Promise<void> } })?.vibrationActuator;
      if (act) {
        try {
          if (typeof act.reset === 'function') {
            act.reset();
          } else if (typeof act.playEffect === 'function') {
            act.playEffect('dual-rumble', { startDelay: 0, duration: 1, weakMagnitude: 0, strongMagnitude: 0 });
          }
        } catch { /* ignore */ }
      }
    }
  }

  public consumeJumpTrigger(): boolean {
    if (this.jumpJustPressed) {
      this.jumpJustPressed = false;
      return true;
    }
    return false;
  }

  public consumeShootTrigger(): boolean {
    if (this.shootJustPressed) {
      this.shootJustPressed = false;
      return true;
    }
    return false;
  }

  public consumeSlideTrigger(): boolean {
    if (this.slideJustPressed) {
      this.slideJustPressed = false;
      return true;
    }
    return false;
  }

  public consumeRagdollTrigger(): boolean {
    return false;
  }

  public consumeHandheldToggleTrigger(): boolean {
    if (this.handheldToggleJustPressed) {
      this.handheldToggleJustPressed = false;
      return true;
    }
    return false;
  }

  public consumeCameraViewToggleTrigger(): boolean {
    if (this.cameraViewToggleJustPressed) {
      this.cameraViewToggleJustPressed = false;
      return true;
    }
    return false;
  }

  public consumeMouseOrbitDelta(): { dx: number; dy: number } {
    const out = { dx: this.mouseOrbitDeltaX, dy: this.mouseOrbitDeltaY };
    this.mouseOrbitDeltaX = 0;
    this.mouseOrbitDeltaY = 0;
    return out;
  }

  public consumeShieldTrigger(): boolean {
    if (this.shieldJustPressed) {
      this.shieldJustPressed = false;
      return true;
    }
    return false;
  }
}
