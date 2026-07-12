/**
 * BouncerVisual — the stylized 3D body of a character.
 *
 * The physics body is a plain circle; everything here is presentation:
 * squash & stretch, landing compression, movement lean, wobble springs,
 * ball-tracking eyes, and post-point emotions. All animation is procedural.
 */

import * as THREE from 'three';
import { PLAYER } from '../config';
import { clamp, damp, lerp } from '../util/math';
import { BOUNCER_STYLES, BouncerStyle } from './styles';

export type Emotion = 'neutral' | 'happy' | 'sad' | 'focus';

export class BouncerVisual {
  group = new THREE.Group();
  private body: THREE.Mesh;
  private bodyMat: THREE.MeshStandardMaterial;
  private belly: THREE.Mesh;
  private eyes: THREE.Group;
  private pupils: [THREE.Mesh, THREE.Mesh];
  private eyeWhites: [THREE.Mesh, THREE.Mesh];
  private mouth: THREE.Mesh;
  private crest: THREE.Group;
  private badge: THREE.Sprite;
  private shadow: THREE.Mesh;

  private side: 0 | 1;
  private wobble = 0; // spring displacement
  private wobbleV = 0;
  private squash = 1; // 1 = rest; <1 flattened; >1 stretched
  private lean = 0;
  private emotion: Emotion = 'neutral';
  private emotionT = 0;
  private blinkT = 2;
  private blink = 0;
  private grounded = true;
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

