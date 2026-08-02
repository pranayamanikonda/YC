# Validation Report — G3 Pre-ship Gate

- **Project:** {{title}}
- **Date:** {{date}}
- **Owner:** verifier (author ≠ reviewer)

> The Iron Law: no line below is checked without a **fresh** run whose output is shown.

| Check | Command | Result | Evidence |
| ----- | ------- | ------ | -------- |
| Build | | pass/fail | |
| Typecheck | | | |
| Lint | | | |
| Tests | | | |
| Security scan | | | |
| Diff review | | | |

## Acceptance coverage
<!-- Each AC-NNN → the test(s) proving it. Gaps are blockers. -->

## Pre-ship checklist
- [ ] Requirements / acceptance criteria are covered
- [ ] Naming follows the approved convention
- [ ] Tokens and styles come from the shared design system (no raw values)
- [ ] Components use approved patterns; required states present (hover/focus/disabled/error/empty/loading)
- [ ] Responsive behaviour is defined
- [ ] Accessibility checked (WCAG 2.2 AA; a11y-reviewer signed off)
- [ ] Content reviewed
- [ ] Assumptions documented (none unconfirmed)
- [ ] Files, docs, change records, and ship log updated
- [ ] `audit` is clean (no inconsistency, no staleness)
- [ ] No unresolved blocking errors

If a blocking check fails, stop and state: (1) what failed, (2) why, (3) where, (4) how to
correct it, (5) whether the agent can fix it autonomously, (6) what needs user approval.

## Verdict
**READY** / **NOT READY** for ship — with the blocking items if not ready.
