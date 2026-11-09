# Café Dry Run feature map

Resolve capabilities, transitions, stale dependencies and required rows from [the source statechart](../../../../cafe-dry-run-statechart.html#spec). Review the [design](../../../../DESIGN.md) before visual verification.

| Entry | Founder goal | Current check |
| --- | --- | --- |
| [S1](s1-spot.md) | Pick a Bengaluru spot and inspect its context | Sourced Indiranagar picker; test action, persistence and coverage |
| [S2](s2-demand.md) | Enter demand and inspect provenance | Demand range, hours and provenance implemented; pedestrian path remains |
| [S3](s3-shop.md) | Configure staff, shifts, equipment, menu and money | Staff, shifts, equipment, menu and service inputs implemented; variants and money remain |
| [S4](s4-service.md) | Run and replay a simulated Saturday | Runnable service journey; full acceptance still open |
| [S5](s5-compare.md) | Compare variants and challenge the agent's advice | UI unimplemented |
| [S6](s6-runway.md) | Inspect break-even and cash runway | UI unimplemented |
| [Demo](demo.md) | Complete the six-step founder and agent journey | Full path unimplemented. Pilot covers chat, sync and restart with an authorized provider. |

Read each entry's gotchas. Update selectors and check status as slices land. An unimplemented entry stays unverified.
