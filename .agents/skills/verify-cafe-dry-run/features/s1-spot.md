# S1. Spot picked

## Sub-features

Map pin and preloaded Bengaluru neighborhood, nearby places, source and coverage, and agent spot selection.

## How to get to it (user POV)

Open `/cafe` and use the Site & demand plate. The map uses a bounded Indiranagar OpenStreetMap snapshot.

## Driving it with Playwright

Run `founder`. Choose **Near Indiranagar Metro** in **Preloaded spots** and save. Match visible nearby place links to the committed OSM snapshot. Once service and runway exist, press ArrowRight then Enter on **Place site pin**. The spot revision changes and demand, the run and the receipt stay fresh. For live coverage, ask the agent to set a named spot and confirm the location changes in the open café tab.

## Gotchas

Test pin targets at all four edges and corners, plus both 1440 and 390 px viewports. The data file alone cannot prove that the UI loads it or explains its coverage.
