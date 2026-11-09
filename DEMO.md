# Cafe Dry Run demo

Generated from cafe-dry-run-statechart.html. Edit the source, then run `node scripts/extract-spec.mjs`.

The agent rehearses these steps in the real app. The human records and publishes the Clips demonstration.

1. Open the app in single-user demo mode or with a seeded demo account. Pick a Bengaluru spot. Nearby places appear with a visible source and gaps stated.
2. Enter rent, cash, opening hours and low, base, high customers per hour. Tags appear on every number.
3. Play the simulated Saturday. Queue grows, customers are lost, the bottleneck is named.
4. Ask the agent: "Should I add a barista or buy another grinder?" Watch it create two variants by editing the same controls you can edit.
5. Challenge it: "Only schedule the second barista from 10 to 12." Edit the shift by hand. The agent re-runs and shows deltas in wait, staff cost and cash.
6. Show the assumption that could reverse the recommendation, then the break-even and monthly cash view. Show the recommendation the model actually produces.
