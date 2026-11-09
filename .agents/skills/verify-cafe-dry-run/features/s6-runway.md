# S6. Runway

## Sub-features

Break-even orders per day, implied capture, monthly cash, startup and recurring costs, and low, base and high runway.

## How to get to it (user POV)

Open the planned Cash ledger after running a chosen scenario. The ledger is unimplemented.

## Driving it with Playwright

Unimplemented. Verify displayed amounts against the cash action using separate weekday and weekend inputs. Change one recurring and one startup item and inspect the expected months. Toggle saved customers and confirm the service-related revenue changes only when the comparison reduces losses. Verify revision references, weakest-source provenance, and stale behavior after changing a dependency.

## Gotchas

Check an actual weekday and weekend fixture and a month with upfront spending. A simulated Saturday multiplied by 30 would produce the wrong monthly cash.
