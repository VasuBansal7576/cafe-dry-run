# S4. Simulated

## Sub-features

Repeatable Saturday simulation, event timeline, waits, service and loss counts, resource utilization, and named bottlenecks.

## How to get to it (user POV)

Open the planned Service test after configuring a shop. Simulation and playback controls are unimplemented.

## Driving it with Playwright

Unimplemented. Run the same scenario twice with the same seed. Compare the full returned timeline and result, then play, pause, and seek. At one chosen timestamp corroborate board counts against event records. Force staff and equipment contention separately and check that the correct resource appears in the bottleneck explanation. Exercise keyboard controls and reduced motion. Edit an input after the run and observe **Stale** until rerun.

## Gotchas

Keep counts at the playhead separate from totals. A static result or same seed alone gives no playback or determinism proof.
