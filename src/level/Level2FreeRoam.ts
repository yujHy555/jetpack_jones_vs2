import * as THREE from 'three';
import { GROUND_Y } from '../entities/Player';

export interface Level2SurfaceInfo {
  height: number;
  slopeAngleX: number; // Radians: dy/dx slope inclination (+PI/6 on 30° uphill ramp!)
  slopeAngleZ: number; // Radians: dy/dz slope inclination
  conveyorVx: number;  // Belt carry velocity along X
  conveyorVz: number;  // Belt carry velocity along Z
}

/**
 * Level 2: Next-Gen 3D Free-Roam Stage (Ready for upcoming custom 3D models & scenes!)
 * - Flat plane tiled with crisp Blue & White sci-fi platform tiles
 * - Animated Moving Conveyor Belt at player start (x = -2..12, z = -1.6..1.6)
 * - Exact 30° Test Ramp (x = 16..22, z = -2.6..2.6) + Elevated Landing Deck (x = 22..28)
 *   using the exact same Blue & White platform tiles for Next-Gen slope foot alignment!
 */
export class Level2FreeRoam {
  public readonly group: THREE.Group;
  private conveyorTex!: THREE.CanvasTexture;
  private blueWhiteTileTex!: THREE.CanvasTexture;
  private rollers: THREE.Mesh[] = [];

  // Exact Conveyor & 30° Ramp Geometry Bounds
  private readonly convMinX = -2.0;
  private readonly convMaxX = 12.0;
  private readonly convHalfZ = 1.6;
  private readonly convHeight = 0.14;
  private readonly convSpeed = 6.8; // Brisk, high-energy conveyor speed!

  private readonly rampStartX = 16.0;
  private readonly rampEndX = 22.0;
  private readonly rampHalfZ = 2.6;
  private readonly rampAngleRad = Math.PI / 6; // Exact 30 degrees!
  private readonly rampTopHeight = 6.0 * Math.tan(Math.PI / 6); // 3.4641m
  private readonly deckEndX = 28.0;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    this.group.name = 'Level2FreeRoamStage';
    this.group.visible = false;
    scene.add(this.group);

