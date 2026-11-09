# S6. Runway

## Sub-features

Break-even orders per open day, capture rates, monthly cash, startup and recurring costs, and low, base and high runway.

## How to get to it (user POV)

Open **Cash ledger** and edit **Money & demand assumptions**. For one scenario, run a fresh Saturday and select **Compute runway**. A paired comparison produces the two-column receipt. **Refresh cash projection** applies newer inputs.

## Driving it with Playwright

Enter rent and opening cash, run a Saturday and compare the receipt with `compute-runway` or `get-comparison`. Check independent weekday arrivals, weekday staffing, weekend wage hours, recurring costs and upfront equipment. Compare both switch states. Change one wage or rent value and verify cash becomes stale while service stays fresh. Refresh and check the prior receipt, the latest result, and the chart's first month and zero line. Repeat at 1440 px and 390 px. Verify the receipt and old stale state survive a server restart.

## Gotchas

Weekend projections apply the actual sample's loss share to expected daily arrivals. Weekdays use their own demand and loss share. Break-even is the first whole orders per open day with nonnegative monthly cash after posting revenue and ingredients to the nearest paise.
