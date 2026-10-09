# Racing Heritage (formerly Redline Nights): agent handoff

Last updated 2026-10-07 (evening). Read this before changing anything.

Racing Heritage (renamed from Redline Nights; the repo, URL, file names and `rn-` storage keys keep the old name) is an Asphalt 9-style arcade street racer, built and maintained for the user (repo owner `akinojofemi-star`).

- **Main product:** the browser game at https://akinojofemi-star.github.io/redline-nights/
- **Also:** Electron desktop apps (Windows, Mac, Linux), which share the same game code.
- **Multiplayer:** online (up to 6 drivers, room codes, own Cloudflare server) and LAN (desktop app only).
- **Content:** 9 maps, 43 real cars in classes D/C/B/A/S, 4 modes, 4 nitro types. All art is original or open-licensed; nothing is taken from Asphalt.

## Ground rules from the user (follow these)

**Scope and release**
- **Browser first.** Work on the browser game only. Do not build desktop apps, update the share folder or publish GitHub releases until the user asks.
- **Finish with a deploy.** Pushing to `main` is the deploy. Then wait for the Pages run to pass and confirm the new code is live (curl the page and grep for a new identifier).

**Driving model** (each of these was an explicit request)
- **Nothing moves or turns the car but the driver.** That rules out road-following, self-centring, any pull toward a fork path, a wall that turns the nose, a slide back onto the road, and a flight that bends with the road (jumps fly straight). The user was explicit: "a car should not be nudged".
- **The chase camera follows the car, never the road.**
- **A fork is one surface with two paths, not two roads.** Which path a car is counted on (`pickRoad`) is bookkeeping only (laps, map, pickups). It must never affect physics, walls, contact or the camera.
- **Walls wreck only on a near head-on hit at speed:** over 110 km/h and more than 55° to the wall (`WALL_WRECK`). Any glancing hit, however fast, just bounces. Hitting the divider always wrecks.
- **Flips:** a normal ramp never rolls a car whose four wheels are all on it, at any angle. Only one side's wheels on the ramp starts a roll (`edgeRoll`). Rolls are physical: a rate from the launch, with steering in the air speeding or slowing it. Only an upside-down landing (more than 120° off upright) wrecks. On its side (50–120°) the car tips back onto its wheels (`p.settle`) and loses 15% speed. A roll that got most of the way round still counts as a barrel roll. **Twist ramps must never wreck a car that takes them properly:** their roll (`twistRoll`) does as many whole turns as the airtime allows at about one per second (`ROLL_RATE`), paced to finish as the car lands, unaffected by air steering. It re-times on a chained jump. More height or speed means more airtime and more rolls, each one counted in the payout.
- **Every metre a car may drive must show a surface under it.** Check with the ray scan (see Testing).
- **Players choose any fork, as late as they like.** Arriving straddling the divider crashes them.
- **The game should punish bad steering, not forgive it.** Wide run-offs and solid barriers are the safety net.

**Nitro**
- Nitro ends only when the bar empties, on a drift, or on a 360. Extra taps never cancel it.
- Nitro types:
  - Single tap: yellow.
  - Quick or late second tap: orange "pulse".
  - Second tap in the blue window: Perfect. It has the highest top speed, reaches it more slowly than Shockwave, and lasts longest.
  - Double tap on a full bar: Shockwave.
- The Perfect timing indicator must be **on the nitro bar itself**, not in the middle of the screen.

**Maps and visuals**
- Nothing solid may stand where a car can drive. Players complain about driving through obstacles.
- On every map the road must contrast clearly with its surroundings.

**Security** (carried over from earlier sessions)
- Never handle, enter or print API keys or credentials, and never create accounts.
- The Sketchfab key lives in the Blender add-on preferences; use it only through the add-on.
- The user's email (akinojofemi@gmail.com) is for git authorship only.

**Working style**
- The user writes short, informal messages and relays complaints from players.
- They expect you to find and fix bugs yourself, test everything, and deploy.
- Report results plainly, including anything that couldn't be verified.

## Where things are

| Path | What |
|---|---|
| `~/Documents/redline-nights/` | the repo (GitHub `akinojofemi-star/redline-nights`, public) |
| `src/redline-nights.html` | **the whole game**: one file, Three.js r128 from CDN, about 3,300 lines. Edit this, never `app/game.html` |
| `tools/prepare.js` | builds `app/game.html` from `src/` (swaps CDN scripts for `app/lib/` copies). Run after every edit: `node tools/prepare.js` |
| `app/shell.html` | the lobby and home page (`index.html` on the web). Runs the game in an iframe and talks to it via `postMessage` |
| `app/models/<id>.json` | car models (glTF JSON with an embedded buffer), plus `boulder.json` |
| `app/tex/` | CC0 ambientCG textures `<name>_c\|n\|r\|e.jpg`, and tree impostors `imp_<name>.png` |
| `app/manifest.webmanifest` | lets the game added to a phone home screen open full screen |
| `tools/build-web.js` | copies `app/` to `web/` (GitHub Pages). `.github/workflows/pages.yml` runs it on every push to `main` |
| `server/worker.js` | online game server: Cloudflare Durable Object, one room per code, deployed at `wss://redline-nights.akinojofemi.workers.dev`. Deploy with `cd server && npx wrangler deploy` (the user is logged in to wrangler) |
| `main.js`, `preload.js`, `lan.js` | Electron app: LAN relay with a UDP beacon, plus a static server |
| `tools/test/` | test harness (see Testing) |
| `tools/blender/` | car model pipeline scripts (see Car models) |
| `tools/release-notes-1.6.4.md` | draft GitHub release notes (not published) |
| `~/Documents/Redline Nights - Share/` | desktop builds and `HOW TO PLAY.txt` for friends. It currently holds 1.6.4 builds made **before** the mobile UI and test-pass fixes, so they're stale and unreleased |

