# S2. Demand entered

## Sub-features

The current flow supports a tagged low, base and high demand range, Saturday curve and hours. Pedestrian counts and conversion remain unimplemented.

## How to get to it (user POV)

Choose **Continue as local dev**, then open `/cafe`. Choose **Start a scenario**.

## Driving it with Playwright

Run the skill's `pilot` command. The scenario initially reads **Current base demand: 20 customers per hour · Illustrative**. Fill the **Base customers per hour** spinbutton with 28, choose **Save demand**, and wait for the visible value to change. The saved value is tagged **Estimate**, and the same scenario ID moves from revision 0 to 1. Verify the PGlite row while the app is stopped and the same visible value after restart.

Run `live` with an authorized provider in the isolated app. Keep `/cafe` open and submit the demand change through the real `/chat` composer. Observe **list-scenarios** and **set-demand** in the tool stream. The original tab must show 35 without refresh and the same row must reach revision 2. Compare the action readback to the projected database row and verify again after restart.

Enter the low, base and high values and hours. Verify source tags on each value. Exercise the optional pedestrian calculation and the required conversion view when the count is missing. Change demand after a run and verify the dependent results show **Stale**.

## Gotchas

The pilot covers one base-demand edit, not all combinations. It cannot prove complete S2 provenance, conversion or invalidation. The pilot's restart proof uses a fresh verification database and concerns the exact same saved scenario ID.
