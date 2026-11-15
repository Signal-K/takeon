# AGENTS

## Navigation commit policy

This repository follows the mandatory commit policy for every repository under `~/Navigation`.

- Linear is the task system of record (team Kestloome, prefix `KES`). Find or create the `KES-` issue before editing, keep its status current, and close the loop when the work is pushed: comment with the commit hash, proof and caveats, set it to Done (In Progress if part is unbuilt), and make sure it is in the current cycle. Desk is archived and must not be used.
- Commit only after a coherent ticket outcome or acceptance slice is implemented and verified. Do not create checkpoint, progress, one-file, or speculative commits. One achieved outcome is one commit by default.
- A coding request authorizes the final task commit unless the user explicitly says not to commit. Do not pause solely for routine commit confirmation once the outcome is complete.
- Before committing, inspect `git status --short`, run appropriate checks, stage the complete task from this repository root with `git add .`, then review `git diff --cached` and `git status --short`. Do not hand-pick only a small subset of task files.
- Preserve unrelated user-owned work. Exclude only clearly unrelated changes, secrets, generated caches/build output, or files explicitly excluded by the user, and disclose exclusions in the handoff and the Linear comment.
- Every commit subject must use exactly `🚀🐺 ↝ [KES-299]: Commit message`.
  - Choose two different emoji for each commit. Do not use flags or smiley/human-face reaction emoji; object, symbol, nature, and animal emoji such as `🐺` are allowed.
  - Use the exact `↝` arrow and spacing.
  - Put all ticket keys worked on in one bracket pair, separated by single spaces. Include the active Linear `KES-` key.
  - Describe the achieved outcome concisely after `: `.
- Never bypass the commit-message hook with `--no-verify`.
