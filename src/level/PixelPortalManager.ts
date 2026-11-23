import * as THREE from 'three';
import { GROUND_Y } from '../entities/Player';

interface PortalDoor {
  x: number;
  y: number;
  enablesPixel: boolean;
  group: THREE.Group;
  curtainMat: THREE.ShaderMaterial;
  outerRing: THREE.Mesh;
  innerRing: THREE.Mesh;
  orbitCubes: THREE.Mesh[];
  surgeTimer: number;
  cooldown: number;
}

/**
 * Sci-Fi Pixel Dimension Portal Doorways
 * - Door 1 (x = 14): Entering activates the Next-Gen Advanced Pixel-Art Shader
 * - Door 2 (x = 42): Entering turns the Pixel-Art Shader OFF and restores smooth 3D HD
 * - Works bidirectionally if the player walks or flies back through either doorway!
 */
export class PixelPortalManager {
  private group: THREE.Group;
  private doors: PortalDoor[] = [];
  private prevPlayerX: number = 0;
  private initializedPlayerX: boolean = false;
  public isPixelModeActive: boolean = false;
  public onPixelModeChange?: (enabled: boolean) => void;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    this.group.name = 'PixelPortalDoorways';
    scene.add(this.group);

    // Door 1: PIXEL DIMENSION ENTRY (wide-open clear runway at x = 14.0!)
    this.doors.push(this.createPortalDoor(14.0, GROUND_Y, true));

