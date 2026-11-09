# S4. Simulated

## Sub-features

Repeatable Saturday simulation, event timeline, waits, service and loss counts, resource utilization, and named bottlenecks.

## How to get to it (user POV)

Open **Service test** after configuring demand and shop. The app can run and replay one saved scenario.

## Driving it with Playwright

Run `founder` to repeat the same seed and compare the full stored timeline and result. Use Enter to play and pause and Home, ArrowRight and End on **Saturday timeline**. Check all board counts against the saved events at a time with a queue, active service and lost customers. The fixture uses one barista across several tasks and requires staff to be the named bottleneck. Run a separate equipment contention case to check the machine bottleneck.

## Gotchas

Keep counts at the playhead separate from totals. A static result or same seed alone gives no playback or determinism proof.

To verify agent seeking, open a fresh result on Service test and call `view-screen`, then `set-playback-position` with the returned run identity and the founder’s clock time. The same action publishes founder slider changes. Check the live slider, the current tab’s saved position, and an untouched second tab. A stale result stays playable as history in the UI and is unavailable to this agent action.
