// Turns the cached OSM download (scripts/osm/fetch.mjs) into the compact map the diorama loads:
// src/demos/metro-live/data/line1-map.json, in metres on a local plane centred on Bến Thành
// (x = east, z = south). Data © OpenStreetMap contributors, ODbL.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CACHE = join(ROOT, '.cache');
const OUT = join(ROOT, '../../src/demos/metro-live/data/line1-map.json');
const load = async (name) => JSON.parse(await readFile(join(CACHE, `${name}.json`), 'utf8')).elements;

const [line, roads, buildings, land, landRelations, landuse] = await Promise.all(
  ['line', 'roads', 'buildings', 'land', 'landRelations', 'landuse'].map(load)
);

// ---- Projection: equirectangular around Bến Thành, plenty accurate over 20 km ----
const route = line.find((e) => e.type === 'relation');
const lineWays = new Map(line.filter((e) => e.type === 'way').map((e) => [e.id, e]));
const platforms = route.members.filter((m) => m.type === 'way' && m.role.startsWith('platform')).map((m) => lineWays.get(m.ref));
const centroid = (geometry) => {
  const lat = geometry.reduce((a, g) => a + g.lat, 0) / geometry.length;
  const lon = geometry.reduce((a, g) => a + g.lon, 0) / geometry.length;
  return { lat, lon };
};
const origin = centroid(platforms[0].geometry);
const KX = Math.cos((origin.lat * Math.PI) / 180) * 111320;
const KZ = 110574;
const project = ({ lat, lon }) => [(lon - origin.lon) * KX, -(lat - origin.lat) * KZ];
const round = (v) => Math.round(v * 10) / 10;
const flat = (pts) => pts.flatMap(([x, z]) => [round(x), round(z)]);

// ---- Geometry helpers ----
function simplify(pts, tolerance) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = pts[a];
    const [bx, bz] = pts[b];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    let best = -1;
    let bestD = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Sutherland–Hodgman against the map rectangle */
function clipRing(ring, [minX, minZ, maxX, maxZ]) {
  const edges = [
    (p) => p[0] >= minX,
    (p) => p[0] <= maxX,
    (p) => p[1] >= minZ,
    (p) => p[1] <= maxZ,
  ];
  const cut = [
    (a, b) => [minX, a[1] + ((b[1] - a[1]) * (minX - a[0])) / (b[0] - a[0])],
    (a, b) => [maxX, a[1] + ((b[1] - a[1]) * (maxX - a[0])) / (b[0] - a[0])],
    (a, b) => [a[0] + ((b[0] - a[0]) * (minZ - a[1])) / (b[1] - a[1]), minZ],
    (a, b) => [a[0] + ((b[0] - a[0]) * (maxZ - a[1])) / (b[1] - a[1]), maxZ],
  ];
  let out = ring;
  for (let e = 0; e < 4 && out.length; e++) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const inCur = edges[e](cur);
      const inPrev = edges[e](prev);
      if (inCur) {
        if (!inPrev) out.push(cut[e](prev, cur));
        out.push(cur);
      } else if (inPrev) {
        out.push(cut[e](prev, cur));
      }
    }
  }
  return out;
}

const area = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i];
    const [x2, z2] = ring[(i + 1) % ring.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
};

const inside = ([x, z], ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
};

