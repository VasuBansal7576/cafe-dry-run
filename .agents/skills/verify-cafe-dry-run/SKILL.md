---
name: verify-cafe-dry-run
description: Drive the Café Dry Run web app to verify a candidate, investigate a broken user journey, or collect launch, shared action, persistence, design, and demo evidence.
---

# Verify Café Dry Run

Read [the feature map](features/README.md) and open the entries affected by the slice. Read the repository's statechart JSON for acceptance and the separate HTML demo for recording order. Scope each verdict to the journey you actually drove. The repository predicate owns overall acceptance.

## Launch

Use Node.js 22.22 or newer, pnpm as pinned in `cafe-app/package.json`, Git, tar, ps, lsof, and a Playwright installation with Chromium. Set `CAFE_PLAYWRIGHT` to the absolute path of the installed package's `index.mjs`. If Chromium is installed outside Playwright, set `CAFE_CHROME` to its executable. Run from the repository root.

```sh
verify=.agents/skills/verify-cafe-dry-run/scripts/verify.mjs
"$verify" doctor "$PWD" 8189
```

The helper archives the repository's committed `cafe-app` into a disposable directory, installs frozen dependencies, and starts `pnpm exec agent-native dev --host 127.0.0.1 --port 8189 --strictPort` there with a fresh PGlite database. Pick an unused port for each worker. The helper refuses port 8080 and any occupied port. It records the commit and application tree. Commit an isolated candidate first if its changes need testing.

## Doctor

The helper checks listener ownership, uses **Continue as local dev**, opens `/cafe`, reads the authenticated `list-scenarios` action, and requires the **Start a scenario** control on a migrated empty database. It also runs the framework's source doctor. The same checks run before each journey. For live chat, an enabled composer is a separate precondition.

## Drive

```sh
"$verify" pilot "$PWD" 8189
CAFE_PROVIDER_SETUP=manual "$verify" live "$PWD" 8189
```

`pilot` drives the founder's demand controls in Chromium, reads the exact persisted row with the server stopped, and restarts to verify the same row in the UI. `live` adds an actual chat edit and requires the already-open Café UI to update before restart. The live command opens a scratch browser and pauses for the operator to connect an authorized provider in that app's Settings. Keep the operator's personal database and browser profile separate. A missing connection leaves the live step unverified. See [the demand journey](features/s2-demand.md) and [the integrated demo](features/demo.md).

## Evidence

The helper writes `.artifacts/verify-cafe-dry-run/<mode>-*/index.json` and selected screenshots and row fields. Set `CAFE_EVIDENCE_DIR` to an absolute writable path when verifying from a read-only checkout. The index records the commit, app tree, core version, inputs, observations, failure phase, and artifact names. Include its path and relevant requirement IDs in the project evidence index.

Drive writes through actual user controls and use the framework read action and offline row projection to corroborate them. Capture the action, the visible result, and the side effect. Keep credentials, cookies, raw provider payloads, and full auth or chat tables out of evidence.

## Cleanup

The helper closes its browser, terminates its own dev process group, confirms the port has cleared, and removes the scratch directory. It checks that evidence files still exist. If cleanup fails, inspect the printed scratch path and recorded process ownership before removing the abandoned instance. The evidence stays under the output directory.
