# Agent changelog

The agent's behaviour lives in `src/20-prompts.js`. Every change to it gets a version
bump and an entry here, so a before/after claim can always be traced to a diff.
The version in force is shown in the app footer.

---

## v0.1 — 2026-08-23 — first working agent

**Prompt pack**

- `SYSTEM`: six operating rules — ban generic filler branches, require an alternative
  framing per branch, force assumptions to be marked rather than smuggled in, calibrate
  confidence, forbid invented facts and citations, and require probes that are
  answerable and consequential rather than rhetorical.
- `clarify`: 3–5 questions chosen for how much they would change the map's shape, each
  carrying the default that will be assumed if the user skips it.
- `buildMap`: 4–6 first-level branches, 2–4 children each, source and confidence on
  every node, 2–3 alternatives and 1–2 probes per first-level branch, at least one
  probe that challenges the brief itself.
- `deepen`: expands one branch, and must include one option a careful person would
  reject, with the conditions under which it would be right after all.
- `refine`: an iteration, not a rewrite — ids preserved so changes can be diffed,
  locked nodes protected, removals stated in a change note, probes get harder each round.

**App behaviour set in this version**

- Skipping a clarifying question converts it into a visible assumption on the map.
- Three model-call failure classes (auth, timeout, network, unusable output) each get
  their own recovery card with actions rather than a generic error.
- Malformed JSON is retried twice with the parse error fed back, before failing.
- Briefs under four words are refused with an explanation instead of mapped.

### Changes made during the build session (app, not prompts)

| # | Observation | Change | Effect |
| --- | --- | --- | --- |
| 1 | Assumptions rendered as a row of pills read as decorative badges and were scanned past. | Re-rendered as a dashed-rule "What this map assumes" note under the summary. | The assumptions now read as caveats attached to the map, which is what they are. |
| 2 | Two phrasings of the same assumption (the model's own, plus a skipped question's default) both appeared. | Deduplicated on a normalised six-word prefix. | Case A dropped from 6 assumption lines to 4, none of them near-duplicates. |
| 3 | The refine dock was laid out as a flex sibling of the map, squeezing the canvas to about a fifth of the window. | Wrapped the map and dock in a column container. | The tree gets the full canvas width; labels stopped wrapping at four words. |
| 4 | Small text (chips, eyebrows, footer) fell below 4.5:1 in the light theme. | Darkened the light-theme neutral and amber tokens; introduced an `--on-probe` token instead of three overlapping theme overrides. | All audited text passes 4.5:1 in all four theme states (see `test/`, contrast audit). |

---

## v0.2 — 2026-08-23 — the map comes first

**Why.** Reviewing v0.1 against NotebookLM's mind maps raised a fair question: does this
need four steps? In v0.1 you could not see anything until you had been through a
five-question form. That is a gate in front of the value, and it asks people to answer
questions about a map they have not seen yet — the hardest moment to answer them well.

**Change.** The flow is now two steps: **brief → map**. The clarifying questions did not
disappear; they moved *onto* the map, where they compete for attention with a structure
you can already read. Each one sits in a dock at the bottom with its suggested answers
one click away, a statement of what it will assume if you skip it, and a "why it
matters" line. Answering reworks the map in place; skipping converts the question into
a visible assumption. The old route survives as a secondary button ("Ask me questions
first") for people who prefer being asked up front.

| | v0.1 | v0.2 |
| --- | --- | --- |
| Steps before the first map | 3 screens (brief → 5-question form → map) | 1 (brief → map) |
| Minimum clicks to a map | 3 — *Ask me questions first*, *Skip the rest*, *Build the map* | 1 — *Map it* |
| When questions are answered | Before seeing anything | Against a map you can already read |
| Cost of ignoring a question | Must still pass the form | None — it sits in the queue |
| Assumptions visible at first render | Only after the form | Immediately, under the map summary |

**Prompt change (this is the version bump).** `buildMap` previously assumed it would
always receive answers. It now has an explicit no-answers branch: map from the brief
alone rather than stalling, mark every node resting on a guess as `source:"assumption"`,
and list those assumptions in plain words so the user can see what to correct.

**Also in this version**

- Every clarifying question in the recorded runs carries a scripted effect, so answering
  one in recorded mode genuinely reworks the map — the user's own words are written into
  the rationale of the nodes it touches, and the assumption it retires is struck from
  the list.
- The map opens one level deep, with the count of hidden children on each collapsed
  branch, plus expand-all / collapse-all. Borrowed directly from NotebookLM: the first
  view should invite exploration, not present a wall.
- Undo now restores the assumption set as well as the tree.

**Cost.** Mapping without answers means the first map rests on more assumptions —
typically two or three stated up front rather than none. That is the trade: the map
is available immediately, and it is honest about what it had to guess.

---

## v0.3 — planned, Week 2

Candidates, each with the observation that motivated it:

1. **Probe quality is uneven.** Some probes are excellent ("Under your consent basis,
   may you contact someone who started KYC and never finished?"); others restate the
   branch. Add a rule requiring each probe to name the two different maps that the two
   possible answers would produce.
2. **Confidence is compressed toward "medium".** Ask for confidence with a stated
   reason, and require at least one "low" per map, so the scale carries information.
3. **Alternatives sometimes argue for the branch they replace.** Require the trade-off
   to name what the alternative *loses*, not only what it gains.
4. **Branch count is stable at five regardless of brief complexity.** Let the model
   choose 3–7 and justify the count in the summary.

Each candidate will be run against the same evaluation set (`evals/cases.md`) and the
before/after scores reported in the Week 2–3 write-up.

5. **Question ordering is fixed.** The dock asks in the order the model produced. Order
   by how much each answer would change the map, so the first question asked is the one
   worth answering.
