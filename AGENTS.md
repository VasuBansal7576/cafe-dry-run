# Cafe Dry Run

Build the complete cafe planning app in the supplied spec and design. A founder picks a spot, sets demand, simulates service, compares staffing or equipment, and inspects cash runway. The founder and the app's agent operate on the same persisted scenarios. Product completeness is the goal. Skip cosmetic code cleanup, PR ceremonies, and comment hygiene.

## Start and resume

The app has not been built. Keep project guidance in this file, the source statechart, and DESIGN.md. Do not create separate planning, acceptance, rules, provenance, or submission documents that repeat these inputs. During an actual build, keep resumable progress in ignored `.pstack/progress.md` and read it when resuming. At the start of every iteration, run `TZ=Asia/Kolkata date`.

Read the installed pstack package's CODEX.md and `skills/poteto-mode/SKILL.md` in full, including Principles, before work. Resolve every pstack skill inside that same package, including TDD, Unslop, and the Prototype playbook. Do not substitute a same-named skill from another collection. Slash names mean read the skill file, not run a shell command. Use `$pstack-codex:poteto-mode` as the entry point. The checked port was 0.15.36-codex.8; record the installed version in local progress and resolve its absolute path when briefing delegates.

For builds, apply Delivery, Figure it out, Autonomous run, and Feature per slice. Read the leaf skill for each principle applied. The first message states the goal, problem, and smallest useful next change. Proceed with authorized reversible work. Advice-only and preparation requests keep their requested scope.

```text
Use $pstack-codex:poteto-mode to build Cafe Dry Run under AGENTS.md.
Read local build progress if present. Continue until scripts/predicate.sh
and independent final verification pass, or the hard stop. Report the handoff.
```

Hard stop for building: **10 November 2026, 10:00 IST**. Reserve time before it for the full demo, a correction, and a retest. Submission deadline: **10 November 2026, 13:29 IST**, equivalent to 9 November 23:59 America/Los_Angeles. The human owns recording and submission.

## Sources and framework

