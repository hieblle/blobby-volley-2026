/**
 * Arena builders — Sunset Deck, Neon Rooftop, Garden Dome.
 *
 * Arenas are pure decoration: identical court dimensions, physics and
 * readability in every one. Background animation is cheap (a few dozen
 * instanced meshes / uniform updates) and can be disabled entirely.
 * Built once per selection and disposed on swap — never rebuilt per match.
 */

import * as THREE from 'three';
import type { ArenaId } from '../settings';

export interface Arena {
  group: THREE.Group;
  /** Ambient/hemisphere tints for the renderer to apply. */
  skyColor: number;
  groundColor: number;
  sunColor: number;
  sunPosition: THREE.Vector3;
  /** Optional light-intensity overrides (readability tuning per arena). */
  hemiIntensity?: number;
  sunIntensity?: number;
  update(time: number, dt: number, animate: boolean): void;
  dispose(): void;
}

class DisposeBag {
  items: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  add<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(x: T): T {
    this.items.push(x);
    return x;
  }
  dispose(): void {
    for (const i of this.items) i.dispose();
  }
}

function gradientSky(bag: DisposeBag, top: string, mid: string, bottom: string): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(0.55, mid);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2, 256);
  const tex = bag.add(new THREE.CanvasTexture(c));
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = bag.add(new THREE.SphereGeometry(140, 24, 16));
  const mat = bag.add(new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }));
  return new THREE.Mesh(geo, mat);
}

