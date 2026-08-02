# Team Standup Digest

## Problem
Distributed teams lose time in synchronous standups across time zones. Managers want a
written daily digest that captures what each person did, is doing, and is blocked on —
without a meeting.

## Goals
- Each member submits a short async update via a web page and a Slack command.
- A daily digest is generated per team and posted to a Slack channel and a web dashboard.
- Managers can see blockers surfaced across the team at a glance.

## Non-goals
- No performance evaluation or scoring.
- No video or voice; text only in v1.

## Users & context
- Team members submitting updates.
- Managers reading the digest.

## Requirements
1. A web page and a Slack slash command to submit an update (done / doing / blocked).
2. A scheduled service generates the digest per team on a cron.
3. The digest posts to a Slack channel and appears on a web dashboard.
4. Blockers are highlighted and aggregated for managers.
5. Updates and digests persist so history is browsable.

## Assumptions to confirm
- Slack is the only chat surface for v1 (Teams/Discord later?).
- Digest cadence is daily at a team-configured time.

## Open questions
- Should late submissions after the digest runs be included in the next day's digest?
