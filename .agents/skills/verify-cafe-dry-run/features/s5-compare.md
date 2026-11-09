# S5. Compared

## Sub-features

Baseline and variant, equal arrival records, editable shift and equipment, deltas, reversing assumption, and live agent explanation.

## How to get to it (user POV)

Open the planned comparison in Service test after producing fresh runs. The comparison controls and agent comparison actions are unimplemented.

## Driving it with Playwright

Unimplemented. Ask the app agent whether to add a barista or buy another grinder. Check that the two variants preserve the baseline, use identical arrival records, and show the same time on both boards. Verify each displayed delta against action results. Edit the shift by hand, rerun through the agent, and check the updated wait, loss, staff cost and cash deltas. Use **Explain** and the reversing assumption control when available.

## Gotchas

Use fresh results for comparison. Capture the actual model's streamed calls and reply. A design-reference review and matching seed alone cannot prove the recommendation or identical arrivals.
