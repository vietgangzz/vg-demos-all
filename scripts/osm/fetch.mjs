// Downloads the OpenStreetMap data behind the Metro Line 1 diorama into scripts/osm/.cache/.
// Run: node scripts/osm/fetch.mjs   (then node scripts/osm/build.mjs)
// Data © OpenStreetMap contributors, ODbL. https://www.openstreetmap.org/copyright
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE = join(dirname(fileURLToPath(import.meta.url)), '.cache');
/** Public Overpass mirrors, tried in turn when one is busy */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
/** Tuyến Metro số 1, Bến Thành → Suối Tiên */
const ROUTE = 11919223;
const LINE = `relation(${ROUTE});way(r)->.rw;`;

const queries = {
  line: `${LINE}
    relation(${ROUTE}); out body;
    .rw out geom tags;
    node(r); out tags;
    node[railway=station](around.rw:250); out tags;
    node[public_transport=station](around.rw:250); out tags;`,
  roads: `${LINE}
    (
      way[highway~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"](around.rw:1400);
      way[highway~"^(residential|unclassified|living_street)$"](around.rw:1300);
    );
    out geom tags;`,
  buildings: `${LINE}
    way[building](around.rw:1300);
    out geom tags;`,
  land: `${LINE}
    (
      way[natural=water](around.rw:3000);
      relation[natural=water](around.rw:3000);
      way[waterway=riverbank](around.rw:3000);
      relation[waterway=riverbank](around.rw:3000);
      way[waterway~"^(river|canal)$"](around.rw:3000);
      way[leisure~"^(park|garden|golf_course|pitch|stadium)$"](around.rw:1000);
      relation[leisure=park](around.rw:1000);
      way[landuse~"^(grass|forest|recreation_ground|cemetery|village_green)$"](around.rw:1000);
      way[tourism=theme_park](around.rw:2000);
      relation[tourism=theme_park](around.rw:2000);
    );
    out geom(10.74,106.66,10.90,106.84) tags;`,
  // Land use: where the city is built up, and where it is open ground (construction sites,
  // cleared land, fields) that must stay free of generated houses
  landuse: `${LINE}
    (
      way[landuse~"^(construction|brownfield|greenfield|meadow|farmland|residential|commercial|retail|industrial|military|railway|religious|education)$"](around.rw:1500);
      relation[landuse](around.rw:1500);
      way[natural~"^(scrub|wetland|grassland|sand)$"](around.rw:1500);
    )->.lu;
    .lu out geom;
    way(r.lu);
    out geom;`,
  // Multipolygon members (the Saigon River, lakes, parks) come back without geometry above
  landRelations: `${LINE}
    (
      relation[natural=water](around.rw:3000);
      relation[waterway=riverbank](around.rw:3000);
      relation[leisure=park](around.rw:1000);
      relation[tourism=theme_park](around.rw:2000);
    )->.rel;
    .rel out body;
    way(r.rel);
    out geom;`,
};

async function query(body) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'User-Agent': 'vg-demos-metro/1.0 (design demo)',
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ data: `[out:json][timeout:240];${body}` }),
      });
      if (res.ok) return await res.json();
      lastError = new Error(`HTTP ${res.status} from ${endpoint}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
  }
  throw lastError;
}

await mkdir(CACHE, { recursive: true });
const refresh = process.argv.includes('--refresh');
for (const [name, body] of Object.entries(queries)) {
  const file = join(CACHE, `${name}.json`);
  if (!refresh && (await access(file).then(() => true, () => false))) {
    console.log(`${name}: cached`);
    continue;
  }
  process.stdout.write(`Fetching ${name}… `);
  const json = await query(body);
  await writeFile(file, JSON.stringify(json));
  console.log(`${json.elements.length} elements`);
}
