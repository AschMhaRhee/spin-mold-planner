# Contributing

Thanks for helping! This project lives or dies on real casting experience, so **non-code contributions matter as much as code**.

## Without writing code

- **Casting reports** ([form](https://github.com/AschMhaRhee/spin-mold-planner/issues/new?template=casting-report.yml)): cast a mold laid out with the planner and report back. Include photos of the mold and of castings straight out of it, your metal, and whatever machine settings you know. Failures are the most valuable reports.
- **Rule suggestions** ([form](https://github.com/AschMhaRhee/spin-mold-planner/issues/new?template=rule-suggestion.yml)): if a rule in [docs/RULES.md](docs/RULES.md) doesn't match what you see at the caster, say so and say why.
- **Metal data:** supplier sheets with solidus, liquidus and pour temperatures for alloys people actually spin cast.
- **Translations and wording:** if an explanation in the app is confusing, open an issue with better wording.

Only share designs and photos you have the right to share.

## With code

1. Fork the repo and make a branch.
2. Make your change. The logic is all in `src/engine.js` and the screens are in `src/app.html`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
3. Run `npm test` and `npm run build`, then open `dist/index.html` in a browser and check it.
4. If you changed a rule, update **docs/RULES.md** and the matching text in `explain()`.
5. Open a pull request saying what changed and why, ideally linking a casting report or reference.

### Ground rules

- **No dependencies and no server.** It has to keep working as one offline HTML file.
- **No AI or network calls.** Everything runs locally so anyone can use it for free.
- **Explain decisions.** Every placement, gate and vent the planner makes must have a reason it can show the user.
- **Mark guesses as guesses.** If a number isn't from an established source or tested castings, label it "Planner" in RULES.md.
- Keep changes small and focused, and add a test for new behaviour.

## Be kind

Casters of every experience level are welcome here. Be patient with questions, be specific with criticism, and assume good intent.
