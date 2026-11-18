# github-core-clone — v3

[![make.fun · github-core-clone-01](https://make.fun/badge/github-core-clone-01.svg)](https://make.fun/bounty/github-core-clone-01?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)
[![rank](https://make.fun/badge/github-core-clone-01/Plowester1/github-core-clone-01-v3/rank.svg)](https://make.fun/bounty/github-core-clone-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)
[![reward](https://make.fun/badge/github-core-clone-01/Plowester1/github-core-clone-01-v3/reward.svg)](https://make.fun/bounty/github-core-clone-01?utm_source=github&utm_medium=readme&utm_campaign=github-core-clone-01)

A from-scratch GitHub-compatible git forge for the [make.fun](https://make.fun/bounty/github-core-clone-01) github-core-clone-01 bounty — built entirely on the Node.js standard library with zero runtime dependencies. Third variant (daggerdash account); the first two variants scored 931 and 926 against a ~947 top-20 bar.

It speaks the four protocols a GitHub-style server needs: smart-HTTP Git (protocol v0 and v2), the GitHub REST API v3, GraphQL, and the Model Context Protocol (MCP) over Streamable HTTP.

## Local trial scores (kit conformance runner, fresh server per run)

| trial | checks | score | perf pts | p50 |
|---|---|---|---|---|
| trial-4 | 114/120 | 963 | 193 | 208 ms |
| trial-5 | 120/120 | 996 | 196 | 198 ms |
| trial-6 | 120/120 | 990 | 190 | 218 ms |

See `STATE.md` for the full build history and `trial-*.json` for the raw results.

## Run

```sh
MAKEFUN_SHOP_TOKEN=<any-token> node --experimental-strip-types -e "import('./main.ts').then(m => m.startServer().then(s => console.log('PORT=' + s.port)))"
```

The server speaks Git smart HTTP at `/<owner>/<repo>.git`, REST at `/api/v3`, GraphQL at `/api/graphql`, and MCP at `/api/mcp`. Any bearer token value works as long as server and client agree (`MAKEFUN_SHOP_TOKEN`).

## Layout

- `store.ts` — in-memory object store (blobs, trees, commits, tags), refs, repos, issues, pulls
- `git.ts` — pack codec (read/write), upload-pack (fetch, shallow/deepen), receive-pack (push, fast-forward validation), ref advertisement, sideband framing
- `rest.ts` — REST API v3 (repos, contents, commits, issues, labels, pulls, merges)
- `graphql.ts` — hand-written GraphQL lexer/parser, projection, connections, introspection, mutations
- `mcp.ts` — MCP tools over Streamable HTTP (repo/issue/PR tools)
- `main.ts` — HTTP server, routing, auth
