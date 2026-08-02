# Rule: Workflow

- The pipeline is the 8-stage graph in `process.md`. Do not invent stages or skip a gate.
- Resolve the size tier first; run only the stages in that tier's phase mask.
- One stage owns one artifact set. If a stage cannot state its output in one line, it is
  doing too much — split it.
- Read the prior HANDOFF and named artifacts before starting a stage. Never rely on
  conversation memory for state that belongs in a file.
- Write to the ledger continuously, not at the end. Assume compaction mid-stage.
- Stop at G1, G2, G3 for human approval. Between gates, advance without stopping.
