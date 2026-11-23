import * as THREE from 'three';
import { GROUND_Y } from '../entities/Player';

export interface CarSurfaceSample {
  height: number;
  isCurb: boolean;
}

interface PhysicsCone {
  group: THREE.Group;
  homeX: number;
  homeZ: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  tipAngle: number;     // 0 = upright, PI/2 = lying flat on side
  tipVel: number;
  rollAngle: number;    // Axial roll while rolling on its side across asphalt/curbs/ramps
  spinVel: number;
  hitCooldown: number;
  isTipped: boolean;
}

/**
 * Level 3: Triple-AAA Arcade Car Proving Ground & Drift Testing Arena
 * - Spacious 220m x 220m matte asphalt tarmac (receives sharp real-time PCFSoftShadowMap car shadows!)
 * - Painted concentric Skidpad Drift Rings (for donuts, figure-8s & sweeping power-slides!)
 * - Raised Red & White FIA Curbs with physical height & tactile suspension rumble collisions
 * - 2 Stunt/Testing Ramps:
 *     1. Stunt Launch Ramp (x = 0, z = 40..54, height = 3.0m) for huge airtime jumps!
 *     2. Tabletop Speed Ramp (x = 0, z = -56..-26, height = 2.4m) for climbing, cresting & landing!
 * - 15 Physics-Driven Traffic Cones that launch, tumble, bounce & settle realistically when hit!
 */
export class Level3CarArena {
  public group: THREE.Group;
  public readonly arenaLimit: number = 96.0;

  // Ramp & Curb Geometry Constants (shared between visuals & exact analytical physics!)
  private readonly curbX = 7.5;
  private readonly curbHalfW = 0.42;
  private readonly curbMinZ = -25.4;
  private readonly curbMaxZ = 34.4;
  private readonly curbHeight = 0.15;

  // Ramp 1: Stunt Launch Ramp (climbs along +Z from z=40 to z=54)
  private readonly r1HalfW = 4.2;
  private readonly r1StartZ = 40.0;
  private readonly r1EndZ = 54.0;
  private readonly r1Height = 3.0;

  // Ramp 2: Tabletop Speed Ramp (z = -26 down to -56)
  private readonly r2HalfW = 4.4;
  private readonly r2EntryZ = -26.0;
  private readonly r2TopStartZ = -36.0;
  private readonly r2TopEndZ = -46.0;
  private readonly r2ExitZ = -56.0;
  private readonly r2Height = 2.4;

  private cones: PhysicsCone[] = [];
  private readonly _surfOut: CarSurfaceSample = { height: GROUND_Y, isCurb: false };
  private readonly _carResOut = { x: 0, z: 0, hitWall: false, normalX: 0, normalZ: 0 };

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    this.group.name = 'Level3CarTestingGround';
    this.group.visible = false;
    scene.add(this.group);

