# Spin Mold Planner

**Plan spin-casting molds: where to put each part, where to gate it, and where to vent it. Plus a helper for fixing molds that won't fill.**

For centrifugal rubber mold casting (CRMC) of pewter, zinc, Zamak and lead. It runs entirely in your web browser: no account, no AI, no install, and your files never leave your computer.

**▶ Use it online:** https://aschmharhee.github.io/spin-mold-planner/
**⬇ Use it offline:** download [`spin-mold-planner.html`](https://aschmharhee.github.io/spin-mold-planner/spin-mold-planner.html) and double-click it.

---

## What it does

### Plan a mold
Drop in STL files of your parts and say how many of each. You get:

- **A balanced layout** on a 7", 9", 10" or 12" mold. Matching parts sit opposite each other, and heavy parts go closest to the centre.
- **A gate for every cavity**, into the thickest section, never through a thin bail or tip, with a starting slot size.
- **Vents**: gate vents, main vents, and vents on points that trap air, each with a zig-zag channel to the rim, or marked for drilling through to the back.
- **Explanations.** Click any cavity to see *why* it was turned, placed, gated and vented the way it was.
- Weights, a suggested pour, a balance check, a cut list, and an image you can save and share.

You can drag and rotate cavities by hand; gates and vents update to match. Zoom in to inspect any of it.

### Fix a mold
Got a cavity that keeps short-filling? Pick the part, turn it to match how it sits in your mold, click where the gate is, and paint the area that didn't fill. A photo of your mold can sit underneath as a tracing guide. You get:

- The likely cause (air trapped where it fills last, a gate feeding through a thin feature, an air pocket, metal stopping early…).
- Where to cut vents, then the fix order: **vent → top-gate → enlarge the gate**, and a better gate spot if the gate itself is the problem.
- How to place the part next time.

### Metals
Pewter (lead-free Britannia), zinc spin-cast alloy, Zamak 3 and lead, all editable to match your supplier's sheet.

## How it decides

Every rule is written out in plain language in **[docs/RULES.md](docs/RULES.md)**, with where it comes from. Most come from Oster Pewter's *[Principles of Centrifugal Rubber Mold Casting](https://osterpewter.com/pewter-rubber-mold-casting)*. The rest are this project's own starting numbers, clearly marked so they can be improved. The core idea:

> Spinning throws metal to the outer end of each cavity first, so the cavity fills from the outside in, and the side nearest the centre fills last. That's where air gets trapped, so that's where the vents go.

The suggested gate sizes are **starting points**. The planner can't know your machine speed, clamp pressure, mold temperature or rubber. Cut small, trial cast, and enlarge.

## Help make it better

This started as one caster's tool and is meant to grow with the community. You don't need to code to help:

- **[Post a casting report](https://github.com/AschMhaRhee/spin-mold-planner/issues/new?template=casting-report.yml).** Lay out a mold with the planner, cast it, and tell us what happened, with photos. Reports where it *failed* are the most useful.
- **[Suggest a rule change](https://github.com/AschMhaRhee/spin-mold-planner/issues/new?template=rule-suggestion.yml)** if your experience says a rule is wrong or missing.
- **[Report a bug](https://github.com/AschMhaRhee/spin-mold-planner/issues/new?template=bug-report.yml)** if something in the app is broken or confusing.

If you do code, see **[CONTRIBUTING.md](CONTRIBUTING.md)** and **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Running it yourself

You need [Node.js](https://nodejs.org) 18 or newer. There are no other dependencies.

```bash
npm test        # run the engine tests
npm run build   # writes dist/index.html (open it in a browser)
```

Every push to `main` is tested and published to GitHub Pages automatically.

## Safety

Molten metal is dangerous. Lead and its fumes and dust are toxic. Keep lead tools, pots and molds separate from lead-free pewter, especially for jewelry. Check that your rubber is rated for the metal's temperature, since zinc alloys need high-temperature rubber. This tool gives layout suggestions, not safety advice.

## License

[MIT](LICENSE). Free to use, change and share, including commercially. Please only share designs (STLs, photos) you have the right to share.
