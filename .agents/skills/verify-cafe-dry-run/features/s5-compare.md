# S5. Compared

## Sub-features

Baseline and variant, equal arrival records, editable shift and equipment, deltas, reversing assumption, and live agent explanation.

## How to get to it (user POV)

In **Service test**, open **Create a variant**, add a barista or enter the grinder price and add a grinder. Select **Scenario B**, set the seed and demand case, and use **Compare Saturdays**. Edit B's shift under **Edit B**. A successful save reruns the current pair when a comparison already exists. **Explain** opens live Agent-Native chat.

## Driving it with Playwright

Verify two variants preserve the original and display in the picker. Fetch both receipt run IDs with `get-simulation` and compare the ordered arrays of arrival IDs, timestamps and drink IDs. Scrub the single **Saturday timeline** and check both board counters. Save the second barista from 10:00 to 12:00 and assert fresh wait, loss, staff cost and cash deltas against the comparison action. Flip **Count weekend customers who would have left but now place an order** and check that the saved receipt changes cash and keeps the same service runs. Reopen after restart and check the old shift receipt is still stale.

For live model acceptance, ask whether to add a barista or buy another grinder. Capture actual streamed tools, the recommendation from action results, and the selected pair appearing without manual refresh. A manual variant check can prove the deterministic path. Live acceptance requires a configured model provider.

## Gotchas

A supplies the demand curve and drink mix. Check the actual arrival records and current scenario revisions. A money edit alone leaves service fresh.
