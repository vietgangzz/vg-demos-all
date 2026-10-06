import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

/**
 * The look on top of the matcaps: a living sky painted behind everything in one fragment
 * shader, glowing materials for the sun, moon, lightning and fireflies (colours above 1, which
 * the bloom pass picks out), clouds lit by the sun, a moon with maria and craters, water that
 * catches the sky, and particles that move on the GPU so the JS thread only sets a few numbers.
 */

type F = THREE.Node<'float'>;
type V2 = THREE.Node<'vec2'>;
type V3 = THREE.Node<'vec3'>;

const { float, vec2, vec3, vec4, uniform, mix, smoothstep, pow, exp, sin, cos, fract, floor, length, dot } = TSL;
const { clamp, step, abs, max, oneMinus, saturate, atan, normalize, uv, Fn, Loop, If } = TSL;

/** 0..1 hash of a 2D cell, from the integer PCG hash (sin() hashes band on mobile GPUs) */
export const hash21 = (p: V2) => TSL.hash(p.x.add(p.y.mul(157)).add(8192)) as F;

/** Smooth value noise */
export const noise2 = Fn(([q]: [V2]) => {
  const i = floor(q);
  const f = fract(q);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const a = hash21(i);
  const b = hash21(i.add(vec2(1, 0)));
  const c = hash21(i.add(vec2(0, 1)));
  const d = hash21(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

/** Four octaves of value noise, 0..~1 */
export const fbm2 = Fn(([q]: [V2]) => {
  const p = vec2(q).toVar();
  const v = float(0).toVar();
  const a = float(0.5).toVar();
  Loop(4, () => {
    v.addAssign(a.mul(noise2(p)));
    p.assign(p.mul(2.03).add(vec2(17.1, 9.2)));
    a.mulAssign(0.5);
  });
  return v;
});

/** Twinkling stars on a jittered grid: `scale` cells per unit; the brightest go past 1 to bloom */
const starLayer = Fn(([p, scale, seed, t, density]: [V2, F, F, F, F]) => {
  const g = p.mul(scale).add(seed);
  const cell = floor(g);
  const f = fract(g);
  const h = hash21(cell);
  const c = vec2(hash21(cell.add(19.7)), hash21(cell.add(41.3)))
    .mul(0.7)
    .add(0.15);
  const d = length(f.sub(c));
  const size = mix(0.04, 0.12, pow(h, 6));
  const twinkle = sin(t.mul(h.mul(3).add(1.2)).add(h.mul(60)))
    .mul(0.35)
    .add(0.65);
  return smoothstep(size, 0, d)
    .mul(step(oneMinus(density), h))
    .mul(twinkle)
    .mul(mix(0.6, 2.4, pow(h, 10)));
});

/** Slanted streaks of distant rain falling through the sky */
const rainLayer = Fn(([p, scale, speed, slant, t, amount]: [V2, F, F, F, F, F]) => {
  const g = vec2(p.x.add(p.y.mul(slant)).mul(scale), p.y.mul(scale).mul(0.16).add(t.mul(speed)));
  const cell = floor(g);
  const f = fract(g);
  const h = hash21(cell);
  const x = hash21(cell.add(7.7)).mul(0.6).add(0.2);
  const line = smoothstep(0.09, 0, abs(f.x.sub(x)));
  const dash = smoothstep(0.25, 0.9, f.y).mul(smoothstep(1, 0.92, f.y));
  return line.mul(dash).mul(step(oneMinus(amount.mul(0.75)), h));
});

/** Distant snow drifting down and side to side */
const snowLayer = Fn(([p, scale, speed, t, amount]: [V2, F, F, F, F]) => {
  const g = vec2(p.x.mul(scale).add(sin(p.y.mul(4).add(t.mul(0.7))).mul(0.35)), p.y.mul(scale).add(t.mul(speed)));
  const cell = floor(g);
  const f = fract(g);
  const h = hash21(cell);
  const c = vec2(hash21(cell.add(3.1)), hash21(cell.add(5.9)))
    .mul(0.6)
    .add(0.2);
  return smoothstep(mix(0.06, 0.16, h), 0, length(f.sub(c))).mul(step(oneMinus(amount.mul(0.7)), h));
});

export type Backdrop = ReturnType<typeof createBackdrop>;

/**
 * The sky behind everything, as one full-screen fragment shader: the palette gradient with a
 * warm horizon at golden hour, the sun's halo and slow rays, high cirrus and banks of distant
 * cloud lit from the sun's side, stars that twinkle, the Milky Way and the odd shooting star at
 * night, sheets of far rain and snow, mist low down, dust in haze, heat shimmer, lightning
 * flashing through the cloud, a soft vignette and dither so the gradients never band.
 */
export function createBackdrop() {
  const u = {
    time: uniform(0),
    aspect: uniform(0.46),
    top: uniform(new THREE.Color('#BFE0FF')),
    bottom: uniform(new THREE.Color('#FFF7EC')),
    horizon: uniform(new THREE.Color('#FFB27A')),
    horizonAmount: uniform(0),
    /** The sun or moon on screen, in uv */
    light: uniform(new THREE.Vector2(0.7, 0.75)),
    lightColor: uniform(new THREE.Color(1, 0.85, 0.5)),
    sunGlow: uniform(0),
    moonGlow: uniform(0),
    night: uniform(0),
    cloud: uniform(0),
    dark: uniform(0),
    rain: uniform(0),
    snow: uniform(0),
    fog: uniform(0),
    haze: uniform(0),
    /** 0..1 a skin's flat backdrop: the sky's features fade, leaving the top-bottom gradient */
    plain: uniform(0),
    heat: uniform(0),
    wind: uniform(0),
    flash: uniform(0),
    flashAt: uniform(new THREE.Vector2(0.5, 0.7)),
    cloudLit: uniform(new THREE.Color('#FFFFFF')),
    cloudShade: uniform(new THREE.Color('#B8C4D6')),
  };

  const material = new THREE.MeshBasicNodeMaterial({ depthWrite: false, depthTest: false, fog: false });
  material.colorNode = Fn(() => {
    const t = u.time;
    const uv0 = uv();
    // Heat rising: the low sky wobbles
    const shimmer = sin(uv0.y.mul(70).sub(t.mul(5)))
      .mul(sin(uv0.x.mul(23).add(t.mul(1.7))))
      .mul(0.004)
      .mul(u.heat)
      .mul(smoothstep(0.75, 0, uv0.y));
    const q = vec2(uv0.x.add(shimmer), uv0.y);
    // Isotropic: x spans the aspect, y spans 1
    const p = vec2(q.x.sub(0.5).mul(u.aspect), q.y);

    const col = vec3(mix(u.bottom, u.top, smoothstep(0, 1, q.y))).toVar();
    col.assign(mix(col, u.horizon, u.horizonAmount.mul(exp(q.y.mul(-2.6))).mul(0.9)));

    // ---- The sun's halo and slow rays, or the moon's glow ----
    const lp = vec2(u.light.x.sub(0.5).mul(u.aspect), u.light.y);
    const toLight = p.sub(lp);
    const dl = length(toLight);
    const clearness = oneMinus(u.cloud.mul(0.65)).mul(oneMinus(u.fog.mul(0.7)));
    // Tight round the sun, wider at golden hour when the whole low sky warms
    const halo = exp(dl.mul(-3.4))
      .mul(mix(0.16, 0.42, u.horizonAmount))
      .add(exp(dl.mul(-12)).mul(0.4))
      .mul(u.sunGlow);
    const ang = atan(toLight.y, toLight.x);
    const r1 = sin(ang.mul(7).add(t.mul(0.11)))
      .mul(0.5)
      .add(0.5);
    const r2 = sin(ang.mul(12).sub(t.mul(0.07)).add(1.3))
      .mul(0.5)
      .add(0.5);
    const rays = pow(r1.mul(r2), 2.2)
      .mul(exp(dl.mul(-1.8)))
      .mul(0.16)
      .mul(u.sunGlow)
      .mul(clearness);
    const moonHalo = exp(dl.mul(-4.5))
      .mul(0.22)
      .add(exp(dl.mul(-15)).mul(0.22))
      .mul(u.moonGlow);
    // Screened rather than added, so a pale day sky keeps its blue instead of going white
    const screen = (c: V3, light: V3) => oneMinus(oneMinus(c).mul(oneMinus(saturate(light))));
    col.assign(screen(col, u.lightColor.mul(halo.add(rays))));
    col.assign(screen(col, vec3(0.72, 0.8, 1).mul(moonHalo)));
    // The sky itself never goes past white, so only the stars, meteors and lightning bloom
    col.assign(TSL.min(col, vec3(0.97)));

    // ---- Night: stars, the Milky Way, a shooting star ----
    const nightSky = u.night
      .mul(oneMinus(u.cloud.mul(0.8)))
      .mul(oneMinus(u.fog))
      .mul(oneMinus(u.haze.mul(0.6)))
      .mul(smoothstep(0.1, 0.5, q.y));
    If(u.night.greaterThan(0.01), () => {
      const rel = p.sub(vec2(0, 0.64));
      const across = rel.x.mul(-0.5).add(rel.y.mul(0.866));
      const along = rel.x.mul(0.866).add(rel.y.mul(0.5));
      const band = exp(across.mul(across).mul(-34));
      const dust = fbm2(vec2(along.mul(3.2).add(t.mul(0.004)), across.mul(8)));
      const lane = smoothstep(0.5, 0.72, fbm2(vec2(along.mul(5).add(3.3), across.mul(14))));
      const milky = band.mul(smoothstep(0.3, 0.85, dust)).mul(oneMinus(lane.mul(0.6)));
      col.addAssign(
        mix(vec3(0.38, 0.34, 0.78), vec3(0.95, 0.72, 0.92), dust)
          .mul(milky)
          .mul(nightSky)
          .mul(0.5)
      );
      const stars = starLayer(p, float(42), float(0), t, float(0.32))
        .add(starLayer(p, float(105), float(7.3), t, float(0.42)).mul(0.7))
        .add(starLayer(p, float(190), float(3.1), t, band.mul(0.5)).mul(0.6));
      col.addAssign(vec3(1, 0.96, 0.9).mul(stars).mul(nightSky));
      // A shooting star now and then
      const period = float(6.5);
      const n = floor(t.div(period));
      const ph = fract(t.div(period));
      const hs = hash21(vec2(n, 3.1));
      const hx = hash21(vec2(n, 8.7));
      const dir = normalize(vec2(mix(-0.85, 0.85, step(0.5, hx)), -0.42));
      const prog = ph.div(0.11);
      const start = vec2(hx.sub(0.5).mul(u.aspect).mul(0.9), hs.mul(0.2).add(0.72));
      const head = start.add(dir.mul(prog.mul(0.42)));
      const tail = head.sub(dir.mul(0.13));
      const pa = p.sub(tail);
      const ba = head.sub(tail);
      const k = clamp(dot(pa, ba).div(dot(ba, ba)), 0, 1);
      const seg = length(pa.sub(ba.mul(k)));
      const streak = smoothstep(0.0035, 0, seg)
        .mul(k)
        .mul(step(prog, float(1)))
        .mul(step(0.35, hs))
        .mul(smoothstep(0, 0.2, prog))
        .mul(smoothstep(1, 0.7, prog));
      col.addAssign(vec3(1.5, 1.45, 1.3).mul(streak).mul(nightSky));
    });

    // ---- Cloud: high cirrus in a clear sky, banks of cumulus as it clouds over ----
    const drift = t.mul(0.01).mul(u.wind.mul(5).add(1));
    const cover = saturate(u.cloud.mul(0.6).add(u.rain.mul(0.25)).add(u.dark.mul(0.25)));
    const cirrus = fbm2(vec2(p.x.mul(1.3).add(drift.mul(0.6)), p.y.mul(9).add(p.x.mul(1.5))));
    const wisps = smoothstep(0.5, 0.85, cirrus)
      .mul(smoothstep(0.35, 0.8, q.y))
      .mul(oneMinus(u.night.mul(0.6)))
      .mul(oneMinus(cover))
      .mul(0.22);
    col.assign(mix(col, u.cloudLit, wisps));
    const banks = float(0).toVar();
    If(cover.greaterThan(0.02), () => {
      const n1 = fbm2(vec2(p.x.mul(2.2).add(drift), p.y.mul(4.4)));
      const n2 = fbm2(vec2(p.x.mul(3.6).add(drift.mul(1.7)).add(5.2), p.y.mul(7).add(1.3)));
      const thresh = mix(0.74, 0.36, cover);
      const d1 = smoothstep(thresh, thresh.add(0.2), n1);
      const d2 = smoothstep(thresh, thresh.add(0.16), n2).mul(0.75);
      banks.assign(
        max(d1, d2)
          .mul(smoothstep(0.02, 0.2, cover))
          .mul(smoothstep(1.05, 0.55, q.y).mul(0.4).add(0.6))
      );
      // Lit from above and from the sun's side, darker at the base
      const shade = mix(u.cloudShade, u.cloudLit, saturate(q.y.mul(0.6).add(n1.sub(thresh).mul(1.4)).add(0.15)));
      const lined = shade.add(u.lightColor.mul(halo).mul(1.2));
      col.assign(mix(col, lined, banks.mul(0.62)));
    });

    // ---- Far rain and snow ----
    If(u.rain.greaterThan(0.02), () => {
      const slant = u.wind.mul(0.5).add(0.1);
      const sheets = rainLayer(p, float(55), float(15), slant, t, u.rain).add(
        rainLayer(p.add(vec2(0.3, 0.1)), float(110), float(24), slant, t, u.rain).mul(0.6)
      );
      col.assign(mix(col, mix(u.cloudLit, vec3(1), 0.4), sheets.mul(0.22).mul(u.rain)));
    });
    If(u.snow.greaterThan(0.02), () => {
      const flakes = snowLayer(p, float(26), float(1.4), t, u.snow).add(
        snowLayer(p.add(vec2(0.2, 0.4)), float(48), float(2.4), t, u.snow).mul(0.6)
      );
      col.assign(mix(col, vec3(1), flakes.mul(0.7).mul(u.snow)));
    });

    // ---- Mist low down, dust in a haze, the warmth of a heatwave ----
    If(u.fog.greaterThan(0.02), () => {
      const m = fbm2(vec2(p.x.mul(1.5).add(t.mul(0.03)), p.y.mul(5).sub(t.mul(0.012))));
      const mask = smoothstep(0.9, 0.05, q.y).mul(m.mul(0.7).add(0.5));
      col.assign(mix(col, mix(u.bottom, vec3(1), 0.55), u.fog.mul(mask).mul(0.8)));
    });
    If(u.haze.greaterThan(0.02), () => {
      const m = fbm2(vec2(p.x.mul(2).add(t.mul(0.02)), p.y.mul(3)));
      col.assign(mix(col, vec3(0.92, 0.78, 0.6), u.haze.mul(0.32).mul(m.mul(0.5).add(0.6))));
    });
    col.addAssign(
      vec3(0.28, 0.1, 0)
        .mul(u.heat)
        .mul(exp(q.y.mul(-3.5)))
        .mul(0.5)
    );

    // ---- Lightning: the whole sky blinks, brightest round the bolt, lighting the cloud ----
    const fp = vec2(u.flashAt.x.sub(0.5).mul(u.aspect), u.flashAt.y);
    const flash = u.flash.mul(
      exp(length(p.sub(fp)).mul(-3))
        .mul(0.5)
        .add(0.1)
    );
    col.addAssign(vec3(0.85, 0.86, 1.05).mul(flash));
    col.addAssign(vec3(1, 1, 1.1).mul(banks).mul(u.flash).mul(0.35));

    // A skin's flat backdrop keeps only the gradient and the lightning
    const flat = vec3(mix(u.bottom, u.top, smoothstep(0, 1, q.y))).add(vec3(0.85, 0.86, 1.05).mul(flash).mul(0.6));
    col.assign(mix(col, flat, u.plain));

    // Vignette, and a whisper of dither so the gradients never band
    const v = length(q.sub(0.5).mul(vec2(1.15, 0.9)));
    col.mulAssign(oneMinus(pow(v, 2.6).mul(mix(0.32, 0.12, u.plain))));
    const grain = hash21(floor(TSL.screenCoordinate.xy))
      .sub(0.5)
      .mul(2.5 / 255);
    return vec4(col.add(grain), 1);
  })();

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return { mesh, u };
}

// ---- Glowing things ----

/**
 * Mark a material as glowing: the bloom pass blurs `amount` of its colour into a halo. Only
 * marked materials glow, so a white cloud on a white sky never blooms into a milky veil.
 */
export function glows<M extends THREE.NodeMaterial>(material: M, amount: F | number = 1) {
  material.mrtNode = TSL.mrt({ bloomIntensity: typeof amount === 'number' ? float(amount) : amount });
  return material;
}

/** Unlit colour that glows */
export function glowMaterial(color: V3 | THREE.Color, params: THREE.MeshBasicNodeMaterialParameters = {}, amount = 1) {
  const material = new THREE.MeshBasicNodeMaterial(params);
  material.colorNode = color instanceof THREE.Color ? vec3(color.r, color.g, color.b) : color;
  return glows(material, amount);
}

/**
 * The sun: a hot core fading to an orange limb, its surface boiling slowly, brighter than white
 * so it blooms. `warm` (golden hour) reddens it.
 */
/** The sun's colours, set by the skin; `warmth` is how far golden hour may redden it */
export const sunColors = {
  lit: uniform(new THREE.Color(1, 0.85, 0.32)),
  shade: uniform(new THREE.Color(0.97, 0.45, 0.1)),
  warmth: uniform(1),
};

export function sunMaterial(time: F, warm: F) {
  const material = new THREE.MeshBasicNodeMaterial();
  const n = TSL.normalView;
  // A toy ball, lit like the rest of the world: soft key from the top left, a warm terminator,
  // a faint highlight and grain, a glowing rim; never brighter than white, so it never burns out
  const key = normalize(vec3(-0.45, 0.6, 0.66));
  const wrap = pow(saturate(dot(n, key).mul(0.5).add(0.5)), 1.4);
  const lit = mix(sunColors.lit as unknown as V3, vec3(1, 0.58, 0.24), warm.mul(sunColors.warmth));
  const shade = mix(sunColors.shade as unknown as V3, vec3(0.86, 0.22, 0.08), warm.mul(sunColors.warmth));
  const grain = TSL.mx_noise_float(TSL.positionGeometry.mul(9).add(time.mul(0.15))).mul(0.035);
  const spec = pow(saturate(dot(n, normalize(key.add(vec3(0, 0, 1))))), 24).mul(0.25);
  const rim = pow(oneMinus(saturate(n.z)), 3).mul(0.22);
  material.colorNode = TSL.min(
    mix(shade, lit, wrap)
      .add(grain)
      .add(vec3(1, 0.92, 0.65).mul(spec))
      .add((sunColors.lit as unknown as V3).mul(rim)),
    vec3(1)
  );
  return glows(material, 0.2);
}

/**
 * A soft glow on a camera-facing sprite: `inner` blooms, `outer` washes. Additive by default
 * (light on a dark sky); `tinted` blends normally, so a colour still shows on a pale day sky.
 */
export function haloMaterial(color: V3 | THREE.Color, opacity: F, inner = 1.4, outer = 0.5, tinted = false) {
  const material = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: tinted ? THREE.NormalBlending : THREE.AdditiveBlending,
    fog: false,
  });
  const d = saturate(length(uv().sub(0.5)).mul(2));
  const glow = pow(oneMinus(d), 2.6)
    .mul(outer)
    .add(pow(oneMinus(d), 9).mul(inner));
  const tint = color instanceof THREE.Color ? vec3(color.r, color.g, color.b) : color;
  material.colorNode = tinted ? vec4(tint, glow.mul(opacity)) : vec4(tint.mul(glow).mul(opacity), 1);
  return material;
}

/**
 * The moon at its real phase, with dark maria and craters, and earthshine on the unlit side so
 * a crescent still shows the whole disc faintly.
 */
export function moonMaterial(light: V3) {
  const material = new THREE.MeshBasicNodeMaterial();
  const n = TSL.normalView;
  const p = TSL.positionGeometry;
  const maria = smoothstep(0.05, 0.4, TSL.mx_fractal_noise_float(p.mul(1.4).add(vec3(2.1, 0, 0)), 3, 2, 0.5));
  const w = TSL.mx_worley_noise_float(p.mul(5.5));
  const bowl = smoothstep(0.32, 0.12, w);
  const rimLight = smoothstep(0.3, 0.38, w).mul(smoothstep(0.46, 0.38, w));
  const albedo = float(1).sub(maria.mul(0.32)).sub(bowl.mul(0.1)).add(rimLight.mul(0.06));
  const lit = smoothstep(-0.05, 0.06, dot(n, light));
  const shade = n.z.mul(0.32).add(0.7);
  const day = vec3(0.95, 0.93, 0.88).mul(albedo).mul(shade);
  const earthshine = vec3(0.07, 0.09, 0.15).add(vec3(0.05, 0.06, 0.08).mul(albedo));
  const rim = pow(oneMinus(saturate(n.z)), 3).mul(0.2);
  material.colorNode = mix(earthshine, day, lit).add(rim);
  return glows(material, lit.mul(0.08));
}

/**
 * Cloud puffs lit by the sun: wrapped light from `key` (view space), cooler undersides, a
 * silver lining on the sunward edge, each puff a touch different, and lit from inside when
 * lightning flashes.
 */
export function cloudMaterial() {
  const u = {
    key: uniform(new THREE.Vector3(0.45, 0.6, 0.66).normalize()),
    lit: uniform(new THREE.Color('#FFFFFF')),
    shade: uniform(new THREE.Color('#AEBBD0')),
    rim: uniform(new THREE.Color('#FFFFFF')),
    rimStrength: uniform(0.5),
    flash: uniform(0),
  };
  const material = new THREE.MeshBasicNodeMaterial();
  const n = TSL.normalView;
  const wrap = pow(saturate(dot(n, u.key).mul(0.5).add(0.5)), 1.7);
  // Cumulus are darker at the base: the puffs low in the cloud sit in its own shade
  const low = smoothstep(-0.95, 0.35, TSL.positionLocal.y).mul(0.2).add(0.8);
  const base = mix(u.shade, u.lit, wrap).mul(low);
  const under = smoothstep(0.1, -0.9, n.y);
  const fres = pow(oneMinus(saturate(n.z)), 2.4);
  const toward = saturate(dot(normalize(n.xy.add(vec2(0.0001, 0))), normalize(u.key.xy)))
    .mul(0.75)
    .add(0.25);
  const variety = TSL.hash(TSL.instanceIndex).mul(0.05).add(0.975);
  const flashed = vec3(0.9, 0.92, 1.1).mul(u.flash).mul(wrap.mul(0.5).add(0.25));
  material.colorNode = TSL.min(
    base
      .mul(oneMinus(under.mul(0.16)))
      .add(u.rim.mul(fres).mul(toward).mul(u.rimStrength))
      .mul(variety),
    vec3(1)
  ).add(flashed);
  // The skin's rainbow sheen reaches the clouds too (Chroma's iridescent cumulus)
  const film = pow(oneMinus(saturate(n.z)), 1.8);
  const rainbow = vec3(0.5).add(
    vec3(0.5).mul(TSL.cos(vec3(0, 2.1, 4.2).add(film.mul(1.6).add(n.y.mul(0.6)).mul(6.283))))
  );
  material.colorNode = (material.colorNode as unknown as V3).add(rainbow.mul(film).mul(skinLook.sheen).mul(0.9));
  glows(material, saturate(u.flash).mul(0.3));
  return { material, u };
}

/**
 * The sun (or the moon) as a light on the skin, as in the original where the sun behind the
 * cloud lights the tops of the numerals: where it is (view space), its colour and strength,
 * and the line of the cloud's shadow (world y of its underside) and how dark it falls.
 */
export const skyLight = {
  pos: uniform(new THREE.Vector3(2, 6, -4)),
  color: uniform(new THREE.Color(1, 0.86, 0.52)),
  amount: uniform(0),
  shadowY: uniform(0),
  shadow: uniform(0),
};

/**
 * The skin (numerals, gadgets): the matcap, warmed where it faces the sun and cooler away from
 * it, with a sheen along the edges turned to the light; the cloud's shadow across the tops;
 * the sky's own colours caught on the rim; and a white blink when lightning hits.
 */
export function skinMaterial(matcap: THREE.Texture, sky: { top: V3; bottom: V3; flash: F }, side?: THREE.Side) {
  const material = new THREE.MeshBasicNodeMaterial(side === undefined ? {} : { side });
  const n = TSL.normalView;
  const base = TSL.texture(matcap, TSL.matcapUV).rgb;
  // The light: falls off with distance, so the tops nearest the sun catch the most
  const toLight = (skyLight.pos as unknown as V3).sub(TSL.positionView);
  const d = length(toLight);
  const ndl = saturate(dot(n, toLight.div(d)));
  const reach = float(1).div(float(1).add(pow(d.div(4.5), 2)));
  const a = skyLight.amount.mul(TSL.min(reach.mul(1.7), 1));
  const light = skyLight.color as unknown as V3;
  const lit = base
    .mul(mix(vec3(1), light.mul(1.15), ndl.mul(a).mul(0.65)))
    .mul(oneMinus(oneMinus(ndl).mul(a).mul(0.08)));
  // The glow on the tops nearest the sun, deeper in colour than the light itself (the original's
  // red spill from the sun behind the cloud), strongest close up
  const near = TSL.min(
    float(1)
      .div(float(1).add(pow(d.div(2.6), 2)))
      .mul(1.8),
    1.3
  );
  const spill = mix(light, vec3(1, 0.5, 0.22), 0.45);
  const sheen = spill.mul(pow(ndl, 2)).mul(skyLight.amount).mul(near).mul(0.95);
  // The cloud's shadow over the tops of the numerals
  const under = smoothstep(skyLight.shadowY.sub(0.95), skyLight.shadowY.sub(0.1), TSL.positionWorld.y).mul(
    skyLight.shadow
  );
  const env = mix(sky.bottom, sky.top, saturate(n.y.mul(0.5).add(0.5)));
  const fres = pow(oneMinus(saturate(abs(n.z))), 3);
  // Strong under a coloured or dark sky, faint under a pale one (it would only wash the white out)
  const pale = smoothstep(0.75, 0.95, TSL.luminance(env));
  // Polka dots (Mem): on the glyph's own surface, so they ride with it
  const g = TSL.positionGeometry.xy.mul(3.4);
  const cell = fract(g).sub(0.5);
  const dotMask = smoothstep(0.2, 0.16, length(cell)).mul(skinLook.dots);
  const dotted = mix(lit, (skinLook.dotColor as unknown as V3).mul(base.mul(0.4).add(0.6)), dotMask);
  // Thin-film sheen (Chroma, Opal): a rainbow that slides along the edges as they turn
  const film = pow(oneMinus(saturate(abs(n.z))), 0.9);
  const phase = film.mul(1.6).add(n.y.mul(0.5)).add(n.x.mul(0.35));
  const rainbow = vec3(0.5).add(vec3(0.5).mul(TSL.cos(vec3(0, 2.1, 4.2).add(phase.mul(6.283)))));
  const iridescent = rainbow.mul(film).mul(skinLook.sheen).mul(1.5);
  material.colorNode = TSL.min(
    dotted
      .mul(oneMinus(under.mul(0.32)))
      .add(
        env
          .mul(fres)
          .mul(mix(0.34, 0.08, pale))
          .mul(oneMinus(skinLook.sheen))
      )
      .add(iridescent),
    vec3(1)
  )
    .add(sheen.mul(oneMinus(under.mul(0.6))))
    .add(vec3(0.5, 0.5, 0.6).mul(sky.flash).mul(0.35));
  return material;
}

/** The skin's extras: 0..1 rainbow sheen, 0..1 polka dots and their colour */
export const skinLook = {
  sheen: uniform(0),
  dots: uniform(0),
  dotColor: uniform(new THREE.Color(0, 0, 0)),
};

/**
 * Pond water: deep blue in the middle, shallow at the rim, the sky reflected over it, wind
 * ripples, caustic lines and sun glints bright enough to sparkle.
 */
export function waterMaterial(time: F, sky: { top: V3 }) {
  const material = new THREE.MeshBasicNodeMaterial();
  const p = TSL.positionGeometry;
  const r = saturate(length(p.xz).div(1.12));
  const w1 = TSL.mx_noise_float(vec3(p.x.mul(3.2), p.z.mul(3.2), time.mul(0.6)));
  const w2 = TSL.mx_noise_float(vec3(p.x.mul(7).add(3), p.z.mul(7), time.mul(0.95)));
  const ripple = w1.mul(0.6).add(w2.mul(0.4));
  const deep = mix(vec3(0.06, 0.33, 0.78), vec3(0.42, 0.82, 1), smoothstep(0.15, 1, r).add(ripple.mul(0.12)));
  const reflected = mix(deep, sky.top, float(0.22).add(ripple.mul(0.08)));
  const caustic = smoothstep(0.1, 0, TSL.mx_worley_noise_float(vec3(p.x.mul(3.6), p.z.mul(3.6), time.mul(0.45))));
  const glint = pow(saturate(ripple.mul(1.7).sub(0.25)), 7).mul(2.6);
  material.colorNode = reflected.add(vec3(0.75, 0.92, 1).mul(caustic).mul(0.22)).add(vec3(glint));
  return glows(material, saturate(glint));
}

/** Falling water: bands of foam scrolling down a ribbon */
export function waterfallMaterial(time: F, flow: F) {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const v = uv();
  const travel = time.mul(flow.mul(1.6).add(0.8));
  const bands = TSL.mx_noise_float(vec3(v.x.mul(14).sub(travel.mul(3)), v.y.mul(5), 0))
    .mul(0.5)
    .add(0.5);
  const foam = smoothstep(0.45, 0.8, bands);
  material.colorNode = mix(vec3(0.42, 0.78, 1), vec3(1.15, 1.2, 1.25), foam);
  material.opacityNode = smoothstep(0, 0.06, v.x)
    .mul(smoothstep(1, 0.85, v.x))
    .mul(0.92);
  return material;
}

/** The sun arc's travelled part, glowing from sunrise to where the sun is now */
export function arcGlowMaterial(progress: F, color: V3) {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const along = uv().x;
  const lit = step(oneMinus(progress), along);
  const tip = smoothstep(0.12, 0, abs(along.sub(oneMinus(progress))));
  material.colorNode = TSL.min(color.mul(float(0.85).add(tip.mul(0.3))), vec3(1));
  material.opacityNode = lit.mul(0.95);
  return glows(material, lit.mul(0.22));
}

// ---- Particles that move on the GPU ----

/** Per-instance random numbers, 0..1 */
export const seed = (k: number, count: number) => TSL.hash(TSL.instanceIndex.add(k * count + 11)) as F;

/** Rotate `p` about z by `a` */
export const rotateZ = (p: V3, a: F) => {
  const c = cos(a);
  const s = sin(a);
  return vec3(p.x.mul(c).sub(p.y.mul(s)), p.x.mul(s).add(p.y.mul(c)), p.z);
};

/** Position node: the instance's geometry scaled by `scale` and moved to `at` */
export const placed = (at: V3, scale: F, angle?: F) => {
  const local = TSL.positionGeometry.mul(scale);
  return (angle ? rotateZ(local, angle) : local).add(at);
};

/** InstancedMesh whose instances are placed by the material, not by matrices */
export function gpuInstances(geometry: THREE.BufferGeometry, material: THREE.Material, count: number) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  return mesh;
}

/** Fraction of instances shown for `amount` (0..1): the first `amount × count` */
export const shown = (amount: F, count: number) => step(TSL.float(TSL.instanceIndex).add(0.5).div(count), amount);
