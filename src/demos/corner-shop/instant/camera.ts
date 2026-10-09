import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

import { dialTexture, SPEEDS } from './dials';
import {
  cameraBody,
  cameraLight,
  chrome,
  darkGlass,
  engraved,
  flashMaterial,
  gloss,
  knurled,
  lampMaterial,
  leatherette,
  lensGlass,
  markedRing,
} from './materials';
import {
  barrelGeometry,
  bezelGeometry,
  BODY,
  bodyGeometry,
  counterGeometry,
  DIAL,
  dialFaceGeometry,
  dialGeometry,
  doorGeometry,
  eyepieceGeometry,
  eyepieceGlassGeometry,
  finderGeometry,
  flashGeometry,
  LENS,
  LENS_TRAVEL,
  lensGlassGeometry,
  lensRingGeometry,
  ledGeometry,
  lugGeometry,
  PLATES,
  SHUTTER,
  shutterGeometry,
  slotGeometry,
  TOP,
} from './model';

/**
 * The instant camera from the Instant demo, as a thing in a room: the rangefinder-style body in
 * pebbled leatherette between brushed plates, the knurled lens ring, the shutter and the dial. Its
 * lens pulls out to switch it on; the flash fires; the lamp on the back charges orange and goes
 * green. Built at its own scale (a unit is a centimetre), front toward +z.
 */

export const FINISHES = {
  silver: { leather: '#151517', plate: '#DADBDD', ink: '#141416' },
  brown: { leather: '#5B3B27', plate: '#D7D5D1', ink: '#141416' },
  black: { leather: '#141416', plate: '#2B2B2E', ink: '#E8E8E6' },
};

export function buildInstantCamera(finish: keyof typeof FINISHES) {
  const f = FINISHES[finish];
  const light = cameraLight();
  const leatherU = TSL.uniform(new THREE.Color(f.leather));
  const plateU = TSL.uniform(new THREE.Color(f.plate));
  const inkU = TSL.uniform(new THREE.Color(f.ink));
  const accentU = TSL.uniform(new THREE.Color('#D8401E'));
  const fireU = TSL.uniform(0);
  const lampU = TSL.uniform(0);
  const lampColor = TSL.uniform(new THREE.Color(1, 0.45, 0.1));

  const group = new THREE.Group();
  const metal = (center: [number, number], rim: number, axis: 'y' | 'z') => knurled(plateU, center, rim, axis, light);
  const add = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = group) => {
    const o = new THREE.Mesh(g, m);
    parent.add(o);
    return o;
  };
  add(bodyGeometry(), cameraBody(leatherU, plateU, PLATES.top, PLATES.bottom, TOP, light));
  add(bezelGeometry(), metal([LENS.x, LENS.y], LENS.bezel, 'z'));
  add(flashGeometry(), flashMaterial(fireU, light));
  add(finderGeometry(), darkGlass(light));
  const shutter = add(shutterGeometry(), metal([SHUTTER.x, SHUTTER.z], SHUTTER.r + 0.16, 'y'));
  add(dialGeometry(), metal([DIAL.x, DIAL.z], DIAL.r, 'y'));
  add(dialFaceGeometry(), engraved(plateU, inkU, accentU, dialTexture(SPEEDS, 0), light));
  lugGeometry().forEach((g) => add(g, chrome(light)));
  add(slotGeometry(), gloss([0.035, 0.035, 0.04], 0.7, light));
  add(eyepieceGeometry(), gloss([0.05, 0.05, 0.055], 0.25, light));
  add(eyepieceGlassGeometry(), darkGlass(light));
  add(doorGeometry(), leatherette(leatherU, light));
  add(counterGeometry(), darkGlass(light));
  add(ledGeometry(), lampMaterial(lampColor, lampU));
  const barrel = new THREE.Group();
  barrel.position.set(LENS.x, LENS.y, 0);
  group.add(barrel);
  add(barrelGeometry(), metal([0, 0], LENS.barrel + 0.3, 'z'), barrel);
  add(lensRingGeometry(), markedRing(light), barrel);
  add(lensGlassGeometry(), lensGlass(light), barrel);
  const lensBack = BODY.d / 2 + 0.52 - 0.22 + 0.02;
  barrel.position.z = lensBack;

  let lens = 0;
  let lensV = 0;
  let lensOn = false;
  let fire = 0;
  let press = 0;

  return {
    group,
    /** Room light on it: dim and warm on the desk, full when held up */
    light,
    setOn(on: boolean) {
      lensOn = on;
      if (!on) lampU.value = 0;
    },
    /** The lamp: charging (orange, breathing) or ready (green) */
    lamp(state: 'charging' | 'ready', t: number) {
      if (state === 'charging') {
        lampColor.value.setRGB(1, 0.45, 0.1);
        lampU.value = 0.55 + 0.45 * Math.sin(t * 14);
      } else {
        lampColor.value.setRGB(0.3, 1, 0.45);
        lampU.value = 1;
      }
    },
    /** The shutter goes down and the flash fires */
    fire() {
      fire = 1;
      press = 1;
    },
    update(dt: number) {
      // The lens on its spring
      lensV += (((lensOn ? 1 : 0) - lens) * 260 - lensV * 15) * dt;
      lens += lensV * dt;
      barrel.position.z = lensBack + lens * LENS_TRAVEL;
      fire = Math.max(0, fire - dt * 4.5);
      fireU.value = fire * fire;
      press = Math.max(0, press - dt * 6);
      shutter.position.y = -press * 0.1;
    },
  };
}

export type InstantCamera = ReturnType<typeof buildInstantCamera>;
