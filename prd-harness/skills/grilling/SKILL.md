---
name: grilling
description: Interrogate a plan before a human gate — sequentially, one question at a time, facts researched not asked, each open decision surfaced with a recommendation and an explicit confirmation. Run before approving G1 or G2, or to work a grilling-type wayfinder ticket.
disable-model-invocation: true
---

# grilling

Before a human approves a gate, the plan should survive being questioned. Grilling
is that interrogation — deliberately sequential and human-in-the-loop, so the answers
are actually thought about rather than skimmed. It complements `council` (the
parallel, automated go/no-go breaker): grilling is what the **human** does at the
gate; council is what the **agents** do when an inner loop deadlocks.

## When to run it

- **At G1** — before approving the framing. Grill the scope, the assumptions-to-confirm,
  and the non-goals. What's assumed but unstated? Which "fact" is really a decision?
- **At G2** — before approving the design. Grill the IA, the flows (empty/error/edge),
  the wireframes, and the 2–3 visual directions against the scenarios and access needs.
- **As a `wayfinder` ticket** — a `grilling`-type ticket routes here to settle one
  charted question.

## The method (see `agents/griller.md`)

1. **One question at a time.** Ask, wait, then ask the next — never a wall of questions.
2. **Research facts; don't ask them.** Look up anything the repo/PRD/artefacts already
   answer; spend the human's attention only on genuine decisions.
3. **Recommend, then confirm.** State the options, recommend one with reasoning, ask the
   human to confirm or override, and record the confirmed answer where it belongs.
4. **Default adversarial.** Assume the plan is wrong until the questions can't break it.

## Run

Dispatch the `griller` agent (author ≠ reviewer — never grill a plan you wrote):

> Grill the G1 framing for `<project>`: read `prd/PRD.md`, the assumptions-to-confirm,
> and `wayfinder/map.md`; interrogate one decision at a time; record each confirmed
> answer in its artefact.

## After it runs

Confirmed answers land in their artefacts (assumptions-to-confirm, ACs, ADRs, or a
`wayfinder` ticket resolution) plus a one-line ledger note. Approve the gate only once
every open decision has a confirmed answer; anything unresolved becomes a `wayfinder`
ticket, not an approval worked around.
