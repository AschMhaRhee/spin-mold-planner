# How the code works

The app is a single HTML page with no dependencies and no server. `build.js` inlines everything into `dist/index.html`.

```
src/engine.js        all the casting logic: plain JavaScript, runs in browsers and Node
src/app.html         the screens: drawing, mouse/touch handling, tabs
examples/            generic example parts + the script that generates them
test/engine.test.js  engine tests (Node's built-in test runner)
build.js             inlines engine + examples into dist/index.html
docs/RULES.md        the rulebook, the human-readable spec for engine.js
```

**Units:** millimetres everywhere in the engine. The UI converts inches for settings.
**World frame:** mold centre at (0, 0), y pointing down, like a canvas.

## The pipeline

### 1. Read the part: `parseSTL()` → `analyze()`
- Reads binary or ASCII STL.
- Picks the "lies flat" axis (the thinnest one by default).
- Rasterises the triangles into a top-down grid (about 280 cells across the longest side). For each cell it records the **top height**, the **bottom height** and the **thickness**.
- Derives:
  - `mask`: which cells are part.
  - `bnd`: outline points, about 0.5 mm apart.
  - `blurAll`: average thickness over a ~1.2 mm window. It's low on thin *or* narrow features, which is how bails and blade tips get detected.
  - `blurWide`: the same over a wider window, for "how much material is behind this edge".
  - `hx, hy`: the heaviest region (gate target).
  - `cands`: outline points that qualify as gate sites (≥ 95% of max thickness and wide enough).
  - `vol`: volume, from the triangles directly. Weight is volume × density.

### 2. Orient: `bestThetaInfo()`
Tries 48 rotations with the part's inner edge on a radial line and scores each one: narrow on the ring (more cavities fit), a good gate site near the inner edge, and it must fit radially. See rule P4.

### 3. Place: `layout()`
- Copies are sorted heaviest first.
- **Try 1 (symmetric):** evenly spaced slots, with pairs opposite each other. Each part searches a small angle window around its slot and steps outward from the "closest to centre" limit until it doesn't collide.
- **Try 2 (packed):** any angle, closest radius, tie-broken by balance.
- Collisions are checked on a 0.5 mm occupancy grid. Cavities are stamped dilated by the spacing. Each gate's spoke corridor is also reserved, so later parts don't block it.
- Each placed copy has a **pose** `P = {c, s, ox, oy, theta}`: rotation plus translation from part grid to world. `toW()` and `toL()` convert both ways.

### 4. Gate and vent: `finish()` → `findVents()` → `routeVent()`
- `chooseEntry()` picks the gate: a qualifying outline point near the centre and near the heavy region, with a clear straight ray to the basin (`clearRay()`).
- Slot size: rule G5.
- `findVents()` adds gate vents (V2), the main vent (V1) and point vents (V3). Point vents are outline points that are local minima of distance-to-centre, with some prominence.
- `routeVent()` finds a channel from each vent wedge to the rim with A* on the grid, avoiding cavities, spokes and the basin, then simplifies the path. No path → drilled vent (V5).

### 5. Explain: `explain()`, `explainLayout()`
Turns the numbers recorded during placement (`inst.why`, `inst.gate.inner`, `v.drillWhy`…) into the plain-language reasons shown in the app and in saved images. **If you change a rule, update its explanation too.** The tests check that every vent has one.

### 6. Fix a mold: `frameFor()`, `diagnose()`
Builds a virtual mold frame around one part (centre straight "up"), then classifies the painted unfilled area: touching the centre side, an interior pocket, or outer end only. It checks the user's gate against G1/G2 and returns notes, vent points, ordered fix steps and a re-gate suggestion.

## Where to start

- **Tune a number:** the constants are inline next to the rule they implement. Search `engine.js` for the rule's code reference in RULES.md.
- **Add a metal:** add an entry to `METALS`. Users can also edit metals in the app.
- **New feature ideas:** see "Known gaps" at the end of [RULES.md](RULES.md).
