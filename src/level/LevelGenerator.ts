import * as THREE from 'three';
import { ObstacleManager } from './Obstacles';

export class LevelGenerator {
  private obstacleManager: ObstacleManager;
  private scene?: THREE.Scene;
  public currentLevel: number = 1;
  public readonly level1EndX: number = 120;
  private level1FinishGate: THREE.Group | null = null;
  private nextSpawnX: number = 22;
  private spawnInterval: number = 22; // Generous spacious rhythm between all scene elements!

  constructor(obstacleManager: ObstacleManager, scene?: THREE.Scene) {
    this.obstacleManager = obstacleManager;
    this.scene = scene;
    if (scene) {
      this.level1FinishGate = this.buildLevel1FinishGate();
      this.level1FinishGate.position.set(this.level1EndX, -3.70, 0);
      scene.add(this.level1FinishGate);
    }
  }

  public setFinishGateVisible(visible: boolean) {
    if (this.level1FinishGate) this.level1FinishGate.visible = visible && this.currentLevel === 1;
  }

  private buildLevel1FinishGate(): THREE.Group {
    const g = new THREE.Group();
    g.name = 'Level1FinishGate';

    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe6eff8, metalness: 0.9, roughness: 0.16 });
    const brownMat = new THREE.MeshStandardMaterial({ color: 0x5c3622, metalness: 0.35, roughness: 0.45 });
    const limeGlow = new THREE.MeshBasicMaterial({ color: 0xa6ff38 });
    const orangeGlow = new THREE.MeshBasicMaterial({ color: 0xff7f2a });

    const h = 4.6;
    const d = 2.6;
    for (const zo of [-d * 0.5, d * 0.5]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.42, h, 0.42), chromeMat);
      pillar.position.set(0, h * 0.5, zo);
      g.add(pillar);

      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.46, h - 0.5, 0.12), limeGlow);
      stripe.position.set(0, h * 0.5, zo);
      g.add(stripe);

      const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.8), brownMat);
      base.position.set(0, 0.15, zo);
      g.add(base);
    }

    const header = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.55, d + 0.8), chromeMat);
    header.position.set(0, h + 0.25, 0);
    g.add(header);

    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.16, d + 0.6), orangeGlow);
    beam.position.set(0, h + 0.25, 0);
    g.add(beam);

    // Glowing Finish Signboard ("SECTOR 1 FINISH -> LEVEL 2")
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#140c16';
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#a6ff38';
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, 500, 116);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#a6ff38';
    ctx.font = 'bold 34px monospace';
    ctx.fillText('★ LEVEL 1 FINISH ★', 256, 46);
    ctx.fillStyle = '#ff9e44';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('ENTER GATE → LEVEL 2 (3D FREE ROAM)', 256, 88);

    const signTex = new THREE.CanvasTexture(canvas);
    signTex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.8, 0.95),
      new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide })
    );
    sign.position.set(0, h + 1.15, 0.2);
    g.add(sign);

    // Translucent golden-lime finish energy curtain
    const curtain = new THREE.Mesh(
      new THREE.PlaneGeometry(d - 0.2, h - 0.2),
      new THREE.MeshBasicMaterial({
        color: 0xa6ff38,
        transparent: true,
        opacity: 0.24,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    curtain.rotation.y = Math.PI / 2;
    curtain.position.set(0, h * 0.5, 0);
    g.add(curtain);

    return g;
  }

  public setLevel(lvl: number) {
    this.currentLevel = lvl;
    this.reset();
  }

  public reset(startX: number = 0) {
    this.obstacleManager.clear();
    this.nextSpawnX = startX + 22;
    if (this.level1FinishGate) {
      this.level1FinishGate.visible = this.currentLevel === 1;
    }

    if (this.currentLevel === 2 || this.currentLevel === 3) {
      // Level 2 = 3D Free-Roam Sandbox; Level 3 = Arcade Drift Car Testing Ground — no legacy 2D obstacles!
      return;
    }

    if (this.currentLevel === 1) {
      // ----------------------------------------------------
      // LEVEL 1: INDUSTRIAL COMPLEX (Spacious layout; Door 1 at x=14.0 kept 100% clear!)
      // ----------------------------------------------------
      // Initial training catwalk platform (x = 4 to 9.5 — well clear of Door 1 at x = 14.0!)
      this.obstacleManager.spawnPlatform(6.8, -1.8, 5.2, 0.5);
      this.spawnCoinLine(5.0, -0.8, 3);
      this.obstacleManager.spawnFuelPickup(9.2, -0.6);

      // High Sky Fuel Canister to reward early vertical exploration!
      this.obstacleManager.spawnFuelPickup(14.0, 6.8);
      this.obstacleManager.spawnFuelPickup(19.0, 12.0);

      // Interactive Physics Supply Crates (well spaced)
      this.obstacleManager.spawnCrate(3.2, -3.2);
      this.obstacleManager.spawnCrate(7.2, -1.3);

      // Tactical Modern Cover Barrier placed cleanly past Door 1 (x = 20.5)
      this.obstacleManager.spawnCoverBarrier(20.5, -3.70);

      // Hyper-Ion Jetpack Upgrade placed in open airspace past Door 1
      this.obstacleManager.spawnHyperJetpackPickup(24.0, 0.6);
    } else if (this.currentLevel === 2) {
      // ----------------------------------------------------
      // LEVEL 2: PLANET XYLOS - BIOLUMINESCENT ALIEN PLANET
      // ----------------------------------------------------
      // Early Metallic Retro Jetpack Upgrade Pickup!
      this.obstacleManager.spawnHyperJetpackPickup(3.5, -1.8);

      // Floating Alien Crystal Platform
      this.obstacleManager.spawnPlatform(15.0, -1.2, 5.5, 0.5);
      this.spawnCoinLine(13.5, -0.2, 3);
      this.obstacleManager.spawnFuelPickup(17.5, 0.2);

      // Modern Cover Barrier in open ground (clear of any platforms)
      this.obstacleManager.spawnCoverBarrier(20.0, -3.70);

      // HIGH-ALTITUDE ALIEN SKY MAZE: Lethal Bio-Plasma Walls & Rich Collectibles!
      this.obstacleManager.spawnSkyMaze(23.0, 4.5);
    } else {
      // ----------------------------------------------------
      // LEVEL 3: DESOLATE MARS (2.5D SIDESCROLLER)
      // ----------------------------------------------------
      // Initial Mars Outpost landing pad & catwalk skyway
      this.obstacleManager.spawnPlatform(6.0, -1.8, 6.5, 0.5);
      this.obstacleManager.spawnFuelPickup(8.5, -0.6);
      this.spawnCoinLine(5.0, -0.6, 3);

      // Early Metallic Retro Jetpack Upgrade Pickup on elevated canyon ledge!
      this.obstacleManager.spawnHyperJetpackPickup(11.0, 1.2);
      this.obstacleManager.spawnPlatform(11.0, 0.8, 4.5, 0.5);

      // High Sky Fuel Canister over canyon chasm
      this.obstacleManager.spawnFuelPickup(14.0, 7.5);
      this.obstacleManager.spawnCoverBarrier(15.0, -3.70);

      // Supply Crate
      this.obstacleManager.spawnCrate(7.0, -1.3);
    }

    // Pre-generate the entire finite Level 1 (0..120m) ONCE at level load so ZERO elements
    // ever pop in, shift, or teleport while the player is playing Level 1!
    if (this.currentLevel === 1) {
      this.update(this.level1EndX);
    }
  }

  public update(playerX: number) {
    // Level 2 (3D Free-Roam) & Level 3 (Arcade Car Testing Ground) use dedicated arenas
    if (this.currentLevel === 2 || this.currentLevel === 3) return;

    const maxSpawnX = this.currentLevel === 1 ? (this.level1EndX - 14) : Infinity;
    while (this.nextSpawnX < playerX + 65 && this.nextSpawnX <= maxSpawnX) {
      // Keep the opening 0..48m runway clean of enemies so player can test movement & Pixel Portals first!
      const allowEnemies = this.nextSpawnX >= 48;
      const origSpawnDrone = this.obstacleManager.spawnDrone.bind(this.obstacleManager);
      const origSpawnSentinel = this.obstacleManager.spawnAlienCyberSentinel.bind(this.obstacleManager);
      if (!allowEnemies) {
        (this.obstacleManager as any).spawnDrone = () => null;
        (this.obstacleManager as any).spawnAlienCyberSentinel = () => null;
      }

      if (this.currentLevel === 1) {
        this.generateChunkLevel1(this.nextSpawnX);
      } else if (this.currentLevel === 2) {
        this.generateChunkLevel2(this.nextSpawnX);
      } else {
        this.generateChunkLevel3(this.nextSpawnX);
      }

      if (!allowEnemies) {
        (this.obstacleManager as any).spawnDrone = origSpawnDrone;
        (this.obstacleManager as any).spawnAlienCyberSentinel = origSpawnSentinel;
      } else if (Math.floor(this.nextSpawnX / this.spawnInterval) % 2 === 0) {
        // Spawn our Next-Gen Translucent Sliding Acid-Lime Slime Blob on the ground runway further down!
        this.obstacleManager.spawnEnemyBlob(this.nextSpawnX + 4.5, -3.70, 5.5);
      }
      this.nextSpawnX += this.spawnInterval;
    }
  }

  // --------------------------------------------------------
  // LEVEL 1: INDUSTRIAL COMPLEX GENERATOR (100% Deterministic Fixed Layout!)
  // --------------------------------------------------------
  private generateChunkLevel1(x: number) {
    // Fixed handcrafted pattern order so Level 1 is ALWAYS identical on boot, retry & level switch!
    const fixedOrder = [0, 1, 2, 4, 3];
    const chunkIdx = Math.max(0, Math.round((x - 22) / this.spawnInterval));
    const pattern = fixedOrder[chunkIdx % fixedOrder.length];

    switch (pattern) {
      case 0:
        // MANDATORY FLIGHT ZONE: High-Voltage Laser Barrier Forcefield Gate!
        this.obstacleManager.spawnCoverBarrier(x - 4.5, -3.70);
        this.obstacleManager.spawnLaserGate(x + 2, -3.70);
        this.obstacleManager.spawnFuelPickup(x + 2, 2.2);
        this.obstacleManager.spawnFuelPickup(x + 2, 8.5);
        this.spawnCoinLine(x - 2, 0.8, 4);
        this.obstacleManager.spawnPlatform(x + 7.0, -1.2, 5.0, 0.5);
        this.obstacleManager.spawnDrone(x + 7.0, 1.2, 3.5);
        break;

      case 1:
        // STRATEGIC MECHANICAL PRESS: Slams to ground floor
        this.obstacleManager.spawnCoverBarrier(x - 3.5, -3.70);
        this.obstacleManager.spawnPiston(x, -3.70);
        this.obstacleManager.spawnCoinPickup(x, -3.20);
        this.obstacleManager.spawnCoinPickup(x - 1.2, -3.20);
        this.obstacleManager.spawnCoinPickup(x + 1.2, -3.20);
        this.obstacleManager.spawnCrate(x + 3.0, -3.2);
        this.obstacleManager.spawnFuelPickup(x + 4.5, -3.20);
        this.obstacleManager.spawnDrone(x - 3.5, 0.9, 3.5);
        break;

      case 2:
        // HIGH-ALTITUDE SKY FLIGHT GAUNTLET & SKY FUEL CHAIN
        this.spawnSkyFuelChain(x + 1, 4.5, 4, 6.0);
        this.spawnCoinLine(x - 1, 14.0, 3);
        this.spawnCoinLine(x + 2, 25.0, 3);
        this.obstacleManager.spawnDrone(x, 7.5, 4.5);
        this.obstacleManager.spawnDrone(x + 4, 18.0, 5.0);
        this.obstacleManager.spawnPlatform(x + 2, -1.8, 6.0, 0.5);
        this.obstacleManager.spawnDrone(x + 2, 0.8, 3.5);
        break;

      case 3:
        // ELEVATED STEPPED RUNWAY + SKY COLLECTIBLES (Spike circles removed per user request!)
        this.obstacleManager.spawnPlatform(x - 2, -1.6, 4.8, 0.5);
        this.obstacleManager.spawnPlatform(x + 3.5, 0.6, 5.2, 0.5);
        this.spawnCoinLine(x - 3.0, -0.6, 3);
        this.spawnCoinLine(x + 2.0, 1.5, 3);
        this.obstacleManager.spawnFuelPickup(x + 3.5, 2.8);
        this.obstacleManager.spawnFuelPickup(x + 3.5, 8.5);
        this.obstacleManager.spawnDrone(x + 3.5, 3.6, 3.5);
        break;

      case 4:
        // STRATEGIC ELEVATED PLATFORM PRESS
        // Cover barrier placed well before the platform out in the open
        this.obstacleManager.spawnCoverBarrier(x - 5.5, -3.70);
        this.obstacleManager.spawnPlatform(x, -1.2, 6.0, 0.5);
        this.obstacleManager.spawnCrate(x - 2.0, -0.7);
        this.obstacleManager.spawnPiston(x + 0.8, -0.95);
        this.obstacleManager.spawnCoinPickup(x + 0.8, -0.45);
        this.obstacleManager.spawnFuelPickup(x + 2.8, -0.45);
        this.obstacleManager.spawnDrone(x - 3.0, 1.2, 3.5);
        this.spawnCoinLine(x - 2, 1.0, 3);
        break;

      case 5:
        // MANDATORY FLIGHT ZONE: Laser Gate with Aerial Attack Drone Patrol
        this.obstacleManager.spawnCoverBarrier(x - 3.5, -3.70);
        this.obstacleManager.spawnLaserGate(x, -3.70);
        this.obstacleManager.spawnDrone(x, 2.8, 4.0);
        this.obstacleManager.spawnFuelPickup(x, 4.2);
        this.obstacleManager.spawnFuelPickup(x + 3, 11.0);
        this.obstacleManager.spawnPlatform(x + 6, 0.2, 5.0, 0.5);
        this.obstacleManager.spawnCrate(x + 7.5, 0.7);
        this.spawnCoinLine(x + 4, 1.2, 3);
        break;

      case 6:
        // DESTRUCTIBLE PLASMA TUBE + DUAL ELEVATED RUNWAYS
        this.obstacleManager.spawnPlatform(x - 2, -0.8, 5.5, 0.5);
        this.obstacleManager.spawnPlasmaTube(x - 2, 0.9);
        this.obstacleManager.spawnPlatform(x + 4, 1.5, 5.0, 0.5);
        this.obstacleManager.spawnCrate(x + 3.2, 2.0);
        this.obstacleManager.spawnDrone(x + 4, 3.2, 3.5);
        this.obstacleManager.spawnFuelPickup(x + 4, 3.0);
        this.obstacleManager.spawnFuelPickup(x + 1, 15.0);
        this.spawnCoinLine(x - 2, -3.2, 3);
        break;

      case 7:
      default:
        // STRATOSPHERE ROCKET LAUNCH CHUTE
        this.obstacleManager.spawnCoverBarrier(x - 6.0, -3.70);
        this.obstacleManager.spawnLaserGate(x + 3, -3.70);
        this.spawnSkyFuelChain(x + 3, 3.2, 5, 7.0);
        this.obstacleManager.spawnPlatform(x - 1, -1.5, 5.0, 0.5);
        this.obstacleManager.spawnDrone(x - 1, 0.8, 3.0);
        this.obstacleManager.spawnCrate(x - 0.5, -1.0);
        this.spawnCoinLine(x + 1, 20.0, 4);
        break;
    }
  }

  // --------------------------------------------------------
  // LEVEL 2: ALIEN PLANET GENERATOR (PLANET XYLOS)
  // --------------------------------------------------------
  private generateChunkLevel2(x: number) {
    const pattern = Math.floor(Math.random() * 6);

    switch (pattern) {
      case 0:
        // ALIEN CYBER SENTINEL PATROL MEADOW
        this.obstacleManager.spawnCoverBarrier(x - 4.5, -3.70);
        this.obstacleManager.spawnFuelPickup(x + 0.5, -3.20);
        this.obstacleManager.spawnPlatform(x + 7.0, -1.0, 5.5, 0.5);
        this.obstacleManager.spawnAlienCyberSentinel(x + 8.2, -0.75); // Cyber Sentinel guarding platform
        this.obstacleManager.spawnDrone(x + 6.0, 1.8, 4.0, true);
        this.spawnCoinLine(x + 5.5, 0.2, 3);
        break;

      case 1:
        // MANDATORY ALIEN FLIGHT CHASM: High-Voltage Bio-Barrier requires Jetpack flight!
        this.obstacleManager.spawnCoverBarrier(x - 4.0, -3.70);
        this.obstacleManager.spawnLaserGate(x, -3.70); // Energy barrier across ground
        this.obstacleManager.spawnAlienCyberSentinel(x - 2.0, -3.70);
        this.obstacleManager.spawnFuelPickup(x, 2.5); // Mid-air fuel refill
        this.obstacleManager.spawnFuelPickup(x + 4.5, 5.0); // Flight step
        this.obstacleManager.spawnFuelPickup(x + 9.0, 2.5); // Landing approach fuel
        this.spawnCoinLine(x + 1, 3.5, 5);
        this.obstacleManager.spawnDrone(x + 4.5, 3.2, 4.5, true); // Alien Drifter patrolling flight corridor
        this.obstacleManager.spawnPlatform(x + 11.0, -0.6, 5.0, 0.5);
        break;

      case 2:
        // METALLIC RETRO JETPACK UPGRADE PEDESTAL & CYBER STALKERS
        this.obstacleManager.spawnCoverBarrier(x - 4.5, -3.70);
        this.obstacleManager.spawnHyperJetpackPickup(x, -1.2); // Snazzy upgrade pickup!
        this.obstacleManager.spawnAlienCyberSentinel(x + 7.5, -3.70);
        this.obstacleManager.spawnDrone(x + 2.0, 2.8, 4.0, true);
        this.spawnCoinLine(x - 2.0, 0.5, 4);
        break;

      case 3:
        // ELEVATED ALIEN PLATFORMS & CYBER SENTINEL PATROL
        this.obstacleManager.spawnPlatform(x + 1.0, 0.5, 6.0, 0.5);
        this.obstacleManager.spawnAlienCyberSentinel(x + 1.0, 0.75);
        this.obstacleManager.spawnFuelPickup(x + 1.0, 2.8);
        this.obstacleManager.spawnFuelPickup(x + 1.0, 9.5);
        this.obstacleManager.spawnDrone(x + 1.0, 2.2, 3.5, true);
        this.spawnCoinLine(x - 1.5, -0.5, 4);
        break;

      case 4:
        // ALIEN BIO-PLASMA SKY MAZE & HIGH-ALTITUDE GAUNTLET
        // Ground cover barrier and platform approach
        this.obstacleManager.spawnCoverBarrier(x - 5.0, -3.70);
        this.obstacleManager.spawnAlienCyberSentinel(x - 2.0, -3.70);
        this.obstacleManager.spawnPlatform(x + 1.0, -1.2, 5.0, 0.5);
        this.obstacleManager.spawnFuelPickup(x - 1.0, 0.8);
        this.obstacleManager.spawnFuelPickup(x + 1.0, 2.8);
        // The lethal Sky Maze: player dies if he touches any wall of the maze!
        this.obstacleManager.spawnSkyMaze(x + 3.0, 4.5);
        break;

      case 5:
      default:
        // TACTICAL ALIEN COMBAT RUNWAY
        this.obstacleManager.spawnCoverBarrier(x - 3.5, -3.70);
        this.obstacleManager.spawnDrone(x + 1.0, 1.5, 4.0, true);
        this.obstacleManager.spawnDrone(x + 5.5, 2.5, 4.0, true);
        this.obstacleManager.spawnCrate(x + 2.0, -3.2);
        this.obstacleManager.spawnAlienCyberSentinel(x + 7.5, -3.70);
        this.obstacleManager.spawnFuelPickup(x + 4.0, -3.2);
        this.spawnCoinLine(x, -3.2, 3);
        break;
    }
  }

  // --------------------------------------------------------
  // LEVEL 3: DESOLATE MARS (2.5D SIDESCROLLER)
  // --------------------------------------------------------
  private generateChunkLevel3(x: number) {
    const pattern = Math.floor(Math.random() * 6);

    switch (pattern) {
      case 0:
        // MARTIAN OUTPOST RIDGE & CYBER SENTINEL PATROL
        this.obstacleManager.spawnCoverBarrier(x - 4.5, -3.70);
        this.obstacleManager.spawnPlatform(x + 1.0, -1.2, 6.0, 0.5);
        this.obstacleManager.spawnAlienCyberSentinel(x + 1.5, -0.95);
        this.obstacleManager.spawnDrone(x + 1.0, 2.5, 4.0, true);
        this.obstacleManager.spawnFuelPickup(x + 3.5, 0.5);
        this.obstacleManager.spawnCrate(x - 1.0, -0.7);
        this.spawnCoinLine(x - 2.5, -3.2, 3);
        this.obstacleManager.spawnFuelPickup(x + 6.0, 8.0);
        break;

      case 1:
        // CANYON CHASM & HIGH-VOLTAGE LASER BARRIER
        this.obstacleManager.spawnCoverBarrier(x - 4.0, -3.70);
        this.obstacleManager.spawnLaserGate(x, -3.70);
        this.obstacleManager.spawnAlienCyberSentinel(x - 2.0, -3.70);
        this.obstacleManager.spawnFuelPickup(x, 2.5);
        this.obstacleManager.spawnFuelPickup(x + 4.5, 6.0);
        this.obstacleManager.spawnFuelPickup(x + 8.5, 2.8);
        this.obstacleManager.spawnDrone(x + 4.5, 3.8, 4.5, true);
        this.spawnCoinLine(x + 1.5, 4.0, 4);
        this.obstacleManager.spawnPlatform(x + 10.0, -0.5, 5.0, 0.5);
        break;

      case 2:
        // HEAVY MARTIAN HYDRAULIC PISTON & RECON RUN
        this.obstacleManager.spawnCoverBarrier(x - 4.0, -3.70);
        this.obstacleManager.spawnPiston(x, -3.70);
        this.obstacleManager.spawnCrate(x + 3.0, -3.2);
        this.obstacleManager.spawnCoinPickup(x - 1.2, -3.2);
        this.obstacleManager.spawnCoinPickup(x + 1.2, -3.2);
        this.obstacleManager.spawnFuelPickup(x + 4.5, -3.2);
        this.obstacleManager.spawnDrone(x - 2.0, 1.8, 3.5, true);
        this.obstacleManager.spawnPlatform(x + 8.0, 0.8, 5.0, 0.5);
        this.obstacleManager.spawnFuelPickup(x + 8.0, 2.2);
        break;

      case 3:
        // HIGH-ALTITUDE MARTIAN SKY MAZE & GRAV ROTORS
        this.obstacleManager.spawnGear(x - 2.0, -2.5, 2.0, -1.2);
        this.obstacleManager.spawnGear(x + 4.0, -2.5, 2.0, 1.2);
        this.obstacleManager.spawnPlatform(x + 1.0, 1.0, 5.5, 0.5);
        this.obstacleManager.spawnFuelPickup(x + 1.0, 2.5);
        this.obstacleManager.spawnSkyMaze(x + 4.0, 4.5);
        this.spawnCoinLine(x - 1.0, 2.0, 3);
        break;

      case 4:
        // HYPER JETPACK RETRO UPGRADE & CANYON CATWALKS
        this.obstacleManager.spawnCoverBarrier(x - 4.5, -3.70);
        this.obstacleManager.spawnPlatform(x, -0.8, 5.5, 0.5);
        this.obstacleManager.spawnHyperJetpackPickup(x, 0.5);
        this.obstacleManager.spawnAlienCyberSentinel(x + 6.0, -3.70);
        this.obstacleManager.spawnDrone(x + 2.0, 2.6, 4.0, true);
        this.spawnCoinLine(x - 2.0, -0.2, 4);
        this.obstacleManager.spawnPlatform(x + 8.0, 1.8, 5.0, 0.5);
        this.obstacleManager.spawnFuelPickup(x + 8.0, 3.2);
        break;

      case 5:
      default:
        // TACTICAL MARTIAN COMBAT RUNWAY & PLASMA TUBE
        this.obstacleManager.spawnCoverBarrier(x - 3.5, -3.70);
        this.obstacleManager.spawnPlasmaTube(x - 1.0, -2.5);
        this.obstacleManager.spawnLaserGate(x + 4.5, -3.70);
        this.obstacleManager.spawnDrone(x + 1.5, 2.0, 4.0, true);
        this.obstacleManager.spawnAlienCyberSentinel(x + 8.5, -3.70);
        this.spawnSkyFuelChain(x + 4.5, 2.5, 4, 6.0);
        this.spawnCoinLine(x + 1.0, -3.2, 3);
        this.obstacleManager.spawnPlatform(x + 11.0, -1.0, 5.0, 0.5);
        break;
    }
  }

  private spawnCoinLine(startX: number, y: number, count: number) {
    for (let i = 0; i < count; i++) {
      this.obstacleManager.spawnCoinPickup(startX + i * 1.2, y);
    }
  }

  private spawnSkyFuelChain(x: number, startY: number, count: number, stepY: number) {
    for (let i = 0; i < count; i++) {
      this.obstacleManager.spawnFuelPickup(x, startY + i * stepY);
    }
  }
}
