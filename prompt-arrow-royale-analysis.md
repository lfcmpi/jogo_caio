## Prompt Engineering Report

**Effectiveness Confidence:** 8.5/10

**Key Optimizations Applied:**

1. **Schema-first architecture** — Data structures defined before behavior. The model generates code from mental data models; giving schemas upfront prevents ad-hoc structures and ensures consistency between server and client.

2. **Explicit formulas as JavaScript code** — The shrink formula, movement normalization, spawn positions, and scoring are given as code snippets, not English descriptions. This eliminates the #1 predicted failure mode (model writing `*= 0.95` instead of subtraction).

3. **Section markers with completeness mandate** — Every section of both files is named and required. The "COMPLETE FILES" rule + markers prevent the model's strongest truncation tendency (typically around line 600-800 of generated code).

4. **Canvas drawing pseudocode for tombstone** — The "peeing stick figure" is the highest-risk creative element (RLHF refusal + ambiguity). By providing explicit canvas coordinates (arc, lineTo, etc.), the instruction becomes mechanical reproduction, not creative interpretation.

5. **State machine as visual grammar** — `lobby → test → playing → ended` with reset arrows eliminates all phase transition ambiguity in 3 lines vs. 3 paragraphs of prose.

6. **Constants block as copy-paste anchor** — All game-tuning values in one JavaScript block. The model copies this verbatim rather than inventing values scattered through the code.

7. **Inline security at point of use** — "textContent ONLY" appears at the DOM section AND in critical rules, not in a separate security section the model would skip. `helmet()` is in the Express setup section, not a footnote.

8. **GM identity via URL parameter** — Eliminates the "first connected player" antipattern that breaks on disconnect/reconnect. Simple, stateless, implementable in 2 lines.

9. **Simplified holdout rooms** — Reduced from "rectangular rooms with wall collision and doors" to "spawn positions on perimeter ring with distance-based movement clamping." This cuts ~200 lines of collision code while preserving the gameplay intent.

10. **Fireball color mapping table** — Explicit `FIREBALL_COLORS` array with index formula (`damage - 2`) prevents the guaranteed off-by-one error in rainbow color assignment.

---

**Failure Modes Defended Against:**

- **XSS via innerHTML** — Explicit ban on innerHTML with textContent mandate repeated at every DOM section and in final rules
- **Shrink formula using multiplication instead of subtraction** — Explicit code snippet with comment "NOT multiplication"
- **Diagonal speed exploit (sqrt(2) faster)** — Explicit normalization code provided + called out in critical rules
- **File truncation** — Section markers + "DO NOT truncate" instruction + every section explicitly named
- **Spawn position amnesia on reset** — Schema defines spawnX/spawnY as "set once, never modified" + critical rule #5
- **Scoring hardcoded to 40** — Critical rule #9 specifies N = actual player count
- **GM panel visible to regular players** — Explicit `isGM` check + "hidden for regular players" instruction
- **Power-up spawn outside shrunk battlefield** — Explicit: "inner circle = half of CURRENT radius"
- **Rate limiting blocking legitimate play** — Client-side aim throttle to 20/sec specified, server budget at 60/sec
- **Tombstone creative refusal** — Mechanical canvas drawing coordinates provided, not narrative description
- **Disconnect handling undefined** — Explicit: "disconnect during playing = death"
- **View culling exemption for GM** — GM has no player object, state broadcast goes to all sockets

---

**Remaining Vulnerabilities:**

- **File length may exceed model context** — index.html could reach 1200+ lines. Mitigation: section markers and completeness mandate, but models with <8K output limits may still truncate. Consider splitting the prompt into two sequential generations (server first, then client) if truncation occurs.

- **Hat drawing variety** — "crown: 3 yellow triangles, wizard: purple cone" etc. is somewhat underspecified. The model will produce functional but visually simple hats. Mitigation: acceptable for a party game; cosmetic polish can be iterated.

- **Reconnection beyond disconnect=death** — No reconnection support. If a player's browser refreshes, they're dead. Mitigation: acceptable for a party game session; adding reconnection would triple the auth complexity.

- **CORS set to `'*'` by default** — The setup code uses `process.env.CORS_ORIGIN || '*'`. In practice most users won't set the env var. Mitigation: documented in code comment, acceptable for ngrok/LAN deployment.

- **Scoring tie-breaking** — If two players have equal damage, their damage rank points are undefined (do they share the higher rank? lower? average?). Mitigation: the `calculateScores` function is given as pseudocode; the model will likely assign sequential ranks (arbitrary but consistent).

- **40-player performance** — Broadcasting full state (40 players + projectiles + powerups + tombstones) 60 times/sec to 41 sockets may cause bandwidth issues on slow connections. Mitigation: for a LAN/ngrok party game this is acceptable. If issues arise, reduce tick rate to 30 or add delta compression.

---

**Token Efficiency:**

- **Estimated prompt tokens:** ~3,200
- **Estimated output tokens required:** ~8,000–12,000 (both files combined)
- **Compression ratio vs naive approach:** ~45% (naive listing of all requirements without structure would be ~5,800 tokens with worse results)
- **Key compression techniques:** Constants as code blocks (eliminates English descriptions of values), section markers (replace verbose instructions with structural anchors), state machine diagram (replaces paragraphs of transition logic), pseudocode over prose (shorter AND more precise)

---

**Phase Contributions to Final Prompt:**

| Phase | Key Insight Incorporated |
|-------|------------------------|
| Phase 1 (Hacker) | Schema-first structure, constant anchoring, ambiguity identification |
| Phase 2 (Red Team) | Shrink formula defense, spawn persistence, scoring flexibility, disconnect handling |
| Phase 3 (Efficiency) | Holdout room simplification, removed over-engineered culling, killed redundant security items |
| Phase 4 (Linguist) | Section scoping (SERVER/CLIENT), explicit value chains, state machine grammar |
| Phase 5 (LLM Self) | Canvas pseudocode for tombstone, "NEVER modify" emphasis, file outline as checklist |
