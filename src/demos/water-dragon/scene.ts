import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import type { Art } from './art';
import { buildBackdrop } from './backdrop';
import { buildDragon, buildSnake, type PuppetModel } from './dragon';
import { hex, KEY_DIR, lacquer, lanternLight, MOON_DIR, type F, type V3 } from './look';
import { Pond, POND } from './pond';
import { createSpray, DROP, MIST } from './spray';
import { buildStage, STAGE } from './stage';
import { BOUNDS, collide, DRAGON, Puppet, SNAKE, xLimit } from './swim';

/**
 * A water puppet show on a pond at night: a dragon and a cobra, in front of their stage, each on
 * its bamboo pole from behind the screen the way the puppeteers work them. A finger on the water
 * takes hold of the nearer one and it swims after the finger, two fingers take one each; the other
 * one, left to itself, comes after the first. The snake strikes, the dragon sprays water from its
 * mouth, either leaps; a hit knocks the other back and under. Everything that breaks the surface
 * throws up water, every drop that falls back leaves its ring, the waves rock the lotus lamps.
 *
 * Metres; the water's at y = 0, the audience toward +z.
 */

export type Who = 'dragon' | 'snake';
export type ShowHaptic = 'splash' | 'bigSplash' | 'leap' | 'spray' | 'ripple' | 'hit' | 'strike';
export type ShowCue = 'drum' | 'splash' | 'bigSplash' | 'plop' | 'spray' | 'flute' | 'hit';

export type ShowEvents = {
  onHaptic: (kind: ShowHaptic) => void;
  onCue: (cue: ShowCue) => void;
  /** Someone landed a hit: the score so far */
  onScore: (score: Record<Who, number>, by: Who) => void;
};

const { vec2, vec3, float, mix, exp, pow, dot, normalize, saturate, smoothstep, max } = TSL;

/** The audience's seat: low over the water, the stage straight ahead (the screen held sideways) */
const SEAT = new THREE.Vector3(0, 2.3, 5.0);
const AIM = new THREE.Vector3(0, 0.8, -4.5);
const FOV = 40;
/** The water's mesh is centred this far back */
const WATER_Z = -12;
/** Where the puppeteers stand, behind the screen, their poles' ends low under the water */
const PIVOT_Z = STAGE.z + (STAGE.depth / 2) * STAGE.scale - 0.35;
const PIVOT_Y = -0.42;

