# Integrated founder and agent demo

Follow the six-step recording order in the [source HTML](../../../../cafe-dry-run-statechart.html). Run `founder` to collect deterministic evidence on a disposable database. Run `demo` for the combined verdict. It fails the full demo gate while the live model observations are missing.

| Step | Founder journey | Real provider observations |
| --- | --- | --- |
| 1 | Pick the Indiranagar preset. Match nearby place links to the snapshot and capture the source and gap notices. | |
| 2 | Save hourly demand, opening hours, rent and cash. Read back the value and source of each field. | |
| 3 | Play, pause and seek a simulated Saturday. Compare board counts with recorded events and read the named bottleneck. | |
| 4 | Create the barista and grinder variants through the founder controls. Compare their saved arrival records. | In a fresh scenario with the same inputs and an authorized provider, ask "Should I add a barista or buy another grinder?" Capture the actual tools and the two variants appearing in the open café tab. |
| 5 | Manually save Barista 2 from 10:00 to 12:00. Check that fresh wait, loss, staff cost and cash deltas replace the old receipt. | Challenge the agent to use the edited shift. Observe the rerun and match its figures to the new action result. |
| 6 | Toggle the named assumption and check the cash ledger, break-even and separated day types. | Capture the model's actual recommendation and check every figure against an action result. |

For live checks, open `/cafe` and `/chat` in the same scratch browser context. Keep the café tab open to observe edits without reload. The founder journey exercises the private `view-screen` and `navigate` handlers via the scratch transport. It checks both tabs’ selected scenarios and playheads, a direct document link, and the visible section after manual scrolling. It checks `explain-result` against the saved receipt and run IDs. Exercise model selection of these tools separately with a real provider. Verify tool streaming, stop and redirect separately. Record only the observed tool names, scenario and receipt IDs, and relevant recommendation text. Keep provider setup screens, cookies, keys and raw auth or chat responses out of the evidence.

The existing `live` demand pilot proves one shared edit when a real provider is connected. The full demo needs the specific tools and recommendation above. For design judgment, inspect the opening file, site and demand, solo service, comparison and cash ledger against `DESIGN.md` at both widths. The founder command's overflow check and captures are inputs to that review.
