# cafe-app

This is the running [Cafe Dry Run](../README.md) application. The product README lives at the repository root.

## Develop

You need Node.js 22.22 or later and pnpm 10.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open the URL the dev server prints.

```bash
pnpm typecheck
pnpm exec vitest run server/lib/cafe
pnpm agent-native:doctor
```

The board, the simulations, and the comparisons run without a model. Live agent chat needs a supported provider.

## Optional local Grok bridge

On macOS, one local user can point the app at a separately authorized Grok CLI profile. This is a structured-text translation of model requests and tool calls. Agent-Native still validates and executes the app actions. The bridge invokes Grok 4.5 with high reasoning effort.

Create a private directory and authorize it with the official CLI. The launcher does not create or copy a login.

```bash
export CAFE_GROK_PROFILE="$HOME/.local/share/cafe-dry-run/grok-profile"
mkdir -p "$CAFE_GROK_PROFILE"
chmod 700 "$CAFE_GROK_PROFILE"
GROK_HOME="$CAFE_GROK_PROFILE" "$HOME/.grok/bin/grok" login
```

Then run `node scripts/local-grok.mjs` from this directory. The official CLI is expected at `~/.grok/bin/grok`. Set `CAFE_GROK_BINARY` if it is elsewhere. Set `CAFE_GROK_PORT` to change the bridge port. Use a distinct `PORT` and a persistent `DATABASE_URL` for each app instance.

The launcher creates an ephemeral loopback bearer and a private temporary sandbox directory. Keep the profile private. The CLI may store session information there.

The sandbox blocks process forks, writes outside the dedicated profile and temporary directory, and reads of user homes, temporary directories, and mounted volumes outside those paths and the CLI binary. It does not restrict network egress or every filesystem path. Dynamic system messages are carried as role-tagged structured text beneath a fixed CLI system instruction. That is not native role isolation. Model output is buffered until each CLI call completes. On provider errors, framework server logs may contain request fields.
