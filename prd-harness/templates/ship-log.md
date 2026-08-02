---
artefact: ship-log
title: "{{title}}"
created: "{{date}}"
---

# {{title}} — Ship Log

Chronological record of what shipped, newest first. Distinct from
`.harness/ledger/*.md` (a fine-grained event log): this is the human-readable release
history. One row per ship/deploy/handoff.

| Version / Date | Change summary | Reason | Owner | Validation status | Known limitations | Follow-ups |
| -------------- | -------------- | ------ | ----- | ----------------- | ----------------- | ---------- |
| {{date}} · v0.0.0 | project initialized | scaffolded by prd-harness | Agent | n/a | none | run Stage 0 → G1 |
