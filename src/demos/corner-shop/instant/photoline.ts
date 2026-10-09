import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import { filmGeometry, type Film } from './film';
import { FILM } from './model';

/**
 * The line over the desk, after the Instant demo's gallery: prints pegged with wooden clothespins
 * along a string of fairy lights. The string sags, dips under each print's weight and bounces
 * when one's clipped on; a print swings on its peg and settles, stirred now and then by a draught,
 * its soft shadow on the wall behind swinging with it.
 *
 * Built in the film's units (a centimetre); the caller scales and places the group.
 */

const { vec3, smoothstep, length, max, min, abs, uv } = TSL;

export type LineOptions = {
  slots: number;
  spacing: number;
  /** How far the middle of the string hangs below its ends */
  sag: number;
  /** How far behind the string the wall is (shadows go on it) */
  wall: number;
  /** A fairy light, already lit or not as the caller likes; placed along the string each frame */
  bulb: (i: number) => THREE.Object3D;
  bulbs: number;
};

type Hung = {
  slot: number;
  group: THREE.Group;
  print: THREE.Mesh;
  jaw: THREE.Object3D;
  shadow: THREE.Mesh;
  angle: number;
  vel: number;
  twist: number;
  clip: number;
};

/** A wooden clothespin, standing up, its jaw at the bottom */
function clothespin(wood: THREE.Material, metal: THREE.Material) {
  const group = new THREE.Group();
  const leg = new RoundedBoxGeometry(0.62, 3.0, 0.24, 2, 0.08);
  const back = new THREE.Mesh(leg, wood);
  back.position.set(0, -0.2, -0.13);
  group.add(back);
  const jaw = new THREE.Object3D();
  jaw.position.set(0, 0.2, 0);
  group.add(jaw);
  const front = new THREE.Mesh(leg, wood);
  front.position.set(0, -0.4, 0.13);
  jaw.add(front);
  const spring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 6, 16), metal);
  spring.rotation.y = Math.PI / 2;
  spring.position.set(0, 0.25, 0);
  group.add(spring);
  return { group, jaw };
}

/** A print's soft shadow, a rounded dark rectangle on the wall */
function shadowMaterial() {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const p = uv()
    .sub(0.5)
    .mul(TSL.vec2(FILM.w + 3, FILM.h + 3));
  const box = abs(p).sub(TSL.vec2(FILM.w / 2 - 0.2, FILM.h / 2 - 0.2));
  const d = length(max(box, TSL.vec2(0, 0))).add(min(max(box.x, box.y), 0));
  m.colorNode = vec3(0.04, 0.03, 0.02);
  m.opacityNode = smoothstep(1.4, -0.4, d).mul(0.32);
  return m;
}

