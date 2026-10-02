// Downloads the CC0 foliage packs used by the Metro Line 1 diorama into scripts/foliage/.cache/.
// Run: node scripts/foliage/fetch.mjs   (then node scripts/foliage/build.mjs)
// Quaternius "Ultimate Stylized Nature Pack" (CC0) via Poly Pizza:
// https://poly.pizza/bundle/Ultimate-Stylized-Nature-Pack-zyIyYd9yGr
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE = join(dirname(fileURLToPath(import.meta.url)), '.cache');
const FILES = {
  'trees.glb': '53a83125-e16a-4024-b8f6-1e72679c7ddf',
  'palms.glb': '88fb0209-5e1e-4cb0-9d11-112e6140ab13',
  'flowers.glb': 'c25cb5dc-3cd3-470c-a08c-045af0c0fe3d',
};

await mkdir(CACHE, { recursive: true });
for (const [name, id] of Object.entries(FILES)) {
  const file = join(CACHE, name);
  if (await access(file).then(() => true, () => false)) {
    console.log(`${name}: cached`);
    continue;
  }
  const res = await fetch(`https://static.poly.pizza/${id}.glb`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log(`${name}: downloaded`);
}
