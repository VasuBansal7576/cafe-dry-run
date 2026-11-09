# Chat — Agent Guide

Chat is the minimal chat-first agent-native app. `/` redirects to shared sign-in, then `/home`, the editable Get started page. Chat lives at `/chat`; new chats start there. Actions carry capabilities; screens exist only for durable workflows.

## Skills

Search with `rg --hidden --follow`; read the exact linked guide before deeper work. `.agents/skills/build-an-app/SKILL.md` — start here for vague requests to create a domain app. `.agents/skills/adding-a-feature/SKILL.md` — cross-area feature checklist. Data/integrations: `.agents/skills/actions/SKILL.md`, `.agents/skills/storing-data/SKILL.md`, `.agents/skills/security/SKILL.md`, `.agents/skills/secrets/SKILL.md`, `.agents/skills/sharing/SKILL.md`. UI: `.agents/skills/frontend-design/SKILL.md`, `.agents/skills/shadcn-ui/SKILL.md`, `.agents/skills/client-side-routing/SKILL.md`. Agent context/workflows: `.agents/skills/context-awareness/SKILL.md`, `.agents/skills/real-time-sync/SKILL.md`, `.agents/skills/reliable-mutations/SKILL.md`, `.agents/skills/performance/SKILL.md`, `.agents/skills/delegate-to-agent/SKILL.md`. Framework: `.agents/skills/agent-native-docs/SKILL.md`, `.agents/skills/agent-native-toolkit/SKILL.md`, `.agents/skills/customizing-agent-native/SKILL.md`.

Use local docs only (no web research): `pnpm action docs-search --query "<topic>"`, `pnpm action docs-search --slug "<slug>"`, `pnpm action docs-search --list`, `pnpm action source-search --query "<pattern>"`, `pnpm action source-search --path <path>`, or `pnpm action source-search --list`. For external-agent integrations, read `pnpm action docs-search --slug "external-agents"`.

## Core rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Normal app data must flow through actions. Keep actions deterministic and focused; use agent chat/AgentSidebar for AI work and follow-ups in the same thread. Keep structured state in SQL and large files in configured storage; persist references only.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver. Never hardcode credentials, webhook URLs, or private/customer data.
- Never fabricate. Report failures and recover; verify writes by reading the row or screen. Navigation is in `<current-screen>`; use `view-screen` for fresh visible-record details.

For custom branding, keep `server/plugins/agent-native-email-branding.ts` aligned: `app.name` appears in transactional email and optional `app.logoUrl` must be an absolute HTTPS URL.

## Application state

- `navigation` describes the view and selected ids. Chat is `chat` at `/chat` and `/chat/<threadId>`; the Get started page is `home` at `/home`; `/` opens shared sign-in/signup.
- Use `navigate` when supported and `view-screen` for a fresh read of visible details; basic navigation is already in `<current-screen>`.

## Building a domain app

Choose the primary workflow and route before editing. Add a domain route under `app/routes/` and set `app.homePath` in `server/plugins/agent-native-email-branding.ts` with `defineAppConfig`. The default Get started page lives at `/home`, and Chat stays at `/chat`; edit `app/routes/home.tsx` when replacing that page with a domain-specific home. Add a static link in `app/components/layout/Sidebar.tsx` before `ChatThreadsSection`; `Header.tsx` uses `APP_TITLE` elsewhere. Shared sidebar and AgentInspector remain.

Use `adding-a-feature` for functional parity and `frontend-design` for a user-facing screen. Keep feature guidance here; do not rewrite `README.md` or `DESIGN.md`. After all edits, run one typecheck, one doctor check, and one browser smoke of the primary workflow, including overlap rejection, cancellation freeing the slot, and authenticated landing. Skip production build and extra test suites.

Before building common workspace or agent UI, read `agent-native-toolkit`; for supported customization, read `customizing-agent-native`.

- Guarded verification: run `pnpm agent-native:doctor`; fix findings before done.

## Café Dry Run

