# Cafe Dry Run · Open on paper

Test a cafe before signing the lease. Set a demand range, inspect a simulated Saturday, compare staffing or equipment, and see how the assumptions affect cash runway.

**Status: specification and design package. The Agent-Native application is not implemented yet.** The interactive reference uses illustrative data and a sample review. It is not the hackathon demo or evidence that app requirements pass.

## Project files

- [AGENTS.md](AGENTS.md) defines the autonomous build workflow and mandatory framework integration.
- [HACKATHON.md](HACKATHON.md) records checked official sources and the idea assessment.
- [Statechart](cafe-dry-run-statechart.html) is the source specification.
- [SPEC.json](SPEC.json) and [DEMO.md](DEMO.md) are extracted from the statechart.
- [ACCEPTANCE.md](ACCEPTANCE.md) maps the full product to required verification.
- [DESIGN.md](DESIGN.md) and [design-reference/](design-reference/) define the visual design.
- [STATE.md](STATE.md) records the next build action. [PROOF.md](PROOF.md) distinguishes preparation checks from app acceptance.
- [THIRD_PARTY.md](THIRD_PARTY.md) and [SUBMISSION_NOTES.md](SUBMISSION_NOTES.md) track disclosures for the human.

## Inspect the reference

Open `design-reference/opening-file.html` in a browser. It works offline. Open `cafe-dry-run-statechart.html` to inspect the behavior and checklist.

With Node.js installed, regenerate the machine-readable spec and demo:

```sh
node scripts/extract-spec.mjs
```

## Build the app

Follow AGENTS.md. The app must use the [Agent-Native framework](https://www.agent-native.com/docs/) and its real shared actions, agent chat, sync, and database integration. Pstack is the development workflow.

The app's clean-clone launch command will be added after it has been scaffolded and verified from an empty runtime data directory. No deployment or functional demo is claimed by this repository.
