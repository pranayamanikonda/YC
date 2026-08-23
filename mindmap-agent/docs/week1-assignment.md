# Week 1 — AI Mind-Map Agent

**Author:** Pranaya Manikonda · **Date:** 23 August 2026
**Problem statement:** 2 — AI Mind-Map Agent
**Try the agent:** https://claude.ai/code/artifact/5c8f55e2-cd7c-492d-abe0-f648f685119c
**This write-up, published:** https://claude.ai/code/artifact/f88435e6-88e3-4516-8c14-09bd3673a441
**Source:** `mindmap-agent/` on branch `claude/ai-agent-design-4t39fl`

---

## 1. What was asked, and what I built

The brief asks for an agent that creates mind maps from a context or requirement and
*goes beyond generic structures* — researching alternatives, asking probing questions,
challenging assumptions, and refining the map from the answers.

I built **Probe**, a browser agent that runs a four-step loop:

```
1 Brief  →  2 Clarify  →  3 Map  →  4 Refine
            ↑                          │
            └──────── the answers change the map ────┘
```

1. **Brief.** You say what you are trying to work out. Purpose, audience and depth are
   optional.
2. **Clarify.** Before mapping anything, the agent asks the 3–5 questions whose answers
   would most change the shape of the map, each with the default it will assume if you
   skip. Skipping is one click and always allowed.
3. **Map.** A tree where every node carries *why it is there*, a **confidence** level,
   and a **source** — `your input`, `model`, or `assumption`. Every first-level branch
   also carries **alternatives** ("are these the only options?" answered concretely,
   each with its trade-off) and **probes** — questions to you that would change that
   branch.
4. **Refine.** The agent puts its hardest open question at the bottom of the screen.
   Your one-line answer rebuilds the map, and the result is shown as a **diff** —
   added nodes edged green, reworded ones amber, with a written change note and a
   one-click undo.

The map is not read-only at any point: rename a node inline, add or delete children,
lock a node so a regeneration cannot touch its wording, take an alternative framing in
place of the branch it argues against, deepen a branch, or mark a branch useful or
generic. Undo/redo covers all of it.

### Two run modes, stated in the interface

| Mode | What it is | Where |
| --- | --- | --- |
| **Recorded** | Replays saved outputs of the v0.1 prompts for three briefs. No key, no network. | The default, and the only mode available on the shared link above — artifact pages are blocked from calling external APIs. |
| **Live** | Sends your own brief to the Anthropic API with your own key. | When you serve `probe.html` yourself and add a key in Settings. |

This split is a constraint, not a design choice: a published artifact cannot call an
LLM API. Rather than hide it, the app names the mode in the top bar, in the footer, and
in every message where the limit bites — including refusing to pretend it can map an
arbitrary brief in recorded mode.

---

## 2. Users and needs

**Primary user.** Someone doing early, messy thinking work with a real deliverable
attached — a UX researcher scoping a study, a founder planning a launch, an engineer
planning twelve weeks of learning. They are competent in their domain. They do not
need an AI to tell them what a mind map is; they need one that has *read their brief*
and can tell them what they are missing.

**Primary tasks.**
1. Turn a paragraph of intent into a structure I can argue with.
2. Find the branch I would not have thought of, and the assumption I am resting on.
3. Leave with something I can paste into a doc, a ticket, or a plan.

| Feature | The need it serves |
| --- | --- |
| Clarifying questions before any map | "It answered a question I did not ask" is the standard failure of generic AI structure |
| Skip → visible assumption | Users will not answer five questions. Skipping must be cheap, but its cost must be visible |
| `source` tag per node | Tells you which parts of the map came from *you* and which the model invented |
| Alternatives with trade-offs | The requirement "are these the only options?", answered rather than asked |
| Probes in a fixed dock | Makes challenging the user the agent's default behaviour, not a feature you have to find |
| Diff + change note + undo | Iteration is only safe if you can see what changed and reverse it |
| Lock a node | Lets the user protect their own thinking from the next regeneration |
| Markdown / Mermaid / JSON export | The map has to leave the tool to be worth making |
| "The prompt used" tab | Anyone can read exactly what instructions produced their map |