**Versions**
- `package.json` is 1.6.4.
- The latest GitHub release is **v1.6.3** (desktop).
- Multiplayer protocol is `VER = '1.7'` in `app/shell.html`. Bump it when the network messages change, because only matching versions can play together.
- `MODEL_VER = 12` in the game. Bump it when car models are re-exported.

## Game architecture (`src/redline-nights.html`)

The game script is one IIFE. Main pieces, by name (use grep; line numbers drift):

### Track
- **Layouts:** `LAYOUTS[map]` lists corners `[x, z, radius, height]` that are filleted into a closed Catmull-Rom curve. It also defines:
  - `sec`: road sections with width, edges (wall, kerb or cliff) and surface;
  - `gaps`: jumps across missing road;
  - `br`: the forks, usually one `short` (shortcut) and one `long` (nitro route); Eifel's are its pit lane (short) and a nitro route. Optional `name` and `ease` (see history).
- **Sampling:** `NS = 2400` samples per lap, in arrays `P`, `F`, `R`, `C`.
- **Coordinates:** `s` is distance along the lap and `x` is lateral position. `+x` is to the right of the driving direction. `sample(s)` fills `TS`.
- **Width and edges:** `HW[k]` is the half-width, and `EL`/`ER` are the edge types (0 wall, 1 kerb with a 12 m run-off, 2 cliff with 5 m).
  - `ROL`/`ROR` is the run-off width, tapered so a run-off narrows into a walled stretch.
  - Narrow sections are at least 12.5 m half-width (×1.3), and bends widen by up to 4.5 m a side.
- **Limits:** `limits(e)` returns the drivable `[lo, hi, openLo, openHi]` for a car, widened where a fork overlaps the main road.
- **Forks:**
  - `BR[]`, built by `buildBranchPts`. `easeJunctions` and `easeStart` shape each fork's departure as a Bezier curve that may never cross the main road or swing back toward it.
  - Lookups: `sepB`, `offB` and `msB` (from a fork-road position); `sepM`, `offM` and `bsM` (from a main-road position).
  - `forkCheck` puts a car on whichever road's centre it is nearer. `toBranch` and `toMain` keep the exact world position via `projectTo`. The player gets a 0.12 s lock so it can't flicker between roads.
  - `b.split` and `b.merge` mark where the roads fully part and rejoin (`apartAt`). The split has a solid divider block (`b.nose`, which `goreCheck` uses to wreck a car straddling it); the merge marker is flat paint.
- **Placement rules:**
  - `tun` (optional, default .4) is where along the lap the tunnel search starts.
  - `GAPS` sit clear of forks.
  - `TUNNEL` is placed away from every other road.
  - Ramps (`RAMPS`, `RAMP_TYPES`) are placed by `flatS` and `flatB` with run-out room.
  - `onRamp` keeps boost pads and nitro canisters off ramps.
- **Drivable-space grid:** `DRV` is a 2 m grid marking every spot a car's body can reach.
  - `DRV.keep()` filters instanced props and trees.
  - `DRV.out()` pushes posts outward: gantry legs, billboards, chevrons and roadworks signs.
  - **Any new scenery must use these**, or players will drive through it.

### Player physics
- **Model:** `carPhysics` is a world-space two-axle car: `psi` (heading), `wvx`/`wvz` (velocity) and `yawR` (yaw rate). `projectTo` recomputes `s`/`x` every frame.
- **Steering:** `rIn = steerS*2.6*STEER*…/(1+u/50)` sets the turn rate. With no input the car runs straight in world space, wherever the road goes.
- **Drift:** starts with brake plus steer; counter-steering chains it the other way. The drift's line turns only as hard as you steer into it.
- **Walls:** a car bounces off a wall, losing speed by how hard it hit. Run-off barriers are solid; only landing more than 3 m beyond one is out of bounds (`goOOB` / `respawn`).
- **Ramps:** `rampStep` handles launches. Running into the side of a tall ramp bounces you off it.

### Nitro
- **Table:** `NT[]` holds the four types: 1 yellow, 2 Perfect, 3 Shockwave, 4 pulse.
- **Controls:** `pressNitro`, `nitroOff`.
- **Perfect window:** `PW0`–`PW1` = 0.55–0.85 s after the first tap (`PT = 1.1`). It's drawn on `#nbar`, which grows and lights the window (classes `.timing` and `.hot`).

### Rest of the game
- **Contact:**
  - `collisions` handles traffic and rivals. A takedown needs nitro plus a ram or a side-swipe, or landing on a car from a jump. Rear-ending never wrecks the player.
  - Obstacles: `OBST`, `updateFeatures`.
