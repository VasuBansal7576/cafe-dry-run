# Integrated founder and agent demo

## Sub-features

Six-step user journey, live agent tools and synchronization, database persistence, and responsive design review.

## How to get to it (user POV)

Start in a single-user local session and follow the separate demo list in the statechart HTML. For the pilot, open `/cafe` and `/chat` in the same browser context.

## Driving it with Playwright

1. Pick a Bengaluru spot and show the nearby sources and coverage gap. [S1](s1-spot.md) is unimplemented.
2. Enter rent, cash, hours and low, base and high demand with tags. [S2](s2-demand.md) has a single base input pilot. The remaining input path is unimplemented.
3. Play the Saturday and show the queue, losses, and bottleneck. [S4](s4-service.md) is unimplemented.
4. Ask whether to add a barista or buy another grinder. Observe the real tools create variants through the founder's actions. [S5](s5-compare.md) is unimplemented.
5. Challenge the agent to schedule the second barista from 10 to 12. Edit the shift by hand, have the agent rerun, and inspect wait, staff cost and cash deltas. [S3](s3-shop.md) and S5 are unimplemented.
6. Show the reversing assumption, break-even and monthly cash. Capture the actual model recommendation. [S6](s6-runway.md) is unimplemented.

For a later design pass, capture the opening file, site and demand, service test, co-pilot review and cash ledger at 1440 px and 390 px. Compare them to `DESIGN.md`. Check provenance, stale and missing states, focus, touch targets, reduced motion, and synchronized playback. Those design checks remain unverified.

## Gotchas

The [demand pilot](s2-demand.md) is a separate workflow. Its successful readback does not advance any full demo step. Run real chat with an authorized provider and a scratch account connection. Use only the app-owned browser context for evidence. Keep OAuth screens and raw auth or chat responses out of the evidence set.
