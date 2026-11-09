# S3. Shop configured

## Sub-features

Staff, shifts, group heads, grinders, steam wands, menu mix, service times, prices, ingredients, rent, wages and opening cash.

## How to get to it (user POV)

The planned flow starts with a saved spot and entered demand. Shop controls are unimplemented.

## Driving it with Playwright

Unimplemented. Fill and save shop inputs, then reopen them to verify the same values and provenance. Add a second barista and manually edit the shift from 10 to 12. Verify the selected scenario becomes stale and the baseline retains its original shifts when editing a variant. Exercise the equivalent agent action and confirm the form updates.

## Gotchas

Use the actual shift controls for the demo challenge. Agent-only edits cannot establish that the founder can make the same change.
