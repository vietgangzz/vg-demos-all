# VG Demos

Showcase app for the VG team's UX/UI demos. The home screen lists every demo; tapping one opens it full screen.

Built on the latest Expo template (SDK 57, Expo Router).

## Run

The app uses native modules (Pulsar haptics, Skia, WebGPU), so it needs a development build — Expo Go won't work.

```bash
bun install
bun run ios       # builds the dev client and starts Metro (or: bun run android)
```

After the first build, `bun run start` is enough while you only change JS.

Notes:

- Building with Xcode 27 / the iOS 27 SDK requires the UIScene life cycle. `plugins/with-scene-lifecycle.js` adds it during prebuild; remove it after upgrading to SDK 58.
- Haptics only work on a real device. The simulator plays the sounds but stays silent on haptics.
- 3D runs on `react-native-webgpu` + `three/webgpu`. `metro.config.js` points every `three` import at the WebGPU build, and `babel.config.js` adds `unplugin-typegpu` so `'use gpu'` functions compile to WGSL.
- On react-native-webgpu (checked on the iOS 27 simulator with three r186), shadow maps, three's output pass (tone mapping / sRGB) and `Color` scene backgrounds render a black frame. `metro-live` renders without them and fakes soft shadows with a TypeGPU shader.
- To feed a live JS value into a TypeGPU shader inside three, use `t3.fromTSL(TSL.uniform(...), d.f32)`. `t3.uniform(node)` copies the value once and never updates.
- Keep `metro-live` smooth: static parts are baked with `mergeByMaterial` (few draw calls), moving crowds are InstancedMeshes, door leaves slide in a vertex shader, and countdowns tick on the UI thread (`AnimatedDigit`) so the 3D screen never re-renders React. Objects passed to a shared value are frozen by Worklets, so create a new frame-info object each frame instead of mutating one.

## Add a demo

1. Create a folder `src/demos/<demo-id>/` with an `index.tsx` that default-exports a full-screen component:

   ```tsx
   import { View } from 'react-native';

   export default function MyDemo() {
     return <View style={{ flex: 1 }}>{/* ... */}</View>;
   }
   ```

2. Register it in `src/demos/registry.ts`:

   ```ts
   import MyDemo from '@/demos/my-demo';

   export const demos: Demo[] = [
     // ...
     {
       id: 'my-demo',
       title: 'My Demo',
       description: 'One-line summary shown in the list.',
       author: 'Your name',
       component: MyDemo,
     },
   ];
   ```

That's it — the demo shows up on the home screen and opens at `/demo/my-demo`.

Notes:

- Demos render edge to edge with no header. A floating close button sits in the top-right corner, so handle safe-area insets inside the demo if content goes near the top.
- Keep each demo self-contained in its folder (components, assets, hooks).
- Add native libraries with `bunx expo install <package>`, then rebuild with `bun run ios`.
- Haptics: use [Pulsar](https://docs.swmansion.com/pulsar) (`react-native-pulsar`) — presets, pattern composer, and a realtime composer that works inside Reanimated worklets.
- Sounds: `useSound(require('@/assets/sounds/<file>.wav'))` from `src/hooks/use-sound.ts`.

## Structure

```
src/
  app/
    _layout.tsx      # root Stack
    index.tsx        # demo list
    demo/[id].tsx    # full-screen demo host + close button
  demos/
    registry.ts      # list of all demos
    metro/           # shared HCMC Metro Line 1 data (stations, fares)
    metro-live/      # 3D live tracking: three.js + TypeGPU shaders on WebGPU, status sheet
      shaders.ts     # all TypeGPU materials + the shared day/night uniform
      native-sheet.tsx  # status sheet on a native UISheetPresentationController (TrueSheet): search, detents
      data/          # line1-map.json, generated from OpenStreetMap (see below)
      world/         # map (OSM loader), environment (water, parks, boats, birds), city (OSM buildings,
                     # tube-house infill, roads, traffic, signals), bridges (incl. Cầu Ba Son's pylon),
                     # landmarks (Opera House, Landmark 81, Bitexco, Bến Thành Market), suoi-tien,
                     # railway (double track, stations), trains (doors, pantograph), people
    metro-onboard/   # door display: live route, doors, arrival chime
    metro-tap/       # tap card on reader: proximity haptics, fare, rolling balance
    metro-board/     # LED dot-matrix platform board (Skia)
    spring-card/     # sample demo
plugins/             # Expo config plugins
scripts/osm/         # OpenStreetMap download + build for the metro-live map
assets/sounds/       # UI sound effects
```

`metro-live` controls: one finger pans (with fling), double-tap zooms in, tap-then-drag zooms like Maps, pinch zooms, two-finger tap zooms out, twist or two-finger sideways drag orbits, two-finger vertical drag tilts; the compass resets the view. Countdowns use SwiftUI `Text` with `contentTransition(.numericText)` from `@expo/ui` (`src/components/numeric-text.ios.tsx`).

The HCMC Metro demos are design concepts: station names are real, but travel times, door sides, fares and crowding are illustrative.

### The real map behind `metro-live`

The 3D city is built from OpenStreetMap at true scale (1 scene unit = 4.5 m): the Line 1 alignment and stations, every road in the corridor with its real bridges (Cầu Sài Gòn beside the metro bridge, Thủ Thiêm, Ba Son, Calmette, Ông Lãnh…), building footprints with their tagged heights (within 1.3 km of the line), road tunnels and underpasses (open cuts down to real portals), land use, the Saigon River, canals, lakes, parks and the Suối Tiên theme park boundary. Where OSM has no footprints, tube houses are generated along the real streets, but only where the map shows a town: built-up land use or enough mapped buildings nearby, never on construction sites, cleared land (most of Thủ Thiêm), fields, wetland or industry. Sidewalks stop at the water's edge, and creeks mapped only as centre lines narrow beside the roads that run along them.

Seen from far away the scene swaps to a lighter level of detail (simple tree crowns, no rooftop clutter, lamps or traffic, one instanced block per train car, and a bold route ribbon), which keeps the whole-line overview at 60 fps. To refresh the data:

```bash
node scripts/osm/fetch.mjs --refresh
```

```bash
node scripts/osm/build.mjs
```

Map data © OpenStreetMap contributors, available under the [ODbL](https://www.openstreetmap.org/copyright).

Trees, palms and flower beds use the CC0 [Ultimate Stylized Nature pack](https://poly.pizza/bundle/Ultimate-Stylized-Nature-Pack-zyIyYd9yGr) by Quaternius. Broadleaf crowns are leaf cards cut out of its leaf texture, wrapped around a small core. Coconut palms, the pack's own meshes, line the river promenades and Thảo Điền. The textures and palm meshes are baked into `src/demos/metro-live/data/foliage.json`, so no image loader is needed at runtime. To rebuild that file (needs ImageMagick):

```bash
node scripts/foliage/fetch.mjs
```

```bash
node scripts/foliage/build.mjs
```

In development builds the scene is exposed for QA from the JS debugger: `metroScene.lookAt(x, z, zoom, pitch?)` flies the camera anywhere, `metroScene.debugDrawCalls()` and `debugTriangles()` report render cost, and `globalThis.__cityTimings` holds the build time of each step.