export function createShow(context: GPUCanvasContext & { present: () => void }, device: GPUDevice, events: ShowEvents, art: Art) {
  const canvas = context.canvas as unknown as { width: number; height: number; clientWidth: number; clientHeight: number };
  let width = canvas.clientWidth;
  let height = canvas.clientHeight;
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    alpha: false,
    canvas: context.canvas as HTMLCanvasElement,
    context,
    device,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.width, canvas.height, false);
  THREE.ColorManagement.enabled = false;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050a1a);
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.1, 900);
  scene.add(camera);

  const stage = buildStage(art);
  scene.add(stage.root);
  const backdrop = buildBackdrop(art);
  scene.add(backdrop.root);
  const pond = new Pond();
  const puppets: Record<Who, Puppet> = {
    dragon: new Puppet(DRAGON, { x: -0.9, z: PIVOT_Z - 0.4, heading: 0.15 }, 1.4),
    snake: new Puppet(SNAKE, { x: 1.1, z: PIVOT_Z - 0.4, heading: -0.25 }, 4.6),
  };
  const models: Record<Who, PuppetModel> = { dragon: buildDragon(DRAGON), snake: buildSnake(SNAKE) };
  scene.add(models.dragon.root, models.snake.root);
  const spray = createSpray(2600);
  scene.add(spray.mesh);
  const other = (w: Who): Who => (w === 'dragon' ? 'snake' : 'dragon');
  const WHO: Who[] = ['dragon', 'snake'];

  // ---- The poles: bamboo, from the puppeteer's hands behind the screen to under the puppet ----
  const poleMat = new THREE.MeshBasicNodeMaterial();
  poleMat.colorNode = TSL.Fn(() => {
    const y = TSL.positionLocal.y;
    const node = smoothstep(0.03, 0.0, TSL.abs(TSL.fract(y.mul(TSL.uniform(1).onObjectUpdate(({ object }) => object?.scale.y ?? 1)).mul(1.6)).sub(0.5)));
    const cane = mix(hex('#8A6A34'), hex('#5A3E18'), node);
    TSL.If(TSL.cameraPosition.y.lessThan(0), () => {
      TSL.Discard();
    });
    return lacquer(cane as unknown as V3, float(0) as unknown as F, float(1) as unknown as F);
  })();
  const poleGeo = new THREE.CylinderGeometry(0.03, 0.036, 1, 8, 1).translate(0, 0.5, 0);
  const rodGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 6, 1).translate(0, 0.5, 0);
  const poles = WHO.map(() => {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    const rod = new THREE.Mesh(rodGeo, poleMat);
    pole.frustumCulled = rod.frustumCulled = false;
    scene.add(pole, rod);
    return { pole, rod, x: 0, wasAt: new THREE.Vector3() };
  });
  const up = new THREE.Vector3(0, 1, 0);
  const span = new THREE.Vector3();
  const attach = new THREE.Vector3();
  const pivot = new THREE.Vector3();
  const stretch = (mesh: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3) => {
    span.subVectors(to, from);
    const len = Math.max(0.01, span.length());
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(up, span.divideScalar(len));
    mesh.scale.set(1, len, 1);
  };

  // ---- The water ----
  const heights = pond.texture;
  const mirror = TSL.reflector({ resolutionScale: 0.5 });
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 70, 360, 260),
    new THREE.MeshBasicNodeMaterial({ transparent: true })
  );
  {
    const m = water.material as THREE.MeshBasicNodeMaterial;
    const at = (p: THREE.Node<'vec2'>) => p.sub(vec2(POND.x0, POND.z0)).div(vec2(POND.w, POND.d));
    const inside = (q: THREE.Node<'vec2'>) =>
      smoothstep(0, 0.02, q.x).mul(smoothstep(1, 0.98, q.x)).mul(smoothstep(0, 0.02, q.y)).mul(smoothstep(1, 0.98, q.y));
    // Up and down with the waves (the mesh lies in x/y before it's laid flat: its y is the world's -z)
    const pl = TSL.positionLocal;
    const qv = at(vec2(pl.x, pl.y.negate().add(WATER_Z)));
    const hv = TSL.texture(heights, qv).level(float(0)).r.mul(inside(qv));
    m.positionNode = vec3(pl.x, pl.y, hv);
    const p = TSL.positionWorld as unknown as V3;
    const q = at(p.xz);
    const e = 1 / 128;
    const tex = (o: THREE.Node<'vec2'>) => TSL.texture(heights, q.add(o));
    const cell = POND.w * e * 2;
    const k = inside(q);
    const hx = tex(vec2(e, 0)).r.sub(tex(vec2(-e, 0)).r).div(cell).mul(k);
    const hz = tex(vec2(0, e)).r.sub(tex(vec2(0, -e)).r).div(cell).mul(k);
    const foam = TSL.texture(heights, q).g.mul(k);
    // The breeze's ripples, always: a few small waves across each other
    const t = TSL.time;
    const ripple = (dir: [number, number], freq: number, speed: number, amp: number) => {
      const ph = p.x.mul(dir[0] * freq).add(p.z.mul(dir[1] * freq)).add(t.mul(speed));
      const c = TSL.cos(ph).mul(amp * freq);
      return vec2(c.mul(dir[0]), c.mul(dir[1]));
    };
    const breeze = ripple([0.8, 0.6], 3.1, 1.3, 0.004)
      .add(ripple([-0.5, 0.86], 4.7, 1.7, 0.0028))
      .add(ripple([0.95, -0.3], 7.9, 2.3, 0.0016))
      .add(ripple([-0.2, -0.98], 12.3, 2.9, 0.001));
    const n = normalize(vec3(hx.add(breeze.x).negate(), 1, hz.add(breeze.y).negate())) as unknown as V3;
    const v = normalize(TSL.cameraPosition.sub(p)) as unknown as V3;
    const dist = TSL.length(TSL.cameraPosition.xz.sub(p.xz));
    // The reflection, bent by the waves (less far off, where they're too small to see)
    const bend = float(0.08).div(dist.mul(0.08).add(1));
    mirror.uvNode = (mirror.uvNode as THREE.Node<'vec2'>).add(n.xz.mul(bend));
    const ndv = saturate(dot(n, v));
    const fres = float(0.06).add(pow(float(1).sub(ndv), 4).mul(0.94));
    const r = TSL.reflect(v.negate(), n) as unknown as V3;
    const moonDir = vec3(MOON_DIR.x, MOON_DIR.y, MOON_DIR.z);
    const keyDir = vec3(KEY_DIR.x, KEY_DIR.y, KEY_DIR.z);
    // Glitter: the moon broken up on the ripples, and the stage light
    const glitter = hex('#E6EEFF')
      .mul(pow(saturate(dot(r, moonDir)), 900).mul(1.1))
      .add(hex('#FFD2A0').mul(pow(saturate(dot(r, keyDir)), 300).mul(0.8)));
    const deep = hex('#04110F');
    const pools = lanternLight(p, null).mul(0.07);
    // (held down, so the moon's not a white-out in it)
    const reflected = TSL.min(mirror.rgb, float(0.9)).mul(float(0.38).add(fres.mul(0.5))) as unknown as V3;
    const foamCol = hex('#9FB2B4').mul(
      smoothstep(0.2, 0.8, foam.mul(TSL.mx_noise_float(vec3(p.x.mul(9), p.z.mul(9), t.mul(0.6))).mul(0.5).add(0.75)))
    );
    const surface = deep.add(pools).add(reflected).add(glitter).add(foamCol.mul(0.45));
    const haze = smoothstep(14, 40, dist);
    m.colorNode = mix(surface, hex('#1A1A2C').add(reflected.mul(0.6)), haze.mul(0.5));
    // A little see-through, close and looking down: the puppets and their poles show under it
    m.opacityNode = saturate(float(0.62).add(fres.mul(0.9)).add(foam.mul(0.4)).add(haze));
  }
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0, WATER_Z);
  water.add(mirror.target);
  water.renderOrder = 2;
  water.frustumCulled = false;
  scene.add(water);
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), new THREE.MeshBasicNodeMaterial());
  (bed.material as THREE.MeshBasicNodeMaterial).colorNode = TSL.Fn(() => {
    TSL.If(TSL.cameraPosition.y.lessThan(0), () => {
      TSL.Discard();
    });
    return hex('#020807');
  })();
  bed.rotation.x = -Math.PI / 2;
  bed.position.set(0, -1.6, WATER_Z);
  scene.add(bed);

  // ---- Post: bloom on what glows, a vignette, soft highlights, grain ----
  const post = new THREE.RenderPipeline(renderer);
  const scenePass = TSL.pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  const glowing = bloom(color, 0.6, 0.55, 0.62);
  const fade = TSL.uniform(1);
  const flash = TSL.uniform(0);
  {
    const pc = TSL.screenUV.sub(0.5);
    const lit = color.rgb.add(glowing.rgb).add(vec3(1, 0.85, 0.7).mul(flash)) as unknown as V3;
    const KNEE = 0.75;
    const soft = TSL.min(lit, KNEE).add(
      exp(max(lit.sub(KNEE), 0).div(1 - KNEE).negate())
        .oneMinus()
        .mul(1 - KNEE)
    );
    const vignette = smoothstep(1.05, 0.25, TSL.length(pc.mul(vec2(1.0, 1.25))));
    const grain = TSL.hash(TSL.screenCoordinate.x.add(TSL.screenCoordinate.y.mul(4099)).add(TSL.floor(TSL.time.mul(24)).mul(7919)))
      .sub(0.5)
      .mul(0.012);
    post.outputNode = TSL.vec4(soft.mul(mix(float(0.45), float(1), vignette)).add(grain).mul(fade.oneMinus()), 1);
  }

  // ---- The camera: the audience's seat, breathing, leaning a little after the action ----
  const look = AIM.clone();
  const tilt = { x: 0, y: 0, nowX: 0, nowY: 0 };
  const camAt = new THREE.Vector3();
  const want = new THREE.Vector3();
  let shake = 0;
  const placeCamera = (t: number, dt: number) => {
    tilt.nowX += (tilt.x - tilt.nowX) * (1 - Math.exp(-dt * 3));
    tilt.nowY += (tilt.y - tilt.nowY) * (1 - Math.exp(-dt * 3));
    const aspect = width / height;
    // Held upright, it sits back to fit the stage in
    const back = aspect < 1 ? 1.6 : 1;
    shake *= Math.exp(-dt * 7);
    // The opening: from further back and higher, gliding in over the water to the seat
    const k = Math.min(1, t / 5.5);
    const glide = 1 - k * k * (3 - 2 * k);
    camAt
      .set(
        Math.sin(t * 0.13) * 0.2 + tilt.nowX * 0.9 + (Math.random() - 0.5) * shake * 0.08,
        Math.sin(t * 0.17 + 1) * 0.08 + tilt.nowY * 0.4 + (Math.random() - 0.5) * shake * 0.06,
        0
      )
      .add(SEAT)
      .sub(AIM)
      .multiplyScalar(back)
      .add(AIM);
    camAt.y += glide * 1.4;
    camAt.z += glide * 5.5;
    // Toward the middle of the action, a little
    const d = puppets.dragon.head.pos;
    const s = puppets.snake.up ? puppets.snake.head.pos : d;
    want.set(
      THREE.MathUtils.clamp((d.x + s.x) * 0.5 * 0.2, -0.6, 0.6),
      AIM.y,
      AIM.z + THREE.MathUtils.clamp(((d.z + s.z) * 0.5 - AIM.z) * 0.1, -0.5, 0.5)
    );
    look.lerp(want, 1 - Math.exp(-dt * 1.2));
    camera.position.copy(camAt);
    camera.lookAt(look);
    camera.fov = aspect < 1 ? 56 : FOV;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  };

  // ---- Water broken: rings, foam, drops, a sound ----
  const carry = new THREE.Vector3();
  let lastSound = 0;
  let lastHaptic = 0;
  let clock = 0;
  const surfaceAt = (x: number, z: number) => pond.heightAt(x, z);
  const breakWater = (x: number, z: number, energy: number, size: number, down: boolean, p: Puppet) => {
    carry.set(Math.sin(p.heading), 0, Math.cos(p.heading)).multiplyScalar(p.speed);
    const e = Math.min(9, energy);
    pond.disturb(x, z, (down ? 1 : -0.7) * Math.min(0.07, 0.009 * e * (size / 0.13)), size * 1.3);
    pond.froth(x, z, 0.08 * e, size * 2);
    spray.burst(x, z, e, size, carry);
    if (clock - lastSound > 0.09) {
      lastSound = clock;
      events.onCue(e > 6 ? 'bigSplash' : e > 2.5 ? 'splash' : 'plop');
    }
    if (e > 3 && clock - lastHaptic > 0.12) {
      lastHaptic = clock;
      events.onHaptic(e > 6 ? 'bigSplash' : 'splash');
    }
  };

  // ---- The fight ----
  const score: Record<Who, number> = { dragon: 0, snake: 0 };
  const struck: Record<Who, boolean> = { dragon: false, snake: false };
  const sprayedAt: Record<Who, number> = { dragon: -1, snake: -1 };
  const hit = (by: Who, x: number, z: number, power: number) => {
    const a = puppets[by];
    const b = puppets[other(by)];
    b.knock(b.head.pos.x - a.head.pos.x, b.head.pos.z - a.head.pos.z, power);
    breakWater(x, z, 7 * power, 0.25, true, b);
    pond.disturb(x, z, 0.05 * power, 0.35);
    score[by]++;
    events.onScore({ ...score }, by);
    events.onHaptic('hit');
    events.onCue('hit');
    shake = 1;
    flash.value = 0.12;
    // The moment it lands, held
    hold = 0.32;
  };
  let hold = 0;
  let lastBump = 0;
  const bumped = (at: THREE.Vector3, depth: number) => {
    if (clock - lastBump < 0.15 || at.y > 0.5 || at.y < -0.5) return;
    lastBump = clock;
    pond.disturb(at.x, at.z, Math.min(0.04, depth * 0.25), 0.25);
    pond.froth(at.x, at.z, 0.4, 0.25);
    spray.burst(at.x, at.z, 2 + depth * 20, 0.12, carry.set(0, 0, 0));
    if (depth > 0.08) events.onHaptic('splash');
  };
  const near = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return dx * dx + dz * dz < r * r && Math.abs(a.y - b.y) < 0.6;
  };
  const fight = () => {
    // The snake's bite: its head into the dragon's head or neck, while it lunges
    for (const w of WHO) {
      const p = puppets[w];
      if (!p.striking) {
        struck[w] = false;
        continue;
      }
      if (struck[w]) continue;
      const foe = puppets[other(w)];
      // Touching is as close as they get, now they bump: a bite is the head right up against it
      const targets = [{ pos: foe.head.pos, r: foe.kind.headR }, ...foe.body.slice(0, 7)];
      if (targets.some((tp) => near(p.head.pos, tp.pos, p.kind.headR + tp.r + 0.1))) {
        struck[w] = true;
        hit(w, p.head.pos.x, p.head.pos.z, 1);
      }
    }
    // The dragon's spout: the other one in front of it, in range
    for (const w of WHO) {
      const p = puppets[w];
      if (!p.spout.on || clock - sprayedAt[w] < 1.2) continue;
      const foe = puppets[other(w)];
      const dx = foe.head.pos.x - p.spout.at.x;
      const dz = foe.head.pos.z - p.spout.at.z;
      const d = Math.hypot(dx, dz);
      const fx = p.spout.dir.x;
      const fz = p.spout.dir.z;
      const fl = Math.hypot(fx, fz) || 1;
      const cos = (dx * fx + dz * fz) / (d * fl || 1);
      if (d > 0.8 && d < 4.2 && cos > 0.93) {
        sprayedAt[w] = clock;
        hit(w, foe.head.pos.x, foe.head.pos.z, 0.8);
      }
    }
    // Leaping on the other: coming down on its head
    for (const w of WHO) {
      const p = puppets[w];
      const foe = puppets[other(w)];
      for (const c of p.crossings) {
        if (c.down && c.vy < -3 && Math.hypot(c.x - foe.head.pos.x, c.z - foe.head.pos.z) < 0.8 && clock - sprayedAt[w] > 1) {
          sprayedAt[w] = clock;
          hit(w, c.x, c.z, 1.2);
        }
      }
    }
  };

  // ---- Left to themselves: they go after each other ----
  const next: Record<Who, number> = { dragon: 9, snake: 8 };
  const think = (w: Who) => {
    const p = puppets[w];
    // The dragon's in the player's hands; left alone a good while, it plays by itself
    if (clock - p.touched < (w === 'dragon' ? 10 : 2.6)) return;
    const foe = puppets[other(w)];
    const t = clock;
    if (!foe.up) {
      const k = t * 0.19;
      p.steer(1.4 * Math.sin(k * 1.3 + 0.4), -3.8 + 2.2 * Math.sin(k * 2.0 + 1.2), false);
      return;
    }
    // Circle the other at a distance, closing in now and then
    const dx = p.head.pos.x - foe.head.pos.x;
    const dz = p.head.pos.z - foe.head.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const a = Math.atan2(dx, dz) + (w === 'snake' ? 0.7 : -0.6);
    const keep = w === 'snake' ? 1.9 : 2.6;
    // ...drawn back toward the middle of the pond, where the audience sees it best
    p.steer(
      (foe.head.pos.x + Math.sin(a) * keep) * 0.7,
      (foe.head.pos.z + Math.cos(a) * keep) * 0.7 + -3.6 * 0.3,
      false
    );
    if (t < next[w] || p.busy) return;
    const facing = (-dx * Math.sin(p.heading) - dz * Math.cos(p.heading)) / d;
    if (w === 'snake' && d < 2.2 && facing > 0.6) {
      if (p.strike(foe.head.pos.x, foe.head.pos.z)) {
        events.onHaptic('strike');
        next[w] = t + 3 + Math.random() * 2.5;
      }
    } else if (w === 'dragon' && d > 1.4 && d < 3.6 && facing > 0.85) {
      if (p.spray()) next[w] = t + 6 + Math.random() * 3;
    } else if (Math.random() < 0.004) {
      if (p.leap(0.8 + Math.random() * 0.35)) next[w] = t + 5;
    }
  };

  // The lotus lamps: pushed off by the puppets as they swim through them
  const pushOut = { x: 0, z: 0 };
  const push = (x: number, z: number) => {
    pushOut.x = 0;
    pushOut.z = 0;
    const by = (px: number, pz: number, py: number, r: number, speed: number) => {
      if (py < -0.4) return;
      const dx = x - px;
      const dz = z - pz;
      const d2 = dx * dx + dz * dz;
      const reach = (r + 0.35) ** 2;
      if (d2 < reach && d2 > 1e-6) {
        const f = (1 - d2 / reach) * 6 * speed;
        const d = Math.sqrt(d2);
        pushOut.x += (dx / d) * f;
        pushOut.z += (dz / d) * f;
      }
    };
    for (const w of WHO) {
      const p = puppets[w];
      by(p.head.pos.x, p.head.pos.z, p.head.pos.y, 0.3, p.speed);
      for (const s of p.body) by(s.pos.x, s.pos.z, s.pos.y, s.r, p.speed);
    }
    return pushOut;
  };

  let last = performance.now();
  let failed = false;
  let onFirstFrame: (() => void) | null = null;
  let introCue = 0;
  const wasAirborne: Record<Who, boolean> = { dragon: false, snake: false };
  const wasSpouting: Record<Who, boolean> = { dragon: false, snake: false };
  const p0 = new THREE.Vector3();
  const v0 = new THREE.Vector3();

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const real = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (failed) return;
    // A hit holds the moment: everything slowed right down, then picking up again
    hold = Math.max(0, hold - real);
    const dt = real * (1 - 0.8 * Math.min(1, hold / 0.16));
    clock += dt;
    try {
      fade.value += (0 - fade.value) * (1 - Math.exp(-dt * 1.6));
      flash.value *= Math.exp(-dt * 9);
      // A drum, the flute, and they come out from behind the screen, the dragon first
      if (introCue === 0 && clock > 0.6) {
        introCue = 1;
        events.onCue('drum');
      }
      if (introCue === 1 && clock > 1.5) {
        introCue = 2;
        events.onCue('flute');
      }
      if (introCue === 2 && clock > 2.4) {
        introCue = 3;
        puppets.dragon.leap(1.05);
      }
      if (introCue === 3 && clock > 4.4) {
        introCue = 4;
        events.onCue('drum');
      }

      for (const w of WHO) {
        const p = puppets[w];
        if (p.up && clock > 4) think(w);
        else if (!p.up) p.steer(w === 'dragon' ? -0.6 : 1.2, -4.5, false);
        p.update(dt, surfaceAt);
      }
      // They bump off each other, and off their own coils, rather than pass through: a hard knock
      // throws up water where they meet
      for (let pass = 0; pass < 2; pass++) {
        collide(puppets.dragon, puppets.snake, bumped);
        collide(puppets.dragon, puppets.dragon);
        collide(puppets.snake, puppets.snake);
        puppets.dragon.relax();
        puppets.snake.relax();
      }
      for (const w of WHO) {
        const p = puppets[w];
        p.finish(dt, surfaceAt);
        models[w].pose(p);
        if (p.inAir && !wasAirborne[w]) {
          events.onHaptic('leap');
          events.onCue('drum');
        }
        wasAirborne[w] = p.inAir;
        for (const c of p.crossings) breakWater(c.x, c.z, Math.abs(c.vy) * 0.9 + c.speed * 0.35, c.size, c.down, p);
        // The wake: what's in the water as it swims pushes it aside, churns it a little
        const wakeAt = (x: number, y: number, z: number, r: number) => {
          const sink = Math.abs(y);
          if (sink > r * 1.3) return;
          const k = (1 - sink / (r * 1.3)) * p.speed * dt;
          pond.disturb(x, z, 0.05 * k, r * 1.5);
          pond.froth(x, z, 0.15 * k, r * 1.6);
        };
        for (const s of p.body) {
          wakeAt(s.pos.x, s.pos.y, s.pos.z, s.r);
          // Out of the water, still running with it: drips
          if (s.wet > 0.15 && s.pos.y > 0.06 && Math.random() < dt * 5 * s.wet) {
            const a = Math.random() * Math.PI * 2;
            p0.set(s.pos.x + Math.cos(a) * s.r * 0.7, s.pos.y - s.r * 0.6, s.pos.z + Math.sin(a) * s.r * 0.7);
            v0.set(0, -0.3 - Math.random() * 0.4, 0);
            spray.spawn(p0, v0, 0.008 + Math.random() * 0.007, DROP, 2);
          }
        }
        wakeAt(p.head.pos.x, p.head.pos.y - 0.12, p.head.pos.z, 0.16);

        // The spout
        if (p.spout.on) {
          if (!wasSpouting[w]) {
            events.onCue('spray');
            events.onHaptic('spray');
          }
          // A jet: a tight core of big drops, a looser spray of fine ones round it, and mist
          const n = Math.round(dt * 420);
          for (let i = 0; i < n; i++) {
            const core = i % 3 === 0;
            const spread = core ? 0.25 : 1.1;
            p0.copy(p.spout.at).addScaledVector(p.spout.dir, Math.random() * 0.06);
            v0.copy(p.spout.dir).multiplyScalar((core ? 6.4 : 5) + Math.random() * 1.4);
            v0.x += (Math.random() - 0.5) * spread;
            v0.y += (Math.random() - 0.5) * spread * 0.8;
            v0.z += (Math.random() - 0.5) * spread;
            spray.spawn(p0, v0, core ? 0.022 + Math.random() * 0.012 : 0.011 + Math.random() * 0.01, DROP, 3);
          }
          if (Math.random() < dt * 40) {
            v0.copy(p.spout.dir).multiplyScalar(1.6 + Math.random() * 1.8);
            spray.spawn(p0.copy(p.spout.at).addScaledVector(p.spout.dir, 0.3 + Math.random() * 0.6), v0, 0.12 + Math.random() * 0.14, MIST, 1.4);
          }
        }
        wasSpouting[w] = p.spout.on;

        // Its pole: from the puppeteer's hands to under its body, the puppeteer moving along behind
        const pole = poles[WHO.indexOf(w)];
        const holdAt = p.body[Math.min(2, p.body.length - 1)].pos;
        pole.x += (THREE.MathUtils.clamp(holdAt.x * 0.75, -2.6, 2.6) - pole.x) * (1 - Math.exp(-dt * 1.5));
        pivot.set(pole.x, PIVOT_Y, PIVOT_Z);
        attach.set(holdAt.x, Math.min(-0.3, holdAt.y - 0.25), holdAt.z);
        stretch(pole.pole, pivot, attach);
        stretch(pole.rod, attach, holdAt);
        // Pushed quickly through the water, the pole shows on the surface as a line of ripples
        const moved = pole.wasAt.distanceTo(attach) / Math.max(dt, 1e-3);
        pole.wasAt.copy(attach);
        if (moved > 1.2 && p.up) {
          for (let i = 1; i <= 3; i++) {
            const k = i / 4;
            pond.disturb(pivot.x + (attach.x - pivot.x) * k, pivot.z + (attach.z - pivot.z) * k, 0.0018 * moved * dt * 60 * 0.05, 0.3);
          }
        }
      }
      fight();

      spray.update(dt, camera, surfaceAt, (x, z, size) => {
        // Each drop leaves its ring; most of them, anyway
        if (Math.random() < 0.55) pond.disturb(x, z, size * 0.32, 0.07);
      });
      pond.step(dt);
      stage.update(clock, dt, pond, push);
      backdrop.update(clock, dt, pond, push, camera);
      stage.glow.value = 0.5 + Math.sin(clock * 2.1) * 0.04 + Math.sin(clock * 5.3) * 0.02;

      placeCamera(clock, dt);
      post.render();
      context.present();
    } catch (e) {
      if (__DEV__) console.error('[water-dragon]', e);
      failed = true;
      return;
    }
    if (onFirstFrame) {
      const cb = onFirstFrame;
      onFirstFrame = null;
      cb();
    }
  });

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const level = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitAt = new THREE.Vector3();
  /** Where a point on the screen (in points) is on the water; the far edge if it's above the horizon */
  const onWater = (x: number, y: number) => {
    ndc.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(level, hitAt) || hitAt.z < -30) {
      hitAt.copy(ray.ray.direction).setY(0).normalize().multiplyScalar(20).add(camera.position).setY(0);
    }
    return hitAt;
  };

  return {
    /**
     * The pole, from the puppeteer behind the screen: (u, v) on the pad, a map of the pond seen
     * from behind it, u -1 to 1 across, v 0 at the screen to 1 out front. The dragon goes there.
     */
    pole(u: number, v: number) {
      const z = THREE.MathUtils.lerp(BOUNDS.zBack, BOUNDS.zFront, THREE.MathUtils.clamp(v, 0, 1));
      puppets.dragon.steer(THREE.MathUtils.clamp(u, -1, 1) * xLimit(z), z);
    },
    /** Its cords: the head held up, the pump squeezed, the pole pressed down (let go: a leap) */
    raise(on: boolean) {
      puppets.dragon.touched = puppets.dragon.t;
      puppets.dragon.raise(on);
    },
    pump(on: boolean) {
      puppets.dragon.touched = puppets.dragon.t;
      puppets.dragon.pump(on);
    },
    dive(on: boolean) {
      puppets.dragon.touched = puppets.dragon.t;
      return puppets.dragon.dive(on);
    },
    /** Where each is now, as (u, v) on the pole's pad (the cobra: null while it's not out) */
    where() {
      const at = (p: Puppet) => ({ u: p.head.pos.x / xLimit(p.head.pos.z), v: (p.head.pos.z - BOUNDS.zBack) / (BOUNDS.zFront - BOUNDS.zBack) });
      const d = puppets.dragon;
      return {
        u: d.x / xLimit(d.z),
        v: (d.z - BOUNDS.zBack) / (BOUNDS.zFront - BOUNDS.zBack),
        cobra: puppets.snake.up ? at(puppets.snake) : null,
      };
    },
    /** How long the dragon's been held under, for how hard it'll leap: 0 to 1 */
    get charge() {
      return puppets.dragon.charge;
    },
    /** A tap on the water: a ring there */
    tap(x: number, y: number) {
      const w = onWater(x, y);
      pond.disturb(w.x, w.z, 0.05, 0.16);
      pond.froth(w.x, w.z, 0.15, 0.15);
      events.onCue('plop');
      events.onHaptic('ripple');
    },
    leap(who: Who) {
      return puppets[who].leap(1);
    },
    /** The dragon sprays; the snake strikes at the dragon (or straight ahead, if it's far) */
    attack(who: Who) {
      const p = puppets[who];
      if (who === 'dragon') return p.spray();
      const foe = puppets.dragon;
      const d = Math.hypot(foe.head.pos.x - p.head.pos.x, foe.head.pos.z - p.head.pos.z);
      const ok =
        d < 3.2
          ? p.strike(foe.head.pos.x, foe.head.pos.z)
          : p.strike(p.head.pos.x + Math.sin(p.heading) * 2, p.head.pos.z + Math.cos(p.heading) * 2);
      if (ok) events.onHaptic('strike');
      return ok;
    },
    /** The phone's gravity, in its own axes, in g: the seat leans with it a little */
    motion(gx: number, gy: number, gz: number) {
      tilt.x = THREE.MathUtils.clamp(gx, -0.5, 0.5);
      tilt.y = THREE.MathUtils.clamp(-gz - 0.55, -0.4, 0.4);
      void gy;
    },
    resize(w: number, h: number, ratio: number) {
      width = w;
      height = h;
      renderer.setSize(w * ratio, h * ratio, false);
    },
    debug() {
      const r = (v: THREE.Vector3) => v.toArray().map((x) => Math.round(x * 100) / 100);
      return { failed, dragon: r(puppets.dragon.head.pos), snake: r(puppets.snake.head.pos), drops: spray.count, score };
    },
    onFirstFrame(cb: () => void) {
      onFirstFrame = cb;
    },
    dispose() {
      renderer.setAnimationLoop(null);
      post.dispose();
      renderer.dispose();
    },
  };
}

export type Show = ReturnType<typeof createShow>;