The [official rules](https://www.builder.io/hackathon/rules), checked 9 November 2026, require a functional Agent-Native app, original or meaningful development during the event starting 27 October 2026, disclosure of prior work and third-party materials, and a public Clips demo accessible without login. A public repo or deployment is optional. Scoring gives usefulness/execution 40% and design, innovation, and Agent-Native use 20% each. Official rules control entry requirements; record any changed rule and its source.

1. JSON in `script#spec` in cafe-dry-run-statechart.html controls product behavior, actions, data, and DoD levels. Parse it directly for checks instead of maintaining a generated copy.
2. Read the separate six-step demo in the HTML. The demo is not in the JSON.
3. DESIGN.md controls tokens, type, layout, accessibility, and result states.
4. design-reference/ supplies layout and imagery only. Its numbers and sample review are illustrative. The duplicate hosted reference under sites/ is not an app scaffold.

Log disagreements in local progress. The JSON wins over conflicting behavior prose, including the broad stale-state legend; moving the pin alone does not change demand. Build required behavior missing from the design in its style. Preserve the real map, editable shifts, menu and service times, live chat, provenance, and stale states. Match 1440 px and 390 px without copying illustrative results. Existing reference screenshots and storefront-original.png are available; regenerate missing captures from opening-file.html and use its embedded JPEG only as a fallback.

**Agent-Native is mandatory.** Pstack coordinates development; Agent-Native is the application framework. Actual framework use is a hackathon requirement. A dependency entry or renamed custom app does not prove compliance. The [official quickstart](https://www.agent-native.com/docs/) currently requires Node.js 22.22 or later and pnpm. Its local entry is **Continue as local dev**. Do not assume this Codex chat supplies the app's provider or create provider accounts.

- Create `cafe-app/` with the official CLI: `npx --yes @agent-native/core@latest create cafe-app --standalone --template chat`. Recheck the installed CLI if flags change. Preserve the root inputs.
- Keep the scaffold's AGENTS.md and framework instructions. Append a reference to this root file and the cafe domain rules. Keep scaffold chat, action discovery, sync, and database integration.
- Implement capabilities with the real `defineAction` API. UI controls and the app's agent invoke the same actions. Learn APIs from the scaffold's version-matched docs, examples, skills, and source. Use its docs-search action when available. Record the resolved core version and commit the lockfile.
- Follow the [database guide](https://www.agent-native.com/docs/server-database/). Use PostgreSQL through Drizzle. The documented local option is PGlite. Prove startup from an empty runtime data directory and persistence across restart. Do not substitute SQLite. A later authorized deployment needs persistent PostgreSQL, not local PGlite.
- Framework proof includes the scaffold command log, dependency and lockfile, real imports, and a live shared-action journey. Show UI and agent mutations reaching the same database record, with UI updates without manual refresh. Attach the evidence to b1, b2, b4, b8, and b10 as appropriate.

## Completion and evidence

Create `scripts/predicate.sh` during build framing. It prints a verdict for every MUST row a1 through a10 and b1 through b10, every state's capabilities and doneWhen conditions, actions, transitions, stale rules, the six-step demo, and DESIGN.md requirements. Include real framework integration, chat, sync, restart persistence, and clean-clone startup. Exit zero only when **all required checks are VERIFIED** against the current candidate. NOT VERIFIED, INCONCLUSIVE, missing evidence, and stale evidence keep it nonzero. Group C is human-owned and reported separately. Group D stays optional.

Main must boot from a clean clone with one documented command and an empty runtime data directory after documented prerequisites and a real provider connection. Before the first app slice, main may hold only the clearly labeled specification package. After the first verified app slice, keep main runnable.

- During the build, `.pstack/progress.md` records the slice, next action, last verified commit, commands, source disagreements, and external blockers with affected IDs and attempted remedies. Fix agent-solvable problems. Missing implementation is NOT VERIFIED, not an external blocker.
- Keep the append-only Show me your work trail in `.pstack/decisions.tsv`. Keep this bookkeeping ignored, not in root documents.
- Runtime evidence belongs in ignored `.artifacts/`. Index requirement ID, tested commit, command or journey, inputs, observed result, and artifact path there. Capture screenshots, traces, and database side effects without secrets. Cleanup preserves evidence. The predicate never reads cached pass values from progress notes.

Automated checks rerun on every predicate invocation. Judgment checks need evidence tied to the candidate and relevant inputs. Changes invalidate affected evidence. Demonstrate each new check failing on a deliberate broken variant in an isolated scratch copy before trusting its pass. Never weaken a journey or change the reference to pass.

Inspect all five reference states at both design widths, provenance and stale results, accessible controls, reduced motion, and synchronized playback. Drive all six demo steps, including the manual 10-to-12 shift edit. Compare arrival records, not just seeds. Test resource contention, determinism, cash calculations, and weakest-source propagation.

## Build workflow

0. **Preflight.** Check time, network, Node.js and pnpm requirements, and secret exclusions. Check real app-provider availability without printing credentials. Supported provider connections can replace an environment key; a missing .env alone does not prove no provider exists. Bootstrap and deterministic work can proceed without a model, but live agent acceptance cannot pass. Install browser tooling and prove headless Chromium launches before UI verification. Use `--no-sandbox` only for the specific sandbox launch error.
1. **Read and frame.** Reuse the existing Git repo. Read the source JSON and separate demo directly from the HTML. Map those requirements and DESIGN.md to executable and live checks. Make missing implementation fail the predicate honestly.
2. **Frame and isolate.** Use Figure it out with the predicate and full scope. Name the scenario lifecycle, result revisions, and stale dependencies before logic. Work on `build/cafe-dry-run`; fast-forward verified slices into main. Use worktrees for concurrent writers or independent verification.
3. **Scaffold and probe risks.** Use the required framework recipe. Prove startup and local demo access. Implement one minimal cafe scenario action, visible control, and persisted value. Drive it through UI and real agent chat, observe sync, restart, and confirm persistence. Fetch one genuine Bengaluru map export with source IDs and attribution. Try bounded alternatives if fetching fails, then show the coverage gap and record a1 INCONCLUSIVE without passing it. These probes precede the large simulator and comparison build.
4. **Generate verification after a real path exists.** Use Create verification skill to write `.agents/skills/verify-cafe-dry-run/`. Map S1 through S6, chat, persistence, design states, and demo. Drive existing paths with real selectors; mark future entries unimplemented. Prove launch, doctor, the scenario mutation from step 3, capture, and cleanup. Confirm evidence survives. Repair failures before using the skill and update its map with each slice.
5. **Build vertical slices.** Each connects UI, actions, store, application state, and visible results. Use Feature. Skip how or architect with a logged reason when settled. Preserve the full product while reducing each work unit.
   - A: Real preloaded spot, tagged demand, default shop, minimal real simulation and cash calculation, and visible runway in the design shell. Use TDD for both engines from their first implementation. Extend the early chat action to scenario fields.
   - B: Shared-resource scheduling, shifts, equipment, menu tasks, patience, repeated seeded runs, utilization, named bottlenecks, synchronized Service test playback, and complete cash inputs.
   - C: Variants on identical arrivals, preserved A, deltas in wait, loss, staff cost and cash, saved-customers switch, editable reversing assumption, and real model explanation grounded in action results.
   - D: Complete the barista-versus-grinder chat journey, manual shift challenge, tool stream, stop and redirect, and application_state navigation through the existing shared actions.
   - E: Complete map interaction, nearby places, attribution, coverage gaps, provenance propagation, and stale behavior. Initial real data and input tags already exist from earlier steps.
   - F: Close remaining source requirements, inspect both design widths, and run the six-step demo. Optional MCP demonstration, extra neighborhoods, share links, Zomato context, and Erlang-C validation follow required acceptance only if time remains.
6. **Prove each slice.** Run doctor, affected journeys, established regressions, and scoped package checks against the candidate commit. Inspect evidence yourself. One unrelated journey is insufficient. Record the SHA, update local progress, and fast-forward main. For docs-only changes after verification, record the unchanged app tree and rerun structural checks rather than claiming new behavior was tested.
7. **Independent final gate.** Once the predicate passes, use a fresh verifier that did not build the app. Supply the source HTML, DESIGN.md, repo, and real app. It re-derives required proofs and runs the full demo at the candidate SHA. Use Swarm by feature-map entry with at most two workers, each with its own instance. Fix failures and reverify. A blocker never counts as a pass.
8. **Handoff.** Fast-forward the verified candidate. Report setup, one-command launch, demo, local evidence locations, all failed or unverified rows, and factual submission disclosures in the handoff response. At the hard stop, preserve the latest working candidate and label incomplete acceptance. No PR or extra planning documents.

For local startup after Node.js 22.22+ and pnpm are installed, run `cd cafe-app && pnpm install --frozen-lockfile && pnpm exec agent-native dev`. Typecheck: `pnpm -C cafe-app typecheck`. Simulator, cash, determinism, runway, provenance, and action regressions: `pnpm -C cafe-app exec vitest run server/lib/cafe`. Structure and scoped runtime mock-marker checks require ripgrep (`rg`): `scripts/check-structure` and `scripts/check-no-mock`. Framework doctor: `pnpm -C cafe-app agent-native:doctor`. Launch and pilot verification: `.agents/skills/verify-cafe-dry-run/scripts/verify.mjs doctor "$PWD" 8189` or `pilot "$PWD" 8189`, with the Playwright and Chromium prerequisites in its skill. These are project checks, not additional hackathon rules. Live chat requires a supported provider connection. DoD b7 covers the domain instructions below.

## Autonomous execution and delegation

Keep working within the active run while authorized useful work remains. Compaction is not a new task. Checkpoints support later resumption; **no external restart driver is assumed**. If explicitly configured, record and test a runner's actual resume mechanism before claiming unattended continuation. Do not create a recurring automation merely to watch this build.

Each iteration makes the smallest evidence-backed change, verifies, updates state, and commits useful progress. Preserve earlier work when discarding a rejected experiment. A plateau requires a new approach, not a weaker predicate. Fix tooling and skill failures in a separate bounded change, then return to the product. On rate or usage limits, preserve verified work and the exact next action. At a dead end or the hard stop, write an honest handoff and stop.

Delegate wherever the selected playbook calls for it, with at most two concurrently active subagents across the entire task tree. Fresh sequential delegates are allowed. Use Codex collaboration and inherit the parent model unless a supported override is explicitly configured. Helper and implementation briefs include absolute paths to package CODEX.md, `agents/poteto-agent.md`, and the poteto-mode skill. If the role is not registered, use a general agent starting with: "Read the poteto-mode skill's SKILL.md in full, including its Principles section, before any work." Routed specialist roles keep their prescribed briefs. Independent verification uses fresh context.

Each writer owns a branch and worktree. Read-only reviewers inspect a fixed commit without writing to another checkout. Each running instance owns a database directory and port; verify process ownership. Regenerate conflicting lockfiles. Resolve conflicts from evidence or report the exact unresolved choice. Never force-push main.

Skip and log `skip: not a goal, product completeness only` for Interrogate, Blast radius, No comments, Technical writing, code/comment Unslop, deslop, Opening a PR, Babysit, and Shipping. Keep Unslop for UI copy and human-facing docs. Product checks and the independent final gate remain required.

## Domain rules for the app's agent

- The language model calls actions for calculations and explains their results. Deterministic server code computes simulation and cash figures.
- Tag inputs observed, public, estimate, or illustrative. Define the weakest-tag order once and test propagation to derived results.
- A public default needs a source URL, retrieval date, and supporting value. Reuse verified source records across sessions; re-fetch when changing a default or checking freshness. Otherwise use illustrative.
- Places come only from real OpenStreetMap or Overture exports with source IDs, licence, snapshot date, and attribution. Show missing coverage. The map never predicts sales or footfall.
- Zomato is optional, only from an already supplied licensed file in data/. Do not download it for this build.
- Compare on the same seed and arrival records. Preserve the baseline when creating a variant.
- Separate weekday, weekend, startup, and recurring inputs. Never multiply one simulated Saturday by 30.
- Faster service increases revenue only under the explicit saved-customers assumption. Name the reversing assumption and make it editable in one click.
- All AI runs through real agent chat. Explain sends a prompt there. UI controls may call deterministic actions. Use framework action transport, not custom `/api` wrappers.
- Show actual action results and the model's actual recommendation. The reference sample review is not chat. Do not tune defaults to favor a purchase.
- Persist scenarios, runs, and stale flags. Moving the pin alone does not change demand. Input changes invalidate dependencies as specified.

## Publication and human-only work

The user authorized the public [GitHub repo](https://github.com/VasuBansal7576/cafe-dry-run) and this cleanup/update. Later pushes follow the current task's authorization. Exclude credentials, runtime databases, private hosting metadata, and verification artifacts from Git.

The supplied statechart, design, reference, and images predate repository preparation on 9 November 2026; their earlier creation dates are unverified. The fictional storefront image's creator and usage rights are unconfirmed. Never present it as a photograph of the selected real site. Disclose supplied design work, actual framework/dependencies/data and licences, and meaningful work completed during the event. Retain dependency licence notices.

This does not authorize deployment, recording or publishing Clips, form submission, rules or consent agreement, or contacting anyone. Group C stays with the human. The human confirms team details, age and eligibility, asset permissions, build dates, and description; records the real app in [Clips](https://www.agent-native.com/apps/clips/); checks access without login; uses the [submission form](https://www.builder.io/hackathon/submit); and confirms receipt. Never put identity, tax, or payment documents in the repo, demo, or form.

Pause before an unauthorized deploy, destructive deletion, shared-branch force-push, or external message. Use already granted authority for reversible work and the requested public repository creation.
