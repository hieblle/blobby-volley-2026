/**
 * GameRenderer — owns the Three.js scene: court, net, arena, characters,
 * ball, effects, lighting, camera, quality presets, and debug overlays.
 * Physics stays in 2D; this class maps the x/y plane to a 2.5D scene at
 * z = 0 with a fixed, centered camera.
 */

import * as THREE from 'three';
import { BALL, COURT, FX, PLAYER } from '../config';
import { clamp } from '../util/math';
import type { Quality, ArenaId } from '../settings';
import { Arena, buildArena } from './arenas';
import { BouncerVisual } from './bouncer';
import { BallVisual } from './ballvis';
import { Effects } from './effects';

export class GameRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;

  bouncers: [BouncerVisual, BouncerVisual] | null = null;
  ballVis = new BallVisual();
  effects = new Effects();

  private arena: Arena | null = null;
  private arenaId: ArenaId | null = null;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private courtGroup = new THREE.Group();
  private courtMats: THREE.MeshStandardMaterial[] = [];
  private staticDisposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

  private camBase = new THREE.Vector3(0, 6.4, 20.5);
  private camImpulse = new THREE.Vector3();
  private camTarget = new THREE.Vector3(0, 4.1, 0);
  cameraImpulseEnabled = true;

  // Debug overlays
  private debugGroup = new THREE.Group();
  private debugCircles: THREE.LineLoop[] = [];
  private debugVel: THREE.ArrowHelper;
  private trajLine: THREE.Line;
  private trajPositions: Float32Array;
  private trajMarker: THREE.Mesh;
  debugVisible = false;
  private highContrast = false;

  quality: Quality = 'medium';
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 400);
    this.camera.position.copy(this.camBase);
    this.camera.lookAt(this.camTarget);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.9);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.position.set(-14, 16, 12);
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -16;
    this.sun.shadow.camera.right = 16;
    this.sun.shadow.camera.top = 16;
    this.sun.shadow.camera.bottom = -4;
    this.sun.shadow.camera.far = 60;
    this.sun.shadow.bias = -0.002;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.buildCourt();
    this.scene.add(this.courtGroup, this.ballVis.group, this.effects.group);

    // Debug visuals.
    const circleGeo = new THREE.BufferGeometry();
    const seg = 40;
    const circlePts = new Float32Array((seg + 1) * 3);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      circlePts[i * 3] = Math.cos(a);
      circlePts[i * 3 + 1] = Math.sin(a);
    }
    circleGeo.setAttribute('position', new THREE.BufferAttribute(circlePts, 3));
    const dbgMat = new THREE.LineBasicMaterial({ color: 0x40ff90 });
    this.staticDisposables.push(circleGeo, dbgMat);
    for (let i = 0; i < 3; i++) {
      const c = new THREE.LineLoop(circleGeo, dbgMat);
      c.frustumCulled = false;
      this.debugCircles.push(c);
      this.debugGroup.add(c);
    }
    this.debugVel = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xffe640);
    this.debugGroup.add(this.debugVel);

    this.trajPositions = new Float32Array(90 * 3);
    const trajGeo = new THREE.BufferGeometry();
    trajGeo.setAttribute('position', new THREE.BufferAttribute(this.trajPositions, 3));
    const trajMat = new THREE.LineDashedMaterial({ color: 0x7fe8ff, dashSize: 0.3, gapSize: 0.2, transparent: true, opacity: 0.8 });
    this.staticDisposables.push(trajGeo, trajMat);
    this.trajLine = new THREE.Line(trajGeo, trajMat);
    this.trajLine.frustumCulled = false;
    this.trajLine.visible = false;
    const tmGeo = new THREE.RingGeometry(0.35, 0.55, 24);
    const tmMat = new THREE.MeshBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    this.staticDisposables.push(tmGeo, tmMat);
    this.trajMarker = new THREE.Mesh(tmGeo, tmMat);
    this.trajMarker.rotation.x = -Math.PI / 2;
    this.trajMarker.visible = false;
    this.debugGroup.visible = false;
    this.scene.add(this.debugGroup, this.trajLine, this.trajMarker);

    window.addEventListener('resize', this.onResize);
    this.onResize();
  }

  private buildCourt(): void {
    const w = COURT.halfWidth;
    const add = <T extends THREE.BufferGeometry | THREE.Material>(x: T): T => {
      this.staticDisposables.push(x);
      return x;
    };

    // Court slab: two halves with distinct (colorblind-safe) tints and
    // patterned edges so sides are never distinguished by hue alone.
    const halfGeo = add(new THREE.BoxGeometry(w, 0.5, 9));
    const leftMat = add(new THREE.MeshStandardMaterial({ color: 0x3f8dd6, roughness: 0.85 }));
    const rightMat = add(new THREE.MeshStandardMaterial({ color: 0xe0784a, roughness: 0.85 }));
    this.courtMats = [leftMat, rightMat];
    const left = new THREE.Mesh(halfGeo, leftMat);
    left.position.set(-w / 2, -0.25, 0);
    left.receiveShadow = true;
    const right = new THREE.Mesh(halfGeo, rightMat);
    right.position.set(w / 2, -0.25, 0);
    right.receiveShadow = true;

    // Side-identification patterns (stripes left, dots right).
    const stripeGeo = add(new THREE.PlaneGeometry(0.5, 8.6));
    const patMat = add(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }));
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(stripeGeo, patMat);
      s.rotation.x = -Math.PI / 2;
      s.position.set(-w + 2 + i * 3.4, 0.012, 0);
      this.courtGroup.add(s);
    }
    const dotGeo = add(new THREE.CircleGeometry(0.32, 16));
    for (let i = 0; i < 6; i++) {
      const d = new THREE.Mesh(dotGeo, patMat);
      d.rotation.x = -Math.PI / 2;
      d.position.set(2.2 + (i % 3) * 3.4, 0.012, i < 3 ? -2.4 : 2.4);
      this.courtGroup.add(d);
    }

    // Boundary + center lines.
    const lineMat = add(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const mkLine = (lw: number, lh: number, x: number, z: number) => {
      const g = add(new THREE.PlaneGeometry(lw, lh));
      const m = new THREE.Mesh(g, lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.015, z);
      this.courtGroup.add(m);
    };
    mkLine(2 * w, 0.16, 0, 4.1);
    mkLine(2 * w, 0.16, 0, -4.1);
    mkLine(0.16, 8.2, -w + 0.08, 0);
    mkLine(0.16, 8.2, w - 0.08, 0);

    // Low side walls (the physics walls made visible).
    const wallGeo = add(new THREE.BoxGeometry(0.5, 4.2, 9));
    const wallMat = add(new THREE.MeshStandardMaterial({
      color: 0xdfe9f2, roughness: 0.4, transparent: true, opacity: 0.34, depthWrite: false,
    }));
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(sx * (w + 0.26), 2.1, 0);
      this.courtGroup.add(wall);
    }

    // Net: posts, tape, and a woven mesh texture.
    const postGeo = add(new THREE.CylinderGeometry(0.12, 0.14, COURT.netHeight + 0.3, 10));
    const postMat = add(new THREE.MeshStandardMaterial({ color: 0xb9c2cf, roughness: 0.45 }));
    for (const z of [-4.4, 4.4]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(0, (COURT.netHeight + 0.3) / 2, z);
      post.castShadow = true;
      this.courtGroup.add(post);
    }
    const netCanvas = document.createElement('canvas');
    netCanvas.width = 64;
    netCanvas.height = 64;
    const nc = netCanvas.getContext('2d')!;
    nc.clearRect(0, 0, 64, 64);
    nc.strokeStyle = 'rgba(255,255,255,0.9)';
    nc.lineWidth = 3;
    for (let i = 0; i <= 64; i += 16) {
      nc.beginPath(); nc.moveTo(i, 0); nc.lineTo(i, 64); nc.stroke();
      nc.beginPath(); nc.moveTo(0, i); nc.lineTo(64, i); nc.stroke();
    }
    const netTex = new THREE.CanvasTexture(netCanvas);
    netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
    netTex.repeat.set(4, 10);
    this.staticDisposables.push(netTex);
    // The net divides left/right, so the camera sees it edge-on: render it
    // as a woven slab (matching the physics capsule) so it stays readable.
    const netH = COURT.netHeight - 0.3;
    const netGeo = add(new THREE.BoxGeometry(COURT.netHalfWidth * 2, netH, 8.8));
    const netMat = add(new THREE.MeshStandardMaterial({
      color: 0xf3e9d8, roughness: 0.7,
    }));
    const net = new THREE.Mesh(netGeo, netMat);
    net.position.set(0, netH / 2, 0);
    net.castShadow = true;
    this.courtGroup.add(net);
    const weaveGeo = add(new THREE.PlaneGeometry(0.34, netH));
    const weaveMat = add(new THREE.MeshBasicMaterial({
      map: netTex, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
    }));
    const weave = new THREE.Mesh(weaveGeo, weaveMat);
    weave.position.set(0, netH / 2, 4.42);
    this.courtGroup.add(weave);
    const tapeGeo = add(new THREE.BoxGeometry(COURT.netHalfWidth * 2 + 0.1, 0.3, 8.8));
    const tapeMat = add(new THREE.MeshStandardMaterial({ color: 0xfff2df, roughness: 0.6 }));
    const tape = new THREE.Mesh(tapeGeo, tapeMat);
    tape.position.set(0, COURT.netHeight - 0.15, 0);
    tape.castShadow = true;
    this.courtGroup.add(tape);

    this.courtGroup.add(left, right);
  }

  setArena(id: ArenaId): void {
    if (this.arenaId === id && this.arena) return;
    if (this.arena) {
      this.scene.remove(this.arena.group);
      this.arena.dispose();
    }
    this.arena = buildArena(id);
    this.arenaId = id;
    this.scene.add(this.arena.group);
    this.hemi.color.setHex(this.arena.skyColor);
    this.hemi.groundColor.setHex(this.arena.groundColor);
    this.hemi.intensity = this.arena.hemiIntensity ?? 0.9;
    this.sun.color.setHex(this.arena.sunColor);
    this.sun.intensity = this.arena.sunIntensity ?? 1.6;
    this.sun.position.copy(this.arena.sunPosition);
    this.applyContrast();
  }

  setBouncers(style0: number, style1: number): void {
    if (this.bouncers) {
      for (const b of this.bouncers) {
        this.scene.remove(b.group);
        b.dispose();
      }
    }
    this.bouncers = [new BouncerVisual(0, style0), new BouncerVisual(1, style1)];
    this.scene.add(this.bouncers[0].group, this.bouncers[1].group);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const dprCap = q === 'low' ? 1 : q === 'medium' ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sun.castShadow = q !== 'low';
    this.effects.intensity = q === 'low' ? 0.5 : q === 'medium' ? 1 : 1.3;
    // Force material refresh for shadow toggles.
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.Material) o.material.needsUpdate = true;
    });
    this.onResize();
  }

  setHighContrast(on: boolean): void {
    this.highContrast = on;
    this.applyContrast();
  }

  private applyContrast(): void {
    if (this.courtMats.length < 2) return;
    if (this.highContrast) {
      this.courtMats[0].color.setHex(0x1450a0);
      this.courtMats[1].color.setHex(0xc94f10);
    } else {
      this.courtMats[0].color.setHex(0x3f8dd6);
      this.courtMats[1].color.setHex(0xe0784a);
    }
  }

  private projVec = new THREE.Vector3();

  /** Project a world-plane point to normalized device coords (reused vec). */
  project(x: number, y: number): THREE.Vector3 {
    return this.projVec.set(x, y, 0).project(this.camera);
  }

  /** Small, decaying camera nudge for exceptional impacts. */
  impulse(strength: number): void {
    if (!this.cameraImpulseEnabled) return;
    this.camImpulse.x += (Math.random() - 0.5) * strength;
    this.camImpulse.y += (Math.random() - 0.5) * strength * 0.7;
  }

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    // Keep the full court in view on narrow windows.
    const needed = 40 * clamp(1.9 / this.camera.aspect, 1, 1.9);
    this.camera.fov = needed;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  /** Training/debug trajectory display. */
  showTrajectory(points: { x: number; y: number }[] | null, landingX: number | null): void {
    if (!points || points.length < 2) {
      this.trajLine.visible = false;
      this.trajMarker.visible = false;
      return;
    }
    const n = Math.min(points.length, 90);
    for (let i = 0; i < 90; i++) {
      const p = points[Math.min(i, n - 1)];
      this.trajPositions[i * 3] = p.x;
      this.trajPositions[i * 3 + 1] = p.y;
      this.trajPositions[i * 3 + 2] = 0;
    }
    (this.trajLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.trajLine.computeLineDistances();
    this.trajLine.visible = true;
    if (landingX !== null) {
      this.trajMarker.position.set(landingX, 0.05, 0);
      this.trajMarker.visible = true;
    } else {
      this.trajMarker.visible = false;
    }
  }

  setDebug(visible: boolean): void {
    this.debugVisible = visible;
    this.debugGroup.visible = visible;
  }

  updateDebug(px0: number, py0: number, px1: number, py1: number, bx: number, by: number, bvx: number, bvy: number): void {
    if (!this.debugVisible) return;
    const [c0, c1, cb] = this.debugCircles;
    c0.position.set(px0, py0, 0.5);
    c0.scale.setScalar(PLAYER.radius);
    c1.position.set(px1, py1, 0.5);
    c1.scale.setScalar(PLAYER.radius);
    cb.position.set(bx, by, 0.5);
    cb.scale.setScalar(BALL.radius);
    const speed = Math.hypot(bvx, bvy);
    this.debugVel.position.set(bx, by, 0.5);
    if (speed > 0.01) {
      this.debugVel.setDirection(new THREE.Vector3(bvx / speed, bvy / speed, 0));
      this.debugVel.setLength(clamp(speed * 0.14, 0.2, 4));
      this.debugVel.visible = true;
    } else {
      this.debugVel.visible = false;
    }
  }

  render(dt: number, backgroundAnimation: boolean): void {
    this.time += dt;
    this.arena?.update(this.time, dt, backgroundAnimation);
    this.effects.update(dt);

    // Camera impulse spring.
    this.camImpulse.multiplyScalar(Math.max(0, 1 - FX.cameraRecovery * dt));
    this.camera.position.copy(this.camBase).add(this.camImpulse);
    this.camera.lookAt(this.camTarget);

    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    for (const d of this.staticDisposables) d.dispose();
    this.arena?.dispose();
    this.ballVis.dispose();
    this.effects.dispose();
    if (this.bouncers) for (const b of this.bouncers) b.dispose();
    this.renderer.dispose();
  }
}
