# S6. Runway

## Sub-features

Break-even orders per open day, capture rates, monthly cash, startup and recurring costs, and low, base and high runway.

## How to get to it (user POV)

Open **Cash ledger** and edit **Money & demand assumptions**. For one scenario, run a fresh Saturday and select **Compute runway**. A paired comparison produces the two-column receipt. **Refresh cash projection** applies newer inputs.

## Driving it with Playwright

Run `founder` to enter rent and cash, check solo conversion and reconcile the paired receipt with `get-comparison`. The fixture uses 23 weekdays, five weekend days and separate demand and staff hours. Check both saved-customer switch states against the same service runs and the change in the higher-monthly-cash option. Inspect the exact monthly balance table and chart in the captures. Verify that the current receipt and old stale state survive a server restart. For an additional cash-only check, edit rent and verify **Stale cash receipt** while the service runs stay fresh.

## Gotchas

Weekend projections apply the actual sample's loss share to expected daily arrivals. Weekdays use their own demand and loss share. Break-even is the first whole orders per open day with nonnegative monthly cash after posting revenue and ingredients to the nearest paise.
