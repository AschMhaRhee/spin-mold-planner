# The rules the planner follows

This is the whole rulebook in plain language. Every rule says where it comes from and where it lives in the code, so anyone can check it, argue with it, or improve it.

**Sources.** Rules marked **Oster** come from Oster Pewter's *[Principles of Centrifugal Rubber Mold Casting](https://osterpewter.com/pewter-rubber-mold-casting)*, chapters 8–10. Rules marked **Planner** are this project's own starting numbers and heuristics. They are reasonable guesses, not established practice, and they're the best place for casting reports to improve things.

Code references point into [`src/engine.js`](../src/engine.js).

---

## How a cavity fills

| ID | Rule | Source |
|---|---|---|
| **F0** | Spinning throws metal to the **outer end of each cavity first**. The cavity fills from the outside in, and the side **nearest the centre fills last**. That's where air gets trapped and where most flaws show up. Almost every rule below follows from this. | Oster ch. 10 |

---

## Placement (`layout()`, `bestThetaInfo()`)

| ID | Rule | Source | Code |
|---|---|---|---|
| **P1** | Keep the layout balanced and symmetrical. Matching parts go **directly opposite each other**. | Oster ch. 8 | `attempt(true)`: slots spaced evenly, pairs at slot *k* and *k + n/2* |
| **P2** | **Heavier parts go closest to the centre.** The planner places parts heaviest first, and each part takes the closest free spot. | Oster ch. 8 | `list.sort` by mass, then the radius search starts at "closest to centre" |
| **P3** | Clearances: Oster's beginner numbers are at least **2¾" from centre and ⅝" from the rim**, and experienced moldmakers go much closer. The planner defaults to **1.75"** from centre, **0.625"** from the rim and **0.19"** between cavities, all editable. | Oster ch. 8 / Planner defaults | `params()` in `src/app.html` |
| **P4** | Point the **long axis out from the centre**, so each part takes up as little of the ring as possible and more cavities fit. Among those orientations, prefer one that puts a thick, wide edge nearest the centre for the gate. | Planner | `bestThetaInfo()` score: `0.5 × gate distance + 1.0 × width + 0.1 × length − 4 × gate wideness` |
| **P5** | If even spacing doesn't fit, fall back to packing each part into the closest free spot that keeps the centre of mass nearest the middle. | Planner | `attempt(false)` |

## Gates (`chooseEntry()`, `finish()`)

| ID | Rule | Source | Code |
|---|---|---|---|
| **G1** | Gate into the **thickest section**. It shrinks most and freezes last, so it has to stay connected to the feed. | Oster ch. 9 | candidates must be ≥ 95% of max thickness (`analyze()`) |
| **G2** | **Never gate through a thin or narrow feature** (a jump ring, bail, sword tip). It freezes first and seals off the heavy part. | Oster ch. 9 | candidates also need local "wideness" (`blurAll ≥ 0.4`); the innermost thin point gets a vent instead |
| **G3** | **One gate per cavity.** More gates make cold shuts where the streams meet. | Oster ch. 9 | one entry per cavity |
| **G4** | The gate needs a **straight, clear spoke from the basin** that doesn't cross the part or another cavity. | Planner | `clearRay()` |
| **G5** | Starting slot size: width ≈ **35% of the section's width** at the gate, depth ≈ **70% of its thickness**, times the metal's **gate factor**. **Start small, enlarge after trial spins.** You can't make a gate smaller. | Oster (start small, larger for short-pasty-range alloys) / Planner (the percentages) | `slotW`, `slotD` in `finish()` |
| **G6** | Alloys with a **short pasty range** (zinc, Zamak, pure lead) freeze fast and need **larger gates** than pewter. | Oster ch. 9 | `gateFactor` in `METALS` |
| **G7** | Pour **considerably more metal** than the cavities need, so the sprue and gates feed shrinkage. The planner shows ≈ 1.25 × (cavities + spokes + basin). | Oster (more metal) / Planner (the 1.25) | `L.pourMass` |

## Vents (`findVents()`, `routeVent()`)

