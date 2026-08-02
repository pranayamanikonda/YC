---
stage: 1-definition
title: "{{title}}"
created: "{{date}}"
---

# {{title}} — Epics

<!--
One section per epic. Stories nest under epics; each story lists its acceptance
criteria by id (AC-NNN). The same rows are exported to backlog.xlsx.
-->

## EPIC-01 — <name>
- **Goal:** <the outcome this epic delivers>
- **Priority:** must | should | could | won't
- Stories:
  - **STORY-01.1** — As a <role>, I want <capability>, so that <benefit>.
    - AC: AC-001, AC-002

## EPIC-02 — <name>
- **Goal:**
- **Priority:**
- Stories:
  - **STORY-02.1** — …
    - AC: AC-003

HANDOFF
  from: 1-definition
  status: ready
  produced: [definition/epics.md, definition/backlog.xlsx, definition/acceptance-criteria.md]
  next: 2-ia
