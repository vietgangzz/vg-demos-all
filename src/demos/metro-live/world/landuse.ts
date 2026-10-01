import { GridIndex, MAP, pointInPolygon, ringCentroid, type LandKind } from './map';

/**
 * Where the city is really built up. OSM's building coverage of Saigon is patchy, so houses are
 * generated along streets to fill the gaps, but only where the map shows a town: built-up land
 * use, or enough mapped buildings around. Construction sites, cleared land (most of Thủ Thiêm),
 * fields, wetland and industry stay free of generated houses.
 */

type Poly = (typeof MAP.landuse)[number];
const index = new GridIndex<Poly>(60);
for (const l of MAP.landuse) {
  const xs = l.outer.map((p) => p.x);
  const zs = l.outer.map((p) => p.y);
  index.insert(l, Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs));
}

/** Open or closed ground wins over built-up when polygons overlap (a site inside a district) */
const PRIORITY: Record<LandKind, number> = {
  site: 5,
  closed: 5,
  wetland: 4,
  open: 4,
  field: 3,
  industrial: 2,
  built: 1,
};

export function landKindAt(x: number, z: number): LandKind | null {
  let best: LandKind | null = null;
  index.query(x, z, 0, (l) => {
    if ((!best || PRIORITY[l.kind] > PRIORITY[best]) && pointInPolygon(x, z, l)) best = l.kind;
  });
  return best;
}

// Mapped buildings per 10-unit cell, summed over a ~200 m window
const CELL = 10;
const WINDOW = 4; // cells either side
const [x0, z0, x1, z1] = MAP.bounds;
const cols = Math.ceil((x1 - x0) / CELL) + 1;
const rows = Math.ceil((z1 - z0) / CELL) + 1;
const nearby = (() => {
  const counts = new Uint16Array(cols * rows);
  for (const b of MAP.buildings) {
    const c = ringCentroid(b.ring);
    const i = Math.floor((c.x - x0) / CELL);
    const j = Math.floor((c.y - z0) / CELL);
    if (i >= 0 && j >= 0 && i < cols && j < rows) counts[j * cols + i]++;
  }
  // Box filter as a summed-area table
  const sat = new Uint32Array((cols + 1) * (rows + 1));
  for (let j = 0; j < rows; j++) {
    let row = 0;
    for (let i = 0; i < cols; i++) {
      row += counts[j * cols + i];
      sat[(j + 1) * (cols + 1) + i + 1] = sat[j * (cols + 1) + i + 1] + row;
    }
  }
  return (i: number, j: number) => {
    const a = Math.max(0, i - WINDOW);
    const b = Math.max(0, j - WINDOW);
    const c = Math.min(cols, i + WINDOW + 1);
    const d = Math.min(rows, j + WINDOW + 1);
    return sat[d * (cols + 1) + c] - sat[b * (cols + 1) + c] - sat[d * (cols + 1) + a] + sat[b * (cols + 1) + a];
  };
})();

/** Mapped buildings within roughly 200 m */
export function buildingDensity(x: number, z: number) {
  return nearby(Math.floor((x - x0) / CELL), Math.floor((z - z0) / CELL));
}

/** Whether generated tube houses belong here */
export function isBuiltUp(x: number, z: number) {
  const kind = landKindAt(x, z);
  if (kind && kind !== 'built') return false;
  return kind === 'built' || buildingDensity(x, z) >= 10;
}
