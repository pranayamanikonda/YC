# Exec Plan: <feature>

- **Stage:** 6-engineering
- **Tier:** {{tier}}
- **Source:** definition/acceptance-criteria.md

## Work units (DAG)
<!--
Each unit: id, deps, acceptance ids, tier. Units with no deps are Layer 0 and run
in parallel. The reviewer of a unit is never its implementer.
-->
| id | depends on | acceptance | tier | owner |
| -- | ---------- | ---------- | ---- | ----- |
| WU-1 | — | AC-001 | small | implementer |
| WU-2 | WU-1 | AC-002 | small | implementer |

## Sequencing
- Layer 0: WU-1
- Layer 1: WU-2

## Testing seam
<!--
Name the ONE seam where these units are tested. Prefer an existing seam over a new
one; a single integration point beats many. Every AC traces to a test at this seam.
-->
- Seam: <module / interface / boundary under test>
- Existing tests to extend: <path or "none — new seam, justified below">

## Rollback
<!-- Per-unit: how to revert if it fails verification. -->
