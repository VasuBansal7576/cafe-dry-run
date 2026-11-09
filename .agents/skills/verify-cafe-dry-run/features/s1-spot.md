# S1. Spot picked

## Sub-features

Map pin and preloaded Bengaluru neighborhood, nearby places, source and coverage, and agent spot selection.

## How to get to it (user POV)

Open `/cafe` and use the Site & demand plate. The map uses a bounded Indiranagar OpenStreetMap snapshot.

## Driving it with Playwright

Pick a preloaded spot, then drop or drag the pin. Capture the rendered coordinates, place records, source attribution, and coverage gap. Match displayed places to their source IDs. Verify that moving the pin leaves an existing demand and result unchanged. Ask the agent to set a named spot and confirm the same visible location changes.

## Gotchas

Test pin targets at all four edges and corners, plus both 1440 and 390 px viewports. The data file alone cannot prove that the UI loads it or explains its coverage.