  constructor(side: 0 | 1, styleIndex: number) {
    this.side = side;
    const style: BouncerStyle = BOUNCER_STYLES[styleIndex % BOUNCER_STYLES.length];
    const r = PLAYER.radius;

    // Body: a rounded, slightly asymmetric gumdrop (sphere squashed and
    // sheared a touch so the silhouette isn't a plain semicircle).
    const bodyGeo = new THREE.SphereGeometry(r, 36, 28);
    const pos = bodyGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // Taper the top into a soft teardrop tip and widen the base.
      const t = (y / r + 1) / 2; // 0 bottom .. 1 top
      const widen = 1 + 0.12 * (1 - t) - 0.18 * t * t;
      pos.setX(i, x * widen + 0.1 * r * t * t); // slight forward shear at top
      pos.setZ(i, z * widen);
      pos.setY(i, y * (1 + 0.14 * t));
    }
    bodyGeo.computeVertexNormals();
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: style.color,
      roughness: 0.55,
      metalness: 0.02,
    });
    this.body = new THREE.Mesh(bodyGeo, this.bodyMat);
    this.body.castShadow = true;
    this.disposables.push(bodyGeo, this.bodyMat);

    // Belly patch.
    const bellyGeo = new THREE.SphereGeometry(r * 0.78, 24, 18, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.5);
    const bellyMat = new THREE.MeshStandardMaterial({ color: style.accent, roughness: 0.7 });
    this.belly = new THREE.Mesh(bellyGeo, bellyMat);
    this.belly.position.set(0, -r * 0.28, r * 0.31);
    this.belly.rotation.x = Math.PI;
    this.disposables.push(bellyGeo, bellyMat);

    // Eyes — big, expressive, tracking the ball.
    this.eyes = new THREE.Group();
    const whiteGeo = new THREE.SphereGeometry(r * 0.24, 18, 14);
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
    const pupilGeo = new THREE.SphereGeometry(r * 0.115, 14, 10);
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x22222c, roughness: 0.3 });
    this.disposables.push(whiteGeo, whiteMat, pupilGeo, pupilMat);
    const mk = (off: number): [THREE.Mesh, THREE.Mesh] => {
      const w = new THREE.Mesh(whiteGeo, whiteMat);
      w.position.set(off, r * 0.34, r * 0.78);
      const p = new THREE.Mesh(pupilGeo, pupilMat);
      p.position.set(0, 0, r * 0.17);
      w.add(p);
      this.eyes.add(w);
      return [w, p];
    };
    const [w1, p1] = mk(-r * 0.3);
    const [w2, p2] = mk(r * 0.3);
    this.eyeWhites = [w1, w2];
    this.pupils = [p1, p2];

    // Mouth — a small capsule we reshape for emotions.
    const mouthGeo = new THREE.SphereGeometry(r * 0.12, 12, 8);
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x50262e, roughness: 0.6 });
    this.mouth = new THREE.Mesh(mouthGeo, mouthMat);
    this.mouth.position.set(0, r * 0.02, r * 0.92);
    this.mouth.scale.set(1.4, 0.5, 0.5);
    this.disposables.push(mouthGeo, mouthMat);

    this.crest = this.buildCrest(style, r);

    // Non-color player identification: floating P1/P2 badge.
    this.badge = this.buildBadge(side === 0 ? 'P1' : 'P2', style.color);
    this.badge.position.set(0, r * 2.15, 0);

    // Soft blob shadow (cheaper + softer than a second shadow map).
    const shGeo = new THREE.CircleGeometry(r * 1.05, 24);
    const shMat = new THREE.MeshBasicMaterial({ color: 0x08131f, transparent: true, opacity: 0.28, depthWrite: false });
    this.shadow = new THREE.Mesh(shGeo, shMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.02;
    this.disposables.push(shGeo, shMat);

    this.body.add(this.belly, this.eyes, this.mouth, this.crest);
    this.group.add(this.body, this.badge, this.shadow);
    // Face the net.
    this.body.rotation.y = side === 0 ? Math.PI * 0.24 : -Math.PI * 0.24;
  }

  private buildCrest(style: BouncerStyle, r: number): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: style.color, roughness: 0.6 });
    const accentMat = new THREE.MeshStandardMaterial({ color: style.accent, roughness: 0.6 });
    this.disposables.push(mat, accentMat);
    const top = r * 1.1;
    switch (style.crest) {
      case 'sprout': {
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.05, r * 0.07, r * 0.5, 8), mat);
        stem.position.y = top + r * 0.2;
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(r * 0.18, 10, 8), accentMat);
        leaf.scale.set(1.6, 0.7, 0.8);
        leaf.position.set(r * 0.14, top + r * 0.48, 0);
        leaf.rotation.z = -0.5;
        g.add(stem, leaf);
        break;
      }
      case 'fin': {
        const fin = new THREE.Mesh(new THREE.ConeGeometry(r * 0.3, r * 0.62, 4), accentMat);
        fin.position.y = top + r * 0.22;
        fin.scale.z = 0.35;
        g.add(fin);
        break;
      }
      case 'leaf': {
        for (const [ang, s] of [[-0.6, 0.8], [0.1, 1], [0.7, 0.7]] as const) {
          const leaf = new THREE.Mesh(new THREE.SphereGeometry(r * 0.2 * s, 10, 8), accentMat);
          leaf.scale.set(0.5, 1.7, 0.4);
          leaf.position.set(Math.sin(ang) * r * 0.25, top + r * 0.32, 0);
          leaf.rotation.z = -ang;
          g.add(leaf);
        }
        break;
      }
      case 'antenna': {
        for (const dx of [-0.18, 0.18]) {
          const stem = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.035, r * 0.045, r * 0.55, 6), mat);
          stem.position.set(dx * r, top + r * 0.24, 0);
          stem.rotation.z = -dx * 1.4;
          const bob = new THREE.Mesh(new THREE.SphereGeometry(r * 0.11, 10, 8), accentMat);
          bob.position.set(dx * r * 2.1, top + r * 0.52, 0);
          g.add(stem, bob);
        }
        break;
      }
      case 'mohawk': {
        for (let i = 0; i < 4; i++) {
          const spike = new THREE.Mesh(new THREE.ConeGeometry(r * 0.11, r * 0.34, 6), accentMat);
          spike.position.set((i - 1.5) * r * 0.19, top + r * 0.12 - Math.abs(i - 1.5) * r * 0.06, 0);
          spike.rotation.z = -(i - 1.5) * 0.25;
          g.add(spike);
        }
        break;
      }
      case 'ears': {
        for (const dx of [-0.42, 0.42]) {
          const ear = new THREE.Mesh(new THREE.SphereGeometry(r * 0.22, 12, 10), mat);
          ear.scale.set(0.6, 1.5, 0.5);
          ear.position.set(dx * r, top + r * 0.14, 0);
          ear.rotation.z = -dx * 0.8;
          const inner = new THREE.Mesh(new THREE.SphereGeometry(r * 0.12, 10, 8), accentMat);
          inner.scale.set(0.5, 1.3, 0.4);
          inner.position.set(dx * r * 0.98, top + r * 0.14, r * 0.06);
          g.add(ear, inner);
        }
        break;
      }
      case 'tuft': {
        for (let i = 0; i < 3; i++) {
          const flame = new THREE.Mesh(new THREE.ConeGeometry(r * 0.12, r * 0.4, 6), i === 1 ? accentMat : mat);
          flame.position.set((i - 1) * r * 0.15, top + r * 0.2 + (i === 1 ? r * 0.1 : 0), 0);
          flame.rotation.z = (i - 1) * 0.35;
          g.add(flame);
        }
        break;
      }
      case 'halo': {
        const halo = new THREE.Mesh(new THREE.TorusGeometry(r * 0.3, r * 0.05, 8, 24), accentMat);
        halo.position.y = top + r * 0.42;
        halo.rotation.x = Math.PI / 2.4;
        g.add(halo);
        break;
      }
    }
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        this.disposables.push(o.geometry);
      }
    });
    return g;
  }

  private buildBadge(text: string, color: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(10, 18, 32, 0.72)';
    const w = 108, h = 52, x = 10, y = 6, rr = 16;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rr);
    ctx.fill();
    ctx.strokeStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 34);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.92, depthWrite: false });
    this.disposables.push(tex, mat);
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.15, 0.58, 1);
    return sprite;
  }

  setEmotion(e: Emotion, duration = 1.6): void {
    this.emotion = e;
    this.emotionT = duration;
  }

  kickWobble(strength: number): void {
    this.wobbleV += strength;
  }

  /** Per-render-frame procedural animation. */
  update(
    x: number,
    y: number,
    vx: number,
    vy: number,
    grounded: boolean,
    ballX: number,
    ballY: number,
    dt: number,
    reducedMotion: boolean,
  ): void {
    this.group.position.set(x, y - PLAYER.radius, 0);

    // Landing detection for compression.
    if (grounded && !this.grounded) this.wobbleV -= clamp(-vy * 0.02 + 0.25, 0.2, 0.8);
    this.grounded = grounded;

    // Wobble spring (drives squash offset).
    const stiffness = 90, damping = 8;
    this.wobbleV += (-this.wobble * stiffness - this.wobbleV * damping) * dt;
    this.wobble += this.wobbleV * dt;

    // Base squash from vertical motion: stretch going up, squash landing.
    let target = 1;
    if (!grounded) target = clamp(1 + vy * 0.016, 0.82, 1.24);
    this.squash = damp(this.squash, target, 14, dt);
    let s = this.squash + (reducedMotion ? 0 : this.wobble);
    s = clamp(s, 0.62, 1.38);
    const inv = 1 / Math.sqrt(s); // volume-ish preservation
    this.body.scale.set(inv, s, inv);
    this.body.position.y = PLAYER.radius * s;

    // Lean into movement direction.
    const targetLean = clamp(-vx * 0.035, -0.38, 0.38);
    this.lean = damp(this.lean, reducedMotion ? 0 : targetLean, 10, dt);
    this.body.rotation.z = this.lean;

    // Eyes track the ball.
    const dx = ballX - x;
    const dy = ballY - y;
    const ang = Math.atan2(dy, dx);
    const px = clamp(Math.cos(ang) * 0.09, -0.09, 0.09);
    const py = clamp(Math.sin(ang) * 0.07, -0.07, 0.07);
    for (const p of this.pupils) {
      p.position.x = px;
      p.position.y = py;
      p.position.z = PLAYER.radius * 0.17;
    }

    // Blinking.
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 0.12;
      this.blinkT = 1.8 + Math.random() * 3.2;
    }
    if (this.blink > 0) this.blink -= dt;
    const eyeScaleY = this.blink > 0 ? 0.15 : this.emotion === 'happy' ? 0.55 : 1;
    for (const w of this.eyeWhites) w.scale.y = damp(w.scale.y, eyeScaleY, 24, dt);

    // Emotions shape the mouth.
    if (this.emotionT > 0) {
      this.emotionT -= dt;
      if (this.emotionT <= 0) this.emotion = 'neutral';
    }
    let mw = 1.4, mh = 0.5, my = 0.02;
    if (this.emotion === 'happy') { mw = 1.8; mh = 1.1; my = 0.0; }
    else if (this.emotion === 'sad') { mw = 1.0; mh = 0.35; my = -0.06; }
    else if (this.emotion === 'focus') { mw = 0.8; mh = 0.4; my = 0.0; }
    this.mouth.scale.x = damp(this.mouth.scale.x, mw, 12, dt);
    this.mouth.scale.y = damp(this.mouth.scale.y, mh, 12, dt);
    this.mouth.position.y = damp(this.mouth.position.y, PLAYER.radius * my + PLAYER.radius * 0.02, 12, dt);

    // Shadow: fades and shrinks with height.
    const hgt = y - PLAYER.radius;
    const k = clamp(1 - hgt / 8, 0.25, 1);
    this.shadow.scale.setScalar(lerp(0.55, 1, k));
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.3 * k;
    this.shadow.position.y = 0.02 - (y - PLAYER.radius);

    // Badge floats gently.
    this.badge.position.y = PLAYER.radius * 2.05 + (reducedMotion ? 0 : Math.sin(performance.now() * 0.002 + this.side) * 0.06);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
