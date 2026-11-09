# S3. Shop configured

## Sub-features

Staff, shifts, group heads, grinders, steam wands, menu mix, service times, prices, ingredients, rent, wages and opening cash.

## How to get to it (user POV)

Open `/cafe` and use **Staff & equipment**. Open **Money & demand assumptions** in Cash ledger for rent, cash and wages. Use **Create a variant** in Service test for an extra barista or grinder.

## Driving it with Playwright

Run `founder` to save tagged equipment, a menu price and a service time. Compare the new barista against the original, then manually save 10:00 to 12:00 in **Edit B · Two baristas**. Confirm the stale historical receipt, fresh deltas and unchanged original shop. For live coverage, exercise the equivalent agent action and confirm the form updates.

## Gotchas

Use the actual shift controls for the demo challenge. Agent-only edits cannot establish that the founder can make the same change.
