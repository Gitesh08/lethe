---
inclusion: manual
---

# Lethe sleep (memory consolidation)

Run this when the user types /lethe-sleep. Use the lethe MCP tools with `workspacePath` set to the absolute workspace root. Report the numbers as returned.

1. Call `lethe_detect_contradictions`. List each axis, both ids, and the resolution.
2. Call `lethe_consolidate_sleep` with `apply: false`. Present `archived`, `merged`, `demoted`, `tokensBefore`, `tokensAfter`, `budgetStatus`, `pbtGate`, and any `diagnostics`. Retention and reinforcement figures are estimated utility, not proof that a rule is useful.
3. If `diagnostics` has FIRST_SEEN_SYNTHESISED, say that those rules have not started decaying yet and suggest `node packages/lethe-mcp/dist/lethe.mjs adopt --workspace . --apply`.
4. Ask the user to confirm. Only when `pbtGate` is `passed` and the user says yes, call `lethe_consolidate_sleep` again with `apply: true`.
5. Never pass `skipGate` together with `apply`.
6. After applying, report `applied` and `backupPath`. Explain that a buried rule can be restored with `lethe_resurrect_engram`: first with `apply: false` to show the matches, then with `apply: true` after confirmation.