| ID | Rule | Source | Code |
|---|---|---|---|
| **V1** | **Main vent:** on the line from the mold centre through the cavity's centre, at the wall nearest the centre. | Oster ch. 10 | `kind: 'main'` |
| **V2** | **Gate vents:** one on **each side of the ingate at 45°** (standard for direct gates). | Oster ch. 10 | `kind: 'gate'` |
| **V3** | **Point vents:** narrow features that point toward the centre or sideways (ears, legs, tails, blade tips, crown points) trap air, so each one gets a vent. The planner finds them as local "closest to centre" points on the outline, ignores the outer 30% of the part (it fills first), and adds at most 6 per cavity. | Oster (which features) / Planner (how they're detected) | `kind: 'tip'` |
| **V4** | **Pie-wedge vent:** a tiny triangle whose tip just touches the cavity wall (hairline opening). The channel jogs slightly toward the centre, turns sharply, and **zig-zags out to the rim**. Straight channels clog. Keep channels as shallow as possible. | Oster ch. 10 | wedge drawn in the app; path found by A* search to the rim |
| **V5** | If a gate, spoke or neighbour blocks the channel, **needle-drill through to the back** of the mold half and channel to the rim there. | Oster ch. 10 | `v.drilled = true` |

## Fixing a mold that won't fill (`diagnose()`)

| ID | Rule | Source |
|---|---|---|
| **X1** | Fix order: **1. vent, 2. top-gate, 3. enlarge the gate.** Don't add gates. | Oster ch. 9–10 |
| **X2** | Short fill on the **centre side** of the cavity: air trapped where it fills last. Vent the innermost points of the unfilled area. | Oster ch. 10 |
| **X3** | Short fill **surrounded by filled metal**: an air pocket. Use a drilled cavity vent at its innermost point. | Oster ch. 10 (drilled cavity vent) / Planner (diagnosis) |
| **X4** | Short fill only at the **outer end**: the metal stopped early. Look at metal amount, pour or mold temperature, spin speed and gate freezing before venting. | Planner, from F0 |
| **X5** | Gate on a feature **< 85% of max thickness, or narrow**: likely root cause. Suggest a new gate into the thickest section, as a side gate if a straight spoke can't reach it. | Oster (G2) / Planner (the 85%) |
| **X6** | Same flaw in the same spot every spin: **reverse the spin direction** for a few passes. If the flaw moves, the venting is at fault. | Oster ch. 10 |
| **X7** | New alloy or new rubber: venting needs can change. Trial cast before copying an old layout. | Oster ch. 10 |

## Metals (`METALS`)

| Metal | Values from | Notes |
|---|---|---|
| Lead-free Britannia pewter | RotoMetals alloy sheet (92 Sn / 7.75 Sb / 0.25 Cu): solidus 471°F, liquidus 563°F, pour 650–675°F | Long pasty range |
| Zinc spin-cast alloy | Belmont Metals J1 sheet: liquidus 734°F, pour 850–950°F | Short pasty range, needs high-temperature rubber |
| Zamak 3 | Published melting range ≈ 716–734°F. **Pour range is an estimate.** | Freezes fast in spin casting; many casters prefer spin-cast zinc alloys |
| Lead | Melts at 621°F. **Pour range is an estimate.** | Keep lead tooling separate from lead-free pewter |

Oster: pour at least **50°F above liquidus**, and the best pour temperature is the lowest one that gives good castings. Users can edit every value on the Metals tab.

---

## Known gaps (good first contributions)

- **Miniatures / 3D parts** are laid out by their top-view footprint. There's no parting-line planning and no split of cavity depth between the mold halves.
- **Wheel-and-spoke runners** (Oster ch. 9) aren't modelled yet. Every gate gets its own straight spoke.
- **Multi-rank molds** (rings of cavities at different radii) only happen when the fallback packer finds room. There's no deliberate ranked template.
- **Side, back and tangential gates** are only suggested in the Fix tab. The layout always uses direct gates.
- **Machine speed, clamp pressure and rubber compound** aren't inputs. Casting reports that include them would let us tune G5 and V3.
