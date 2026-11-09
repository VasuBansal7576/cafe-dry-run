# Café Dry Run feature map

Resolve capabilities, transitions, stale dependencies and required rows from [the source statechart](../../../../cafe-dry-run-statechart.html#spec). Review [the design](../../../../DESIGN.md) before judging the captures.

| Entry | Founder goal | Automated founder journey |
| --- | --- | --- |
| [S1](s1-spot.md) | Pick a Bengaluru spot and inspect its context | Preset, OSM place IDs and coverage, keyboard pin and unchanged results |
| [S2](s2-demand.md) | Enter demand and inspect provenance | Tagged range and hours, counted footfall, shared source and stale results |
| [S3](s3-shop.md) | Configure the shop and money inputs | Tagged menu and equipment inputs, preserved baseline, manual 10:00 to 12:00 shift |
| [S4](s4-service.md) | Run and replay a Saturday | Repeated seed, shared staff contention, event-based counts and keyboard playback |
| [S5](s5-compare.md) | Compare staffing and equipment changes | Matched arrival records, one playhead, fresh deltas and a reversing assumption |
| [S6](s6-runway.md) | Inspect break-even and runway | Solo and paired receipts, calendar math, cash switch and restart |
| [Demo](demo.md) | Complete the founder and agent journey | Founder portions run in Chromium. The live model portion requires a provider. |

The founder command records scoped observations. Provider-dependent checks and full design judgment each need their own evidence.
