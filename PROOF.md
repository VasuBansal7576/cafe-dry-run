# Proof index

Preparation evidence only. The application has not been scaffolded. Every required app row in ACCEPTANCE.md remains NOT VERIFIED.

| Proof | Verdict | Evidence | Scope |
| --- | --- | --- | --- |
| Original input preserved | VERIFIED | Git commit 878d82c | Supplied HTML before preparation edits |
| Official rules and framework docs read | VERIFIED | HACKATHON.md, linked official sources checked 2026-11-09 | Source review, not runtime framework use or eligibility |
| Spec and demo extraction | VERIFIED | scripts/extract-spec.mjs; .artifacts/preparation/checks.json; .artifacts/preparation/execution.json | Independent HTML parser matches both outputs; repeated extraction is unchanged; missing spec and missing demo step each fail without writing output; rerun retains candidate SHA, commands, and raw output |
| Acceptance scope preserved | VERIFIED | .artifacts/preparation/checks.json; diff from 878d82c | All 20 A/B DoD rows, states, actions, transitions, and principles remain unchanged |
| Publication exclusions | VERIFIED | .gitignore; .artifacts/preparation/checks.json | Secrets, runtime data, hosting metadata, and evidence paths are ignored; example env files remain eligible |
| Independent preparation review | VERIFIED | Commit 3701744; .artifacts/preparation/reviewer.md | Fresh read-only reviewer confirmed extraction, preserved acceptance, official requirements, and human boundaries; concurrency wording clarified following review. This is not app verification. |
| Public repository | Pending publication | No verified remote yet | Must read back visibility and compare remote main to local main |

During implementation, append product proofs with requirement ID, exact candidate commit, command or journey, result, and .artifacts/ pointer. Automated gates must rerun rather than trust this table.