**Rely on it for:** structure, alternatives, naming assumptions, questions to take to
real sources.
**Do not rely on it for:** facts, numbers, prices, citations, anything specific to your
company it cannot know, or professional judgement. Both lists are printed on the first
screen, before the user's first run — not buried in a help page.

---

## 3. Initial capability check

Three things were run end to end.

### (a) Three briefs, one per target domain

| Case | Brief | Result |
| --- | --- | --- |
| A | UX research study for a fintech KYC onboarding drop-off | 5 clarifying questions → 20 nodes across 5 branches, 10 alternatives, 7 probes, 2 stated assumptions plus one for every question skipped; one refinement round rebuilt the diagnostics branch and promoted the exit intercept |
| B | Go-to-market for a campus food delivery app | 4 questions → 21 nodes, 9 alternatives, 7 probes, 3 stated assumptions; the refinement turned "pick a wedge" into a numeric target ladder once the user supplied a kill number |
| C | Learn ML in 12 weeks as a working engineer | 4 questions → 21 nodes, 9 alternatives, 7 probes, 3 stated assumptions; answering one probe about work data re-cut the project branch onto the user's own dataset |

Scored against the rubric in [`evals/cases.md`](../evals/cases.md) — 12 points, pass at 9:

| Case | C1 questions | C2 non-generic | C3 alternatives | C4 assumptions | C5 probes | C6 iteration | Total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | 2 | 1 | 2 | 2 | 2 | 2 | **11** |
| B | 2 | 1 | 2 | 2 | 2 | 2 | **11** |
| C | 2 | 1 | 2 | 2 | 2 | 2 | **11** |

**3 of 3 pass. Mean 11/12. The lost point is the same one every time:** each map still
contains one branch that is a domain template rather than a response to the brief —
"Getting the findings used", "What kills this", "Staying on it for twelve weeks". The
content underneath is specific; the branch heading is not. That is the first thing
v0.2 targets.

*How to read this number honestly:* the three runs are recorded, scored by their author,
with one rater. It says the agent produces maps of the intended shape. It does not say
the agent is good — that requires live runs and someone else scoring, which is Week 2.

### (b) 35 automated end-to-end checks

`test/flow.test.mjs` drives the real page in headless Chromium: **35/35 pass.** It
covers the full flow on two of the three cases, inline rename, delete and undo, lock,
voting, branch expansion, all four exports, the diff highlighting, the mobile layout,
and a contrast audit across all four theme states (system light, system dark, and both
explicit choices).

### (c) Failure paths, deliberately triggered

| Trigger | Behaviour |
| --- | --- |
| Brief of one word ("marketing") | Refused, with an explanation of what a usable brief contains — no map produced |
| Own brief with no key / on the shared link | Says plainly that only the three recorded briefs can run here, and offers them |
| Expanding a branch with no recorded expansion | Says so, names the branch that does have one, keeps everything else working |
| Answering a probe with no recorded refinement | Says so, and still writes the answer to the session log |
| (Live) 401, timeout, unreachable API, unusable JSON | Four distinct recovery cards, each with actions; brief and answers are never lost |

---

## 4. What works, and what needs improvement

**Works**

- The clarifying step changes the output visibly. Answering "only completers are
  reachable" or "we stop at 200 orders a week" produces a map that could not have been
  written from the brief alone.
- Skipping is genuinely cheap, and the assumptions it creates are visible on the map
  rather than hidden in the model's head.
- The refinement diff is the feature that makes iteration feel safe: you can see the
  four nodes that moved, and undo them in one click.
- Failure states are specific. Nothing in the app produces a blank screen or a bare
  "something went wrong".

