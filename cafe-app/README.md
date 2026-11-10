# Chat

The minimal agent-native starter app — a clean, ChatGPT-style shell with chat at
the center, durable threads, standard app navigation, auth, live sync, and
actions. Start here when you want a real browser app to build on without
committing to a domain template.

**Live app: [chat.agent-native.com](https://chat.agent-native.com?utm_source=github&utm_medium=referral&utm_content=chat-readme)**

Chat is the basic agent-native app starting point. It gives you the app-agent
loop wired end to end and one example action, so you can add your own UI, data,
and actions on top.

## Features

- ChatGPT-style shell with a threads list and durable chat history.
- Auth, live sync, and application state wired out of the box.
- The action surface the agent and UI share, plus one example action to copy.
- A minimal, brandable base for any domain app.

## Develop locally

Scaffold your own copy and run it:

```bash
npx --yes @agent-native/core@latest create my-app --standalone --template chat
cd my-app
corepack enable
pnpm install
pnpm dev
```

Full docs: [agent-native.com/docs/template-chat](https://agent-native.com/docs/template-chat?utm_source=github&utm_medium=referral&utm_content=chat-readme).

### Optional local Grok bridge

The standard provider configuration remains the default. On macOS, a single local user can opt into a separately authorized Grok CLI profile. This is a structured-text translation of model requests and tool calls; Agent-Native validates and executes the app actions. The bridge invokes Grok 4.5 with high reasoning effort.

Create a private dedicated directory and authorize it directly with the official CLI:

```sh
export CAFE_GROK_PROFILE="$HOME/.local/share/cafe-dry-run/grok-profile"
mkdir -p "$CAFE_GROK_PROFILE"
chmod 700 "$CAFE_GROK_PROFILE"
GROK_HOME="$CAFE_GROK_PROFILE" grok login
```

Then run `node scripts/local-grok.mjs` from `cafe-app`. The launcher does not create or copy a login. The official CLI is expected at `~/.grok/bin/grok`; set `CAFE_GROK_BINARY` if it is elsewhere. Set `CAFE_GROK_PORT` to change the bridge port, and use a distinct `PORT` and persistent `DATABASE_URL` for each app instance. The launcher creates an ephemeral loopback bearer and a private temporary sandbox directory. Keep the profile private: the CLI may store session information there.

The sandbox blocks process forks, writes outside the dedicated profile and temporary directory, and reads of user homes, temporary directories, mounted volumes and network mounts outside those paths and the CLI binary. It does not restrict network egress or every possible filesystem path. Dynamic system messages are carried as role-tagged structured text beneath a fixed CLI system instruction, rather than through a native multi-message API; this does not provide native role isolation. Model output is buffered until each CLI call completes.
