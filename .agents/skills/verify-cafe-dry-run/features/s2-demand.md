# S2. Demand entered

## Sub-features

Tagged low, base and high demand, the Saturday curve and hours, and optional pedestrian count and conversion.

## How to get to it (user POV)

Choose **Continue as local dev**, then open `/cafe`. Choose **Start a scenario**.

## Driving it with Playwright

Run the skill's `pilot` command. The scenario initially reads **Current base demand: 20 customers per hour · Illustrative**. Fill the **Base customers per hour** spinbutton with 28, choose **Save demand**, and wait for the visible value to change. The saved value is tagged **Estimate**, and the same scenario ID moves from revision 0 to 1. Verify the PGlite row while the app is stopped and the same visible value after restart.

Run `live` with an authorized provider in the isolated app. Keep `/cafe` open and submit the demand change through the real `/chat` composer. Observe **list-scenarios** and **set-demand** in the tool stream. The original tab must show 35 without refresh and the same row must reach revision 2. Compare the action readback to the projected database row and verify again after restart.

Run `founder` to edit the range, both Saturday times and a curve multiplier. Check saved tags and the curve’s effect on the weekend projection. Call `set-pedestrian-count` without a count before a solo runway, with a current solo and paired receipt, and after invalidation. Check the linked receipt and the conditional rates. From a second tab, use the same action to save 600 observed pedestrians and a 10% estimated conversion on the shared arrival source. The already-open tab shows 60 estimated Saturday arrivals and stale results. Edit the conversion in the founder form and check the update in the other tab.

## Gotchas

The pilot covers one base-demand edit, not all combinations. It cannot prove complete S2 provenance, conversion or invalidation. The pilot's restart proof uses a fresh verification database and concerns the exact same saved scenario ID.
