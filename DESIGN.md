# Open on paper

Design system for Café Dry Run. The opening file follows a first-time founder through a site survey, a simulated Saturday, and a cash ledger. Each document answers a question the founder faces before signing the lease.

The first screen pairs **Open on paper.** with **Test your café before you sign the lease.** The numbered rail keeps the whole test visible as the founder moves between documents. The [Café Dry Run statechart](cafe-dry-run-statechart.html#spec) defines the app's behavior and action contracts.

## Visual references

Open the [interactive preview](design-reference/opening-file.html) locally to inspect the original layout and try the controls. It runs offline with illustrative data. The [original storefront PNG](design-reference/storefront-original.png) is the uncropped fictional storefront used on the cover and site plate.

| Screen or state | Reference capture |
| --- | --- |
| Opening file | [Desktop](design-reference/screenshots/01-opening-file.png) · [Mobile](design-reference/screenshots/07-mobile-opening-file.png) |
| Site and demand | [Storefront photo](design-reference/screenshots/02-site-and-demand.png) · [Site sketch](design-reference/screenshots/03-site-sketch.png) |
| Service test at 08:25 | [Desktop](design-reference/screenshots/04-service-test.png) · [Mobile](design-reference/screenshots/08-mobile-service-test.png) |
| Service test with the sample review open | [Co-pilot review](design-reference/screenshots/05-copilot-review.png) |
| Cash ledger | [Opening assumptions and receipt](design-reference/screenshots/06-cash-ledger.png) |

Desktop captures use a 1440 px CSS viewport. Mobile captures use 390 px. All PNGs are at 2× resolution. For UI review, capture the matching viewport and state. Compare the type scale, spacing, document treatment, and emphasis. Use the interactive preview for replay and layout changes. Use the statechart for production behavior and model results.

## Color

| Token | Value | Use |
| --- | --- | --- |
| `workspace` | `#20201e` | Page background |
| `board` | `#272624` | Forms and service boards |
| `panel` | `#302e2b` | Secondary panels and ticket beds |
| `field` | `#393530` | Input wells |
| `ink` | `#f7f0e3` | Primary text on graphite |
| `muted-ink` | `#cbc2b4` | Secondary text on graphite |
| `rule` | `#59534c` | Decorative dividers and borders on graphite |
| `paper` | `#eee2cc` | Photograph mats and printed slips |
| `paper-shade` | `#e1d0b2` | Secondary paper tone |
| `print` | `#29241d` | Text on paper |
| `receipt` | `#fff3d9` | Cash ledger and cover slip |
| `folder` | `#584133` | Cover folder behind the photograph |
| `signal` | `#ff713b` | Primary action, active tab, focus on graphite, and the service bottleneck marker |
| `signal-on-paper` | `#a43615` | Accent text and focus on paper |
| `signal-ink` | `#231b15` | Text on orange buttons |
| `bottleneck-ticket` | `#ffc6a1` | Ticket at the active bottleneck |

Graphite is the workspace. Warm paper marks the documents. Orange identifies the next action or the current point of pressure. The service board names the bottleneck in text and uses peach for its ticket. Neutral tickets stay quiet. Use the graphite `ink` or `muted-ink` tokens for small text and `print` or `signal-on-paper` on paper. Green is outside this palette.

## Type and layout

| Role | Typeface | Treatment |
| --- | --- | --- |
| Cover title | `"Iowan Old Style", Baskerville, Georgia, serif` | 62 to 145 px, medium weight, tight tracking. Italic orange for *on paper.* |
| Section title | Same serif stack | 37 to 78 px, medium weight, tight tracking |
| Body and controls | `system-ui, sans-serif` | Body starts at 14 px with 1.45 line height. Controls use 12 to 13 px. |
| Figures and metadata | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | Tabular figures with visible units. Quiet metadata uses uppercase and `.105em` tracking. Keep essential labels and statuses at 11 px or larger. |

The masthead pairs a compact **DRY RUN** wordmark with a 19 px orange disc cut by a horizontal notch. The navigation starts below it. The content spans up to 1480 px with inline gutters of `clamp(14px, 3.25vw, 50px)`. The opening title sits beside the cover documents. The other screens use flat, square-edged boards, thin rules, and aligned data columns.

Stack the cover, survey, and ledger by 645 px. Stack the two service boards by 555 px and keep both on the same timeline. Keep scenario labels visible on each board. Use 44 px touch targets and a 2 px focus outline with a 4 px offset. Reserve shadows for paper and the cover clip. Tilt the cover folder about −4°, the photo about 2.5°, and the slip about −5°. Keep working forms, tickets, and tables level.

## The opening file

| Tab | Founder question | Main element |
| --- | --- | --- |
| 00 Opening file | What can I test before I sign? | Cover with a clipped storefront photograph and a note about the matched Saturday test |
| 01 Site & demand | Where is the shop, and how many people might come in? | Site plate beside editable demand assumptions |
| 02 Service test | What happens if I add a second barista? | Two ticket boards with a shared Saturday clock |
| 03 Cash ledger | What has to be true for this café to work? | Break-even receipt beside a monthly cash chart |

### Opening file

The photograph depicts a plausible storefront at street level. Favor natural light and familiar lease-spot details such as glass, a threshold, and neighboring shopfronts. Caption fictional imagery **Illustrative photograph**. The note pinned to the cover reads **One site. Two Saturdays.** with **Same arrivals · One change at a time** below it.

### Site and demand

Keep the site plate and demand form separate. The plate shows the location, source, and coverage if known. A schematic carries an **Illustrative** label. Nearby places describe the area. The founder enters low, base, and high customers per hour, or supplies a pedestrian count and conversion rate. Show the input's provenance beside each value. A pin move affects the site plate. Applying a demand edit makes dependent results stale.

### Service test

Use the same station order and scale on both boards. The preview uses **Order**, **Grind**, **Brew**, **Steam**, and **Pickup**. An active ticket sits at the station. Queued tickets stack below it with a visible count. On the first comparison, label A **One barista** and B **Two baristas**. Both boards show the same arrival stream at the same timestamp. A stays intact when a founder tests a different staffing or equipment choice in B.

Play, pause, and seek use one shared clock. Load a readable paused frame. Respect reduced motion by removing decorative transitions while keeping playback and seeking available. Call out the current bottleneck with a stage name and wait duration. If shared staff capacity is the cause, name it in the explanation. Separate counts at the selected timestamp from totals for the full run.

Place **Explain** beside the comparison. The chat opens with the selected scenarios and run in context. An agent suggestion names the input it would change and applies it through the same action as the founder's control. The founder can review the updated input on the board.

### Cash ledger

Use a warm receipt with a thin orange top edge and a torn lower edge. Start with **What must be true for this café to work?** and the break-even orders per day. Align A and B values in fixed columns. Group startup costs separately from recurring costs. Show monthly cash, burn, runway, and the weekday and weekend demand assumptions behind them.

The chart uses graphite for A and orange for B on paper. Label both series and the zero-cash line directly. The saved-customers switch is explicit. Count sales from faster service only when the switch is on and the comparison returns fewer lost orders. The decision note names the assumption that could reverse the result and the range tested. The shareable receipt carries the scenario and run references, provenance, and assumptions that make the result conditional.

## Provenance and result states

Source tags are small, stamped labels beside the figures they qualify. Use the visible labels **Observed**, **Public**, **Estimate**, and **Illustrative**, with the corresponding lowercase values in data. Each derived figure inherits the weakest tag of its inputs. Tie simulation, comparison, and cash figures to their scenario and run. When inputs change, mark affected figures **Stale** until the new action result arrives. For missing results, identify the input or action needed to produce them.