    // Door 2: HD REALITY EXIT (auto-shifts clear of ALL platforms, obstacles & crates!)
    this.doors.push(this.createPortalDoor(46.0, GROUND_Y, false));
  }

  public setVisible(visible: boolean) {
    this.group.visible = visible;
  }

  /**
   * Automatically shifts doorways clear of ANY overlapping platforms, cover barriers, crates, or obstacles
   * with generous ±2.8m horizontal clearance so Pixel Doors are NEVER obstructed by anything!
   */
  public ensureClearOfPlatforms(
    platforms: { x: number; y: number; width: number; height: number }[],
    extraBlockers: { x: number; y: number; halfW: number; halfH: number }[] = []
  ) {
    for (const door of this.doors) {
      let attempts = 0;
      while (attempts < 16) {
        const blockedByPlat = platforms.some((p) => {
          const platBottom = p.y - p.height * 0.5;
          const platTop = p.y + p.height * 0.5;
          const overlapsY = platBottom < door.y + 4.4 && platTop > door.y - 0.2;
          const overlapsX = Math.abs(p.x - door.x) < p.width * 0.5 + 2.8;
          return overlapsY && overlapsX;
        });
        const blockedByExtra = extraBlockers.some((b) => {
          const bBottom = b.y - b.halfH;
          const bTop = b.y + b.halfH;
          const overlapsY = bBottom < door.y + 4.4 && bTop > door.y - 0.2;
          const overlapsX = Math.abs(b.x - door.x) < b.halfW + 2.8;
          return overlapsY && overlapsX;
        });
        if (!blockedByPlat && !blockedByExtra) break;
        door.x += 3.2;
        door.group.position.x = door.x;
        attempts++;
      }
    }
  }

  private createPortalDoor(x: number, y: number, enablesPixel: boolean): PortalDoor {
    const doorGroup = new THREE.Group();
    doorGroup.position.set(x, y, 0);

    const frameHeight = 3.5;
    const frameDepth = 1.9; // Spans Z so player clearly passes THROUGH the doorway!
    const pillarThickness = 0.28;

    const primaryHex = enablesPixel ? 0xff22cc : 0x00ffaa;
    const secondaryHex = enablesPixel ? 0x00f5ff : 0xffffff;

    // Materials
    const frameMetal = new THREE.MeshStandardMaterial({
      color: enablesPixel ? 0x262a3a : 0xdbe6f2,
      metalness: 0.85,
      roughness: 0.22
    });
    const darkTrim = new THREE.MeshStandardMaterial({
      color: 0x151822,
      metalness: 0.6,
      roughness: 0.45
    });
    const neonMat = new THREE.MeshBasicMaterial({
      color: primaryHex
    });
    const accentMat = new THREE.MeshBasicMaterial({
      color: secondaryHex
    });

    // Front & Back Vertical Pillars (aligned along Z so Jones walks straight through the arch along X!)
    const pillarGeo = new THREE.BoxGeometry(pillarThickness, frameHeight, pillarThickness);
    const zOffsets = [-frameDepth * 0.5, frameDepth * 0.5];
    for (const zo of zOffsets) {
      const pillar = new THREE.Mesh(pillarGeo, frameMetal);
      pillar.position.set(0, frameHeight * 0.5, zo);
      doorGroup.add(pillar);

      // Glowing vertical neon strip on each pillar
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(pillarThickness + 0.04, frameHeight - 0.35, 0.08),
        neonMat
      );
      strip.position.set(0, frameHeight * 0.5, zo);
      doorGroup.add(strip);

      // Heavy bolted pedestal foot
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.24, 0.52),
        darkTrim
      );
      base.position.set(0, 0.12, zo);
      doorGroup.add(base);
    }

    // Overhead Arch Header spanning Z between front and back pillars
    const header = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.38, frameDepth + 0.42),
      frameMetal
    );
    header.position.set(0, frameHeight + 0.12, 0);
    doorGroup.add(header);

    // Overhead Glowing Sign Bar (Pixel Magenta/Cyan vs HD Emerald/White)
    const signBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.12, frameDepth + 0.26),
      accentMat
    );
    signBar.position.set(0, frameHeight + 0.14, 0);
    doorGroup.add(signBar);

    // Stylized 1979 Retro-Future Space Signboard ("★ PIXEL REALM · 79 ★" / "✦ HD REALITY · 01 ✦")
    const badgeCanvas = document.createElement('canvas');
    badgeCanvas.width = 512;
    badgeCanvas.height = 144;
    const ctx = badgeCanvas.getContext('2d')!;

    // 1. Brushed-chrome outer bevel rounded chassis
    const r = 22;
    ctx.beginPath();
    ctx.moveTo(r, 4);
    ctx.lineTo(512 - r, 4);
    ctx.quadraticCurveTo(508, 4, 508, r);
    ctx.lineTo(508, 140 - r);
    ctx.quadraticCurveTo(508, 140, 512 - r, 140);
    ctx.lineTo(r, 140);
    ctx.quadraticCurveTo(4, 140, 4, 140 - r);
    ctx.lineTo(4, r);
    ctx.quadraticCurveTo(4, 4, r, 4);
    ctx.closePath();

    const bgGrad = ctx.createLinearGradient(0, 0, 0, 144);
    if (enablesPixel) {
      bgGrad.addColorStop(0, '#1e0b2e');
      bgGrad.addColorStop(0.55, '#120720');
      bgGrad.addColorStop(1, '#290d3a');
    } else {
      bgGrad.addColorStop(0, '#0a2422');
      bgGrad.addColorStop(0.55, '#07171a');
      bgGrad.addColorStop(1, '#0e2d28');
    }
    ctx.fillStyle = bgGrad;
    ctx.fill();

    // 2. Classic 1979 NASA / Atari Sunset Rainbow Racing Stripes across the left & right edges
    ctx.save();
    ctx.clip();
    const stripes = enablesPixel
      ? ['#ff9900', '#ff4466', '#ff22cc', '#00f5ff']
      : ['#00ffaa', '#00e5ff', '#88f7ff', '#fff4d6'];
    stripes.forEach((hex, idx) => {
      ctx.fillStyle = hex;
      ctx.fillRect(0, 108 + idx * 8, 512, 6);
    });
    // Subtle retro CRT scanlines
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    for (let y = 8; y < 136; y += 6) {
      ctx.fillRect(0, y, 512, 2);
    }
    ctx.restore();

    // 3. Chrome outer border + neon inner trim + 4 retro corner rivets
    ctx.strokeStyle = '#d8e4f0';
    ctx.lineWidth = 7;
    ctx.stroke();

    ctx.strokeStyle = enablesPixel ? '#ff33dd' : '#00ffaa';
    ctx.lineWidth = 3;
    ctx.strokeRect(14, 14, 484, 116);

    const rivets = [[26, 26], [486, 26], [26, 118], [486, 118]];
    for (const [rx, ry] of rivets) {
      ctx.beginPath();
      ctx.arc(rx, ry, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#e2edf7';
      ctx.fill();
    }

    // 4. Bold 1979 Space Typography with soft neon glow
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = enablesPixel ? '#00f5ff' : '#00ffaa';
    ctx.shadowBlur = 14;
    ctx.fillStyle = enablesPixel ? '#fff5d6' : '#ffffff';
    ctx.font = '900 36px "Orbitron", "Arial Black", sans-serif';
    ctx.fillText(enablesPixel ? '★ PIXEL REALM · 79 ★' : '✦ HD REALITY · 01 ✦', 256, 52);

    ctx.shadowBlur = 6;
    ctx.fillStyle = enablesPixel ? '#00f5ff' : '#66ffcc';
    ctx.font = 'bold 17px monospace';
    ctx.fillText(enablesPixel ? '16-BIT DIMENSION GATEWAY  [ ENTER ]' : '3D OPTICAL RESTORE  [ EXIT ]', 256, 88);

    const badgeTex = new THREE.CanvasTexture(badgeCanvas);
    badgeTex.colorSpace = THREE.SRGBColorSpace;
    const badgeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(3.0, 0.84),
      new THREE.MeshBasicMaterial({ map: badgeTex, transparent: true, side: THREE.DoubleSide })
    );
    badgeMesh.position.set(0, frameHeight + 0.82, 0.35);
    doorGroup.add(badgeMesh);

    // Animated Hypnotic 1979 Pixel-Vortex & Data-Rain Energy Curtain (100% GPU Shader!)
    const curtainGeo = new THREE.PlaneGeometry(frameDepth - 0.12, frameHeight - 0.15);
    curtainGeo.rotateY(Math.PI / 2);
    const curtainMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSurge: { value: 0 },
        uColorA: { value: new THREE.Color(enablesPixel ? 0xb6ff3b : 0x00ffaa) },
        uColorB: { value: new THREE.Color(enablesPixel ? 0xff55b8 : 0x00e5ff) },
        uColorC: { value: new THREE.Color(enablesPixel ? 0xff7f2a : 0xffffff) },
        uIsPixelDoor: { value: enablesPixel ? 1.0 : 0.0 }
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
        uniform float uSurge;
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform vec3 uColorC;
        uniform float uIsPixelDoor;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 456.21));
          p += dot(p, p + 45.32);
          return fract(p.x * p.y);
        }

        void main() {
          vec2 uv = vUv;
          vec2 gridRes = vec2(14.0, 26.0);
          vec2 pUv = uIsPixelDoor > 0.5 ? (floor(uv * gridRes) + 0.5) / gridRes : uv;

          // 1. Swirling Concentric Dimensional Vortex
          vec2 centered = (pUv - 0.5) * vec2(1.0, 1.6);
          float dist = length(centered);
          float ang = atan(centered.y, centered.x);
          float swirl = sin(dist * 16.0 - uTime * (6.5 + uSurge * 12.0) + ang * 3.0) * 0.5 + 0.5;
          float rings = sin(dist * 24.0 - uTime * 9.0) * 0.5 + 0.5;

          // 2. Cascading Retro Pixel Data-Rain Blocks falling inside the doorway!
          vec2 rainCell = floor(uv * gridRes + vec2(0.0, uTime * 7.5));
          float rainSpark = step(0.84, hash21(rainCell)) * uIsPixelDoor;

          // 3. Soft Frame Edge Vignette + Bright Surge Pulse on Crossing!
          float edge = smoothstep(0.0, 0.14, uv.x) * smoothstep(1.0, 0.86, uv.x)
                     * smoothstep(0.0, 0.09, uv.y) * smoothstep(1.0, 0.91, uv.y);

          vec3 col = mix(uColorA, uColorB, swirl);
          col = mix(col, uColorC, pow(rings, 3.0) * 0.65 + rainSpark * 0.85 + uSurge * 0.75);

          float alpha = (0.30 + 0.36 * swirl + 0.28 * rainSpark + 0.45 * uSurge) * edge;
          gl_FragColor = vec4(col * (1.15 + uSurge * 1.4), alpha);
        }
      `
    });
    // Share ONE compiled GLSL program across all portal doors (zero duplicate shader compilation!)
    curtainMat.customProgramCacheKey = () => 'PixelDoorCurtainV1';
    const curtain = new THREE.Mesh(curtainGeo, curtainMat);
    curtain.position.set(0, frameHeight * 0.5, 0);
    curtain.renderOrder = 8;
    doorGroup.add(curtain);

    // Counter-Rotating Holographic Dimensional Portal Rings framing the doorway opening!
    const outerRingMat = new THREE.MeshBasicMaterial({
      color: enablesPixel ? 0xb6ff3b : 0x00ffaa,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const outerRing = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.035, 8, 24), outerRingMat);
    outerRing.position.set(0, frameHeight * 0.5, 0);
    outerRing.rotation.y = Math.PI / 2;
    doorGroup.add(outerRing);

    const innerRingMat = new THREE.MeshBasicMaterial({
      color: enablesPixel ? 0xff55b8 : 0x00e5ff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.028, 8, 6), innerRingMat); // Hexagonal retro-tech ring!
    innerRing.position.set(0, frameHeight * 0.5, 0);
    innerRing.rotation.y = Math.PI / 2;
    doorGroup.add(innerRing);

    // 8 Floating Orbiting 1979 Pixel Voxel Cubes dancing around the portal frame!
    const orbitCubes: THREE.Mesh[] = [];
    const cubeGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    const orangeMat = new THREE.MeshBasicMaterial({ color: 0xff7f2a });
    const limeMat = new THREE.MeshBasicMaterial({ color: 0xb6ff3b });
    const cubeMats = enablesPixel ? [limeMat, neonMat, orangeMat, accentMat] : [neonMat, accentMat];
    for (let i = 0; i < 8; i++) {
      const c = new THREE.Mesh(cubeGeo, cubeMats[i % cubeMats.length]);
      doorGroup.add(c);
      orbitCubes.push(c);
    }

    this.group.add(doorGroup);

    return {
      x,
      y,
      enablesPixel,
      group: doorGroup,
      curtainMat,
      outerRing,
      innerRing,
      orbitCubes,
      surgeTimer: 0,
      cooldown: 0
    };
  }

  public update(dt: number, totalTime: number, playerX: number, playerY: number) {
    if (!this.initializedPlayerX) {
      this.prevPlayerX = playerX;
      this.initializedPlayerX = true;
    }

    for (const door of this.doors) {
      if (door.cooldown > 0) {
        door.cooldown = Math.max(0, door.cooldown - dt);
      }

      if (door.surgeTimer > 0) {
        door.surgeTimer = Math.max(0, door.surgeTimer - dt * 2.2);
      }

      door.curtainMat.uniforms.uTime.value = totalTime;
      door.curtainMat.uniforms.uSurge.value = door.surgeTimer;

      // Counter-rotating dimensional rings spin into hyperdrive when crossed!
      const spinBoost = 1.0 + door.surgeTimer * 6.5;
      door.outerRing.rotation.x += dt * 1.4 * spinBoost;
      door.innerRing.rotation.x -= dt * 2.6 * spinBoost;
      const ringPulse = 1.0 + Math.sin(totalTime * 4.5 + door.x) * 0.06 + door.surgeTimer * 0.42;
      door.outerRing.scale.setScalar(ringPulse);
      door.innerRing.scale.setScalar(1.0 + Math.cos(totalTime * 6.0) * 0.08 + door.surgeTimer * 0.55);

      // Animate 8 orbiting 1979 pixel voxel cubes spiraling around the portal!
      for (let i = 0; i < door.orbitCubes.length; i++) {
        const ang = totalTime * (1.8 + door.surgeTimer * 5.0) + (i * Math.PI * 0.25);
        const radiusBoost = 1.0 + door.surgeTimer * 0.85;
        const cube = door.orbitCubes[i];
        cube.position.set(
          Math.cos(ang) * 0.45 * radiusBoost,
          1.75 + Math.sin(ang * 1.5 + i) * 1.45,
          Math.sin(ang) * 0.92 * radiusBoost
        );
        cube.rotation.set(totalTime * 2.2 + i, totalTime * 2.8, totalTime * 1.4);
        const cs = 0.8 + 0.35 * Math.sin(totalTime * 5.0 + i) + door.surgeTimer * 0.6;
        cube.scale.setScalar(cs);
      }

      // Check doorway crossing (works whether walking, running, sliding, or low-flying through!)
      const withinHeight = playerY >= door.y - 0.8 && playerY <= door.y + 3.8;
      if (door.cooldown <= 0 && withinHeight) {
        const crossedRight = this.prevPlayerX < door.x && playerX >= door.x;
        const crossedLeft = this.prevPlayerX > door.x && playerX <= door.x;

        if (crossedRight || crossedLeft) {
          const nextState = crossedRight ? door.enablesPixel : !door.enablesPixel;
          door.cooldown = 0.45;
          door.surgeTimer = 1.0; // Trigger hyperdrive portal ring & voxel burst!
          if (nextState !== this.isPixelModeActive) {
            this.isPixelModeActive = nextState;
            this.onPixelModeChange?.(nextState);
          }
        }
      }
    }

    this.prevPlayerX = playerX;
  }

  public reset(startPlayerX: number = 0) {
    this.prevPlayerX = startPlayerX;
    this.initializedPlayerX = true;
    this.isPixelModeActive = false;
    for (const d of this.doors) d.cooldown = 0;
  }
}
