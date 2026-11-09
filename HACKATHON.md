# Hackathon requirements and idea fit

Checked on 9 November 2026. This is a build reference, not a claim of participant eligibility or completed submission.

## Official entry requirements

[Official rules](https://www.builder.io/hackathon/rules) require a functional Agent-Native app, original work or meaningful development during the event, disclosure of prior work and third-party materials, and a public Clips demonstration accessible without login. The human submits the form and confirms receipt. A public repo or deployment is optional. Framework use and demo accessibility are checked before rankings become final.

Building may start on 27 October 2026. Submission closes on 9 November at 23:59 America/Los_Angeles, or 10 November at 13:29 IST. Our earlier build stop is a project decision. Each team member must meet the rules' age, eligibility, and permission requirements. The human confirms these.

Scoring is usefulness and execution at 40%, with design, innovation, and Agent-Native use at 20% each. These rules do not require a specific business domain.

## Framework choice

Use [Agent-Native](https://github.com/BuilderIO/agent-native). Pstack coordinates development; it is not the application framework.

The [official getting-started guide](https://www.agent-native.com/docs/) specifies Node.js 22.22 or later and pnpm. Start from its standalone Chat template:

```sh
npx --yes @agent-native/core@latest create cafe-app --standalone --template chat
```

The generated app provides chat and shared actions. Its documented local entry is **Continue as local dev**. A provider connection is required for real agent responses, but not for scaffolding. Record and verify the actual provider selected during implementation. Do not create new provider accounts or assume this Codex chat's model is available to the app.

The [database guide](https://www.agent-native.com/docs/server-database/) specifies PostgreSQL and Drizzle, with PGlite for local development. Verify persistent local storage through restart; SQLite is not the proposed option. Follow the generated app's installed-version instructions for migrations and sync.

The [agent setup guide](https://www.agent-native.com/docs/create-with-an-agent/) explains that the app includes its own AGENTS.md, skills, and version-matched docs. Read those before changing framework integration. The exact scaffold recipe is our implementation choice; the rules require using Agent-Native, not those particular CLI flags.

## Assessment of Cafe Dry Run

Recommendation: keep the idea and its full core loop. This is a judgment about the proposal, not a prediction of judging results.

The [challenge](https://www.builder.io/hackathon#challenge) asks for people and agents working through connected data and actions. The founder can enter assumptions, watch a queue, and edit a shift. The agent can create alternatives, run them on the same arrivals, explain the differences, and expose the assumption that would change its recommendation. Those are concrete jobs for the agent and useful controls for the person.

The distinctive experience is the visible link between shared staff time, queues, an editable staffing decision, and cash. Keep that visible in the demo. Calling a model only to narrate a predetermined result would leave the main idea unproven.

The largest delivery risks are real agent integration, persistent shared state, and simulator correctness. Prove the first two immediately after startup. Keep the real map as location context. Finish the required flow before optional external MCP demonstrations, more neighborhoods, or share links.

No product pivot is justified by the published challenge. Personal eligibility and rights to supplied assets remain for the human to confirm. The app is not built yet, so framework compliance and functional acceptance are still unverified.

## Human submission reference

Use the [official submission page](https://www.builder.io/hackathon/submit) and [Clips](https://www.agent-native.com/apps/clips/). The repo does not submit itself. Update SUBMISSION_NOTES.md from the actual final app and check THIRD_PARTY.md before recording. Leave private identity, payment, and tax records out of the project.