/** Bobbing crowd of little spectator blobs seated on bleacher stands. */
function makeCrowd(bag: DisposeBag, count: number, zBase: number, standColor = 0x2b3a52): {
  group: THREE.Group;
  update: (t: number) => void;
} {
  const group = new THREE.Group();
  const rows = 3;
  const perRow = Math.ceil(count / rows);

  // Stepped bleachers rising away from the court.
  const standMat = bag.add(new THREE.MeshStandardMaterial({ color: standColor, roughness: 0.9 }));
  for (let r = 0; r < rows; r++) {
    const topY = 0.7 + r * 1.05;
    const geo = bag.add(new THREE.BoxGeometry(36, topY + 0.6, 1.9));
    const step = new THREE.Mesh(geo, standMat);
    step.position.set(0, (topY - 0.6) / 2, zBase - r * 1.9);
    group.add(step);
  }

  const geo = bag.add(new THREE.SphereGeometry(0.42, 8, 6));
  const mat = bag.add(new THREE.MeshLambertMaterial({}));
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const dummy = new THREE.Object3D();
  const base: { x: number; y: number; z: number; phase: number; speed: number }[] = [];
  const palette = [0xff8f6b, 0x74c0ff, 0xa5e06b, 0xd6a2ff, 0xffd36b, 0x7fe8d0];
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const x = -16 + (i % perRow) * (32 / perRow) + Math.random() * 0.8;
    const y = 0.7 + row * 1.05 + 0.36;
    const z = zBase - row * 1.9 + Math.random() * 0.3;
    base.push({ x, y, z, phase: Math.random() * Math.PI * 2, speed: 1.5 + Math.random() * 2 });
    dummy.position.set(x, y, z);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    color.setHex(palette[i % palette.length]);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  group.add(mesh);
  const update = (t: number) => {
    for (let i = 0; i < count; i++) {
      const b = base[i];
      dummy.position.set(b.x, b.y + Math.abs(Math.sin(t * b.speed + b.phase)) * 0.24, b.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  return { group, update };
}

function makeFlag(bag: DisposeBag, color: number, x: number, z: number): {
  group: THREE.Group;
  update: (t: number) => void;
} {
  const group = new THREE.Group();
  const poleGeo = bag.add(new THREE.CylinderGeometry(0.06, 0.08, 5, 8));
  const poleMat = bag.add(new THREE.MeshStandardMaterial({ color: 0xcfd6de, roughness: 0.5 }));
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 2.5;
  const flagGeo = bag.add(new THREE.PlaneGeometry(1.7, 0.95, 8, 3));
  const flagMat = bag.add(new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.position.set(0.88, 4.4, 0);
  group.add(pole, flag);
  group.position.set(x, 0, z);
  const pos = flagGeo.attributes.position as THREE.BufferAttribute;
  const baseX: number[] = [];
  for (let i = 0; i < pos.count; i++) baseX.push(pos.getX(i));
  const update = (t: number) => {
    for (let i = 0; i < pos.count; i++) {
      const bx = baseX[i];
      const k = (bx + 0.85) / 1.7; // 0 at pole, 1 at tip
      pos.setZ(i, Math.sin(t * 3 + k * 4 + x) * 0.22 * k);
    }
    pos.needsUpdate = true;
    flagGeo.computeVertexNormals();
  };
  return { group, update };
}

// ---------------------------------------------------------------------------

function buildSunset(): Arena {
  const bag = new DisposeBag();
  const group = new THREE.Group();
  const updates: ((t: number, dt: number) => void)[] = [];

  group.add(gradientSky(bag, '#2a3f6e', '#ff9d5c', '#ffd9a8'));

  // Sun disk low over the water.
  const sunGeo = bag.add(new THREE.CircleGeometry(7, 32));
  const sunMat = bag.add(new THREE.MeshBasicMaterial({ color: 0xffe9b8, fog: false }));
  const sun = new THREE.Mesh(sunGeo, sunMat);
  sun.position.set(-24, 9, -95);
  group.add(sun);

  // Ocean.
  const seaGeo = bag.add(new THREE.PlaneGeometry(300, 200, 48, 24));
  const seaMat = bag.add(new THREE.MeshStandardMaterial({
    color: 0x2e5f8a,
    roughness: 0.35,
    metalness: 0.25,
  }));
  const sea = new THREE.Mesh(seaGeo, seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -6;
  group.add(sea);
  const seaPos = seaGeo.attributes.position as THREE.BufferAttribute;
  updates.push((t) => {
    for (let i = 0; i < seaPos.count; i += 3) {
      const x = seaPos.getX(i);
      const y = seaPos.getY(i);
      seaPos.setZ(i, Math.sin(t * 0.8 + x * 0.15 + y * 0.1) * 0.35);
    }
    seaPos.needsUpdate = true;
  });

  // Glittering sun path on the water.
  const glintGeo = bag.add(new THREE.PlaneGeometry(6, 80));
  const glintMat = bag.add(new THREE.MeshBasicMaterial({
    color: 0xffdf9e, transparent: true, opacity: 0.35, depthWrite: false,
  }));
  const glint = new THREE.Mesh(glintGeo, glintMat);
  glint.rotation.x = -Math.PI / 2;
  glint.position.set(-24, -5.9, -55);
  group.add(glint);
  updates.push((t) => { glintMat.opacity = 0.28 + Math.sin(t * 1.7) * 0.08; });

  // Deck platform below the court.
  const deckGeo = bag.add(new THREE.BoxGeometry(34, 3, 18));
  const deckMat = bag.add(new THREE.MeshStandardMaterial({ color: 0xa5714f, roughness: 0.8 }));
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.position.set(0, -1.62, -1);
  group.add(deck);

  // Flags + crowd.
  for (const [c, x, z] of [[0xff6b52, -14.5, -5], [0x3fa0f5, 14.5, -5], [0xffc23c, -14.5, 3], [0x2fd8b8, 14.5, 3]] as const) {
    const f = makeFlag(bag, c, x, z);
    group.add(f.group);
    updates.push(f.update);
  }
  const crowd = makeCrowd(bag, 36, -9, 0x6e5040);
  group.add(crowd.group);
  updates.push(crowd.update);

  // Distant clouds.
  const cloudGeo = bag.add(new THREE.SphereGeometry(4, 10, 8));
  const cloudMat = bag.add(new THREE.MeshBasicMaterial({ color: 0xffe4c4, transparent: true, opacity: 0.75, fog: false }));
  const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, 8);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 8; i++) {
    dummy.position.set(-70 + i * 22 + (i % 3) * 6, 20 + (i % 4) * 4, -90 - (i % 2) * 10);
    dummy.scale.set(1.6 + (i % 3) * 0.5, 0.55, 1);
    dummy.updateMatrix();
    clouds.setMatrixAt(i, dummy.matrix);
  }
  group.add(clouds);

  return {
    group,
    skyColor: 0xffc389,
    groundColor: 0x6a4a3a,
    sunColor: 0xffd9a8,
    sunPosition: new THREE.Vector3(-14, 16, 12),
    update(time, dt, animate) {
      if (!animate) return;
      for (const u of updates) u(time, dt);
    },
    dispose() {
      bag.dispose();
    },
  };
}

function buildNeon(): Arena {
  const bag = new DisposeBag();
  const group = new THREE.Group();
  const updates: ((t: number, dt: number) => void)[] = [];

  group.add(gradientSky(bag, '#131a33', '#28305e', '#4a3a6e'));

  // City skyline: instanced towers with emissive window texture.
  const winCanvas = document.createElement('canvas');
  winCanvas.width = 32;
  winCanvas.height = 64;
  const wc = winCanvas.getContext('2d')!;
  wc.fillStyle = '#171d38';
  wc.fillRect(0, 0, 32, 64);
  for (let y = 2; y < 64; y += 6) {
    for (let x = 2; x < 32; x += 6) {
      wc.fillStyle = Math.random() < 0.5 ? '#ffd88a' : '#8ad4ff';
      if (Math.random() < 0.65) wc.fillRect(x, y, 3, 3);
    }
  }
  const winTex = bag.add(new THREE.CanvasTexture(winCanvas));
  winTex.colorSpace = THREE.SRGBColorSpace;
  const towerGeo = bag.add(new THREE.BoxGeometry(6, 30, 6));
  const towerMat = bag.add(new THREE.MeshBasicMaterial({ map: winTex, fog: false }));
  const towers = new THREE.InstancedMesh(towerGeo, towerMat, 18);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 18; i++) {
    const ring = i < 10 ? 0 : 1;
    const spread = ring === 0 ? 60 : 100;
    dummy.position.set(
      -spread + (i % 10) * (spread / 4.5) + (i * 7) % 11,
      -12 + ((i * 13) % 9),
      -60 - ring * 30 - ((i * 5) % 12),
    );
    dummy.scale.set(0.8 + (i % 3) * 0.4, 0.8 + ((i * 3) % 5) * 0.28, 1);
    dummy.updateMatrix();
    towers.setMatrixAt(i, dummy.matrix);
  }
  group.add(towers);

  // Rooftop slab.
  const slabGeo = bag.add(new THREE.BoxGeometry(36, 3, 20));
  const slabMat = bag.add(new THREE.MeshStandardMaterial({ color: 0x39415f, roughness: 0.85 }));
  const slab = new THREE.Mesh(slabGeo, slabMat);
  slab.position.set(0, -1.62, -1);
  group.add(slab);

  // Neon trim strips (restrained, away from the ball's flight zone).
  const stripGeo = bag.add(new THREE.BoxGeometry(34, 0.14, 0.14));
  for (const [color, y, z] of [[0xff5cab, 0.06, -8.4], [0x5ce1ff, 0.06, 6.4]] as const) {
    const mat = bag.add(new THREE.MeshBasicMaterial({ color }));
    const strip = new THREE.Mesh(stripGeo, mat);
    strip.position.set(0, y, z);
    group.add(strip);
    updates.push((t) => { mat.color.setHex(color).multiplyScalar(0.8 + Math.sin(t * 2 + z) * 0.2); });
  }

  // Animated sign.
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 256;
  signCanvas.height = 96;
  const sc = signCanvas.getContext('2d')!;
  sc.fillStyle = '#101530';
  sc.fillRect(0, 0, 256, 96);
  sc.font = 'bold 44px system-ui, sans-serif';
  sc.textAlign = 'center';
  sc.textBaseline = 'middle';
  sc.fillStyle = '#ff5cab';
  sc.fillText('BOUNCE', 128, 30);
  sc.fillStyle = '#5ce1ff';
  sc.fillText('COURT', 128, 70);
  const signTex = bag.add(new THREE.CanvasTexture(signCanvas));
  signTex.colorSpace = THREE.SRGBColorSpace;
  const signGeo = bag.add(new THREE.PlaneGeometry(9, 3.4));
  const signMat = bag.add(new THREE.MeshBasicMaterial({ map: signTex, transparent: true, fog: false }));
  const sign = new THREE.Mesh(signGeo, signMat);
  sign.position.set(16, 12, -34);
  sign.rotation.y = -0.35;
  group.add(sign);
  updates.push((t) => { signMat.opacity = 0.82 + Math.sin(t * 4) * 0.1; });

  // Patrol drones with blinking lights.
  const droneGeo = bag.add(new THREE.SphereGeometry(0.35, 8, 6));
  const droneMat = bag.add(new THREE.MeshBasicMaterial({ color: 0x9fb4ff }));
  const drones: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const d = new THREE.Mesh(droneGeo, droneMat);
    group.add(d);
    drones.push(d);
  }
  updates.push((t) => {
    drones.forEach((d, i) => {
      d.position.set(
        Math.sin(t * 0.24 + i * 2.1) * 26,
        11 + Math.sin(t * 0.7 + i) * 2,
        -26 - i * 8,
      );
    });
  });

  const crowd = makeCrowd(bag, 30, -10);
  group.add(crowd.group);
  updates.push(crowd.update);

  return {
    group,
    skyColor: 0x7d8fd0,
    groundColor: 0x3a4166,
    sunColor: 0xccd6ff,
    sunPosition: new THREE.Vector3(10, 18, 14),
    hemiIntensity: 1.25,
    sunIntensity: 1.75,
    update(time, dt, animate) {
      if (!animate) return;
      for (const u of updates) u(time, dt);
    },
    dispose() {
      bag.dispose();
    },
  };
}

function buildGarden(): Arena {
  const bag = new DisposeBag();
  const group = new THREE.Group();
  const updates: ((t: number, dt: number) => void)[] = [];

  group.add(gradientSky(bag, '#8fd0ff', '#cdeeff', '#eafff2'));

  // Glass dome ribs.
  const ribMat = bag.add(new THREE.MeshStandardMaterial({ color: 0xe8f4ee, roughness: 0.4, metalness: 0.3 }));
  const ribGeo = bag.add(new THREE.TorusGeometry(42, 0.35, 8, 40, Math.PI));
  for (let i = 0; i < 5; i++) {
    const rib = new THREE.Mesh(ribGeo, ribMat);
    rib.rotation.y = (i / 5) * Math.PI;
    rib.position.y = -2;
    group.add(rib);
  }

  // Terrace floor beyond the court.
  const floorGeo = bag.add(new THREE.CylinderGeometry(40, 40, 2.5, 36));
  const floorMat = bag.add(new THREE.MeshStandardMaterial({ color: 0x8fbf8a, roughness: 0.9 }));
  const terrace = new THREE.Mesh(floorGeo, floorMat);
  terrace.position.y = -1.4;
  group.add(terrace);

  // Foliage: instanced bushes and trees — kept well clear of the court
  // and the crowd stands so gameplay is never occluded.
  const bushGeo = bag.add(new THREE.SphereGeometry(1.4, 10, 8));
  const bushMat = bag.add(new THREE.MeshLambertMaterial({ color: 0x3e8f4e }));
  const bushes = new THREE.InstancedMesh(bushGeo, bushMat, 26);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < 26; i++) {
    // Two side banks (beyond the walls) + a distant back row.
    let x: number, z: number;
    if (i < 8) { x = -17 - (i % 4) * 2.2; z = -4 + i * 1.1; }
    else if (i < 16) { x = 17 + (i % 4) * 2.2; z = -4 + (i - 8) * 1.1; }
    else { x = -22 + (i - 16) * 4.6; z = -19 - (i % 3) * 2; }
    dummy.position.set(x, 0.4 + (i % 3) * 0.3, z);
    dummy.scale.setScalar(0.8 + (i % 4) * 0.35);
    dummy.updateMatrix();
    bushes.setMatrixAt(i, dummy.matrix);
    color.setHSL(0.3 + (i % 5) * 0.02, 0.5, 0.32 + (i % 3) * 0.06);
    bushes.setColorAt(i, color);
  }
  if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
  group.add(bushes);

  const trunkGeo = bag.add(new THREE.CylinderGeometry(0.3, 0.4, 4, 8));
  const trunkMat = bag.add(new THREE.MeshStandardMaterial({ color: 0x7a5a40, roughness: 0.9 }));
  const crownGeo = bag.add(new THREE.SphereGeometry(2.4, 10, 8));
  const crownMat = bag.add(new THREE.MeshLambertMaterial({ color: 0x4aa35a }));
  for (const [x, z] of [[-21, -15], [22, -13], [-24, -2], [25, -4]] as const) {
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, 2, z);
    const crown = new THREE.Mesh(crownGeo, crownMat);
    crown.position.set(x, 5.2, z);
    crown.scale.y = 0.85;
    group.add(trunk, crown);
  }

  // Moving sunlight shafts through the glass.
  const shaftGeo = bag.add(new THREE.PlaneGeometry(5, 26));
  const shafts: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
  for (let i = 0; i < 3; i++) {
    const mat = bag.add(new THREE.MeshBasicMaterial({
      color: 0xfff8d8, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide,
    }));
    const shaft = new THREE.Mesh(shaftGeo, mat);
    shaft.position.set(-14 + i * 14, 10, -12);
    shaft.rotation.z = 0.35;
    group.add(shaft);
    shafts.push({ mesh: shaft, mat });
  }
  updates.push((t) => {
    shafts.forEach((s, i) => {
      s.mesh.position.x = -14 + i * 14 + Math.sin(t * 0.12 + i * 2) * 4;
      s.mat.opacity = 0.07 + Math.sin(t * 0.4 + i) * 0.04;
    });
  });

  // Butterflies.
  const bflyGeo = bag.add(new THREE.PlaneGeometry(0.34, 0.26));
  const bflyMats = [0xffb14f, 0xff7fb0, 0x9fd0ff].map((c) =>
    bag.add(new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })),
  );
  const bflies: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(bflyGeo, bflyMats[i % 3]);
    group.add(b);
    bflies.push(b);
  }
  updates.push((t) => {
    bflies.forEach((b, i) => {
      b.position.set(
        Math.sin(t * 0.3 + i * 1.7) * 16,
        4.5 + Math.sin(t * 0.9 + i * 2.3) * 2.4,
        -10 - (i % 3) * 3,
      );
      b.rotation.y = Math.sin(t * 10 + i) * 0.9;
    });
  });

  const crowd = makeCrowd(bag, 30, -12, 0x55755f);
  group.add(crowd.group);
  updates.push(crowd.update);

  return {
    group,
    skyColor: 0xd6f2ff,
    groundColor: 0x7fae7a,
    sunColor: 0xfff6dd,
    sunPosition: new THREE.Vector3(12, 20, 10),
    update(time, dt, animate) {
      if (!animate) return;
      for (const u of updates) u(time, dt);
    },
    dispose() {
      bag.dispose();
    },
  };
}

export function buildArena(id: ArenaId): Arena {
  switch (id) {
    case 'neon':
      return buildNeon();
    case 'garden':
      return buildGarden();
    default:
      return buildSunset();
  }
}

export const ARENA_INFO: { id: ArenaId; name: string; blurb: string }[] = [
  { id: 'sunset', name: 'Sunset Deck', blurb: 'A floating court above a calm golden-hour ocean.' },
  { id: 'neon', name: 'Neon Rooftop', blurb: 'Night play over a glittering future skyline.' },
  { id: 'garden', name: 'Garden Dome', blurb: 'Glass, foliage, and drifting sunlight.' },
];
