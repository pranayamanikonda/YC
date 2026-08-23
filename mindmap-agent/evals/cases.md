# Evaluation set

Ten briefs across the three domains the agent targets, plus the rubric each run is
scored against. Three are implemented as recorded runs in the app (marked ●); the rest
are for the Week-2 live-mode evaluation.

## Rubric

Each run is scored on six criteria. Total 12; a run "succeeds" at 9+ **and** no zero.

| # | Criterion | 0 | 1 | 2 |
| --- | --- | --- | --- | --- |
| C1 | **Clarifying questions earn their place** | Asks what the brief already said | Mixed | Every question would change the map's shape |
| C2 | **Non-generic branches** | Branches could be pasted onto any brief in the domain | 1–2 filler branches | Every branch is specific to this brief |
| C3 | **Alternatives are real** | None, or restatements | Present but one-sided | Names a framing an expert might prefer, with what it costs |
| C4 | **Assumptions surfaced** | Assumptions hidden inside confident nodes | Some marked | Every skipped question and inferred node visibly marked |
| C5 | **Probes are consequential** | Rhetorical ("have you considered users?") | Answerable but low-impact | Answer would visibly change the map |
| C6 | **Refinement is an iteration** | Unrelated new map | Partial carry-over | Ids preserved, change note accurate, locked nodes intact |

Also recorded per run, as diagnostics rather than scores: time to first map, nodes
produced, model calls, retries, failures, and which nodes the evaluator edited or
voted down (from the session-log export).

## Cases

| # | Domain | Brief | Recorded |
| --- | --- | --- | --- |
| 1 | Product / UX | Plan a UX research study for a fintech onboarding flow where users drop off before finishing KYC | ● |
| 2 | Business | Go-to-market for a campus food delivery app launching next semester | ● |
| 3 | Learning | Learn machine learning in 12 weeks as a working software engineer | ● |
| 4 | Product / UX | Decide whether to rebuild our design system or extend the one we have | |
| 5 | Product / UX | Work out why enterprise trials convert at half the rate of self-serve trials | |
| 6 | Business | Price a B2B analytics product for the Indian mid-market | |
| 7 | Business | Should we hire a second designer or contract the work out for six months | |
| 8 | Learning | Prepare for a senior product-design interview loop in five weeks | |
| 9 | Learning | Get a non-technical founding team fluent enough in AI to make build/buy calls | |
| 10 | Adversarial | "AI" — a deliberately empty brief, to check the thin-brief guardrail holds | |

## Failure cases (must degrade safely, not score)

| # | Trigger | Expected behaviour |
| --- | --- | --- |
| F1 | Brief under four words | Refuse with an explanation of what a usable brief contains |
| F2 | Invalid API key | Named 401 recovery card, offer of settings and recorded mode |
| F3 | Model returns prose instead of JSON | Two silent repair attempts, then a card saying the output was unusable, brief and answers preserved |
| F4 | Request times out | Timeout card offering retry and a smaller model |
| F5 | Probe answered with no recorded refinement (recorded mode) | Say so plainly, point at a probe that is recorded, keep the answer in the session log |
| F6 | Page opened from `file://` in live mode | Network card explaining that the file must be served |

## Week-2 protocol

1. Run cases 1–9 in live mode on v0.1, one round of refinement each. Score with the
   rubric above; record the diagnostics.
2. Apply one v0.2 prompt change from `CHANGELOG-agent.md`.
3. Re-run the same nine cases, same scorer, same order. Report both success rates and
   the per-criterion movement.
4. Run F1–F6 against both versions; any regression blocks the version.