export function buildPhotoLine(film: Film, o: LineOptions) {
  const group = new THREE.Group();
  const slotX = (i: number) => (i - (o.slots - 1) / 2) * o.spacing;
  const XA = slotX(0) - o.spacing;
  const XB = slotX(o.slots - 1) + o.spacing;
  const DROP = FILM.h / 2 + 0.6;

  // The string: a thin tube along points that move as it bounces
  const N = 160;
  const R = 6;
  const pos = new Float32Array((N + 1) * R * 3);
  const index: number[] = [];
  for (let i = 0; i < N; i++)
    for (let j = 0; j < R; j++) {
      const a = i * R + j;
      const b = i * R + ((j + 1) % R);
      const c = (i + 1) * R + j;
      const d = (i + 1) * R + ((j + 1) % R);
      index.push(a, c, b, b, c, d);
    }
  const stringGeo = new THREE.BufferGeometry();
  stringGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  stringGeo.setIndex(index);
  const string = new THREE.Mesh(stringGeo, new THREE.MeshStandardNodeMaterial({ color: '#9C8466', roughness: 0.9 }));
  string.frustumCulled = false;
  group.add(string);
  // A hook at each end, in the wall
  const hookM = new THREE.MeshStandardNodeMaterial({ color: '#C9A15A', roughness: 0.35, metalness: 0.6 });
  for (const x of [XA, XB]) {
    const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, o.wall, 10), hookM);
    hook.rotation.x = Math.PI / 2;
    hook.position.set(x, 0, -o.wall / 2);
    group.add(hook);
  }

  const bulbs = Array.from({ length: o.bulbs }, (_, i) => {
    const b = o.bulb(i);
    group.add(b);
    return b;
  });

  const wood = new THREE.MeshStandardNodeMaterial({ color: '#D9B587', roughness: 0.75 });
  const metal = new THREE.MeshStandardNodeMaterial({ color: '#A9ADB2', roughness: 0.35, metalness: 0.7 });
  const shadowM = shadowMaterial();

  const hung: Hung[] = [];
  let bounce = 0;
  let bounceVel = 0;
  let next = 0;

  /** The string's height at x, now: its sag, a dip under each print, the bounce */
  const yAt = (x: number) => {
    const u = (x - XA) / (XB - XA);
    let y = -o.sag * 4 * u * (1 - u);
    for (const h of hung) {
      const d = (x - slotX(h.slot)) / 2.2;
      y -= 0.45 * Math.exp(-d * d) * h.clip;
    }
    return y + bounce * Math.sin(Math.PI * u);
  };

  const updateString = () => {
    const r = 0.07;
    for (let i = 0; i <= N; i++) {
      const x = XA + ((XB - XA) * i) / N;
      const y = yAt(x);
      for (let j = 0; j < R; j++) {
        const a = (j / R) * Math.PI * 2;
        const k = (i * R + j) * 3;
        pos[k] = x;
        pos[k + 1] = y + Math.cos(a) * r;
        pos[k + 2] = Math.sin(a) * r;
      }
    }
    stringGeo.attributes.position.needsUpdate = true;
    stringGeo.computeBoundingSphere();
    bulbs.forEach((b, i) => {
      const x = XA + ((i + 0.5) / bulbs.length) * (XB - XA);
      b.position.set(x, yAt(x) - 0.55, 0.15);
    });
  };
  updateString();

  return {
    group,
    slotX,
    count: () => hung.length,
    nextSlot: () => next % o.slots,
    /** Where a print at `slot` hangs, its middle, in the group's units */
    restPose(slot: number, out: THREE.Vector3) {
      const x = slotX(slot);
      return out.set(x, yAt(x) - DROP, 0);
    },
    /** A peg goes on at `slot`, jaw open; returns how to clip the arriving print on */
    prepare(slot: number, photo: THREE.Texture) {
      const old = hung.findIndex((h) => h.slot === slot);
      if (old >= 0) {
        const [gone] = hung.splice(old, 1);
        gone.group.removeFromParent();
        gone.shadow.removeFromParent();
      }
      const print = new THREE.Mesh(filmGeometry(), [
        film.edge(true),
        film.edge(true),
        film.edge(true),
        film.edge(true),
        film.frozen(photo),
        film.back(true),
      ]);
      const { group: pin, jaw } = clothespin(wood, metal);
      const holder = new THREE.Group();
      holder.add(print);
      print.position.y = -DROP;
      holder.add(pin);
      pin.position.set(0, 0.2, 0.08);
      holder.visible = false;
      group.add(holder);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(FILM.w + 3, FILM.h + 3), shadowM);
      shadow.visible = false;
      shadow.renderOrder = 1;
      group.add(shadow);
      const h: Hung = { slot, group: holder, print, jaw, shadow, angle: 0, vel: 0, twist: 0, clip: 0 };
      next = slot + 1;
      return {
        print,
        showPin() {
          holder.visible = true;
          print.visible = false;
          hung.push(h);
        },
        clip(swing: number) {
          print.visible = true;
          shadow.visible = true;
          h.clip = 1;
          h.vel = swing;
          bounceVel -= 9;
        },
      };
    },
    update(dt: number, t: number) {
      bounceVel += (-bounce * 60 - bounceVel * 3.2) * dt;
      bounce += bounceVel * dt;
      updateString();
      for (const h of hung) {
        const draught = Math.sin(t * 0.7 + h.slot * 1.9) * 0.012 + Math.sin(t * 1.9 + h.slot) * 0.006;
        h.vel += (-h.angle * 9 - h.vel * 1.1) * dt + draught * dt * 6;
        h.angle += h.vel * dt;
        h.twist += (Math.sin(t * 0.5 + h.slot * 2.3) * 0.08 - h.twist) * Math.min(1, dt * 2);
        const x = slotX(h.slot);
        h.group.position.set(x, yAt(x), 0);
        h.group.rotation.set(0, h.twist * h.clip, h.angle);
        h.jaw.rotation.x = h.clip ? 0 : -0.45;
        // Its shadow, thrown down and to the right by the lamp, on the wall behind
        h.shadow.position.set(
          x + Math.sin(h.angle) * DROP + 1.1,
          yAt(x) - DROP * Math.cos(h.angle) - 1.4,
          -o.wall + 0.05
        );
        h.shadow.rotation.z = h.angle;
      }
    },
  };
}

export type PhotoLine = ReturnType<typeof buildPhotoLine>;