**Needs improvement**

1. **One template branch per map** (see the rubric scores above) — the biggest quality
   gap and the first v0.2 change.
2. **Confidence is compressed.** Almost everything is `high` or `medium`; a scale that
   never says `low` carries no information.
3. **Recorded mode is a partial experience.** One expansion and one refinement per
   case. Honest, but a reviewer without an API key sees a rehearsal, not the agent.
4. **No memory between sessions.** Close the tab and the map is gone. Exports exist,
   but a "resume" would cost little.
5. **The probe dock shows one question at a time** with no sense of how many remain or
   which matter most.
6. **Nothing yet learns from the 👍/👎 signals.** They are captured in the session log
   and go nowhere. Week 3 should feed voted-down nodes back into the refine prompt.

---

## 5. The seven concepts — where they stand after Week 1

| Concept | In the build today | Week 2–3 |
| --- | --- | --- |
| **User needs** | Three target users, three tasks, every feature mapped to a need (§2); rely / do-not-rely printed on the first screen | Test the mapping with two people outside this project |
| **Defining success** | Six-criterion rubric and a 10-brief evaluation set written; 3 recorded cases scored 11/12, 3/3 pass | Run all 9 briefs live, independent scorer, report the success rate before and after v0.2 |
| **Data and model evolution** | Prompts isolated in one versioned pack; changelog records four build-session iterations with their observed effects | Ship v0.2, report per-criterion movement on the same evaluation set |
| **Mental models** | Mode named in three places; capability/limit lists on the first screen; the agent refuses briefs it cannot map well rather than guessing | Add a first-run walkthrough of what a probe is and why skipping is safe |
| **Trust and explanations** | Per-node `why`, confidence, and source tag; assumptions listed under the map; the exact prompt readable in-app | Make confidence carry information (v0.2 candidate 2); show *which answer* changed a node |
| **Feedback and controls** | Edit, add, delete, lock, undo/redo, swap-in alternatives, 👍/👎, exportable session log | Feed voted-down nodes into the refine prompt so the map responds to the feedback |
| **Errors and graceful failures** | Guardrail on thin briefs; two silent JSON repairs; four named recovery cards; recorded-mode limits stated instead of faked | Add resume-after-failure and a partial-map fallback when only some of the JSON parses |

---

## 6. Timeline

| When | What | Status |
| --- | --- | --- |
| Week 1 (17–23 Aug) | Choose the problem statement, design the loop, build the agent, prompt pack v0.1, three recorded cases, 35 automated checks, this write-up | **Done — this submission** |
| Week 2 (24–30 Aug) | Run the nine live briefs on v0.1 and score them; ship v0.2 from the changelog candidates; re-run and report before/after; wire 👍/👎 into refinement | Planned |
| Week 3 (31 Aug–6 Sep) | Two outside users on real briefs; fix what they hit; session resume; final course-project write-up with the reported success rate and the iteration evidence | Planned |

---

## 7. Lessons learnt so far

1. **The interesting design work was in the refusals.** Deciding what the agent will
   *not* do — map a one-word brief, pretend recorded mode is live, hide a skipped
   question — did more for its credibility than any feature.
2. **A skip is a design decision, not a shortcut.** Turning every skipped question into
   a visible assumption was the change that made the clarify step worth its friction.
3. **Iteration is only usable if it is reversible and visible.** Before the diff and
   undo existed, refining felt like gambling with a map you had already invested in.
4. **The platform constraint shaped the product.** No LLM call is possible from a
   published artifact, so the honest options were "make the limit visible" or "fake it".
   Naming it produced a better artifact — and, unexpectedly, a good demonstration of
   graceful failure.
5. **Design bugs hide in the gap between source and output.** The dock squeezing the
   canvas to a fifth of the window, and small text failing contrast in the light theme,
   were both invisible in code and obvious in a screenshot. Looking at the running
   thing found what reading it could not.
