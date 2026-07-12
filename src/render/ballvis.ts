/**
 * BallVisual — swirl-textured ball with spin, speed trail, blob shadow,
 * and an optional accessibility outline shell.
 */

import * as THREE from 'three';
import { BALL, FX } from '../config';
import { clamp } from '../util/math';

const TRAIL_POINTS = 22;

export class BallVisual {
  group = new THREE.Group();
  private mesh: THREE.Mesh;
  private outline: THREE.Mesh;
  private shadow: THREE.Mesh;
  private trail: THREE.Line;
  private trailPositions: Float32Array;
  private trailMat: THREE.LineBasicMaterial;
  private history: number[] = []; // x,y pairs
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

  constructor() {
    const geo = new THREE.SphereGeometry(BALL.radius, 28, 22);
    const tex = this.makeSwirlTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0.02 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.disposables.push(geo, mat, tex);

    // Accessibility outline: inverted-hull black shell.
    const outGeo = new THREE.SphereGeometry(BALL.radius * 1.14, 24, 18);
    const outMat = new THREE.MeshBasicMaterial({ color: 0x0c1220, side: THREE.BackSide });
    this.outline = new THREE.Mesh(outGeo, outMat);
    this.outline.visible = false;
    this.disposables.push(outGeo, outMat);

    const shGeo = new THREE.CircleGeometry(BALL.radius * 1.1, 20);
    const shMat = new THREE.MeshBasicMaterial({ color: 0x08131f, transparent: true, opacity: 0.3, depthWrite: false });
    this.shadow = new THREE.Mesh(shGeo, shMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.disposables.push(shGeo, shMat);

    this.trailPositions = new Float32Array(TRAIL_POINTS * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trailMat = new THREE.LineBasicMaterial({
      color: 0xfff3d0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.trail = new THREE.Line(trailGeo, this.trailMat);
    this.trail.frustumCulled = false;
    this.disposables.push(trailGeo, this.trailMat);

    this.group.add(this.mesh, this.outline, this.shadow, this.trail);
  }

  private makeSwirlTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff8ea';
    ctx.fillRect(0, 0, 256, 128);
    // Two sweeping bands so rotation reads clearly at speed.
    ctx.fillStyle = '#ff8a3d';
    ctx.beginPath();
    for (let x = 0; x <= 256; x += 4) {
      const y = 34 + Math.sin((x / 256) * Math.PI * 2) * 18;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    for (let x = 256; x >= 0; x -= 4) {
      const y = 62 + Math.sin((x / 256) * Math.PI * 2) * 18;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#2e6fd8';
    ctx.beginPath();
    for (let x = 0; x <= 256; x += 4) {
      const y = 78 + Math.sin((x / 256) * Math.PI * 2 + 2.5) * 14;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    for (let x = 256; x >= 0; x -= 4) {
      const y = 100 + Math.sin((x / 256) * Math.PI * 2 + 2.5) * 14;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  setOutline(on: boolean): void {
    this.outline.visible = on;
  }

  update(x: number, y: number, vx: number, vy: number, angle: number, visible: boolean, reducedMotion: boolean): void {
    this.mesh.visible = visible;
    this.outline.visible = this.outline.visible && visible;
    this.mesh.position.set(x, y, 0);
    this.outline.position.copy(this.mesh.position);
    this.mesh.rotation.z = angle;

    // Blob shadow tracks x on the floor.
    this.shadow.position.set(x, 0.025, 0);
    const k = clamp(1 - (y - BALL.radius) / 12, 0.2, 1);
    this.shadow.scale.setScalar(clamp(k * 1.15, 0.4, 1.2));
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = visible ? 0.32 * k : 0;

    // Trail.
    const speed = Math.hypot(vx, vy);
    if (visible && !reducedMotion) {
      this.history.push(x, y);
      while (this.history.length > TRAIL_POINTS * 2) this.history.splice(0, 2);
    } else {
      this.history.length = 0;
    }
    const n = this.history.length / 2;
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const j = Math.min(i, n - 1);
      const hx = n > 0 ? this.history[j * 2] : x;
      const hy = n > 0 ? this.history[j * 2 + 1] : y;
      this.trailPositions[i * 3] = hx;
      this.trailPositions[i * 3 + 1] = hy;
      this.trailPositions[i * 3 + 2] = -0.05;
    }
    (this.trail.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    const target = speed > FX.trailSpeed && visible && !reducedMotion
      ? clamp((speed - FX.trailSpeed) / 10, 0, 0.55)
      : 0;
    this.trailMat.opacity += (target - this.trailMat.opacity) * 0.2;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