    this.buildAsphaltGround();
    this.buildDriftSkidpadRings();
    this.buildStraightawayAndCurbs();
    this.buildTestingRamps();
    this.buildPhysicsTrafficCones();
    this.buildPerimeterWalls();
  }

  public setVisible(visible: boolean) {
    this.group.visible = visible;
  }

  public resetCones() {
    for (const c of this.cones) {
      c.pos.set(c.homeX, GROUND_Y + 0.34, c.homeZ);
      c.vel.set(0, 0, 0);
      c.yaw = 0;
      c.tipAngle = 0;
      c.tipVel = 0;
      c.rollAngle = 0;
      c.spinVel = 0;
      c.hitCooldown = 0;
      c.isTipped = false;
      c.group.position.copy(c.pos);
      c.group.rotation.order = 'YXZ';
      c.group.rotation.set(0, 0, 0);
    }
  }

  private createAsphaltTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#525864';
    ctx.fillRect(0, 0, 512, 512);

    for (let i = 0; i < 6500; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const v = 66 + Math.floor(Math.random() * 34);
      ctx.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
      ctx.fillRect(x, y, 2, 2);
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 510, 510);
    ctx.beginPath();
    ctx.moveTo(256, 0); ctx.lineTo(256, 512);
    ctx.moveTo(0, 256); ctx.lineTo(512, 256);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(36, 36);
    tex.anisotropy = 4;
    return tex;
  }

  private createRampDeckTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#38404e';
    ctx.fillRect(0, 0, 256, 512);

    // Side safety stripes
    ctx.fillStyle = '#ff9e22';
    ctx.fillRect(0, 0, 18, 512);
    ctx.fillRect(238, 0, 18, 512);

    // Glowing yellow-white launch chevrons
    ctx.strokeStyle = '#ffd233';
    ctx.lineWidth = 14;
    for (let y = 60; y < 480; y += 95) {
      ctx.beginPath();
      ctx.moveTo(48, y + 42);
      ctx.lineTo(128, y);
      ctx.lineTo(208, y + 42);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  private buildAsphaltGround() {
    const tex = this.createAsphaltTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.92,
      metalness: 0.04,
      envMapIntensity: 0.14
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), mat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, GROUND_Y, 0);
    floor.receiveShadow = true;
    this.group.add(floor);
  }

  private buildDriftSkidpadRings() {
    const ringMatWhite = new THREE.MeshBasicMaterial({ color: 0xeaf2ff, transparent: true, opacity: 0.72, depthWrite: false });
    const ringMatAmber = new THREE.MeshBasicMaterial({ color: 0xff9e33, transparent: true, opacity: 0.80, depthWrite: false });

    const padCenters = [
      { x: -26, z: 28 },
      { x: 26, z: 28 },
      { x: 34, z: -26 }
    ];

    for (const c of padCenters) {
      for (const r of [10, 16, 22]) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.18, r + 0.18, 64), r === 16 ? ringMatAmber : ringMatWhite);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(c.x, GROUND_Y + 0.012, c.z);
        this.group.add(ring);
      }
    }
  }

  private buildStraightawayAndCurbs() {
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
    const dashGeo = new THREE.PlaneGeometry(0.32, 4.2);
    for (let z = -22; z <= 36; z += 9) {
      const dash = new THREE.Mesh(dashGeo, dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(0, GROUND_Y + 0.012, z);
      this.group.add(dash);
    }

    // Raised FIA Red & White Side Curbs (height = 0.15m, physically collided by wheels!)
    const redMat = new THREE.MeshStandardMaterial({ color: 0xe62e2e, roughness: 0.72 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf4f7fa, roughness: 0.72 });
    const curbGeo = new THREE.BoxGeometry(this.curbHalfW * 2, this.curbHeight, 2.85);

    for (const sideX of [-this.curbX, this.curbX]) {
      for (let i = 0; i < 20; i++) {
        const curb = new THREE.Mesh(curbGeo, i % 2 === 0 ? redMat : whiteMat);
        curb.position.set(sideX, GROUND_Y + this.curbHeight * 0.5, -24 + i * 3.0);
        curb.castShadow = true;
        curb.receiveShadow = true;
        this.group.add(curb);
      }
    }
  }

  private buildTestingRamps() {
    const deckTex = this.createRampDeckTexture();
    const deckMat = new THREE.MeshStandardMaterial({
      map: deckTex,
      roughness: 0.80,
      metalness: 0.10,
      envMapIntensity: 0.18
    });
    const sideMat = new THREE.MeshStandardMaterial({
      color: 0x2a313d,
      roughness: 0.75,
      metalness: 0.25
    });

    // --- RAMP 1: STUNT LAUNCH RAMP (x = 0, z = 40..54, height = 3.0m) ---
    const r1Len = this.r1EndZ - this.r1StartZ;
    const r1Shape = new THREE.Shape();
    r1Shape.moveTo(0, 0);
    r1Shape.lineTo(r1Len, 0);
    r1Shape.lineTo(r1Len, this.r1Height);
    r1Shape.closePath();

    const r1Extrude = new THREE.ExtrudeGeometry(r1Shape, {
      depth: this.r1HalfW * 2,
      bevelEnabled: false
    });
    // Extrude is in XY with depth along +Z; rotateY(-PI/2) maps +X -> +Z and +Z -> -X
    r1Extrude.translate(0, 0, -this.r1HalfW);
    r1Extrude.rotateY(-Math.PI / 2);
    const r1Body = new THREE.Mesh(r1Extrude, sideMat);
    r1Body.position.set(0, GROUND_Y, this.r1StartZ);
    r1Body.castShadow = true;
    r1Body.receiveShadow = true;
    this.group.add(r1Body);

    // Top chevron deck plane on Ramp 1
    const r1Hyp = Math.hypot(r1Len, this.r1Height);
    const r1Angle = Math.atan2(this.r1Height, r1Len);
    const r1Deck = new THREE.Mesh(new THREE.PlaneGeometry(this.r1HalfW * 2 - 0.04, r1Hyp), deckMat);
    r1Deck.rotation.x = -Math.PI / 2 - r1Angle;
    r1Deck.position.set(0, GROUND_Y + this.r1Height * 0.5 + 0.015, this.r1StartZ + r1Len * 0.5);
    r1Deck.receiveShadow = true;
    this.group.add(r1Deck);

    // --- RAMP 2: TABLETOP SPEED RAMP (x = 0, z = -26..-56, height = 2.4m) ---
    const r2Shape = new THREE.Shape();
    r2Shape.moveTo(0, 0);
    r2Shape.lineTo(10, this.r2Height);
    r2Shape.lineTo(20, this.r2Height);
    r2Shape.lineTo(30, 0);
    r2Shape.closePath();

    const r2Extrude = new THREE.ExtrudeGeometry(r2Shape, {
      depth: this.r2HalfW * 2,
      bevelEnabled: false
    });
    // RotateY(+PI/2) maps +X -> -Z
    r2Extrude.translate(0, 0, -this.r2HalfW);
    r2Extrude.rotateY(Math.PI / 2);
    const r2Body = new THREE.Mesh(r2Extrude, sideMat);
    r2Body.position.set(0, GROUND_Y, this.r2EntryZ);
    r2Body.castShadow = true;
    r2Body.receiveShadow = true;
    this.group.add(r2Body);

    // Tabletop flat deck surface
    const r2Top = new THREE.Mesh(new THREE.PlaneGeometry(this.r2HalfW * 2 - 0.04, 10.0), deckMat);
    r2Top.rotation.x = -Math.PI / 2;
    r2Top.position.set(0, GROUND_Y + this.r2Height + 0.015, -41.0);
    r2Top.receiveShadow = true;
    this.group.add(r2Top);
  }

  private buildPhysicsTrafficCones() {
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff5511, roughness: 0.42, metalness: 0.12 });
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x1e222a, roughness: 0.82 });
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

    const baseGeo = new THREE.BoxGeometry(0.68, 0.08, 0.68);
    const coneGeo = new THREE.ConeGeometry(0.30, 1.05, 12);
    const bandGeo = new THREE.CylinderGeometry(0.145, 0.20, 0.18, 12);

    // 3 drift-pad apex cones + 12 slalom & straightaway test cones!
    const conePositions: [number, number][] = [
      [-26, 28], [26, 28], [34, -26],
      [-5.2, 12], [5.2, 12],
      [-5.2, 22], [5.2, 22],
      [-14, 6], [-18, 16], [-14, 26],
      [14, 6], [18, 16], [14, 26],
      [-4.2, -14], [4.2, -14]
    ];

    for (const [cx, cz] of conePositions) {
      // Pivot at exact center of mass (0.34m above ground) so tipping/tumbling NEVER clips through the asphalt!
      const g = new THREE.Group();
      g.rotation.order = 'YXZ';
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = -0.30;
      base.castShadow = true;
      g.add(base);

      const body = new THREE.Mesh(coneGeo, coneMat);
      body.position.y = 0.22;
      body.castShadow = true;
      g.add(body);

      const band = new THREE.Mesh(bandGeo, stripeMat);
      band.position.y = 0.34;
      g.add(band);

      g.position.set(cx, GROUND_Y + 0.34, cz);
      this.group.add(g);

      this.cones.push({
        group: g,
        homeX: cx,
        homeZ: cz,
        pos: new THREE.Vector3(cx, GROUND_Y + 0.34, cz),
        vel: new THREE.Vector3(),
        yaw: 0,
        tipAngle: 0,
        tipVel: 0,
        rollAngle: 0,
        spinVel: 0,
        hitCooldown: 0,
        isTipped: false
      });
    }
  }

  /**
   * Triple-AAA 4-Corner Oriented-Hull Ramp Side-Wall & Back-Wall Collision Solver (Zero-GC!):
   * Checks ALL 4 bumper corners of the car's real 2.30m x 5.25m hull against both ramps' solid walls
   * so the front hood/bumpers NEVER clip into or get wedged on the side of a ramp!
   */
  public resolveCarHorizontal(
    prevX: number,
    prevY: number,
    prevZ: number,
    nextX: number,
    nextZ: number,
    heading: number = 0
  ): { x: number; z: number; hitWall: boolean; normalX: number; normalZ: number } {
    let x = nextX;
    let z = nextZ;
    let hitWall = false;
    let normalX = 0;
    let normalZ = 0;
    const maxStepH = 0.42;

    const fwdX = Math.sin(heading);
    const fwdZ = Math.cos(heading);
    const rightX = Math.cos(heading);
    const rightZ = -Math.sin(heading);

    // 4 real bumper corners + 2 mid-flank points of the 2.30m x 5.25m car hull
    const hullPts = [
      [ 1.18,  2.62],
      [-1.18,  2.62],
      [ 1.18, -2.62],
      [-1.18, -2.62],
      [ 1.18,  0.00],
      [-1.18,  0.00]
    ];

    // 1. Ramp 1 Solid Side Walls (x = ±4.2) & Solid Back Drop Wall (z = 54.0)
    // ONLY collide as a solid wall if the car's center was OUTSIDE the ramp on the previous frame!
    // If the car is centered in the ramp lane approaching the open front entry, let it climb freely!
    const prevOutsideR1Side = Math.abs(prevX) >= this.r1HalfW - 0.10;
    const prevBehindR1Back = prevZ >= this.r1EndZ - 0.10;
    if (prevOutsideR1Side || prevBehindR1Back) {
      for (let p = 0; p < hullPts.length; p++) {
        const cx = x + rightX * hullPts[p][0] + fwdX * hullPts[p][1];
        const cz = z + rightZ * hullPts[p][0] + fwdZ * hullPts[p][1];

        if (Math.abs(cx) < this.r1HalfW && cz > this.r1StartZ + 0.15 && cz < this.r1EndZ) {
          const r1SurfH = GROUND_Y + ((cz - this.r1StartZ) / (this.r1EndZ - this.r1StartZ)) * this.r1Height;
          if (r1SurfH > prevY + maxStepH) {
            if (prevBehindR1Back && !prevOutsideR1Side) {
              const pushZ = this.r1EndZ - cz + 0.03;
              z += pushZ;
              normalZ = 1;
              hitWall = true;
            } else if (prevOutsideR1Side) {
              const sideSign = Math.sign(prevX || cx || 1);
              const pushX = sideSign * (this.r1HalfW + 0.03) - cx;
              x += pushX;
              normalX = sideSign;
              hitWall = true;
            }
          }
        }
      }
    }

    // 2. Ramp 2 Solid Side Walls (x = ±4.4, z = -56..-26) — open on BOTH front & rear ramp entries!
    const prevOutsideR2Side = Math.abs(prevX) >= this.r2HalfW - 0.10;
    if (prevOutsideR2Side) {
      for (let p = 0; p < hullPts.length; p++) {
        const cx = x + rightX * hullPts[p][0] + fwdX * hullPts[p][1];
        const cz = z + rightZ * hullPts[p][0] + fwdZ * hullPts[p][1];

        if (Math.abs(cx) < this.r2HalfW && cz < this.r2EntryZ - 0.15 && cz > this.r2ExitZ + 0.15) {
          let r2SurfH = GROUND_Y + this.r2Height;
          if (cz > this.r2TopStartZ) {
            r2SurfH = GROUND_Y + ((this.r2EntryZ - cz) / (this.r2EntryZ - this.r2TopStartZ)) * this.r2Height;
          } else if (cz < this.r2TopEndZ) {
            r2SurfH = GROUND_Y + ((cz - this.r2ExitZ) / (this.r2TopEndZ - this.r2ExitZ)) * this.r2Height;
          }
          if (r2SurfH > prevY + maxStepH) {
            const sideSign = Math.sign(prevX || cx || 1);
            const pushX = sideSign * (this.r2HalfW + 0.03) - cx;
            x += pushX;
            normalX = sideSign;
            hitWall = true;
          }
        }
      }
    }

    this._carResOut.x = x;
    this._carResOut.z = z;
    this._carResOut.hitWall = hitWall;
    this._carResOut.normalX = normalX;
    this._carResOut.normalZ = normalZ;
    return this._carResOut;
  }

  /**
   * Exact Analytical Surface Height + Curb Flag (Zero-GC!)
   * Used by all 4 car wheels for realistic curb reactions & ramp climbing/jumping!
   */
  public getSurfaceInfo(x: number, z: number): CarSurfaceSample {
    const out = this._surfOut;
    out.height = GROUND_Y;
    out.isCurb = false;

    // 1. Raised Red & White FIA Curbs (x = ±7.5, z = -25.4..34.4)
    if (z >= this.curbMinZ && z <= this.curbMaxZ) {
      const distL = Math.abs(x + this.curbX);
      const distR = Math.abs(x - this.curbX);
      if (distL <= this.curbHalfW || distR <= this.curbHalfW) {
        out.height = GROUND_Y + this.curbHeight;
        out.isCurb = true;
        return out;
      }
    }

    // 2. Ramp 1: Stunt Launch Ramp (x = -4.2..+4.2, z = 40..54)
    if (Math.abs(x) <= this.r1HalfW && z >= this.r1StartZ && z <= this.r1EndZ) {
      const t = (z - this.r1StartZ) / (this.r1EndZ - this.r1StartZ);
      out.height = GROUND_Y + t * this.r1Height;
      return out;
    }

    // 3. Ramp 2: Tabletop Speed Ramp (x = -4.4..+4.4, z = -56..-26)
    if (Math.abs(x) <= this.r2HalfW && z <= this.r2EntryZ && z >= this.r2ExitZ) {
      if (z > this.r2TopStartZ) {
        const t = (this.r2EntryZ - z) / (this.r2EntryZ - this.r2TopStartZ);
        out.height = GROUND_Y + t * this.r2Height;
      } else if (z >= this.r2TopEndZ) {
        out.height = GROUND_Y + this.r2Height;
      } else {
        const t = (z - this.r2ExitZ) / (this.r2TopEndZ - this.r2ExitZ);
        out.height = GROUND_Y + t * this.r2Height;
      }
      return out;
    }

    return out;
  }

  /**
   * 3D Rigid-Body Traffic Cone Physics & Car Impact Solver!
   * Cones launch, spin end-over-end, bounce off the tarmac, and settle realistically when hit by the car.
   */
  public updateCones(
    dt: number,
    carX: number,
    carY: number,
    carZ: number,
    carHeading: number,
    carVelX: number,
    carVelZ: number,
    onConeHit?: (impactSpeed: number) => void
  ) {
    const safeDt = Math.min(dt, 0.05);
    const cosH = Math.cos(carHeading);
    const sinH = Math.sin(carHeading);
    const carSpeed = Math.hypot(carVelX, carVelZ);
    // Car half-extents (width ~2.3m -> halfW 1.25m, length ~5.25m -> halfL 2.7m)
    const carHalfW = 1.28;
    const carHalfL = 2.72;

    for (const c of this.cones) {
      if (c.hitCooldown > 0) c.hitCooldown = Math.max(0, c.hitCooldown - safeDt);

      // Oriented bounding-box collision check in car-local space!
      const relX = c.pos.x - carX;
      const relZ = c.pos.z - carZ;
      const localX = relX * cosH - relZ * sinH;
      const localZ = relX * sinH + relZ * cosH;

      const coneR = 0.36;
      const hitVert = Math.abs((c.pos.y - 0.34) - carY) < 1.35;
      if (hitVert && Math.abs(localX) < carHalfW + coneR && Math.abs(localZ) < carHalfL + coneR && c.hitCooldown <= 0) {
        const dist = Math.max(0.15, Math.hypot(relX, relZ));
        const nx = relX / dist;
        const nz = relZ / dist;
        const kick = Math.max(5.5, carSpeed * 1.08);

        c.vel.x = carVelX * 0.78 + nx * (kick * 0.42);
        c.vel.z = carVelZ * 0.78 + nz * (kick * 0.42);
        c.vel.y = THREE.MathUtils.clamp(2.8 + carSpeed * 0.18, 2.8, 8.5);
        // Align cone yaw along its launch direction and give it a clean physical tip-over impulse!
        c.yaw = Math.atan2(c.vel.x, c.vel.z);
        c.tipVel = THREE.MathUtils.clamp(4.5 + carSpeed * 0.22, 4.5, 9.5);
        c.spinVel = (Math.random() - 0.5) * 4.0;
        c.isTipped = true;
        c.hitCooldown = 0.18;
        onConeHit?.(carSpeed);
      }

      // Integrate clean center-of-mass 3D flight, single-axis tip-over & ground bounces (ZERO ground penetration!)
      const moving = c.vel.lengthSq() > 0.004 || c.pos.y > GROUND_Y + 0.36 || Math.abs(c.tipVel) > 0.02 || Math.abs(c.spinVel) > 0.02;
      if (!moving) continue;

      c.vel.y -= 24.0 * safeDt;
      c.pos.addScaledVector(c.vel, safeDt);
      c.yaw += c.spinVel * safeDt;
      c.tipAngle += c.tipVel * safeDt;

      // Sample surface at cone center AND both ends along its tipped axis so it NEVER intersects curbs or ramps!
      const axisX = Math.sin(c.yaw) * Math.sin(c.tipAngle);
      const axisZ = Math.cos(c.yaw) * Math.sin(c.tipAngle);
      const hCenter = this.getSurfaceInfo(c.pos.x, c.pos.z).height;
      const hEndA = this.getSurfaceInfo(c.pos.x + axisX * 0.42, c.pos.z + axisZ * 0.42).height;
      const hEndB = this.getSurfaceInfo(c.pos.x - axisX * 0.42, c.pos.z - axisZ * 0.42).height;
      const surfH = Math.max(hCenter, hEndA, hEndB);

      // Exact non-intersecting vertical clearance accounting for the 0.68m square base diagonal while rolling!
      const flatFactor = Math.abs(Math.sin(c.tipAngle));
      const baseCornerExtra = Math.abs(Math.sin(c.rollAngle * 2.0)) * 0.08 * flatFactor;
      const minCenterY = surfH + THREE.MathUtils.lerp(0.35, 0.35 + baseCornerExtra, flatFactor);

      if (c.pos.y <= minCenterY) {
        c.pos.y = minCenterY;
        if (Math.abs(c.vel.y) > 1.5) {
          c.vel.y = -c.vel.y * 0.34;
          c.vel.x *= 0.72;
          c.vel.z *= 0.72;
          c.tipVel *= 0.55;
          c.spinVel *= 0.55;
        } else {
          c.vel.y = 0;
          c.vel.x *= Math.max(0, 1.0 - safeDt * 4.2);
          c.vel.z *= Math.max(0, 1.0 - safeDt * 4.2);
          c.spinVel *= Math.max(0, 1.0 - safeDt * 5.8);
          // Smooth natural axial rolling on its side across asphalt, curbs & ramps!
          if (c.isTipped) {
            c.tipVel *= Math.max(0, 1.0 - safeDt * 8.0);
            const targetFlat = Math.PI * 0.5;
            c.tipAngle = THREE.MathUtils.lerp(c.tipAngle, targetFlat, Math.min(1, safeDt * 9.0));
            const horizSpd = Math.hypot(c.vel.x, c.vel.z);
            if (horizSpd > 0.15) {
              // Roll around cone's long axis proportional to ground travel speed
              const crossRoll = c.vel.x * Math.cos(c.yaw) - c.vel.z * Math.sin(c.yaw);
              c.rollAngle += (crossRoll / 0.34) * safeDt;
            } else {
              // Gently settle square base flat on one of its 4 faces (multiples of PI/2)
              const nearestFace = Math.round(c.rollAngle / (Math.PI * 0.5)) * (Math.PI * 0.5);
              c.rollAngle = THREE.MathUtils.lerp(c.rollAngle, nearestFace, Math.min(1, safeDt * 8.0));
            }
          }
        }
      }

      // Keep inside arena walls
      if (Math.abs(c.pos.x) > this.arenaLimit) {
        c.pos.x = Math.sign(c.pos.x) * this.arenaLimit;
        c.vel.x *= -0.45;
      }
      if (Math.abs(c.pos.z) > this.arenaLimit) {
        c.pos.z = Math.sign(c.pos.z) * this.arenaLimit;
        c.vel.z *= -0.45;
      }

      c.group.position.copy(c.pos);
      c.group.rotation.set(c.tipAngle, c.yaw, c.rollAngle);
    }
  }

  private buildPerimeterWalls() {
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x262c36, roughness: 0.65, metalness: 0.35 });
    const accentMat = new THREE.MeshBasicMaterial({ color: 0xff8822 });
    const span = 200;
    const h = 2.2;
    const thick = 1.6;

    const specs = [
      { x: 0, z: -100, w: span, d: thick },
      { x: 0, z: 100, w: span, d: thick },
      { x: -100, z: 0, w: thick, d: span },
      { x: 100, z: 0, w: thick, d: span }
    ];

    for (const s of specs) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(s.w, h, s.d), wallMat);
      wall.position.set(s.x, GROUND_Y + h * 0.5, s.z);
      wall.receiveShadow = true;
      this.group.add(wall);

      const stripe = new THREE.Mesh(new THREE.BoxGeometry(s.w > 10 ? s.w : s.w + 0.1, 0.16, s.d > 10 ? s.d : s.d + 0.1), accentMat);
      stripe.position.set(s.x, GROUND_Y + h - 0.35, s.z);
      this.group.add(stripe);
    }
  }
}
