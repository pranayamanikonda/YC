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

## Rollback
<!-- Per-unit: how to revert if it fails verification. -->
