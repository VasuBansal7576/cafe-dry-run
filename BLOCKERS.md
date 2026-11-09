# Blockers and pending external checks

No external blocker prevents repository preparation. Missing app implementation is NOT VERIFIED, not a blocker waiver.

| Item | Affected work | Current evidence | Next action and owner |
| --- | --- | --- | --- |
| App model connection is unverified | a6, b2, b3, b9 and live demo | No app or project .env exists yet. This does not establish whether a documented provider connection is available. | Build agent checks supported existing connections during scaffold preflight, tries a real tool call, and requests human setup only if none works. |
| Map export has not been fetched | a1 and S1 | Design reference contains an illustrative street sketch only. | Build agent fetches real data early, records attribution and source IDs, and retains a coverage-gap state if external access fails. a1 cannot pass without its evidence. |
| Supplied storefront asset provenance is unconfirmed | Human submission and asset disclosure | The reference and original PNG were supplied; creator and usage rights were not supplied. | Human confirms rights or authorizes a replacement before the final demo. See THIRD_PARTY.md. |
| Participant and prior-work facts need confirmation | Group C only | Team eligibility and earlier asset creation dates have not been independently established. | Human confirms facts before submission. Do not fabricate them from repository timestamps. |
