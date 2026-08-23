/* ─────────────────────────────────────────────────────────────
   Recorded runs
   These are outputs of the prompt pack above (authored at v0.1, carried
   forward through v0.2), produced with
   Claude (Opus) during the build session on 2026-08-23 and saved
   verbatim so the agent can be demonstrated without an API key.
   Recorded mode replays these; it never invents new content.
   ───────────────────────────────────────────────────────────── */

/* fills the defaults so the case data below stays readable */
function mk(o) {
  return Object.assign({
    why: '', confidence: 'medium', source: 'model',
    alternatives: [], probes: [], children: []
  }, o);
}

const RECORDED = [
  /* ── Case A — product / UX work ───────────────────────────── */
  {
    id: 'kyc',
    label: 'UX research plan',
    brief: {
      topic: 'Plan a UX research study for our fintech app onboarding — new users drop off before finishing KYC and we do not know why.',
      purpose: 'plan',
      audience: 'Product and design team at an early-stage fintech',
      depth: 3
    },
    questions: [
      { id: 'q1', question: 'Is the drop-off concentrated at document upload, or spread across the whole KYC sequence?',
        why: 'Decides whether this is one deep usability study or a funnel-wide diagnostic.',
        suggestions: ['Concentrated at doc upload', 'Spread across steps', "We don't know yet"],
        assumeIfSkipped: "You don't know yet — so the plan starts with a diagnostic week instead of a scripted test.",
        effect: { resolves: 0,
          note: 'Where the loss sits is no longer a guess: branch 1 is now grounded in your answer instead of a default.',
          ops: [{ set: { id: 'n1', source: 'user', confidence: 'high',
            why: 'Grounded in what you told me: {{answer}}. The diagnostic work is scoped to that rather than to the whole funnel.' } }] } },
      { id: 'q2', question: 'Can you talk to people who abandoned, or only to people who completed?',
        why: 'Recruitment changes the method and the timeline more than any other choice here.',
        suggestions: ['We can reach abandoners', 'Only completers', 'Only internal / proxy users'],
        assumeIfSkipped: 'Only completers are reachable, so abandonment gets inferred from behaviour rather than asked about.',
        effect: {
          note: 'Recruitment is the constraint that shapes the method, so branch 2 now follows what you can actually do.',
          ops: [{ set: { id: 'n2', source: 'user', confidence: 'high',
            why: 'Follows your recruitment reality: {{answer}}. Every method under it has to survive that constraint.' } }] } },
      { id: 'q3', question: 'What decision does this research feed — a redesign that is already scoped, or a choice of KYC vendor?',
        why: 'A scoped redesign needs a ranked fix list; a vendor decision needs comparison criteria.',
        suggestions: ['Redesign already scoped', 'Choosing / keeping a vendor', 'Convincing leadership to fund it'],
        assumeIfSkipped: 'A redesign is already scoped, so the study aims at prioritised fixes, not a landscape report.',
        effect: { resolves: 1,
          note: 'Knowing which decision this feeds changes what the study has to deliver, so the last branch is re-aimed at it.',
          ops: [{ set: { id: 'n5', source: 'user', confidence: 'high',
            why: 'Aimed at the decision you named: {{answer}}. Findings that do not move that decision are noise.' } }] } },
      { id: 'q4', question: 'How much of this flow is fixed by the regulator, and how much is yours to change?',
        why: 'Testing a flow you cannot ship is the most common way this study gets wasted.',
        suggestions: ['Most of it is fixed', 'Sequence fixed, UI is ours', 'Largely ours'],
        assumeIfSkipped: 'Sequence and required fields are fixed; wording, ordering within a step and feedback are yours.',
        effect: {
          note: 'The compliance boundary is now yours rather than mine, so the branch is scoped to what you can actually change.',
          ops: [{ set: { id: 'n4', source: 'user', confidence: 'high',
            why: 'Scoped by what you said is changeable: {{answer}}. Testing outside that boundary would waste the round.' } }] } },
      { id: 'q5', question: 'How many weeks before the team needs findings they can act on?',
        why: 'Under two weeks rules out recruiting abandoners and changes the whole design.',
        suggestions: ['About 1 week', '3–4 weeks', 'No fixed date'],
        assumeIfSkipped: '3–4 weeks, which allows one diagnostic week and one round of sessions.',
        effect: {
          note: 'Your timeline decides whether a diagnostic week is affordable, so it is now an open question on branch 1 rather than an assumption.',
          ops: [{ addProbe: { id: 'n1', probe: 'You said the timeline is {{answer}} — does week 1 stay diagnostic, or do you need findings before instrumentation could deliver them?' } }] } }
    ],
    map: {
      title: 'KYC drop-off: a study that survives contact with compliance',
      summary: 'Cut by the four things that can each sink this study — not knowing where the loss is, not being able to reach the people who left, measuring the wrong thing, and testing a flow you are not allowed to ship. The fifth branch is about the findings actually being used.',
      assumptions: [
        "You don't yet know which KYC step loses the most people, so week 1 is diagnostic rather than a scripted usability test.",
        'A redesign is already scoped, so the output is a ranked fix list rather than a landscape review.'
      ],
      root: mk({ id: 'n0', label: 'KYC onboarding drop-off study', source: 'user', confidence: 'high', children: [
        mk({ id: 'n1', label: 'Locate the loss before scripting anything', confidence: 'high', source: 'assumption',
          why: 'You cannot write a task script or recruit a sample for a problem whose location is unknown.',
          alternatives: [
            { label: 'Start with interviews and let the stories locate the break', tradeoff: 'Faster to a narrative, but you will fix the step people remember rather than the one that costs the most.' },
            { label: 'Read support tickets and chat logs first', tradeoff: 'Cheapest signal and already consented, but it over-represents people motivated enough to complain.' }
          ],
          probes: [
            "Do your analytics separate 'upload failed' from 'user gave up before uploading'? If not, that gap decides your first week.",
            'Is drop-off worse on mid-range Android? If yes this may be a camera and file-size problem wearing a UX costume.'
          ],
          children: [
            mk({ id: 'n1a', label: 'Event audit: one event per KYC step, per document type', confidence: 'high', why: 'Most KYC funnels log the step but not the failure reason, which is the number you actually need.' }),
            mk({ id: 'n1b', label: 'Split the funnel by device tier, ID type and returning vs new', confidence: 'medium', why: 'Aggregate drop-off hides the segment that is actually failing.' }),
            mk({ id: 'n1c', label: 'Session replay of abandoned attempts, where consent allows', confidence: 'medium', source: 'assumption', why: 'The only way to watch abandonment without recruiting anyone — if your consent basis covers it.' })
          ] }),
        mk({ id: 'n2', label: 'Reaching people who left', confidence: 'high', source: 'assumption',
          why: 'Completers are exactly the people the flow did not stop; a study built on them answers the wrong question.',
          alternatives: [
            { label: 'Study completers only and infer the barrier', tradeoff: 'Ethically and legally simplest, but survivorship bias is baked into every finding.' },
            { label: 'Panel of people who abandoned some other fintech onboarding', tradeoff: 'Fast and clean consent, but their reasons belong to a different product.' }
          ],
          probes: [
            'Under your current consent basis, may you contact someone who started KYC and never finished? That single answer decides the recruitment plan.',
            'What could you offer an abandoner that does not feel like the company that just rejected them asking for a favour?'
          ],
          children: [
            mk({ id: 'n2a', label: 'One-question exit intercept at the moment of abandonment', confidence: 'medium', why: 'Catches intent while it is live; low effort, but the sample skews to people willing to answer anything.' }),
            mk({ id: 'n2b', label: 'Re-contact partially completed sign-ups — check the legal basis first', confidence: 'medium', source: 'assumption', why: 'The highest-signal sample you can get, and the one most likely to be blocked by privacy counsel.' }),
            mk({ id: 'n2c', label: 'Proxy users with a rehearsal script — smoke test only', confidence: 'low', why: 'Use it to find the broken parts of your own script, never as evidence about real abandonment.' })
          ] }),
        mk({ id: 'n3', label: 'What counts as success', confidence: 'high', source: 'model',
          why: 'Completion rate alone will reward a flow that pushes people through a step they do not understand.',
          alternatives: [
            { label: 'Benchmark usability test with a standard questionnaire', tradeoff: 'Comparable across rounds and easy to report, but it will not tell you which step to fix.' },
            { label: 'Instrument only, no sessions', tradeoff: 'Cheap and continuous, and you will see exactly where they leave and never why.' }
          ],
          probes: ['If completion went up but support contacts also went up, would you still call the redesign a win?'],
          children: [
            mk({ id: 'n3a', label: 'Unassisted verified account as the task-success bar', confidence: 'high', why: 'Assisted completion in a lab hides the exact friction you are hunting.' }),
            mk({ id: 'n3b', label: 'Time to first blocker, not total time on task', confidence: 'medium', why: 'Total time flatters flows where people quietly struggle at the end.' }),
            mk({ id: 'n3c', label: 'Recovery rate after a rejected document', confidence: 'high', why: 'Rejection handling is where most KYC funnels lose people permanently.' })
          ] }),
        mk({ id: 'n4', label: 'The compliance boundary', confidence: 'medium', source: 'assumption',
          why: 'Half of what looks like bad UX here is a field someone believes is mandatory. Some of those beliefs are wrong.',
          alternatives: [
            { label: 'Design freely, clear it with compliance at the end', tradeoff: 'Preserves creative range, at the risk of testing a flow you can never ship.' },
            { label: 'Treat the whole flow as fixed and study only wording', tradeoff: 'Safe and quick, and it caps the size of any improvement you can find.' }
          ],
          probes: ['Which fields in this flow has anyone traced to an actual regulation this year, rather than inherited from the first version?'],
          children: [
            mk({ id: 'n4a', label: 'Field-by-field trace: which rule requires this, in what form', confidence: 'medium', why: 'Turns a vague "compliance says so" into a list you can negotiate against.' }),
            mk({ id: 'n4b', label: 'Bring compliance into the review before the sessions, not after', confidence: 'high', why: 'Late compliance review is the standard way a research finding dies quietly.' }),
            mk({ id: 'n4c', label: 'Design the failure path for IDs that will never verify', confidence: 'medium', why: 'Every KYC flow has these users; most products leave them in a dead end.' })
          ] }),
        mk({ id: 'n5', label: 'Getting the findings used', confidence: 'medium', source: 'model',
          why: 'A ranked fix list only moves if the people who prioritise saw the failure with their own eyes.',
          alternatives: [
            { label: 'Write and circulate a report', tradeoff: 'Durable and citable, and typically read once.' },
            { label: 'Engineers observe sessions live, no report', tradeoff: 'Findings land immediately, but only what those two people saw survives the month.' }
          ],
          probes: ['Who has to say yes for a fix to ship — and will they see any of this research first-hand?'],
          children: [
            mk({ id: 'n5a', label: 'Score by severity × how many users hit it, tied to funnel loss', confidence: 'high', why: 'Ranking by funnel cost is the language the redesign scope is already written in.' }),
            mk({ id: 'n5b', label: 'Two abandonment clips, ten minutes, with the exec sponsor in the room', confidence: 'medium', why: 'One watched clip generally outperforms a whole findings deck.' })
          ] })
      ] })
    },
    /* one recorded refinement, keyed to the probe the user answers */
    refinements: [{
      probeId: 'n1',
      question: "Do your analytics separate 'upload failed' from 'user gave up before uploading'?",
      answer: "No — we only log a single kyc_step_exit event with no reason attached.",
      note: 'Your logging cannot tell failure from abandonment, so a diagnostic week is no longer optional: instrumentation moves ahead of everything and the exit intercept gets promoted, because it is the only reason-capture you can ship this week.',
      ops: [
        { set: { id: 'n1', label: 'Instrument first — week 0 is not optional', confidence: 'high', source: 'user',
          why: 'You confirmed there is one exit event with no reason, so nothing downstream can be planned until failure and abandonment are distinguishable.' } },
        { set: { id: 'n1a', label: 'Add a failure-reason field to the upload event', confidence: 'high', source: 'user',
          why: 'The single change that converts your existing funnel into a diagnostic instrument.' } },
        { add: { parentId: 'n1', node: mk({ id: 'n1d', label: 'Ship a one-week logging patch before recruiting anyone', confidence: 'high', source: 'user',
          why: 'Recruiting now would spend your only round of sessions on a question the logs could answer for free.' }) } },
        { set: { id: 'n2a', label: 'Exit intercept — now the fastest reason-capture you have', confidence: 'high', source: 'user',
          why: 'With no reason in the logs, one question at the moment of abandonment becomes the highest-value thing you can ship this week.' } },
        { addProbe: { id: 'n1', probe: 'If the logging patch shows the loss is at document capture rather than the form, are you prepared to make the camera step the whole study?' } }
      ]
    }],
    /* one recorded branch expansion */
    deepen: {
      nodeId: 'n2',
      children: [
        mk({ id: 'n2d', label: 'Ask the KYC vendor for their aggregate rejection reasons', confidence: 'medium', why: 'Vendors sit on the reason codes your logs are missing, and rarely volunteer them.' }),
        mk({ id: 'n2e', label: 'Recruit through the rejection email itself', confidence: 'medium', source: 'assumption', why: 'The one message an abandoner definitely received; needs compliance sign-off on wording.' }),
        mk({ id: 'n2f', label: 'Pay for a full quota of abandoners before knowing the segment', confidence: 'low', why: 'Considered and rejected: only worth it once the funnel split tells you which segment to buy.' })
      ]
    }
  },

  /* ── Case B — business / startup strategy ─────────────────── */
  {
    id: 'gtm',
    label: 'Go-to-market plan',
    brief: {
      topic: 'Go-to-market for a campus food delivery app we are launching next semester.',
      purpose: 'plan',
      audience: 'Two-person founding team, students themselves',
      depth: 3
    },
    questions: [
      { id: 'q1', question: 'Are you delivering from restaurants, from campus canteens, or from home cooks?',
        why: 'Supply model decides margin, regulation and who you have to convince first.',
        suggestions: ['Restaurants near campus', 'Campus canteens', 'Home cooks / cloud kitchens'],
        assumeIfSkipped: 'Restaurants near campus — the plan assumes an aggregator model.',
        effect: { resolves: 0,
          note: 'What you are aggregating decides margin and who you have to convince, so the supply branch follows your answer.',
          ops: [{ set: { id: 'm2', source: 'user', confidence: 'high',
            why: 'Built on your supply model: {{answer}}. Margin, regulation and the first sales conversation all follow from it.' } }] } },
      { id: 'q2', question: 'One campus you intend to dominate, or several at once?',
        why: 'Density is the only advantage a campus player has over an incumbent; spreading gives it away.',
        suggestions: ['One campus, deep', 'Two or three nearby', 'City-wide from day one'],
        assumeIfSkipped: 'One campus first, depth over coverage.',
        effect: { resolves: 1,
          note: 'Coverage is the decision the whole plan hangs on, so the wedge branch is sized to what you said.',
          ops: [{ set: { id: 'm1', source: 'user', confidence: 'high',
            why: 'Sized to your coverage decision: {{answer}}. Density is the only advantage a campus player has, and this is how much of it you keep.' } }] } },
      { id: 'q3', question: 'Who pays for delivery — the student, the restaurant, or you for now?',
        why: 'This sets the unit economics that every other decision in the map has to survive.',
        suggestions: ['Student pays a small fee', 'Restaurant commission only', 'We subsidise to start'],
        assumeIfSkipped: 'Student pays a small fee, partly subsidised at launch.',
        effect: {
          note: 'Who pays sets the unit economics every other branch has to survive, so branch 3 starts from your answer.',
          ops: [{ set: { id: 'm3', source: 'user', confidence: 'high',
            why: 'Starts from who pays: {{answer}}. Every cost lever below is judged against that.' } }] } },
      { id: 'q4', question: 'What can you do on this campus that the incumbent apps cannot?',
        why: 'If the honest answer is "nothing yet", the first job is finding one, not marketing.',
        suggestions: ['Cheaper for students', 'Faster inside campus gates', 'Menus they do not carry', 'Nothing durable yet'],
        assumeIfSkipped: 'Nothing durable yet — so the plan treats finding the wedge as work, not as a given.',
        effect: { resolves: 2,
          note: 'Your edge has to be visible in the product, so the exclusivity node now carries it explicitly.',
          ops: [{ set: { id: 'm2b', source: 'user', confidence: 'high',
            why: 'Your stated edge: {{answer}}. If a student cannot feel this in the first order, it is not an edge yet.' } }] } }
    ],
    map: {
      title: 'Campus delivery: win one dinner window before winning a campus',
      summary: 'Cut by the sequence that actually decides survival — pick a wedge narrow enough to dominate, lock supply before demand, make one delivery pay for itself, then buy attention with channels that cost time rather than money. The last branch is what kills it.',
      assumptions: [
        'Aggregating nearby restaurants rather than canteens or home cooks.',
        'One campus first: the plan optimises for density, not coverage.',
        'No durable advantage over incumbents yet, so finding one is treated as the first job.'
      ],
      root: mk({ id: 'm0', label: 'Campus food delivery — go to market', source: 'user', confidence: 'high', children: [
        mk({ id: 'm1', label: 'A wedge narrow enough to actually own', confidence: 'high', source: 'assumption',
          why: 'Against a funded incumbent, the only winnable game is being the obvious choice for one group at one time of day.',
          alternatives: [
            { label: 'Launch three campuses at once to look like a network', tradeoff: 'Better investor story, and you will be second-best everywhere, which kills word of mouth.' },
            { label: 'Start with one hostel block as a closed beta', tradeoff: 'Tightest feedback loop, but the volume stays too small for restaurants to take you seriously.' }
          ],
          probes: [
            'What number, by what date, would tell you the wedge failed rather than needed more time?',
            'Which meal do students on this campus complain about most? That complaint is your wedge, not the meal with the biggest market.'
          ],
          children: [
            mk({ id: 'm1a', label: 'Choose the campus by hostel density within 1 km, not by size', confidence: 'high', why: 'Delivery economics are decided by walking distance between drops, not by enrolment.' }),
            mk({ id: 'm1b', label: 'Own dinner 8–11pm before touching lunch', confidence: 'medium', why: 'Late dinner is where campus demand concentrates and where incumbents are slowest.' }),
            mk({ id: 'm1c', label: 'Define "dominant" numerically before launch', confidence: 'medium', source: 'assumption', why: 'Without a number, every result looks like progress.' })
          ] }),
        mk({ id: 'm2', label: 'Supply before demand', confidence: 'high', source: 'model',
          why: 'Students leave permanently after one bad first order, so the menu has to be right before anyone is invited.',
          alternatives: [
            { label: 'List everything, sort quality out later', tradeoff: 'Fills the app fast, and spends your one first impression on your worst restaurant.' },
            { label: 'Run your own single-menu kitchen', tradeoff: 'Margin and consistency become yours; so does a restaurant business you did not intend to start.' }
          ],
          probes: ['If two restaurants supply most of your orders, what is your plan for the week one of them leaves?'],
          children: [
            mk({ id: 'm2a', label: 'Sign the 8–12 places students already name, not the 30 that will sign fastest', confidence: 'high', why: 'Demand follows names people already trust; a long tail of unknown listings adds nothing.' }),
            mk({ id: 'm2b', label: 'One dish or price available only through you', confidence: 'medium', why: 'Without exclusivity you are a worse version of an app they already have installed.' }),
            mk({ id: 'm2c', label: 'Check peak kitchen capacity, not just willingness', confidence: 'medium', why: 'The restaurant that says yes may already be at its limit exactly when you need it.' })
          ] }),
        mk({ id: 'm3', label: 'Make one delivery pay for itself', confidence: 'high', source: 'assumption',
          why: 'A subsidised order is a marketing expense; if it never converges, growth is just a faster way to run out of money.',
          alternatives: [
            { label: 'Pickup points instead of door delivery', tradeoff: 'Removes the hardest cost line, and puts you in competition with walking.' },
            { label: 'Charge restaurants a flat monthly listing fee', tradeoff: 'Predictable revenue that does not scale with orders, and a harder first sale.' }
          ],
          probes: [
            'At what basket size does a delivery stop losing money — and does your menu even contain baskets that size?',
            'Would students accept a 10-minute wait for a batched order in exchange for no fee?'
          ],
          children: [
            mk({ id: 'm3a', label: 'Student riders between classes vs dedicated riders', confidence: 'medium', why: 'Cheaper and more flexible, but availability collapses exactly at exam time.' }),
            mk({ id: 'm3b', label: 'Batching orders to the same hostel is the only real lever', confidence: 'high', why: 'Nothing else moves cost per delivery as much at campus distances.' }),
            mk({ id: 'm3c', label: 'Write down the cost per delivery this week, before any growth', confidence: 'high', source: 'assumption', why: 'The number is easier to fix at 20 orders a day than at 200.' })
          ] }),
        mk({ id: 'm4', label: 'The first 500 students', confidence: 'medium', source: 'model',
          why: 'Campus demand is won in the channels students already use, which are mostly free and mostly not advertising.',
          alternatives: [
            { label: 'Paid social targeted to the campus radius', tradeoff: 'Scales without people, and rarely pays back on a small average order.' },
            { label: 'Sponsor a campus event for launch volume', tradeoff: 'One good spike and useful footage; retention from event traffic is usually poor.' }
          ],
          probes: ['Which of these can you run with zero budget — and what stops it working by week three?'],
          children: [
            mk({ id: 'm4a', label: 'Hostel WhatsApp groups timed to mess closing', confidence: 'high', why: 'The message lands at the moment the need appears, which is worth more than reach.' }),
            mk({ id: 'm4b', label: 'One paid ambassador per hostel block', confidence: 'medium', why: 'Distribution that maps exactly onto your delivery geography.' }),
            mk({ id: 'm4c', label: 'Referral paid in food, not cash', confidence: 'medium', why: 'Keeps the reward inside the product and costs you margin rather than money.' })
          ] }),
        mk({ id: 'm5', label: 'What kills this', confidence: 'medium', source: 'model',
          why: 'Campus businesses fail on a small number of predictable events; naming them early is cheaper than reacting.',
          alternatives: [
            { label: 'Ignore incumbents and focus on your own execution', tradeoff: 'Keeps the team focused, and leaves you with no plan for the month they discount your campus.' }
          ],
          probes: ['Which of these would you not survive — and what is the cheapest early warning you could set up for it?'],
          children: [
            mk({ id: 'm5a', label: 'An incumbent drops fees on your campus for a month', confidence: 'low', why: 'Unlikely early, fatal if it lands before you have habit.' }),
            mk({ id: 'm5b', label: 'Exams and holidays: roughly a quarter of the year near zero', confidence: 'high', why: 'Cash planning that assumes 12 trading months will break in the third month.' }),
            mk({ id: 'm5c', label: 'One food-safety incident', confidence: 'medium', why: 'On a closed campus, reputation moves faster than any refund policy.' })
          ] })
      ] })
    },
    refinements: [{
      probeId: 'm1',
      question: 'What number, by what date, would tell you the wedge failed rather than needed more time?',
      answer: 'If we are under 200 orders a week by week 8, we stop and rethink.',
      note: '200 orders by week 8 becomes the spine of the plan: the wedge branch is now a stated target, and the growth branch is re-cut around what has to be true weekly to reach it, rather than around channels in general.',
      ops: [
        { set: { id: 'm1', label: 'The wedge: 200 orders a week by week 8', confidence: 'high', source: 'user',
          why: 'Your kill number, stated up front, so every other branch is judged against it.' } },
        { set: { id: 'm1c', label: 'Weekly target ladder: 25 → 60 → 120 → 200', confidence: 'high', source: 'user',
          why: 'Breaks your week-8 number into a figure you can miss early enough to react to.' } },
        { add: { parentId: 'm1', node: mk({ id: 'm1d', label: 'Week-4 checkpoint: under 60 means the wedge is wrong, not the marketing', confidence: 'medium', source: 'user',
          why: 'Separates a demand problem from an awareness problem while there is still time to change one.' }) } },
        { set: { id: 'm4', label: 'Getting to 200 a week', confidence: 'high', source: 'user',
          why: 'Re-cut from "channels we could use" to "what has to be true each week to hit your number".' } },
        { addProbe: { id: 'm3', probe: 'At 200 orders a week, does your cost per delivery reach break-even — or does hitting the target make the losses bigger?' } }
      ]
    }],
    deepen: {
      nodeId: 'm3',
      children: [
        mk({ id: 'm3d', label: 'Minimum order value tuned to the batching radius', confidence: 'medium', why: 'The simplest lever that lifts basket size without touching the menu.' }),
        mk({ id: 'm3e', label: 'Rider pay per batch rather than per order', confidence: 'medium', source: 'assumption', why: 'Aligns the rider with the only cost lever you have; needs care to stay fair at low volume.' }),
        mk({ id: 'm3f', label: 'Free delivery on everything, funded from commission', confidence: 'low', why: 'Considered and rejected for now: it only works once commission per order clears the true delivery cost.' })
      ]
    }
  },

  /* ── Case C — learning / study planning ───────────────────── */
  {
    id: 'ml12',
    label: 'Learning plan',
    brief: {
      topic: 'Help me learn machine learning in 12 weeks. I am a working software engineer with evenings free.',
      purpose: 'learn',
      audience: 'Myself — backend engineer, five years experience',
      depth: 3
    },
    questions: [
      { id: 'q1', question: 'At week 12, what do you want to be able to do — ship a model at work, pass interviews, or read papers?',
        why: 'These three goals share maybe a third of their content; picking one doubles the useful hours.',
        suggestions: ['Ship something at work', 'Pass ML interviews', 'Read and follow papers'],
        assumeIfSkipped: 'Ship a working model at work — the plan optimises for applied delivery.',
        effect: { resolves: 0,
          note: 'The exit test is what the twelve weeks are built around, so branch 1 now states yours.',
          ops: [{ set: { id: 'p1', source: 'user', confidence: 'high',
            why: 'Your exit test: {{answer}}. Every checkpoint below is a step towards that and nothing else.' } }] } },
      { id: 'q2', question: 'Honestly, how many hours a week, and are they one block or scattered evenings?',
        why: 'Scattered hours rule out the long-project formats most curricula assume.',
        suggestions: ['4–6, scattered', '6–8, scattered', '10+, weekend blocks'],
        assumeIfSkipped: '6–8 hours across scattered evenings.',
        effect: { resolves: 1,
          note: 'The plan now assumes the hours you actually have rather than an idealised week.',
          ops: [{ set: { id: 'p5', source: 'user', confidence: 'high',
            why: 'Planned around the time you actually have: {{answer}}. The unit of work is sized to fit it.' } }] } },
      { id: 'q3', question: 'What is already solid — Python, linear algebra, statistics?',
        why: 'The maths branch is either two weeks or six depending on this answer.',
        suggestions: ['Python solid, maths rusty', 'Both solid', 'Python solid, no maths since school'],
        assumeIfSkipped: 'Python solid, maths rusty — refresh only where it blocks you.',
        effect: {
          note: 'Maths is either two weeks or six depending on where you start, so that branch is scoped to your answer.',
          ops: [{ set: { id: 'p2', source: 'user', confidence: 'high',
            why: 'Scoped to your starting point: {{answer}}. Anything you already have is not revised.' } }] } },
      { id: 'q4', question: 'Is there a real dataset or problem at work you could attach this to?',
        why: 'A real problem changes retention more than any course choice on this list.',
        suggestions: ['Yes, with permission', 'Maybe, needs asking', 'No — use a public dataset'],
        assumeIfSkipped: 'No — the plan supplies a public dataset project instead.',
        effect: { resolves: 2,
          note: 'A real dataset changes more of this plan than any course choice, so the project branch is anchored to your answer.',
          ops: [{ set: { id: 'p3', source: 'user', confidence: 'high',
            why: 'Anchored to: {{answer}}. The whole twelve weeks runs on this one problem.' } }] } }
    ],
    map: {
      title: 'Twelve weeks to a model you actually shipped',
      summary: 'Cut around the four reasons engineers stall on ML rather than around topics: no defined exit, maths taken in the wrong order, project churn, and the unglamorous parts nobody teaches. The last branch is about surviving all twelve weeks.',
      assumptions: [
        'The goal is shipping applied work rather than interviews or paper-reading.',
        'Roughly 6–8 scattered evening hours a week.',
        'No work dataset available, so the plan supplies its own project.'
      ],
      root: mk({ id: 'p0', label: 'Learn ML in 12 weeks', source: 'user', confidence: 'high', children: [
        mk({ id: 'p1', label: 'Decide the exit test in week 1', confidence: 'high', source: 'assumption',
          why: 'Without a stated week-12 artefact, "learning ML" expands to fill twelve weeks and produces nothing you can point at.',
          alternatives: [
            { label: 'Follow one course syllabus end to end', tradeoff: 'Momentum and complete coverage, and at week 12 you know what was taught rather than what you can build.' },
            { label: 'Replicate one paper', tradeoff: 'Deep and impressive, and weeks 1–4 feel like failure, which is when most people quit.' }
          ],
          probes: [
            'If you could only prove one thing at week 12, which would it be?',
            'Would your manager count this as work time if it produced something the team used?'
          ],
          children: [
            mk({ id: 'p1a', label: 'Write the week-12 artefact down now, in one sentence', confidence: 'high', why: 'It converts a vague goal into something that can be finished.' }),
            mk({ id: 'p1b', label: 'Checkpoints at week 4 and week 8, each something that runs', confidence: 'high', why: 'Running code at a fixed date is the only reliable measure of progress here.' }),
            mk({ id: 'p1c', label: 'Kill criterion: a week with no runnable output means the plan is wrong', confidence: 'medium', why: 'Distinguishes a bad plan from a lack of discipline, which is the usual misdiagnosis.' })
          ] }),
        mk({ id: 'p2', label: 'Maths, only where it bites', confidence: 'medium', source: 'assumption',
          why: 'You need enough to debug, not enough to derive; the usual ordering spends your whole budget before anything trains.',
          alternatives: [
            { label: 'Full maths foundation first, about eight weeks', tradeoff: 'You will never be blocked later, and two-thirds of the twelve weeks are gone before you train a model.' },
            { label: 'Skip maths entirely, stay at library level', tradeoff: 'Fastest to a working model, with a hard ceiling the first time the results look wrong.' }
          ],
          probes: ['When a result looks wrong, do you want to be able to diagnose it yourself, or is asking someone acceptable for now?'],
          children: [
            mk({ id: 'p2a', label: 'Matrix shapes and what breaks when they mismatch', confidence: 'high', why: 'The single most common source of errors in the first month.' }),
            mk({ id: 'p2b', label: 'Likelihood, priors, and why models are confidently wrong', confidence: 'medium', why: 'Explains calibration failures you will otherwise treat as bugs.' }),
            mk({ id: 'p2c', label: 'Defer calculus and analysis until something forces them', confidence: 'medium', why: 'Learning them on demand is efficient; learning them upfront is where plans die.' })
          ] }),
        mk({ id: 'p3', label: 'One project, carried the whole way', confidence: 'high', source: 'assumption',
          why: 'Problems that only appear in week 6 — leakage, drift, messy labels — are the ones worth meeting, and a new project every fortnight never reaches them.',
          alternatives: [
            { label: 'A different small project every two weeks', tradeoff: 'Broader exposure and a fuller portfolio, and you never hit the interesting failures.' },
            { label: 'Kaggle competitions', tradeoff: 'Clean data and fast feedback, and you skip the part of the job that is actually hard.' }
          ],
          probes: [
            'Is there data at work you could get permission to use? That one answer would change most of this plan.',
            'What would make this project useful to someone other than you?'
          ],
          children: [
            mk({ id: 'p3a', label: 'Pick data from a domain you already understand', confidence: 'high', why: 'Domain knowledge is what lets you spot a wrong result; without it you cannot tell good from broken.' }),
            mk({ id: 'p3b', label: 'Dumbest baseline that could work, by week 2', confidence: 'high', why: 'A baseline turns every later week into a comparison instead of a hope.' }),
            mk({ id: 'p3c', label: 'Same project four times: baseline → features → proper model → deployed', confidence: 'medium', why: 'Repetition on one problem is what converts tutorials into judgement.' })
          ] }),
        mk({ id: 'p4', label: 'The parts nobody teaches', confidence: 'high', source: 'model',
          why: 'Most applied failures are data and evaluation problems, not model-choice problems.',
          alternatives: [
            { label: 'Focus on architectures and current papers', tradeoff: 'Interview-friendly at senior level, and rarely what blocks a model from shipping.' }
          ],
          probes: ['Ship or interview? The two reading lists diverge around week 6.'],
          children: [
            mk({ id: 'p4a', label: 'Leakage and messy labels — where real failures live', confidence: 'high', why: 'A leaked feature produces a great score and a useless model.' }),
            mk({ id: 'p4b', label: 'Pick the metric that matches the decision being made', confidence: 'high', why: 'Accuracy on imbalanced data is the classic way to be confidently wrong.' }),
            mk({ id: 'p4c', label: 'Put it behind an API and watch it drift', confidence: 'medium', why: 'Deployment is where an engineer already has an advantage worth using.' })
          ] }),
        mk({ id: 'p5', label: 'Staying on it for twelve weeks', confidence: 'medium', source: 'model',
          why: 'The plan will not fail on content; it will fail in week 5 on a busy evening.',
          alternatives: [
            { label: 'Cohort course with deadlines', tradeoff: 'External accountability works well, and you inherit their pace and their project.' },
            { label: 'Study group with peers', tradeoff: 'Motivating and social, and it moves at the speed of the least available person.' }
          ],
          probes: ['Which past learning attempt died, and in which week? Plan around that failure mode specifically.'],
          children: [
            mk({ id: 'p5a', label: 'Fixed slot, small unit: 45 minutes beats a heroic Sunday', confidence: 'medium', why: 'Scattered evenings reward small repeatable units over long blocks.' }),
            mk({ id: 'p5b', label: 'Public log of what ran and what broke', confidence: 'medium', why: 'Writing the failure down is what turns it into knowledge rather than frustration.' }),
            mk({ id: 'p5c', label: 'One person who asks what you shipped', confidence: 'medium', source: 'assumption', why: 'Cheapest accountability that survives a bad week.' })
          ] })
      ] })
    },
    refinements: [{
      probeId: 'p3',
      question: 'Is there data at work you could get permission to use?',
      answer: 'Yes — support ticket text, if I anonymise it first.',
      note: 'A real work dataset changes the plan: the project branch is now built on your support tickets, text handling moves in ahead of general tabular work, and anonymisation becomes week-1 work rather than an afterthought.',
      ops: [
        { set: { id: 'p3', label: 'One project: support-ticket triage on your own data', confidence: 'high', source: 'user',
          why: 'You have real text data with permission, which beats any public dataset for both learning and usefulness.' } },
        { set: { id: 'p3a', label: 'Anonymise and sample the tickets — week 1 work', confidence: 'high', source: 'user',
          why: 'Permission depends on it, and doing it first prevents a rebuild in week 6.' } },
        { set: { id: 'p3b', label: 'Baseline: keyword rules on ticket text, week 2', confidence: 'high', source: 'user',
          why: 'On text, a rules baseline is often uncomfortably competitive — which is exactly the lesson.' } },
        { add: { parentId: 'p2', node: mk({ id: 'p2d', label: 'Text representation before anything fancier: counts, TF-IDF, embeddings', confidence: 'high', source: 'user',
          why: 'Your data is text, so this moves ahead of the general tabular material.' }) } },
        { set: { id: 'p4a', label: 'Leakage in ticket data: resolution notes written after the fact', confidence: 'high', source: 'user',
          why: 'The specific leak your dataset will have, and the one most likely to fool you.' } },
        { addProbe: { id: 'p3', probe: 'If the model is only as good as your keyword rules at week 8, is that a failure — or a finding worth shipping?' } }
      ]
    }],
    deepen: {
      nodeId: 'p1',
      children: [
        mk({ id: 'p1d', label: 'Artefact option: an internal tool a colleague uses weekly', confidence: 'high', why: 'Usage by someone else is the hardest bar and the most convincing evidence.' }),
        mk({ id: 'p1e', label: 'Artefact option: a written post-mortem of one model that failed', confidence: 'medium', source: 'assumption', why: 'Cheaper to finish and unusually persuasive to hiring managers.' }),
        mk({ id: 'p1f', label: 'Artefact option: a certificate', confidence: 'low', why: 'Considered and rejected: it proves attendance rather than capability, useful only where HR filters on it.' })
      ]
    }
  }
];
