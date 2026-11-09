# Current state

Preparation task, 9 November 2026. The user requested corrected build instructions, a public GitHub repository, an official-rules check, and an idea assessment. This task does not implement the app.

- Current slice: repository preparation and framework requirements.
- Original supplied spec: commit `878d82c`.
- Last verified app commit: none. No scaffold, app provider, database, simulator, or live acceptance exists yet.
- Pstack package checked: 0.15.36-codex.8. Resolve its installed root when starting the build.
- Required framework: Agent-Native. Use the official standalone Chat scaffold in cafe-app/. Local PostgreSQL through PGlite is the documented starting point.
- Next build action: preflight under AGENTS.md, build the honest acceptance predicate, scaffold, and prove one real shared scenario action through UI, database, live agent, sync, and restart.
- Cross-session restart driver: not configured or claimed.
- App commands: unresolved until scaffold. TYPECHECK_CMD, TEST_CMD, structure/no-mock checks, launch, doctor, and driven journeys remain to be implemented and verified.
- Available preparation command: `node scripts/extract-spec.mjs` generates SPEC.json and DEMO.md.

## Resolved disagreements

- INCONCLUSIVE no longer permits the completion predicate to exit zero.
- A runnable persisted user path precedes generation of the app verification skill.
- The six-step demo is extracted separately because it is outside the JSON.
- Official framework docs resolve the database question to PostgreSQL with local PGlite. Live persistence is still unverified.
- MCP demonstration and Erlang-C remain optional per group D.
- The new public-repository request overrides the previous prohibition on publishing a repo link for this preparation task. Deployment and submission remain human-gated.
- Source JSON still controls behavior when the statechart's general prose differs. For example, moving the pin alone does not invalidate demand, despite the broad diagram legend saying any edit makes results stale.

## Build acceptance

All product rows are NOT VERIFIED. See ACCEPTANCE.md. Preparation checks in PROOF.md do not imply application acceptance.