Follow the project rules in `../AGENTS.md` and behavior specification in `../cafe-dry-run-statechart.html`. The café view is `/cafe`. Each scenario is private to its signed-in owner. The founder and agent use the same actions.

| Action | Use |
| --- | --- |
| `list-scenarios` | Read scenario IDs, selected spots, spot and service input revisions, tagged demand and shop inputs, and latest run IDs. |
| `create-scenario` | Start a private scenario with clearly labeled illustrative inputs. |
| `set-spot` | Move the selected scenario's pin by snapshot place name or coordinates using its `spotRevision`. Confirm the saved spot with `list-scenarios`. Use nearby places as area context only. |
| `set-demand` | Edit hourly demand, opening hours or the Saturday curve using the current revision. |
| `set-pedestrian-count` | Save an observed count and conversion, or send `pedestrian: null` to clear it. Omit `pedestrian` to read without editing. With no count, read conditional capture rates from a fresh runway or comparison. Pass `comparison: { aId, bId }` for a pair and use its shared arrival source ID and revision. Never treat the illustrative denominators as site footfall. |
| `tag-source` | Change one tagged numeric input’s source without changing its value; use the field path and applicable revision from `list-scenarios`. Public tags require full source evidence. |
| `configure-shop` | Replace selected `shop` or `finance` fields. Send the current `expectedRevision` for shop and `expectedFinanceRevision` for finance. Send both to save shop and finance together. To change one shift, preserve the other workers and shifts in the replacement list. |
| `run-simulation` | Persist a seeded service result for the current revision. Use its metrics and provenance when explaining the result. |
| `get-simulation` | Read a saved run and its stale status. Request playback only when the arrival and event timeline is needed. |

Use `navigate` to open `/cafe?scenario=<id>` with `#opening-file`, `#site-demand`, `#service-test`, or `#cash-ledger`. `view-screen` returns the visible document and its `documentHash`, even after scrolling without changing the URL's `hash`. It also includes the selected scenarios, saved spot, displayed run IDs and timeline position. Active playback refreshes the position once per second. A stale result describes the earlier run revision. Simulation numbers come from actions. Explain opens the built-in agent chat.

Quote each fresh result's `chatFigures.text` exactly, including signs, decimals, currency and units. Keep the figure attached to its scenario and source tag. Read a fresh action in the current turn. Raw numbers are available for the app; the agent never rounds, converts or calculates with them.

| Comparison and cash action | Use |
| --- | --- |
| `configure-shop` with `variantLabel` | Copy the baseline and change the copy only. Send its current service and finance revisions. The grinder's startup quote belongs in its financial inputs. |
| `configure-finance` | Edit tagged prices, ingredients, cash, wages, startup, recurring, and weekday assumptions. A money edit invalidates cash but leaves service playback fresh. |
| `compare-scenarios` | Run A and B against the same records from their nearest shared ancestor, or from A when they are unrelated. Both shops must serve the drinks in the shared mix. The saved-customer assumption applies to the pair in either order. Pass it only to change it. |
| `get-comparison` | Read the current shared arrival source even before the first run. Edit its ID and revision via `set-demand` or `set-pedestrian-count`. Read any saved receipt and check service and cash freshness. |
| `compute-runway` | Save a solo runway from the scenario's latest fresh simulation. |
| `explain-result` | Read the selected receipt's exact sample, linked action results and reversing assumption. The real chat model writes any recommendation using those figures. |

For comparison navigation, use `/cafe?scenario=<a>&compare=<b>#service-test`. The tab state records both scenarios, and the shared clock records the paired run IDs and position. Weekday arrivals, loss share, and staffing are independent inputs. Weekend sales price the completed drinks from the matched Saturdays, scaled by expected daily arrivals and the weekend calendar. With the switch off, count the lower of the baseline and candidate completions for each drink on each Saturday. With the switch on, include additional completed drinks only if the candidate lost fewer customers overall. Keep the saved-customer sensitivity conditional, including when the tested values do not change the decision. Break-even means the first whole number of orders per open day with nonnegative posted monthly cash.
