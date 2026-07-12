/**
 * Pooled visual effects: impact rings, spark bursts, and the landing
 * marker shown after a point. Everything is preallocated — the update
 * loop performs no allocations.
 */

import * as THREE from 'three';
import { clamp } from '../util/math';

const RING_POOL = 14;
const SPARK_POOL = 80;

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  grow: number;
}

interface Spark {
  active: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
}

export class Effects {
  group = new THREE.Group();
  private rings: Ring[] = [];
  private sparks: Spark[] = [];
  private sparkMesh: THREE.InstancedMesh;
  private landMarker: THREE.Mesh;
  private landLife = 0;
  private dummy = new THREE.Object3D();
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  /** Master intensity (visual preset / reduced-motion can scale this). */
  intensity = 1;

  constructor() {
    const ringGeo = new THREE.RingGeometry(0.35, 0.5, 26);
    this.disposables.push(ringGeo);
    for (let i = 0; i < RING_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      this.disposables.push(mat);
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ mesh, life: 0, maxLife: 0.4, grow: 3 });
    }

    const sparkGeo = new THREE.SphereGeometry(0.07, 6, 4);
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xfff0b8 });
    this.disposables.push(sparkGeo, sparkMat);
    this.sparkMesh = new THREE.InstancedMesh(sparkGeo, sparkMat, SPARK_POOL);
    this.sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparkMesh.frustumCulled = false;
    this.group.add(this.sparkMesh);
    for (let i = 0; i < SPARK_POOL; i++) {
      this.sparks.push({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0 });
    }

    const lmGeo = new THREE.RingGeometry(0.5, 0.85, 32);
    const lmMat = new THREE.MeshBasicMaterial({
      color: 0xffd75e,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.disposables.push(lmGeo, lmMat);
    this.landMarker = new THREE.Mesh(lmGeo, lmMat);
    this.landMarker.rotation.x = -Math.PI / 2;
    this.landMarker.visible = false;
    this.group.add(this.landMarker);
  }

  /** Expanding ring at an impact point. strength 0..1. */
  ring(x: number, y: number, strength: number, color = 0xffffff): void {
    if (this.intensity <= 0) return;
    const r = this.rings.find((r) => r.life <= 0);
    if (!r) return;
    r.life = r.maxLife = 0.28 + strength * 0.22;
    r.grow = 2.5 + strength * 5;
    r.mesh.position.set(x, y, 0.3);
    r.mesh.scale.setScalar(0.4 + strength * 0.4);
    r.mesh.visible = true;
    const m = r.mesh.material as THREE.MeshBasicMaterial;
    m.color.setHex(color);
    m.opacity = 0.5 + strength * 0.4;
  }

  /** Burst of sparks. count scaled by intensity. */
  burst(x: number, y: number, strength: number): void {
    const count = Math.floor((4 + strength * 12) * this.intensity);
    let spawned = 0;
    for (const s of this.sparks) {
      if (spawned >= count) break;
      if (s.active) continue;
      s.active = true;
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5 * (0.5 + strength);
      s.x = x; s.y = y; s.z = 0;
      s.vx = Math.cos(a) * sp;
      s.vy = Math.abs(Math.sin(a)) * sp * 0.9 + 1;
      s.vz = (Math.random() - 0.5) * 2;
      s.life = 0.3 + Math.random() * 0.3;
      spawned++;
    }
  }

  /** Emphasize the decisive landing point after a rally. */
  showLanding(x: number): void {
    this.landLife = 1.4;
    this.landMarker.position.set(x, 0.04, 0);
    this.landMarker.visible = true;
  }

  update(dt: number): void {
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - r.life / r.maxLife;
      r.mesh.scale.setScalar(r.mesh.scale.x + r.grow * dt);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = clamp((1 - t) * 0.8, 0, 1);
      if (r.life <= 0) r.mesh.visible = false;
    }

    let idx = 0;
    for (const s of this.sparks) {
      if (s.active) {
        s.life -= dt;
        if (s.life <= 0) {
          s.active = false;
        } else {
          s.vy -= 22 * dt;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          s.z += s.vz * dt;
          if (s.y < 0.05) { s.y = 0.05; s.vy = Math.abs(s.vy) * 0.4; }
          this.dummy.position.set(s.x, s.y, s.z);
          const sc = clamp(s.life * 2.2, 0.1, 1);
          this.dummy.scale.setScalar(sc);
          this.dummy.updateMatrix();
          this.sparkMesh.setMatrixAt(idx++, this.dummy.matrix);
        }
      }
    }
    // Park unused instances out of sight.
    this.dummy.position.set(0, -50, 0);
    this.dummy.scale.setScalar(0.001);
    this.dummy.updateMatrix();
    for (let i = idx; i < SPARK_POOL; i++) this.sparkMesh.setMatrixAt(i, this.dummy.matrix);
    this.sparkMesh.instanceMatrix.needsUpdate = true;

    if (this.landLife > 0) {
      this.landLife -= dt;
      const m = this.landMarker.material as THREE.MeshBasicMaterial;
      m.opacity = clamp(this.landLife, 0, 1) * 0.85;
      this.landMarker.scale.setScalar(1 + (1.4 - this.landLife) * 0.5);
      if (this.landLife <= 0) this.landMarker.visible = false;
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