    this.blueWhiteTileTex = this.createBlueWhitePlatformTileTexture();
    this.buildFlatFloorPlane();
    this.buildStartConveyorBelt();
    this.build30DegreeTestRamp();
  }

  public setVisible(visible: boolean) {
    this.group.visible = visible;
  }

  /**
   * Generates crisp Blue & White industrial platform tiles matching the Level 1 platform tile style
   */
  private createBlueWhitePlatformTileTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Clean bright white base plate
    ctx.fillStyle = '#f2f7ff';
    ctx.fillRect(0, 0, 256, 256);

    // Subtle brushed panel interior highlight
    ctx.fillStyle = '#e2eeff';
    ctx.fillRect(10, 10, 236, 236);

    // Bold Triple-AAA Cobalt Blue outer border & diagonal tech corner accents
    ctx.strokeStyle = '#1f6fe5';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, 246, 246);

    // Inner blue grid cross-seam
    ctx.strokeStyle = '#3b8aff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(128, 12);
    ctx.lineTo(128, 244);
    ctx.moveTo(12, 128);
    ctx.lineTo(244, 128);
    ctx.stroke();

    // Blue corner locking squares + white rivets
    const corners = [
      [14, 14], [214, 14], [14, 214], [214, 214]
    ];
    for (const [cx, cy] of corners) {
      ctx.fillStyle = '#1f6fe5';
      ctx.fillRect(cx, cy, 28, 28);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx + 14, cy + 14, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Center blue tech diamond pip
    ctx.fillStyle = '#2574e8';
    ctx.beginPath();
    ctx.moveTo(128, 112);
    ctx.lineTo(144, 128);
    ctx.lineTo(128, 144);
    ctx.lineTo(112, 128);
    ctx.closePath();
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    return tex;
  }

  private buildFlatFloorPlane() {
    const floorTex = this.blueWhiteTileTex.clone();
    floorTex.needsUpdate = true;
    floorTex.repeat.set(70, 70); // Crisp 2m x 2m blue & white platform tiles across 140m x 140m plane

    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.94, // Matte non-reflective architectural tiles so cast shadows pop cleanly!
      metalness: 0.02,
      envMapIntensity: 0.10
    });
    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(14, GROUND_Y, 0);
    floorMesh.receiveShadow = true;
    this.group.add(floorMesh);
  }

  private buildStartConveyorBelt() {
    const beltLength = this.convMaxX - this.convMinX;
    const beltWidth = this.convHalfZ * 2;
    const centerX = (this.convMinX + this.convMaxX) * 0.5;

    // Animated Directional Chevron Conveyor Belt Texture
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#1b2434';
    ctx.fillRect(0, 0, 256, 128);
    // Belt tread slats
    ctx.fillStyle = '#26344a';
    for (let x = 0; x < 256; x += 32) {
      ctx.fillRect(x, 4, 18, 120);
    }
    // Glowing cyan-blue forward chevrons
    ctx.strokeStyle = '#38d2ff';
    ctx.lineWidth = 8;
    for (let x = 24; x < 256; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 22);
      ctx.lineTo(x + 26, 64);
      ctx.lineTo(x, 106);
      ctx.stroke();
    }
    // Crisp white edge trim lines
    ctx.fillStyle = '#eef6ff';
    ctx.fillRect(0, 0, 256, 8);
    ctx.fillRect(0, 120, 256, 8);

    this.conveyorTex = new THREE.CanvasTexture(canvas);
    this.conveyorTex.colorSpace = THREE.SRGBColorSpace;
    this.conveyorTex.wrapS = THREE.RepeatWrapping;
    this.conveyorTex.wrapT = THREE.RepeatWrapping;
    this.conveyorTex.repeat.set(6, 1);

    const beltMat = new THREE.MeshStandardMaterial({
      map: this.conveyorTex,
      roughness: 0.85,
      metalness: 0.08,
      envMapIntensity: 0.25
    });
    const beltMesh = new THREE.Mesh(
      new THREE.BoxGeometry(beltLength, this.convHeight, beltWidth),
      beltMat
    );
    beltMesh.position.set(centerX, GROUND_Y + this.convHeight * 0.5, 0);
    beltMesh.receiveShadow = true;
    this.group.add(beltMesh);

    // Flush Blue & White Metallic Side Guard Rails (top strictly at GROUND_Y + 0.14 -> ZERO boot intersection!)
    const railMat = new THREE.MeshStandardMaterial({ color: 0x1f6fe5, roughness: 0.55, metalness: 0.35, envMapIntensity: 0.3 });
    const railGeo = new THREE.BoxGeometry(beltLength + 0.24, this.convHeight, 0.14);
    for (const sz of [-this.convHalfZ - 0.07, this.convHalfZ + 0.07]) {
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.position.set(centerX, GROUND_Y + this.convHeight * 0.5, sz);
      rail.receiveShadow = true;
      this.group.add(rail);
    }

    // Flush Rotating Chrome End Rollers (radius = 0.07 -> top strictly at GROUND_Y + 0.14, ZERO intersection!)
    const rollerMat = new THREE.MeshStandardMaterial({ color: 0xdce8f8, metalness: 0.78, roughness: 0.28 });
    const rollerGeo = new THREE.CylinderGeometry(0.068, 0.068, beltWidth + 0.08, 14);
    rollerGeo.rotateX(Math.PI / 2);
    for (const rx of [this.convMinX - 0.06, this.convMaxX + 0.06]) {
      const roller = new THREE.Mesh(rollerGeo, rollerMat);
      roller.position.set(rx, GROUND_Y + 0.068, 0);
      this.group.add(roller);
      this.rollers.push(roller);
    }
  }

  private build30DegreeTestRamp() {
    const run = this.rampEndX - this.rampStartX; // 6.0m
    const rise = this.rampTopHeight;             // 3.4641m
    const width = this.rampHalfZ * 2;            // 5.2m
    const hyp = Math.hypot(run, rise);           // 6.9282m

    // Build exact solid wedge + Blue & White platform-tiled top ramp surface!
    const rampTex = this.blueWhiteTileTex.clone();
    rampTex.needsUpdate = true;
    rampTex.repeat.set(3.5, 2.6);

    const rampTopMat = new THREE.MeshStandardMaterial({
      map: rampTex,
      roughness: 0.90,
      metalness: 0.02,
      envMapIntensity: 0.22
    });
    const sideMat = new THREE.MeshStandardMaterial({
      color: 0x1e5ec4,
      roughness: 0.82,
      metalness: 0.06,
      envMapIntensity: 0.25
    });

    // Solid triangular wedge base underneath the ramp (inset cleanly below the slab & clear of deckBlock = ZERO Z-fighting!)
    const slabThickness = 0.08;
    const insetRise = Math.max(0.1, rise - 0.10);
    const insetRun = run - 0.04;
    const wedgeShape = new THREE.Shape();
    wedgeShape.moveTo(0.08, 0);
    wedgeShape.lineTo(insetRun, 0);
    wedgeShape.lineTo(insetRun, insetRise);
    wedgeShape.closePath();

    const wedgeGeo = new THREE.ExtrudeGeometry(wedgeShape, {
      depth: width - 0.06,
      bevelEnabled: false
    });
    wedgeGeo.translate(this.rampStartX, GROUND_Y + 0.005, -(this.rampHalfZ - 0.03));
    const wedgeMesh = new THREE.Mesh(wedgeGeo, sideMat);
    this.group.add(wedgeMesh);

    // Blue & White Platform-Tiled Inclined Ramp Surface flush along the exact 30° plane
    const rampSlab = new THREE.Mesh(
      new THREE.BoxGeometry(hyp, slabThickness, width + 0.04),
      rampTopMat
    );
    const midX = (this.rampStartX + this.rampEndX) * 0.5;
    const midY = GROUND_Y + rise * 0.5;
    const nx = -Math.sin(this.rampAngleRad);
    const ny = Math.cos(this.rampAngleRad);
    rampSlab.position.set(
      midX - nx * (slabThickness * 0.5),
      midY - ny * (slabThickness * 0.5),
      0
    );
    rampSlab.rotation.z = this.rampAngleRad;
    rampSlab.receiveShadow = true;
    this.group.add(rampSlab);

    // Elevated Flat Blue & White Landing Deck at top of the 30° ramp (x = 22.02..28.0 — zero overlap with ramp!)
    const deckLen = this.deckEndX - this.rampEndX - 0.02;
    const deckTex = this.blueWhiteTileTex.clone();
    deckTex.needsUpdate = true;
    deckTex.repeat.set(3.0, 2.6);
    const deckMat = new THREE.MeshStandardMaterial({
      map: deckTex,
      roughness: 0.90,
      metalness: 0.02,
      envMapIntensity: 0.22
    });
    const deckBlock = new THREE.Mesh(
      new THREE.BoxGeometry(deckLen, rise, width),
      [sideMat, sideMat, deckMat, sideMat, sideMat, sideMat]
    );
    deckBlock.position.set(this.rampEndX + 0.02 + deckLen * 0.5, GROUND_Y + rise * 0.5 + 0.002, 0);
    deckBlock.receiveShadow = true;
    this.group.add(deckBlock);
  }

  /**
   * Super-Tight 3D Wall & Step-Up Collision Resolver for Conveyor Belt, 30° Ramp & Elevated Landing Block!
   * - Prevents side/back wall teleportation onto the ramp or block (solid walls if surfaceH > prevY + 0.42m!)
   * - Allows smooth entry at the front foot of the 30° ramp (x = 16.0), smooth conveyor step-up (0.14m),
   *   and clean landings from above!
   */
  public resolveHorizontalAndSurface(
    prevX: number,
    prevY: number,
    prevZ: number,
    nextX: number,
    nextZ: number,
    playerRadius: number = 0.34
  ): { x: number; z: number; surface: Level2SurfaceInfo } {
    let x = nextX;
    let z = nextZ;
    const maxStepUp = 0.42;

    // 1. Solid Side & Back Wall Check for the 30° Ramp + Elevated Landing Block (x = 16..28, |z| <= 2.6)
    const minX = this.rampStartX - playerRadius;
    const maxX = this.deckEndX + playerRadius;
    const maxAbsZ = this.rampHalfZ + playerRadius;

    if (x > minX && x < maxX && Math.abs(z) < maxAbsZ) {
      // Compute exact top surface height at the proposed (x, z) inside the ramp+deck footprint
      const clampedX = THREE.MathUtils.clamp(x, this.rampStartX, this.deckEndX);
      const surfAtNext = clampedX <= this.rampEndX
        ? GROUND_Y + ((clampedX - this.rampStartX) / (this.rampEndX - this.rampStartX)) * this.rampTopHeight
        : GROUND_Y + this.rampTopHeight;

      // If the surface is higher than Jones can step up (> prevY + 0.42m), block entry as a SOLID WALL!
      if (surfAtNext > prevY + maxStepUp) {
        const wasOutsideZ = Math.abs(prevZ) >= maxAbsZ - 0.02;
        const wasOutsideBackX = prevX >= maxX - 0.02;
        if (wasOutsideZ) {
          z = Math.sign(prevZ || z || 1) * maxAbsZ;
        } else if (wasOutsideBackX) {
          x = maxX;
        } else {
          // Push out along whichever wall is closest
          const distToBack = Math.abs(maxX - x);
          const distToSide = Math.abs(maxAbsZ - Math.abs(z));
          if (distToSide <= distToBack) {
            z = Math.sign(z || 1) * maxAbsZ;
          } else {
            x = maxX;
          }
        }
      }
    }

    // 2. Compute exact surface at the resolved (x, z), accounting for player footprint radius on conveyor & ramp!
    const surface = this.getSurfaceInfo(x, z, playerRadius);
    return { x, z, surface };
  }

  private readonly _surfOut: Level2SurfaceInfo = { height: GROUND_Y, slopeAngleX: 0, slopeAngleZ: 0, conveyorVx: 0, conveyorVz: 0 };
  private readonly _rayOut = { x: 0, y: 0, z: 0, surfaceHeight: GROUND_Y };
  private readonly _camOut = { x: 0, y: 0, z: 0 };
  private readonly _flyOut = { x: 0, y: 0, z: 0, surfaceHeight: GROUND_Y };

  /**
   * Exact analytical surface height, 30° slope angle, and conveyor belt velocity at any world (x, z) — Zero-GC!
   */
  public getSurfaceInfo(x: number, z: number, pad: number = 0.22): Level2SurfaceInfo {
    const out = this._surfOut;
    // 1. Moving Conveyor Belt at start (x = -2..12, z = -1.6..1.6) — padded tightly so boots NEVER sink into edges!
    if (x >= this.convMinX - pad && x <= this.convMaxX + pad && Math.abs(z) <= this.convHalfZ + pad * 0.6) {
      out.height = GROUND_Y + this.convHeight;
      out.slopeAngleX = 0;
      out.slopeAngleZ = 0;
      out.conveyorVx = this.convSpeed;
      out.conveyorVz = 0;
      return out;
    }

    // 2. Exact 30° Test Ramp (x = 16..22, z = -2.6..2.6)
    if (x >= this.rampStartX && x <= this.rampEndX && Math.abs(z) <= this.rampHalfZ + pad * 0.4) {
      const t = (x - this.rampStartX) / (this.rampEndX - this.rampStartX);
      out.height = GROUND_Y + t * this.rampTopHeight;
      out.slopeAngleX = this.rampAngleRad;
      out.slopeAngleZ = 0;
      out.conveyorVx = 0;
      out.conveyorVz = 0;
      return out;
    }

    // 3. Elevated Landing Deck at top of the 30° Ramp (x = 22..28, z = -2.6..2.6)
    if (x > this.rampEndX && x <= this.deckEndX + pad * 0.4 && Math.abs(z) <= this.rampHalfZ + pad * 0.4) {
      out.height = GROUND_Y + this.rampTopHeight;
      out.slopeAngleX = 0;
      out.slopeAngleZ = 0;
      out.conveyorVx = 0;
      out.conveyorVz = 0;
      return out;
    }

    // 4. Flat Blue & White Platform Tile Floor
    out.height = GROUND_Y;
    out.slopeAngleX = 0;
    out.slopeAngleZ = 0;
    out.conveyorVx = 0;
    out.conveyorVz = 0;
    return out;
  }

  /**
   * Full-Body 3D Collision Solver for Flying Enemies (Helmet Dome + Pods + 1.78m Dangling Tentacles!):
   * Guarantees NO part of a drone can ever clip into the 30° ramp, elevated landing deck, conveyor belt, or floor!
   */
  public resolveFlyingEntity(
    prevX: number,
    prevY: number,
    prevZ: number,
    nextX: number,
    nextY: number,
    nextZ: number,
    radius: number = 0.78,
    bottomClearance: number = 1.88
  ): { x: number; y: number; z: number; surfaceHeight: number } {
    let x = nextX;
    let y = nextY;
    let z = nextZ;

    // 1. Check solid side & back walls of the 30° Ramp + Elevated Landing Deck block (x: 16..28, z: -2.6..2.6)
    const minX = this.rampStartX - radius;
    const maxX = this.deckEndX + radius;
    const maxAbsZ = this.rampHalfZ + radius;

    if (x > minX && x < maxX && Math.abs(z) < maxAbsZ) {
      const clampedX = THREE.MathUtils.clamp(x, this.rampStartX, this.deckEndX);
      const blockTopAtX = clampedX <= this.rampEndX
        ? GROUND_Y + ((clampedX - this.rampStartX) / (this.rampEndX - this.rampStartX)) * this.rampTopHeight
        : GROUND_Y + this.rampTopHeight;

      const droneBottom = y - bottomClearance;
      // If drone's tentacles/body are below the solid ramp/deck surface:
      if (droneBottom < blockTopAtX) {
        const wasOutsideZ = Math.abs(prevZ) >= maxAbsZ - 0.05;
        const wasOutsideBackX = prevX >= maxX - 0.05;
        const blockTooHighToGlideOver = (blockTopAtX - droneBottom) > 1.35;
        if (wasOutsideZ && blockTooHighToGlideOver) {
          // Deflect cleanly around the solid side wall of the ramp/deck!
          z = Math.sign(prevZ || z || 1) * maxAbsZ;
        } else if (wasOutsideBackX && blockTooHighToGlideOver) {
          // Deflect cleanly off the solid back wall of the elevated deck!
          x = maxX;
        } else {
          // Smoothly lift entire drone + tentacles above the 30° ramp / deck surface!
          y = blockTopAtX + bottomClearance;
        }
      }
    }

    // 2. Final full-footprint surface clearance check (Floor, Conveyor, 30° Ramp, Elevated Deck)
    const surf = this.getSurfaceInfo(x, z, radius);
    const minAllowedY = surf.height + bottomClearance;
    if (y < minAllowedY) {
      y = minAllowedY;
    }

    this._flyOut.x = x;
    this._flyOut.y = y;
    this._flyOut.z = z;
    this._flyOut.surfaceHeight = surf.height;
    return this._flyOut;
  }

  /**
   * Swept 3D Segment Surface Raycast for Fast Lasers/Bullets (Zero-GC!):
   * Samples along prev -> cur so fast bolts NEVER tunnel through the 30° ramp, landing deck, conveyor, or floor!
   */
  public raycastSurfaceHit(
    prevX: number,
    prevY: number,
    prevZ: number,
    curX: number,
    curY: number,
    curZ: number
  ): { x: number; y: number; z: number; surfaceHeight: number } | null {
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sx = prevX + (curX - prevX) * t;
      const sy = prevY + (curY - prevY) * t;
      const sz = prevZ + (curZ - prevZ) * t;
      const surf = this.getSurfaceInfo(sx, sz, 0.08);
      if (sy <= surf.height + 0.08) {
        this._rayOut.x = sx;
        this._rayOut.y = Math.max(sy, surf.height + 0.04);
        this._rayOut.z = sz;
        this._rayOut.surfaceHeight = surf.height;
        return this._rayOut;
      }
    }
    return null;
  }

  /**
   * 3rd-Person Camera Anti-Clipping Solver:
   * Traces from Jones's shoulder pivot to the desired camera position and smoothly pulls
   * the camera forward/upward so it NEVER clips through the 30° ramp, landing deck, conveyor, or floor!
   */
  public resolveCameraPosition(
    pivotX: number,
    pivotY: number,
    pivotZ: number,
    desiredX: number,
    desiredY: number,
    desiredZ: number
  ): { x: number; y: number; z: number } {
    const steps = 16;
    const minClearance = 0.58;
    let bestT = 1.0;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sx = pivotX + (desiredX - pivotX) * t;
      const sy = pivotY + (desiredY - pivotY) * t;
      const sz = pivotZ + (desiredZ - pivotZ) * t;
      const surf = this.getSurfaceInfo(sx, sz, 0.38);
      if (sy < surf.height + minClearance) {
        // Pull camera slightly in front of the intersected ramp/deck/floor
        bestT = Math.max(0.22, (i - 1) / steps);
        break;
      }
    }

    const rx = pivotX + (desiredX - pivotX) * bestT;
    let ry = pivotY + (desiredY - pivotY) * bestT;
    const rz = pivotZ + (desiredZ - pivotZ) * bestT;

    const finalSurf = this.getSurfaceInfo(rx, rz, 0.38);
    if (ry < finalSurf.height + minClearance) {
      ry = finalSurf.height + minClearance;
    }
    this._camOut.x = rx;
    this._camOut.y = ry;
    this._camOut.z = rz;
    return this._camOut;
  }

  public update(dt: number) {
    if (!this.group.visible) return;
    if (this.conveyorTex) {
      this.conveyorTex.offset.x -= dt * 2.25;
    }
    for (const r of this.rollers) {
      r.rotation.z -= dt * 15.0;
    }
  }
}
