# S1. Spot picked

## Sub-features

Map pin and preloaded Bengaluru neighborhood, nearby places, source and coverage, and agent spot selection.

## How to get to it (user POV)

The planned Site & demand document opens from the opening file. The current build has no site picker.

## Driving it with Playwright

Unimplemented. Once wired, pick a preloaded spot, then drop or drag the pin. Capture the rendered coordinates, place records, source attribution, and coverage gap. Match displayed places to their source IDs. Verify that moving the pin leaves an existing demand and result unchanged. Ask the agent to set a named spot and confirm the same visible location changes.

## Gotchas

The checked-in Indiranagar extract can support a map proof. The data file alone cannot prove that the UI loads it or explains its coverage.
