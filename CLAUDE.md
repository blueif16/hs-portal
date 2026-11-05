# hs-portal — project status & conventions

Content-first 小红书 growth system for an AI / 智能体 niche account. A daily **worker** on this Mac discovers what's working on XHS through the upstream **xiaohongshu-mcp** engine. The results go to **Supabase**, and a **dashboard** (usable from both devices) shows trends, opportunity cards, drafts and job health. The old Chrome extension (automated 养号) was **retired on 2026-11-04**.

**Read first:**
- [RUNBOOK.md](./RUNBOOK.md): what runs where, the secrets' locations, and the common tasks.
- [research/xhs-sync-brief-2026-11-04.md](./research/xhs-sync-brief-2026-11-04.md) and [research/xhs-discovery-approaches-2026-11-04.md](./research/xhs-discovery-approaches-2026-11-04.md): why this design.
- The newest `.tasks/HANDOFF-*.md` (git-ignored session handoff).

## Current status (2026-11-04)

| Piece | Where | State |
|---|---|---|
| Engine: xiaohongshu-mcp `v2.7.2 + PR #906` (`b02200d`) | `~/.local/src`, `~/.local/share/xiaohongshu-mcp` | Built from a pinned, reviewed commit. Logged in with the MAIN account (read-only use). Serves `127.0.0.1:18060` with token auth. Smoke-tested: login ✅ search ✅ detail ✅ |
| Worker | `worker/` (TypeScript, Node 24 strips types, no build) | Built. 34 unit tests, mutation-checked. Types clean. First real run OK on 2026-11-05 (run #2). Not scheduled yet |
| Database | Supabase project `iewyltbtcjnmdzezfpnt` | 2 migrations (`supabase/migrations/`). Row-level security on every table, owner-only via `app_owners` plus `private.is_owner()`. Security advisor clean. Still empty |
| Dashboard | `dashboard/` (Next.js 16.4, `@supabase/ssr`) | Connection-status page only. Auth, owner sign-in and the real pages are not built |
| Old extension | `extension/` | Retired. `AUTO_RUN = false`. Its XHS web session now belongs to the engine |

**Known upstream engine issues:**
- `get_my_profile` times out from an overseas IP.
- There's no follow tool.
- `publish_content` has no AI-content declaration.

Details are in the RUNBOOK.

## Architecture

- **Engine (upstream, unmodified):** xiaohongshu-mcp is a go-rod browser with its own pinned fingerprint. It holds the account's single web session and exposes MCP tools (search, detail, profile, notifications, publish).
- **`worker/src/`** (`run.ts` is the daily run):
  1. Code searches each active keyword and up to 10 pending candidates, using this week's most-liked page (`WEEKLY_HITS`: 最多点赞 · 一周内), with 5–15s pauses.
  2. Supabase stores the notes and a daily snapshot.
  3. Haiku labels each note on-niche or off-niche.
  4. Code scores notes (momentum and saves).
  5. Full details and comments for the top on-niche notes.
  6. Haiku proposes keyword ideas, which enter as candidates. After labelling, code scores each searched keyword's heat (`planKeywords`): the top 20 with ≥60% on-niche results stay or are activated, and two misses in a row retire a keyword.
  7. Haiku writes opportunity cards, and code drops any card that cites unknown notes.
  8. Gate-checked drafts for cards saved on the dashboard.
  9. An optional account snapshot.
  10. A heartbeat in `job_runs`.

  The modules:
  - `parse.ts` and `score.ts`: the tested core.
  - `gate.ts`: the publish gate.
  - `engine.ts`: MCP client, starts the engine if it's down.
  - `llm.ts`: Haiku 5.5 through `claude -p --json-schema`, using the Claude Code login, no API key.
  - `prompts.ts`: the Haiku prompts.
  - `probe.ts`: read-only health check.
- **`supabase/migrations/`** is the schema source of truth. Tables: `keywords`, `keyword_stats`, `notes`, `note_snapshots`, `note_comments`, `opportunities`, `drafts`, `account_snapshots`, `library_items`, `job_runs`, `app_owners`.
- **`dashboard/`** is Next.js 16: `proxy.ts` refreshes sessions, `utils/supabase/{server,client,middleware}.ts` hold the clients, `database.types.ts` holds the generated types shared with the worker.

## Conventions (ALWAYS / NEVER)

- **NEVER patch or reinvent the XHS engine.** Run upstream xiaohongshu-mcp pinned to a release or a reviewed PR commit. Report bugs upstream, then bump the pin (RUNBOOK → Upgrade). The point is to stay in sync instead of debugging selectors ourselves.
- **Code collects, the LLM judges.** No agent in the collection loop: one engine call at a time, 5–15s random pauses, ≤60 min per run. Haiku only classifies, proposes and writes.
- **Every opportunity card cites stored `note_id`s** (`keepCitedCards`). NEVER present LLM-made keywords as platform data. They enter as `candidate`, and only their own search results (heat, on-niche share) can activate them. No operator approval: the user chose this on 2026-11-05. Every status change writes `status_reason`.
- **The engine always runs on 127.0.0.1 with `AUTH_TOKEN`**, because upstream CORS is `*` and without a token any website could drive the account. **One web session per account:** the engine owns it, so NEVER log the account in on web anywhere else. Re-login means one attempt only.
- **The repo is PUBLIC and GitGuardian scans it.** Secrets live only in git-ignored files (RUNBOOK → Secrets). Scrub xsec tokens and cookies from fixtures. Pre-commit check: `git diff --cached | grep -E 'AB[A-Za-z0-9_=+/-]{30,}|sb_secret_|eyJ'`.
- **Haiku calls:** `claude -p --model claude-haiku-5-5 --output-format json --json-schema … --tools "" --strict-mcp-config`. NEVER `--bare`, which requires an API key.
- **Remix means structure-level reuse (结构级复刻), NEVER copying text (文本级抄袭).** Drafts must pass `draftProblems`: title 8–20 characters, body 80–1000, ≥3 topics, no 引流 bait. Publishing stays human: the operator ticks 【笔记含AI合成内容】 and clicks 发布.
- **Tests:** pure logic is written test-first in `worker/test/` (`npm test`), with mutation checks. Glue is verified by `node worker/src/probe.ts`. Types: `npx tsc -p worker`.
- **Schema changes:** Supabase MCP `apply_migration`, then mirror the file into `supabase/migrations/`, regenerate the types, and run `get_advisors`.
- **Next.js 16:** use `proxy.ts`, not `middleware.ts`. Read `dashboard/node_modules/next/dist/docs/` before writing Next code.
- **Commit and push directly on `main`.** One idea per commit.
- Orchestrate non-trivial builds through sub-agents: one spec file per agent, disjoint files.
- Write natural Chinese. NEVER use 战役 for "campaign".

## Legacy: the Chrome extension (retired 2026-11-04)

`extension/` was a governed MV3 养号 runner that copied Redaily v3.3.2's mechanics. It ran on 87 days, but always in dry-run, so it did zero real engagement. From 2026-10-17 it hit HTTP 461 and login walls.

It was retired because:
- 2026 XHS rules ban automated interaction, and enforcement now acts within days;
- its own additions were detectable: the fingerprint-report block, unsigned API calls and the MAIN-world hook;
- Redaily moved on to v3.5.4.

The code stays in git history (baseline `b3ae7e7`; last extension work `963cebc`) and in `extension/README.md`. Analyses: `research/redaily-3.5.4-teardown-2026-11-04.md`, `RISK-MODEL.md`, `PLAN.md`. Its months of collected data are in the Chrome profile's extension storage (see memory `hs-portal-live-data-location`). Removing the extension deletes that data.