- **AI and modes:** `updateRivals`. Modes are classic, elim, time and rush (`MODES`, `G.modeSel`).
- **Camera:** `CAMS` and `cameraFollow`, with five views.
- **Phone layout:** `setViewShift` handles the phone-portrait offset.
- **Scenery:**
  - `LOOK[scenery]` sets the per-map palette: the road is darkest, and the run-off and ground use clearly different colours.
  - `rnTex()` applies world-mapped PBR textures through `onBeforeCompile`. **Cloning an rnTex material drops the shader**, so build a new one.
  - `TERRAIN` builds the heightfield.
  - `impTrees`, `boulders` and `chunked` handle the photo props.
- **Multiplayer:**
  - `MP` and `mpStart`/`mpState`/`mpApply`.
  - The host's lobby runs the AI.
  - Remote cars are buffered 100–300 ms and dead-reckoned.
- **HUD and mobile:**
  - Phones are `max-width:640px` or `max-height:500px`.
  - The menu becomes a tabbed sheet: `.card.tabbed`, sections tagged `[data-tab=car|track|mode|set]`.
  - The HUD is a slim band along the top; `.hudbtns` holds camera, full screen and pause.
- **Touch controls:**
  - `bindTouch` wires the buttons.
  - The custom layout editor is `#tedit`. Layouts are saved in `localStorage` key `rn-touch`, separately for portrait and landscape.
- **Full screen:** `toggleFS()` posts `{t:'fs'}` to the shell (`toggleFullscreen()` there; the app uses `rn.toggleFullscreen`). iPhones have no Fullscreen API, so they get an "Add to Home Screen" tip instead.
- **Test hook:** `game.html?test=1` exposes `window.__ev(src)`, which evaluates code inside the game's closure.

## Testing (do this after every gameplay or map change)

**1. Start a local server**
```bash
python3 -m http.server 8765 -d ~/Documents/redline-nights/app
```
In this desktop app, `/Applications/.claude/launch.json` already has an "rn" configuration for this; start it with `preview_start`.

**2. Copy the test scripts into `app/`, and delete them before committing**
```bash
cp tools/test/suite.js app/zz_suite.js && cp tools/test/bot.js app/zz_bot3.js
```

**3. Run maps from `http://localhost:8765/shell.html`**

Open each map in an iframe and evaluate the suite inside it:
```js
const f=document.createElement('iframe');f.src='game.html?test=1&n='+Math.random()+'#city';document.body.appendChild(f);
await new Promise(r=>f.onload=r);await new Promise(r=>setTimeout(r,2000));
f.contentWindow.__ev(await (await fetch('zz_suite.js')).text());
f.contentWindow.__ev('T.probes()');            // feature probes on this map; problems go to T.issues
f.contentWindow.__ev(`T.race(5,'classic',{drift:true,nitro:'perfect',avoid:true})`);  // a full race driven through the controls
f.contentWindow.__ev('T.issues.join("\\n")');
```
- **Maps:** `city`, `canyon`, `alpine`, `coast`, `tokyo`, `jungle`, `volcano`, `arctic`, `industrial`, `eifel`, `sakura`, `desert`, `autumn`, `moon`, `tropic`, `savanna`, `highland`, `retro`, `bayou`.
- **`T.probes()` covers:** every ramp, air and ground 360s, gaps, both fork routes, divider crashes, canisters, pads, roadworks, traffic, nitro rams, Shockwave, all nitro types, drift, out of bounds, the cameras and ghost mode.
- **`T.race(carIdx, mode, opt)`:** checks every frame for NaN values, cars escaping walls, stuck cars and whether the results screen appears.

**Known false alarms**
- "player outside limits x = hi+5" comes from the out-of-bounds probe placing the car there on purpose.
- A rare "could not stay on the main road" is the bot running wide. It can also appear on City's short fork in the first map of a long all-maps run; on its own it passes.
- "results never shown" when `laps × lap time` exceeds `secs` (default 170 s). Pass a bigger `secs` for multi-lap races.
- An occasional race note of a player 0.6–0.8 m outside limits during a wall bounce, or an out-of-bounds where the bot runs off a gap's cliff edge.

