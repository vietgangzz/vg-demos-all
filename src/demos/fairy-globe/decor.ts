import { FontStyle, Skia, TextAlign } from 'react-native-skia';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { dayness, hex, radial, shade, type V3 } from './light';
import { geo, SEA } from './world';

/**
 * The things an old map draws on its seas: the oceans' names lettered across them, little paper
 * boats with a lamp lit in the cabin, whales surfacing. They sit on the sea and turn with the globe.
 */

const OCEANS: { name: string; lon: number; lat: number; size: number; tilt: number }[] = [
  { name: 'Pacific Ocean', lon: -150, lat: 12, size: 1.0, tilt: -0.08 },
  { name: 'Pacific Ocean', lon: 165, lat: -18, size: 0.8, tilt: 0.1 },
  { name: 'Atlantic Ocean', lon: -38, lat: 24, size: 0.85, tilt: 0.25 },
  { name: 'South Atlantic', lon: -18, lat: -28, size: 0.7, tilt: -0.1 },
  { name: 'Indian Ocean', lon: 78, lat: -22, size: 0.85, tilt: 0.05 },
  { name: 'Arctic Ocean', lon: 160, lat: 81, size: 0.6, tilt: 0.0 },
  { name: 'Southern Ocean', lon: 60, lat: -58, size: 0.7, tilt: 0.0 },
];

/** Lettering on a transparent card, like ink on the paper of the sea */
function letteringTexture(text: string) {
  const w = 1024;
  const h = 192;
  const surface = Skia.Surface.Make(w, h);
  if (!surface) return null;
  const c = surface.getCanvas();
  c.clear(Skia.Color('transparent'));
  const style = {
    color: Skia.Color('#EAF6FF'),
    fontFamilies: ['Georgia'],
    fontSize: 104,
    fontStyle: FontStyle.Italic,
    letterSpacing: 10,
  };
  const para = Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Center })
    .pushStyle(style)
    .addText(text)
    .build();
  para.layout(w);
  para.paint(c, 0, (h - para.getHeight()) / 2);
  surface.flush();
  const read = surface.makeImageSnapshot().readPixels();
  if (!(read instanceof Uint8Array)) return null;
  // Unpremultiply and turn the rows so v runs up
  const out = new Uint8Array(read.length);
  const row = w * 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < row; x += 4) {
      const i = y * row + x;
      const o = (h - 1 - y) * row + x;
      const a = read[i + 3];
      out[o] = a ? Math.min(255, (read[i] * 255) / a) : 0;
      out[o + 1] = a ? Math.min(255, (read[i + 1] * 255) / a) : 0;
      out[o + 2] = a ? Math.min(255, (read[i + 2] * 255) / a) : 0;
      out[o + 3] = a;
    }
  }
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** A strip of the sphere just over the sea, bent to lie on it, `arc` radians long */
function curvedCard(arc: number, tall: number, segs = 32) {
  const g = new THREE.PlaneGeometry(1, 1, segs, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const a = p.getX(i) * arc;
    const b = p.getY(i) * tall;
    const r = SEA + 0.0025;
    // Wrap round the sphere: x along a great circle through the card's middle, y up toward north
    p.setXYZ(i, Math.sin(a) * Math.cos(b) * r, Math.sin(b) * r, Math.cos(a) * Math.cos(b) * r);
  }
  g.computeVertexNormals();
  return g;
}

export function buildDecor() {
  const group = new THREE.Group();

  // ---- Ocean names ----
  for (const o of OCEANS) {
    const tex = letteringTexture(o.name);
    if (!tex) continue;
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const ink = TSL.texture(tex, TSL.uv());
    const night = TSL.float(1).sub(dayness(radial()).mul(0.4));
    m.colorNode = ink.rgb.mul(0.85).mul(night);
    m.opacityNode = ink.a.mul(0.55);
    const arc = 0.42 * o.size;
    const mesh = new THREE.Mesh(curvedCard(arc, arc * 0.1875), m);
    // The card is built facing +z at lon 0, lat 0; turn it to its sea
    const q = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(0, (o.lon * Math.PI) / 180, 0))
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((-o.lat * Math.PI) / 180, 0, o.tilt)));
    mesh.quaternion.copy(q);
    mesh.renderOrder = 2;
    group.add(mesh);
  }

  // ---- Boats and whales: little paper models on the sea ----
  const n = TSL.normalize(TSL.normalWorld) as unknown as V3;
  const card = (c: string) => {
    const m = new THREE.MeshBasicNodeMaterial();
    m.colorNode = shade(hex(c), n, radial(), 0.5);
    return m;
  };
  const hull = card('#B3402F');
  const sail = card('#F6EEDC');
  const whaleMat = card('#4C6A9A');
  const lampMat = new THREE.MeshBasicNodeMaterial();
  lampMat.colorNode = hex('#FFC86A').mul(TSL.float(0.6).add(TSL.float(1).sub(dayness(radial())).mul(1.4)));
  const boat = () => {
    const g = new THREE.Group();
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.32, 0.24, 6, 1).scale(1.8, 1, 0.7), hull);
    h.position.y = 0.12;
    const s1 = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 3).scale(0.08, 1, 1), sail);
    s1.position.set(0.1, 0.8, 0);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.3), sail);
    cabin.position.set(-0.4, 0.34, 0);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.31), lampMat);
    lamp.position.set(-0.4, 0.36, 0);
    g.add(h, s1, cabin, lamp);
    return g;
  };
  const whale = () => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10).scale(1.8, 0.55, 0.8), whaleMat);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.5, 3).scale(1, 1, 0.12).rotateZ(Math.PI / 2), whaleMat);
    tail.position.set(-1.0, 0.35, 0);
    tail.rotation.z = -0.6;
    g.add(body, tail);
    return g;
  };
  const sailors: { obj: THREE.Group; lon: number; lat: number; heading: number; speed: number; size: number }[] = [];
  const BOATS: [number, number][] = [
    [-30, 38], [-60, 15], [-125, 25], [170, 30], [140, -42], [65, -5], [-5, -45], [-160, -20], [100, 5], [-42, -40],
  ];
  const WHALES: [number, number][] = [[-140, -35], [-28, 55], [120, -52], [175, 50], [40, -45]];
  BOATS.forEach(([lon, lat], k) => {
    const obj = boat();
    group.add(obj);
    sailors.push({ obj, lon, lat, heading: k * 1.3, speed: 0.6 + (k % 3) * 0.2, size: 0.016 });
  });
  WHALES.forEach(([lon, lat], k) => {
    const obj = whale();
    group.add(obj);
    sailors.push({ obj, lon, lat, heading: k * 2.1, speed: 0.3, size: 0.02 });
  });

  const at = new THREE.Vector3();
  const up = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  const update = (t: number) => {
    for (const s of sailors) {
      const lon = s.lon + Math.cos(s.heading) * t * s.speed;
      const lat = s.lat + Math.sin(s.heading) * t * s.speed * 0.3;
      geo(lon, lat, SEA + 0.0005, at);
      up.copy(at).normalize();
      s.obj.position.copy(at);
      s.obj.quaternion.setFromUnitVectors(Y, up);
      s.obj.rotateY(s.heading + Math.sin(t * 0.7 + s.lon) * 0.1);
      // Riding the swell
      s.obj.rotateX(Math.sin(t * 1.8 + s.lat) * 0.08);
      s.obj.scale.setScalar(s.size);
    }
  };
  update(0);
  return { group, update };
}