/** Stitch multipolygon member ways into closed rings */
function assembleRings(parts) {
  const key = (p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
  const pool = parts.filter((g) => g && g.length > 1).map((g) => [...g]);
  const rings = [];
  while (pool.length) {
    const ring = pool.pop();
    let grown = true;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && grown) {
      grown = false;
      const end = key(ring[ring.length - 1]);
      for (let i = 0; i < pool.length; i++) {
        const g = pool[i];
        if (key(g[0]) === end) ring.push(...g.slice(1));
        else if (key(g[g.length - 1]) === end) ring.push(...g.slice(0, -1).reverse());
        else continue;
        pool.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (ring.length > 3) rings.push(ring);
  }
  return rings;
}

const isClosed = (g) => g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;

// ---- Metro line: tunnel + viaduct, ordered Bến Thành → Suối Tiên ----
const stations = platforms.map((p) => project(centroid(p.geometry)));
const trackWays = route.members.filter((m) => m.type === 'way' && m.role === '').map((m) => lineWays.get(m.ref));
const start = stations[0];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const segments = trackWays
  .map((w) => {
    let pts = w.geometry.map(project);
    const level = w.tags.tunnel === 'yes' ? -1 : w.tags.bridge === 'yes' ? 1 : 0;
    return { pts, level };
  })
  .sort((a, b) => Math.min(dist(a.pts[0], start), dist(a.pts.at(-1), start)) - Math.min(dist(b.pts[0], start), dist(b.pts.at(-1), start)));
const track = [];
for (const seg of segments) {
  const tail = track.length ? track.at(-1) : start;
  if (dist(seg.pts.at(-1), tail) < dist(seg.pts[0], tail)) seg.pts.reverse();
  for (const p of simplify(seg.pts, 0.4)) track.push([...p, seg.level]);
}

// ---- Map extent: the line's bounding box plus a margin ----
const MARGIN = 1600;
const xs = track.map((p) => p[0]);
const zs = track.map((p) => p[1]);
const bounds = [Math.min(...xs) - MARGIN, Math.min(...zs) - MARGIN, Math.max(...xs) + MARGIN, Math.max(...zs) + MARGIN];
const inBounds = ([x, z]) => x > bounds[0] && x < bounds[2] && z > bounds[1] && z < bounds[3];

// ---- Roads ----
const ROAD_CLASS = {
  motorway: ['m', 24],
  trunk: ['t', 20],
  primary: ['p', 15],
  secondary: ['s', 11],
  tertiary: ['r', 8],
  residential: ['l', 5.5],
  unclassified: ['l', 5],
  living_street: ['l', 4],
};
const roadOut = [];
for (const w of roads) {
  const t = w.tags;
  if (t.area === 'yes' || !w.geometry) continue;
  const link = t.highway.endsWith('_link');
  const [cls, base] = ROAD_CLASS[t.highway.replace('_link', '')] ?? [];
  if (!cls) continue;
  // Road tunnels and underpasses (not passages through buildings), drawn with their portals
  const tunnel = t.tunnel === 'yes';
  if ((t.tunnel && !tunnel) || (tunnel && cls === 'l')) continue;
  const oneway = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout';
  const lanes = Number.parseFloat(t.lanes);
  let width = Number.isFinite(lanes) ? lanes * 3.3 : base;
  if (!Number.isFinite(lanes) && oneway && 'mtps'.includes(cls)) width *= 0.55;
  if (link) width = Math.min(width, 7);
  const pts = simplify(w.geometry.map(project), 0.8);
  if (!pts.some(inBounds)) continue;
  const road = { c: link ? `${cls}k` : cls, w: round(width), p: flat(pts) };
  if (oneway) road.o = 1;
  if (tunnel) road.t = 1;
  if (t.bridge && t.bridge !== 'no') road.b = Number.parseInt(t.layer ?? '1', 10) || 1;
  if (t.name) road.n = t.name;
  roadOut.push(road);
}

// ---- Buildings ----
const parseHeight = (t) => {
  const h = Number.parseFloat(String(t.height ?? '').replace(',', '.'));
  if (Number.isFinite(h) && h > 0) return h;
  const levels = Number.parseFloat(t['building:levels']);
  if (Number.isFinite(levels) && levels > 0) return levels * 3.3 + 1.5;
  return undefined;
};
const buildingOut = [];
for (const w of buildings) {
  if (!w.geometry || !isClosed(w.geometry)) continue;
  const ring = simplify(w.geometry.slice(0, -1).map(project), 0.35);
  if (ring.length < 3 || Math.abs(area(ring)) < 12) continue;
  const b = { id: w.id, p: flat(area(ring) < 0 ? ring.reverse() : ring) };
  const h = parseHeight(w.tags);
  if (h) b.h = round(h);
  if (w.tags.name) b.n = w.tags.name;
  if (w.tags.building && w.tags.building !== 'yes') b.t = w.tags.building;
  buildingOut.push(b);
}

// ---- Water and greenery ----
const polygonsOf = (filter, ways = land, relations = landRelations) => {
  const out = [];
  const pushPolygon = (outers, inners) => {
    for (const o of outers) {
      let outer = clipRing(simplify(o.map(project), 1.5), bounds);
      if (outer.length < 3) continue;
      if (area(outer) < 0) outer = outer.reverse();
      const holes = inners
        .map((r) => clipRing(simplify(r.map(project), 1.5), bounds))
        .filter((r) => r.length >= 3 && inside(r[0], outer));
      const poly = { o: flat(outer) };
      if (holes.length) poly.i = holes.map((h) => flat(area(h) > 0 ? h.reverse() : h));
      out.push(poly);
    }
  };
  for (const w of ways) {
    if (w.type !== 'way' || !w.geometry || !filter(w.tags ?? {})) continue;
    // Nodes outside the download box come back as null; the ring is clipped to the map anyway
    const g = w.geometry.filter(Boolean);
    const clipped = g.length < w.geometry.length;
    if (!clipped && !isClosed(g)) continue;
    if (g.length > 3) pushPolygon([isClosed(g) ? g.slice(0, -1) : g], []);
  }
  const relWays = new Map(relations.filter((e) => e.type === 'way').map((e) => [e.id, e.geometry]));
  for (const r of relations) {
    if (r.type !== 'relation' || !r.members || !filter(r.tags ?? {})) continue;
    const ofRole = (role) =>
      assembleRings(
        r.members
          .filter((m) => m.type === 'way' && (m.role || 'outer') === role)
          .map((m) => (m.geometry ? m.geometry.filter(Boolean) : relWays.get(m.ref)))
      ).map((g) =>
        isClosed(g) ? g.slice(0, -1) : g
      );
    pushPolygon(ofRole('outer'), ofRole('inner'));
  }
  return out.map((p, k) => ({ ...p, k }));
};

const water = polygonsOf((t) => t.natural === 'water' || t.waterway === 'riverbank').map(({ k: _k, ...p }) => p);
const GREEN_KIND = { park: 'park', garden: 'park', golf_course: 'golf', pitch: 'pitch', stadium: 'pitch', grass: 'grass', village_green: 'grass', forest: 'forest', recreation_ground: 'grass', cemetery: 'grass' };
const green = [];
for (const [tag, values] of [
  ['leisure', ['park', 'garden', 'golf_course', 'pitch', 'stadium']],
  ['landuse', ['grass', 'forest', 'recreation_ground', 'cemetery', 'village_green']],
]) {
  for (const value of values) {
    for (const { k: _k, ...p } of polygonsOf((t) => t[tag] === value)) green.push({ ...p, k: GREEN_KIND[value] });
  }
}
// Land use, reduced to what the city builder needs: open ground (no generated houses), built-up
// districts (houses fill the gaps OSM has not mapped yet) and industry
const LANDUSE_KIND = {
  construction: 'site',
  brownfield: 'open',
  greenfield: 'open',
  meadow: 'field',
  farmland: 'field',
  grassland: 'field',
  scrub: 'field',
  wetland: 'wetland',
  sand: 'open',
  military: 'closed',
  residential: 'built',
  commercial: 'built',
  retail: 'built',
  religious: 'built',
  education: 'built',
  industrial: 'industrial',
  railway: 'industrial',
};
const landuseOut = [];
for (const [value, kind] of Object.entries(LANDUSE_KIND)) {
  const polys = polygonsOf((t) => t.landuse === value || t.natural === value, landuse, landuse);
  for (const { k: _k, ...p } of polys) landuseOut.push({ ...p, k: kind });
}
const themePark = polygonsOf((t) => t.tourism === 'theme_park' && /Suối Tiên/.test(t.name ?? ''))[0];

// Waterway centrelines: the Saigon River for boats, the canals for thin water where unmapped as areas
const rivers = [];
const riverWays = land
  .filter((e) => e.type === 'way' && /^(river|canal)$/.test(e.tags?.waterway ?? '') && e.geometry)
  .map((w) => ({ ...w, geometry: w.geometry.filter(Boolean) }))
  .filter((w) => w.geometry.length > 1);
const saigon = assembleRings(riverWays.filter((w) => w.tags.name === 'Sông Sài Gòn').map((w) => w.geometry));
for (const g of saigon) rivers.push({ n: 'Sông Sài Gòn', w: 0, p: flat(simplify(g.map(project), 3).filter(inBounds)) });
for (const w of riverWays) {
  if (w.tags.name === 'Sông Sài Gòn') continue;
  const pts = simplify(w.geometry.map(project), 1.5);
  if (!pts.some(inBounds)) continue;
  rivers.push({ n: w.tags.name ?? '', w: w.tags.waterway === 'canal' ? 10 : 14, p: flat(pts) });
}

const map = {
  attribution: '© OpenStreetMap contributors (ODbL)',
  origin: [origin.lat, origin.lon],
  bounds: bounds.map(round),
  line: track.flatMap(([x, z, l]) => [round(x), round(z), l]),
  stations: stations.map(([x, z]) => [round(x), round(z)]),
  roads: roadOut,
  buildings: buildingOut,
  water,
  rivers,
  green,
  themePark: themePark?.o ?? null,
  landuse: landuseOut,
};

await mkdir(dirname(OUT), { recursive: true });
const text = JSON.stringify(map);
await writeFile(OUT, text);
console.log(
  `line ${track.length} pts · ${stations.length} stations · ${roadOut.length} roads · ${buildingOut.length} buildings · ` +
    `${water.length} water · ${green.length} green · ${landuseOut.length} landuse · ${rivers.length} waterways · ` +
    `${roadOut.filter((r) => r.t).length} tunnels · ${(text.length / 1024).toFixed(0)} KB`
);