**Other checks**
- **Class balance sim (after any car or engine change):** for each car, on six maps (city, alpine, industrial, coast, canyon, arctic), start a classic race, then set `G.countdown=0` and `G.mode='race'`. Clear traffic (`t.down=true`), rivals (`r.out=true`) and roadworks (`OBST.length=0`: dead blocks revive). Drive one lap with `T.drive({drift:true,nitro:'perfect',avoid:true})` and sum the lap times. Within a class, set `k *= 1 + gain × (time / class mean − 1)` with gain 1.5, then 1.2, then 1, clamping `k` to 0.85–1.15. Apply `k` to `c.bal` and `c.top = top0 × (1 + (k − 1) × 0.6)`. Bot noise is about ±1%, so keep each car's best pass and confirm with one more run.
- **Surface coverage (after any road or edge change):** for every drivable point (step along each road; across from `limits()` lo to hi), cast a `THREE.Raycaster` straight down from 3 m above the road against the scene's visible, non-instanced meshes (set `ray.camera=camera`). A point with no hit within 1.2 m of road height is a hole. One-sided materials facing down count as holes, which is the point. It takes about 25 s per map and blocks the page, so poll with short waits.
- **Screenshots:** iframes render black with `toDataURL`. Navigate the pane itself to `game.html?test=1&n=<unique>#map` instead (a hash-only change doesn't reload). Render, then POST `renderer.domElement.toDataURL()` to `tools/test/recv.py` (port 8791). `tools/test/sheet.swift` makes contact sheets.
- **Phones:** use the browser pane's mobile preset (375×812) and a custom 812×375 for landscape. Reset to desktop afterwards.
- **Online smoothness:** wrap each lobby's `WebSocket` in the duo page to delay sends and receives by 30–70 ms each, with occasional 150–350 ms stalls, from a seeded random sequence so builds can be compared. Step both games by the real elapsed time (stepping 1/60 per tick runs slower than real time and biases the result). Compare B's remote car `car.g.position` with A's real one: distance, and the second difference for roughness. Single runs are very noisy, so always compare several seeds in the same frame setup.
- **Online:** run `npx wrangler dev --port 8787` in `server/`, open `app/duo.html?server=ws://localhost:8787` (two lobbies side by side) and drive them by clicking buttons (`hostOnline`, `code` + `joinCode`, `ready`, `start`). A hidden pane doesn't run `requestAnimationFrame`, so step the games with `iframe.contentWindow.__rn.step(dt)`.

## Car models

The models are real cars from Sketchfab (mostly CC BY-NC-SA, so the game must stay non-commercial). Credits are in `CREDITS` in the game.

**Pipeline** (Blender 5.2 through MCP; the add-on listens on :9876). `tools/blender/newcar.py` runs it end to end:
1. Exec `carlib.py`, `sfab.py`, `texsplit.py` and `newcar.py`, in that order, into one dict put on `builtins` (each MCP call gets a fresh namespace). Set `RAW_DIR` to a scratch folder for the raw imports. After each Blender start, set `scene.blendermcp_use_sketchfab = True`. The Sketchfab key lives in the add-on preferences: use it only through the add-on.
2. Import from Sketchfab (`import_asset`, target size about 4.6), then `report(rules)` to see the dimensions and the biggest materials with the class each would get.
3. `build(id, rules, split=...)`:
   - `texsplit` bakes texture × vertex colour into `Col` and splits two-tone parts. `split` defaults to `('paint','trim','chrome')`. Drop `'paint'` when white patches appear (a livery or light paint read as chrome).
   - `prepare_car` assigns the game materials and rigs the wheels.
   - `per_class_decimate` welds the body at 0.2 mm, then decimates each material on its own to `BUDGET` (paint 11k, black/trim 6k, glass 4k, chrome 2.5k, each light 1.5k). A whole-body collapse decimate shreds Sketchfab meshes split at every seam.
   - `smooth`, then export a GLB to `/tmp/rh_glb`.
4. Run `python3 ../tools/blender/glb2json.py <dir>` from `app/` to produce `app/models/<id>.json`. Copy only the new GLBs into a fresh directory first.
   - Then run `python3 ../tools/blender/darktrim.py models/<id>.json`. Forza-sourced textures often bake light grey into parts that are black on the real car, and the game shows the trim's baked colour, so they come out white. The script scales the trim's mean colour down to 3.5% when it is above 15%. Most cars sit at 0.5–5%.
5. Bump `MODEL_VER` (now 12).

Rule gotchas:
- Interiors often share materials with the outside. Delete interior objects by name first (`SM_Interior`, `SteeringWheel`, `INTERIOR`, `BONNETCAM`, `polySurface*`), or tell them apart by phong number.
- A `windowinside` → delete rule took the Alpine's whole body with it.
- `carlib` has a gloss `black` material for texsplit.
- **Check the nose.** `prepare_car`'s `nose='auto'` picks the wrong end on some long-tailed mid-engined cars. The Valhalla, AMG ONE and Daytona SP3 drove tail first until fixed. Because it labels the lamps and front wheels by the end it chose, a headlight-position check passes anyway. Look at each new car from its +z side in the game. Fix a finished model with `python3 ../tools/blender/turnaround.py models/<id>.json`: it rotates the geometry, swaps the wheel names and the head/tail lamps, and needs a `MODEL_VER` bump. For a rebuild, pass `nose='-y'` or `'+y'`.
- On Forza-sourced models (`…RewardRecycled…`), `Coloured_Material` is the black secondary zone: grilles, sills, mirrors, diffuser and window surrounds. It defaults to paint, so add `(r'coloured_material','black')` unless it really is the body colour (on the A110 the body paint is `WindowInside`).

**Provenance:** many Sketchfab car models (ddiaz-design and others) are ripped from games. Material names show it: "RewardRecycled" is Forza, "nfsm" is NFS Mobile, and one name says "from_CSR2". The game must stay non-commercial. Rejected for unclear origin or broken geometry: VTX_car's AMG ONE, LSxSEPTIC's AMG GT Black Series, several GR Corollas.

Smoothing pass (2026-10-08, all 43 cars): weld paint vertices at 0.5 mm, 4 rounds of vertex smoothing (factor 0.45) on interior paint vertices only, shade every face smooth, then a Weighted Normal modifier (face area, weight 50, keep sharp). Export with `export_vertex_color='ACTIVE'`. Transferring normals from a heavily smoothed copy of the paint was tried and dropped: it gives dark blotches because many paint faces point inward. The models depend on double-sided materials. For more real detail, the cars must be re-imported from Sketchfab at a higher polygon budget. The per-car `prepare_car` rules were never saved, so that means about 4 hours of work.

Gotcha: Rimac material names match the wheel rule (`^rim`), so rename them first.

## Releasing desktop apps (only when the user asks)

1. Run `npm run dist:all`. Windows NSIS and zip and Linux AppImages build fine on this Mac.
2. Copy the builds into the share folder, replacing the old version, and update `HOW TO PLAY.txt`.
3. Run `gh release create vX.Y.Z … --latest` with the notes file.

Mac builds need `identity: '-'` and `hardenedRuntime: false` (already set). Delete removed builds with `rm "${SH:?}"/…` (a safety check blocks a bare `$SH`).

## Recent history (newest first)

- **Reversed cars fixed (2026-10-09):** the Valhalla, AMG ONE and Daytona SP3 models were built back to front (wrong nose from `nose='auto'`), so they drove tail first. They were turned round with `tools/blender/turnaround.py`. All 68 cars were checked from the front. `MODEL_VER` 12.

- **25 new cars (2026-10-09), 68 in all:** five per class, all from ddiaz-design on Sketchfab.

  | Class | New cars |
  |---|---|
  | S | Aston Martin Valhalla, Mercedes-AMG ONE, Porsche 918 Spyder, Ferrari Daytona SP3, Koenigsegg Regera |
  | A | Corvette Z06, Ferrari 296 GTB, McLaren Artura, 911 GT2 RS, Aston Martin DBS GT Zagato |
  | B | 718 Cayman GT4, Lotus Emira, Maserati MC20, BMW M5 CS, Jaguar F-Type SVR |
  | C | Audi RS3, Hyundai Elantra N, AMG A45 S, Alpine A110, Lancer Evo X |
  | D | AE86 Trueno, Honda S2000, Mazda RX-8, Fiesta ST, Integra Type R |

  - The new cars were balanced against the class mean of the existing cars, which kept their `BAL` values.
  - The default car is now found by id (`civic`), not by index.
  - `MODEL_VER` 11, `VER` 1.11.

- **Shockwave push, three more maps, boost-pad fix (2026-10-09):**
  - **Shockwave contact:** while a shockwave runs (`nitroLevel 3`), touching any rival or online player throws it aside with `shove(o, side)`, and takes it down too when knockdowns are on. The blast does the same to everyone in reach (before, with knockdowns off it only slowed AI rivals). AI cars carry `r.shove`, a 16 m/s sideways slide that decays, with no steering back until it's spent, clamped by walls; wrecked ones slide too. Online players get `mpBump` with `lat:±16`.
  - **Highland Loch** (`highland`, 4.9 km): rain, a wet road, overcast, steep green glens, a zig-zag of switchbacks, a ruined castle (towers and curtain walls), dry-stone walls, sheep and lochs.
  - **Retro Wave** (`retro`, 4.6 km): square corners. The ground is the canvas grid (`GROUND_LOOK.grid`), with a striped synthwave sun, wireframe mountains and neon pylons. The shortcut is a "hyperlane" across the middle, about 650 m shorter.
  - **Bayou Nights** (`bayou`, 4.9 km): moonlit night, cypress trees over dark pools, stilt shacks with lantern glows, lanterns on posts, fireflies (`wx:'fireflies'`, additive, rising) and a cliff-edged causeway. A shortcut there would have had to cross the bottom wiggle, so the nitro route goes round outside it and the shortcut cuts inside the eastern bulge.
  - **Boost pads:** a pad in a ramp's flight path (same lane, up to `T.len+FLY(T)` past the ramp) moves to just past the landing. Two new maps had a start pad that cars flew over.
  - `VER` 1.10.

- **Three more maps (2026-10-09):**
  - **Lunar Base** (`moon`, 5.8 km): a black sky with stars, grey regolith terrain, craters (flattened torus rims over dark floors), white domes with glowing bands, masts with red lights, and a lit Earth with a blue halo overhead. Base lamps along the track. The crater rim has kerbs on its inside: a twist ramp there rolled cars off a 5 m cliff run-off.
  - **Paradise Isle** (`tropic`, 5.5 km, noon): a turquoise sea ground (like the coast's), a white sand strip either side of the road (left off under the cliff-edged causeway), palms, huts on stilts out in the lagoon, green islands far off. The shortcut is a hairpin cut-back across the bottom bend.
  - **Savanna Sunset** (`savanna`, 5.1 km): golden grass, flat-topped acacias, baobabs, red termite mounds, rocky kopjes, a red-earth dirt section (sand texture tinted red, because the dirt texture reads green). The shortcut bows north round the notch: a straight chord clipped the hairpin to 6 m.
  - `palms(spots)` is now a shared helper (the desert and the island).
  - Suite fixes:
    - `T.clear` also avoids roadworks (the drift probe was starting in the barrels on Moon) and prefers a straight.
    - The ram probe puts the rival 6 m ahead, on the ground (from 9 m away it sidesteps, and a rival left mid-air is flown over).
    - The canister probe resets canisters first (an earlier probe may have taken them, and they respawn only after 12 s).
  - `VER` 1.9.

- **Three new maps, bolder bend signs, proper finish (2026-10-09):**
  - **Sakura Pass** (`sakura`, 4.4 km, spring day): cherry blossom (jacaranda tinted pink), firs, a switchback pocket over a drop, a stone shrine road under red torii gates (built like gantries, posts via `DRV.out`), pagodas, a snow-capped peak and falling petals (`wx:'petals'`). Its corner list starts at the straight after the switchbacks, so the start is clear of both forks.
  - **Dune Sea** (`desert`, 5.6 km, golden hour): a fast highway out to a far hairpin, then a dirt S-bend back. Smooth dune terrain, palm oases, rocks, three pyramids far off.
  - **Maple Valley** (`autumn`, 4.9 km): twisty lanes, low-poly maples in red, orange and gold (per-instance colour; tinting the photo trees went muddy), firs, red barns and hay bales on the dirt section, and falling leaves (`wx:'leaves'`).
  - Designing a layout: preview with `layoutPoints` in any `?test=1` page and keep non-adjacent stretches at least about 200 m apart. Then load the map and check every `b.sep` profile: it must rise once and fall once. Forks must not overlap each other, and neither may the start.
  - Fork lessons: the automatic ease can start inside the bend before a straight and wobble about 1 m to the wrong side, and a bot (or a player) holding the far side then counts as on the fork. Fixes:
    - Draw the departure tangent by hand (`ease:[0,…]`), with its first point far enough along the straight that the fillet starts on the straight.
    - Keep a fork's start well clear of a hairpin exit, because running wide there drops you onto the fork.
  - Bend signs (`CHEV`, all maps): three severities (red under 48 m radius, amber under 85 m, pale under 150 m, every other spot). Boards are 30% bigger, unlit, ignore fog, and stand wholly outside drivable space.
  - Finish (`finishAt`, all maps): a 6 m checkered band, a checkered arch with the map name, and tall checkered pylons. Any fork spanning the line (Eifel's pit lane) gets its own band and arch where its cars actually finish, at `s0 + bs*span/len`.
  - `clouds()` and `unitBox` are shared helpers for the daytime maps.
  - Suite: the parked-traffic probe starts 25 m before the car (from further back the bot cuts a bend and misses).
  - `VER` 1.8 (new maps: older clients must not join a game on a map they lack).

- **Eifel finishing touches (2026-10-09):**
  - The Bit to Hatzenbach straight has kerbs and 12 m of run-off instead of cliff edges (the jump keeps its own edges).
  - Gravel traps (sand texture, grey-beige) on the outside run-off of every kerbed bend tighter than 180 m.
  - Grandstands round the outside of Dunlop and Coca-Cola.
  - An "EIFEL · GRAND PRIX" advertising bridge (a `gantry`) 170 m before the Dunlop apex.
  - Fair-weather cloud sprites in the sky.
  - All `forest`-only.

- **Eifel nitro route (2026-10-09):** a `long` fork that leaves the Valvoline descent (eased) and loops east round the outside of Ford. It merges by hand (`ease:[1,0]`) into the run down to Dunlop at about 2,670 m, well before the hairpin; the automatic merge eased right into the Dunlop braking zone. It's 1,195 m against 1,056 m of main road and stays at least 72 m from every other stretch, with 32 canisters, 5 pads and a ramp. The main-road ramps re-placed themselves round it. One bot run in four went over the cliff edge after the jump near the new hops on the Bit straight; it didn't repeat.

- **Eifel pit lane (2026-10-09):**
  - The pit lane is a `short` fork named `PIT LANE`. It leaves the NGK straight about 200 m after the chicane, hooks round inside Coca-Cola (radius 30), runs 76 m to the right of the start straight past the line, and merges about 470 m after it. It's 762 m against 925 m of main road.
  - New branch options: `name` (the label on signs, gantries and hints) and `ease:[start,end]`. Set an end to 0 to keep it exactly as drawn; the automatic ease only suits gradual peel-offs. Both pit-lane ends are drawn by hand and tangent to the main road.
  - The fork crosses the start line, which is fine: lap distance is continuous on a branch.
  - Fix in `pickRoad`: a candidate road only counts if the car's mapped position matches its real world position. Where a branch bends back (the pit lane inside the hairpin), the nearest point can be far along it with a small sideways offset, and the car jumped 100 m onto the pit lane.
  - Pit garages now stand on the far side of the pit lane.
  - Suite: the flip probe uses a ramp on a straight, and the parked-traffic probe uses the straightest run-up. Both used to fall back to bends on Eifel.

- **New map, Eifel Grand Prix (`eifel`, 2026-10-09):**
  - Traced from the user's map of the Nürburgring GP circuit at 5.5 m per pixel (5.95 km lap). Corner names are left out of the game.
  - To trace a map: load the image into a canvas, overlay `layoutPoints(spec)` from a `?test=1` game frame, adjust the corners until it matches, and check that non-adjacent stretches are at least about 70 m apart centre to centre. The Haug-Haken and Dunlop hairpins are opened out a little so their legs don't touch at the game's road width.
  - Its forks are the pit lane from the drawing and a nitro route (see the newer entries). The jump is on the Bit to Hatzenbach straight; `tun:.53` puts the tunnel on the Audi S climb (the default put it over the Dunlop braking zone).
  - New `forest` scenery: daylight, grass, photo firs, rolling hills, red, white and blue grandstands opposite the pits on the main straight and round the arena, and a pit building.

- **2K textures, better car paint (2026-10-08):**
  - Desktop loads 2K colour maps (`<name>_c2.jpg`, listed in `TEX2K`) for asphalt, concrete, dirt, grass, ice, paving, dark rock, layered rock, sand and snow. They are the original ambientCG CC0 sources (Asphalt031, Concrete034, Ground037, Grass004, Ice002, PavingStones070, Rock035, Rock051, Ground054, Snow006), saved at quality 70. Normal and roughness maps stay 1K. Phones stay 1K. The metal and stone-wall originals couldn't be identified, so those stay 1K, and facades are unchanged because their window glow maps line up with the current images. To download from ambientCG, use curl with a browser user agent on `https://ambientcg.com/get?file=<ID>_2K-JPG.zip`.
  - Paint colours were sRGB hex values used as linear, which washed every car out. `paintCol` converts them, and the paint picker uses it too. Paint is slightly less mirror-like now (roughness .3, clear-coat roughness .07) so leftover facets in the meshes show less.
  - Picking a car preloads every model in its class, so the race doesn't wait on the download.
  - Every car got the smoothing pass described under Car models.

- **Renamed to Racing Heritage; looks, smoothness, online (2026-10-08):**
  - Every visible name changed to Racing Heritage: titles, logo, home-screen name, desktop title, an in-game billboard, the server's text reply. The server change takes effect only after `wrangler deploy`. Internal names stay.
  - Ramps all share one look: a dark deck with amber chevrons and white edges, dark metal sides, amber rails on both edges and a white lip.
  - World textures: `rnTile` in `rnTex` blends each texture with a bigger, rotated copy of itself under a wandering mask, plus a gentle large-scale brightness variation, so tiling no longer shows.
  - Cars: `ENV` is now a prefiltered environment built from the map's sky (gradient in linear light, lifted at night), a ring of horizon lights, an overhead glow and the sun or moon. The old canvas cube is the fallback. Paint is `MeshPhysicalMaterial` with a clear coat; glass and chrome are sharper.
  - Smoothness: every shader is compiled during the countdown (`prewarm`, hidden objects included), and again just after a car model arrives. Before, 28 shaders compiled on the first race frame (212 ms) and more mid-race. Frame steps near the recent average use the average (`dtAvg`). A few per-frame allocations were removed.
  - Online: 20 car updates a second (`MP_RATE`, was 15). Remote cars keep the old smoothing in `mpApply`: a spring rewrite tested worse and was dropped. Remote drift smoke shows. Bumps are felt on both screens (`mpBump` sends `{t:'ev',type:'bump'}`, applied unless that player's own game registered the contact in the last 0.25 s). `VER` bumped to 1.7.

- **Acceleration curves, class balance, lobby stats, canisters (2026-10-08):**
  - `engineAcc(spec,u,top)` is the one engine curve, used by the physics and by the menu's 0–200 stat (`accelTime`). Pull is strongest at a standstill and eases smoothly to zero at top speed, with no step. The shape depends on drivetrain (`POWER`, `DRIVE` by model): EVs launch hardest and fade most, hybrids launch strong, turbos are the default, and high-revving cars without turbos launch softer and pull to the top.
  - Class balance: `BAL[model]` scales a car's pull, and 60% as much its top speed, so every car laps within about 1% of its class average. The Corvette C8 and the Audi RS6 moved to class B.
  - The multiplayer lobby shows the chosen car's stat bars and description. The game sends them with its car list in the `ready` message.
  - Reverse: holding brake once the car has stopped reverses it (up to about 45 km/h), and steering works backwards. Before, a car stopped nose-first against a wall could never get off it. The test bot backs off walls the same way.
  - Canisters: bigger and brighter, with an 18 m solid cyan beam and a ring on the road (no fog on either). They are per player by design: each game collects for its own car only and never syncs pickups, so taking one never takes it from anyone else.

- **Invisible road, flips, wall wrecks (2026-10-08):**
  - The left kerb and run-off were built mirrored, so they faced down and were invisible from above on every map with open left edges (Volcano and Coast worst). They're now built facing up.
  - Where a fork meets the main road at an angle, the shared drivable area reached into a corner with no surface; tarmac aprons now cover it on both roads. A downward-ray scan of every drivable point finds 0 uncovered spots on all 9 maps.
  - Rolls, roof landings and the wall rule as above. Ramps only lift a car with at least one wheel on them (half the ramp's width plus `WHEEL`).

- **No nudging at all, and visibility (2026-10-08):**
  - Removed every nudge: walls turning the nose and sliding the car back onto the road, path switching that drove the walls and the camera, and the in-air bend and sideways damping. For the player, `pickRoad` replaces `forkCheck`: it picks the nearest path centre among the paths the car is on, and never switches within 1 m of a junction.
  - Walls stop the car at their line and take the speed it carried into them. A hit faster than `WALL_WRECK` wrecks. Car contact works across fork paths: `overlap` uses world positions when two cars are counted on different paths.
  - Chase camera: its direction comes from the car only (70% velocity, 30% heading, lightly smoothed). The default CHASE view is raised to up 2.3 / back 5.8 / ahead 12, with up to 8 m more look-ahead at speed.
  - Fog starts at least 320 m out (2.5× each map's value) and is full at 1400 m or more (1.25×).
  - Jumps: flights are straight now, so `fliesOn` only places a ramp or gap where a straight line off it (from anywhere across its width) stays over the road for a 330 km/h flight. Ramps need a 60 m straight run-up and gaps 100 m. A ramp with no such spot falls back to a smaller one (mega → kicker → hop, twist or kicker → hop). Tokyo's gap is now 366 m after the start, the only spot that fits.
  - Bot wrecks went from about 0.5 to 3–7 per 2-lap race, and lap times rose 5–15%. The game is harder by design now.

- **Forks, ramps from the air, drift feel (2026-10-08):**
  - Forks no longer pull the car. Three causes: (1) the chase camera snapped up to 25° in a frame when the car was switched between the two overlapping roads; it now carries the road's direction across a switch and eases over (`camRoad` in `cameraFollow`). (2) A car physically on the other road when the overlap ended was slid onto the road it was counted on and its nose turned up to 38°; `onOtherRoad` now moves it to the road it's actually on. (3) A car on the seam between the roads (on neither) was eased onto one; now it's a divider crash. The divider block is drawn on the real seam between the road edges (it was up to ~5 m off where roads meet at an angle).
  - Ramps work from the air: `rampStep` lands a flying car on a ramp surface it comes down onto, bounces it off a ramp's tall side, and launches it again if it skims the lip within 1.5 m. Rivals use the same code.
  - Drift: tail kicks out to about 30° in 0.3 s (was 0.5 s for 28°) and holds about 40° with no overshoot, unwinds in about 0.5 s on release, and hands back to grip with no snap. The drift direction uses the sign of the stick, so half-stick drifts fully. Steering is unchanged (the user said it's fine).
  - Suite: new probes for skimming a ramp in the air and for camera swings at forks.
- **Bug fixes (2026-10-07):**
  - The "NaN bounding sphere" error: the Civic Type R's code-built stand-in body (shown while its model downloads) had a NaN wing, because the hatch shape has no `deckH`. The wing now stands on the tailgate.
  - Gap placement steps down its rules (280 m run-out, then 200, then 180) instead of silently keeping an unchecked spot, and keeps 600 m after the start line so the pack has spread out. City's gap moved from 349 m to 793 m, Tokyo's from an unchecked 1560 m to 3330 m (Tokyo's tunnel moved to 1215–1674 m as a result). The other maps are unchanged.
  - Fork divider: `goreCheck` now judges a hit where the car's front reaches the block's front face. Before, the edge wall shoved a straddling car aside first, so Coast's short-fork divider never crashed anyone.
  - Test suite: the parked-traffic probe picks a car on a straight approach.
- **Touch controls editor:** drag the buttons, size, opacity, swap sides, reset.
- **Mobile UI:** tabbed menu sheet, slim race HUD, full screen in the HUD, pause menu and settings.
- **Full feature test pass (45 races plus probes on all 9 maps).** Fixed:
  - fork road switching that stalled cars and let them slip past the divider;
  - fork roads weaving back over the main road;
  - run-off areas ending abruptly at a wall;
  - gaps inside forks;
  - boost pads and canisters on ramps;
  - traffic parked where jumps land.

  The Perfect indicator also moved onto the nitro bar.
- **1.6.4:**
  - Removed all steering assist.
  - Nitro taps never cancel.
  - Wider roads.
  - Scenery kept out of drivable space.
  - Fork dividers were sitting mid-road on three forks; they're now at the real split.
  - Clearer road colours.
- **1.6.3 and earlier:** photo trees and boulders, 43 cars, the four nitros, textured worlds, the Asphalt-style camera, chain drifts, slipstream trails, fair contact online, its own online server, and LAN in the app.

## Open items and known issues

- **Untested on real devices:** the mobile UI and the touch editor were only checked at phone sizes in a desktop browser. Ask the user for feedback from players.
- **Gap placement:** Tokyo's gap only fits with the 200 m run-out tier, and it still ends about 185 m before the long fork. That's the best spot the map allows.
- **Sunset Coast palms** are code-built, not photo-real (Poly Haven has no palm).
- **New maps:** the user once asked for maps modelled on an Asphalt video that can no longer be viewed. Ask for screenshots if new maps come up.
- **Stale desktop builds:** the share folder's 1.6.4 builds don't include the mobile UI and test-pass fixes. Rebuild before any desktop release.
- **No pause in multiplayer:** the pause menu is disabled online, but the HUD full-screen button still works.
