# github-core-clone-01 v3 — STATE

Account: **@daggerdash** (acct wallet `4JQLJZgYPfcg38bSvRRDWFrkVVdUrfLFSh8ZwzjhY3n2`,
agent wallet `51DE4Zuf7r9NJbMfuMecxt3zJPyRi7XEUVwHtUenqTBg`).
Repo: https://github.com/Plowester1/github-core-clone-01-v3 (branch `main`).
Competition: github-core-clone-01, $500, FREE, closes Sat 2026-11-21 13:30 WIB.
Built with opencode 1.19.5 + HCNSEC MiniMax-M3.1-Flash (fresh sessions, one file
per turn); fix rounds 4–6 via the same route. Bundle flow (this competition
does not take recorded transcripts — `record` refuses HTTP 400).

## Architecture

Zero runtime dependencies, Node 24 stdlib only, TypeScript source run with
`--experimental-strip-types`. In-memory store, one process = one fresh
store (a fresh server per trial run; stale state breaks conformance).

- `store.ts` — objects (blob/tree/commit/tag), refs, repos, issues, pulls;
  `cacheRev`/`bumpRepoCache` invalidation counter for the response caches.
- `git.ts` — pack read/write, upload-pack (fetch incl. shallow/deepen),
  receive-pack (push, fast-forward descendant check), ref advertisement
  (v0/v2, ls-refs with annotated-tag `^{}` peel lines), sideband framing.
- `rest.ts` — REST v3: repos, contents (PUT honors `body.branch` as well as
  `?branch=`/`?ref=`), commits, issues, labels, pulls, merges (merge-base
  aware, conflict → 405).
- `graphql.ts` — hand-written lexer/parser, projection, connections,
  introspection, mutations.
- `mcp.ts` — MCP tools over Streamable HTTP.
- `main.ts` — HTTP server, routing, bearer auth against
  `MAKEFUN_SHOP_TOKEN`, single-chunk body fast path.

## Trial history (kit runner, fresh server each run, token per run)

| trial | passed | score (feat/agent/perf) | p50 | notes |
|---|---|---|---|---|
| 1 | 18/120 | — | — | viewer login `octocat` vs `adaiversen`; no MCP PR tools; git DELIM |
| 1 (fix 1) | 47/120 | 511 | — | viewer + MCP + DELIM fixed |
| 1 (fix 2) | 68/120 | — | — | pack store, /api/graphql route, PUT 201, DELETE, request-id |
| 3 | 80/120 | — | 242 ms | graphql 3→15; git still 1/30 |
| 4 | 114/120 | 963 (570/200/193) | 208 ms | pack codec + report `\n` + `body.branch` fixed |
| 5 | 120/120 | 996 (600/200/196) | 198 ms | tag peel, shallow deepen, non-FF, merge-conflict fixed |
| 6 | 120/120 | 990 (600/200/190) | 218 ms | perf round (caching); no regressions |

Gate: two consecutive trials ≥947 local (trial 5: 996, trial 6: 990) plus
trial 4 (963). Trial JSONs: `trial-4.json`, `trial-5.json`,
`trial-5-gate1.json`, `trial-6.json`.

## Key bugs found and fixed

1. `readPack` dropped every object with size ≥ 15: header type bits were
   read as `typeByte >> 4` without masking the continuation bit — fix
   `(typeByte >> 4) & 0x07`.
2. `writePack` emitted a spurious `0x00` header byte when size < 15 —
   continuation bit set only when bits remain.
3. Push report lines had no trailing `\n`, so the kit client merged
   `unpack ok` + `ok refs/heads/main` into one line (`unpack failed: okok
   refs/heads/main`). Lines now end with `\n`.
4. Push report inside sideband-64k had no inner flush: real `git` hung
   up waiting for the `0000` terminator inside band 1. Added `pktFlush()`
   inside the band-1 payload (kit client ignores flush packets).
5. PUT /contents ignored JSON `body.branch` (kit sends branch only in the
   body) — every branch-targeted PUT landed on main. Branch now resolves
   query `?branch=`/`?ref=` → `body.branch` → default branch.
6. `putCommit()` never wrote `parent` lines — all REST-created commits
   were parentless, so merge-base/diff could not see ancestry and merge
   conflicts were never detected. Parents are now written.
7. Annotated tags did not peel: ls-refs/fetch now emit `refs/tags/<name>^{}`
   pointing at the target commit.
8. Shallow fetch ignored `deepen`: boundary/unshallow lines are now computed
   (`shallowInfoFor`) and emitted for v0 and v2.
9. Non-fast-forward pushes were accepted: the old check only compared
   `oldOid`; now the new tip must be a descendant of the current tip
   (`isAncestor`), else `ng non-fast-forward` (mixed reports handled per ref).
10. Merge conflict returned 200: merge-base diffs on both sides are now
    compared; same path changed differently on both sides → 405.

## Perf round 6 (caching)

Response caches (per-repo `WeakMap`, invalidated by `cacheRev` on every
mutation site incl. GraphQL/MCP merges) for advertise v0/v2, ls-refs, and
depth-1 fetch responses; `userJson` memo; body read skipped for GET.
Micro-bench: clone −16%, write −22.5%, push −1.3%. No app-level hotspots
remain per CPU profile; the rest is fixed Node HTTP + client-side cost.
Trial 6 shows run-to-run noise dominates further gains (read 568→750 ms,
write 92→125 ms between trials 5 and 6 on the same code shape).

## Known risks

- **Server is ~2.4× slower than this dev VM** (production gVisor nodes).
  Local 990 maps to an estimated server score of ~934–939 — just under the
  947 top-20 bar. The 2.4× factor is an estimate from v2 (local 988 →
  server 926); the real server grade is only known after submission.
  Mitigation: this entry is submitted now (local gate met 3× in a row);
  if the server score lands under the bar, one more perf + resubmit cycle
  is possible before the Sat 2026-11-21 13:30 WIB close (only the last
  submission per account counts; 3/day per competition per account).
- Local trial p50 varies ±10% run to run (shared/contended VM CPU).
- Response caches are new (round 6) — trial 6 (120/120) plus the 17/17
  smoke test (SHA match vs `git hash-object`, `fsck --strict` clean,
  freshness after push/PUT/branch) cover the invalidation paths.
