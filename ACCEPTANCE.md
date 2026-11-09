# Required product acceptance

Use this map when implementing scripts/predicate.sh and the verification skill. Every row below is required unless explicitly labeled optional. Current status is NOT VERIFIED because the application has not been built. Source prose is not runtime proof.

## DoD

Include every `must` item in SPEC.json groups A and B by its original ID: a1 through a10 and b1 through b10. Do not omit rows, change their levels, or turn a blocker into a pass. Report group C separately as human-owned. Group D is optional.

## State and action coverage

Map every state's human and agent capabilities, produced results, doneWhen conditions, and stale rule. Each action needs a real schema, server implementation, UI entry, agent access, and application state where relevant. Domain calculations occur in actions; playback rendering uses their event timeline.

| ID | Required observation | Source |
| --- | --- | --- |
| s1 | Pick and move a pin, select a Bengaluru spot, see sourced nearby places and coverage. Pin movement alone leaves demand unchanged. | S1, setSpot |
| s2 | Edit low/base/high, Saturday curve, opening hours, and optional count/conversion. Exercise required-conversion view and tag each input. Demand changes invalidate S4/S5/S6. | S2, setDemand, setPedestrianCount, tagSource |
| s3 | Edit staff and shifts, equipment, menu mix, prices, ingredients, money, and tagged service times. Create multiple persisted variants. Shop edits invalidate dependent results. | S3, configureShop, tagSource |
| s4 | Replay real server events with play, pause, seek, speed, and seed controls. Repeated runs expose p50/p90, served/lost totals, per-person/machine utilization, and shared-person bottlenecks. | S4, runSimulation |
| s5 | Preserve A, run A/B with identical arrival records, show wait/loss/staff-cost/cash deltas, and edit the named reversing assumption in one click. Every explained number traces to an action result. | S5, compareScenarios, explainResult |
| s6 | Show low/base/high cash duration, break-even and implied capture, monthly cash, separate weekday/weekend demand and startup/recurring costs. Test saved-customers off and on. | S6, computeRunway |
| shared-state | UI and real agent mutate the same SQL records. Observe live sync without refresh, current view/scenarios/timeline in application_state, stale invalidation, and restart persistence. | b1, b2, b5, b6, b10 |
| chat | Real model creates alternatives, explains action results, and navigates context. Tool calls stream visibly. Stop and redirect work during a real run. Explain routes through chat. | b3, b8, b9 |

Same seed alone is insufficient evidence of fair comparison. Check the arrival records themselves. Test resource contention, determinism, cash calculations, and weakest-source propagation. Erlang-C is optional d6, not a required gate.

## Presentation and complete journey

| ID | Required observation | Source |
| --- | --- | --- |
| design-desktop | Inspect all five reference states at 1440 px with the specified palette, type, spacing, board/receipt layout, scenario labels, and real data. | DESIGN.md |
| design-mobile | Inspect the same states at 390 px, including stacked boards, readable fields and results, 44 px targets, focus treatment, and no clipped essential controls. | DESIGN.md |
| design-results | Show input provenance and inherited result tags, scenario/run references, missing and stale results, shared timeline, current-frame versus full-run counts, and labeled cash series/zero line. | DESIGN.md |
| design-motion | Reduced motion removes decoration while play, pause, and seek remain usable. | DESIGN.md |
| demo | Drive all six steps in DEMO.md through the real UI and chat, including the manual 10-to-12 shift edit. Capture actual results and the model's actual recommendation. | HTML demo |
| clean-start | A fresh clone with documented prerequisites launches with one command, initializes empty runtime storage, and can run the demo with a configured real provider. | AGENTS.md |
| framework | Retain scaffold/version evidence and prove real framework actions, chat, database access, and sync. Installing a package alone does not pass. | b4, AGENTS.md |

A single product proof may support multiple rows when its evidence establishes each claim. Store the tested commit, command, inputs, observed result, and artifact path. Fresh independent verification of the final candidate is required after the predicate first passes.
