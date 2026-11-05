# RUNBOOK — what runs where

One page so nobody has to remember. If something looks stale, check the dashboard's job heartbeats (`job_runs`) first.

## Machines & services

| What | Where it runs | How it's started | Health check |
|---|---|---|---|
| **XHS engine** — upstream [xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp), pinned `v2.7.2 + PR #906` (`b02200d`) | this Mac, `127.0.0.1:18060` (localhost only, token auth) | started by the worker when needed, or by hand (below) | `node worker/src/probe.ts` |
| **Discovery worker** — `worker/` | this Mac | by hand: `cd worker && node src/run.ts` · scheduled: **not yet** (launchd, planned) | row in `job_runs` with `status=ok` |
| **Database** — Supabase project `iewyltbtcjnmdzezfpnt` | Supabase cloud | always on | Supabase dashboard / `job_runs` |
| **Dashboard** — `dashboard/` (Next.js 16) | local `npm run dev` for now; Vercel planned | `cd dashboard && npm run dev` → http://localhost:3000 | page shows `Supabase: connected` |
| **Old extension** — `extension/` | Chrome | **retired** (`AUTO_RUN = false`) | — |

## Secrets (never in git — the repo is public)

| Secret | File |
|---|---|
| XHS login cookies | `~/.local/share/xiaohongshu-mcp/state/cookies.json` |
| Engine access token | `~/.local/share/xiaohongshu-mcp/state/auth_token` |
| Supabase URL + publishable key (dashboard) | `dashboard/.env.local` |
| Supabase secret key (worker writes) | `worker/.env.local` → `SUPABASE_SECRET_KEY=` |

## Common tasks

**Start the engine by hand** (visible window; don't close it while a run is going):
```
S=~/.local/share/xiaohongshu-mcp/state
cd $S && COOKIES_PATH=$S/cookies.json AUTH_TOKEN=$(cat $S/auth_token) \
  nohup ~/.local/share/xiaohongshu-mcp/v2.7.2-pr906-b02200d/xiaohongshu-mcp -headless=false -port 127.0.0.1:18060 >> $S/server.log 2>&1 &
```
Stop it: `pkill -f "v2.7.2-pr906-b02200d/xiaohongshu-mcp -headless"`

**Login expired** (a run fails with `LOGIN_REQUIRED`): stop the engine, then run once and scan the QR with the 小红书 app — **one attempt only**; repeated tries can use up the account's web device slots:
```
S=~/.local/share/xiaohongshu-mcp/state
cd $S && COOKIES_PATH=$S/cookies.json ~/.local/share/xiaohongshu-mcp/v2.7.2-pr906-b02200d/xiaohongshu-login
```
XHS allows **one web session per account** — the engine owns it. Use the phone app to browse; don't log in on web elsewhere.

**Upgrade the engine** (when #906 is merged upstream, switch back to an official release):
```
cd ~/.local/src/xiaohongshu-mcp && git fetch --tags origin && git checkout <tag>
GOTOOLCHAIN=auto go build -o ~/.local/share/xiaohongshu-mcp/<tag>/xiaohongshu-mcp . \
  && GOTOOLCHAIN=auto go build -o ~/.local/share/xiaohongshu-mcp/<tag>/xiaohongshu-login ./cmd/login
```
then point `XHS_ENGINE_BIN` (worker/.env.local) at the new binary and run the probe. Never patch the engine locally — report bugs upstream.

**Worker tests / checks:** `cd worker && npm test` (unit) · `npx tsc -p .` (types) · `node src/probe.ts "<keyword>"` (live, read-only, no DB).

**Schema change:** apply a migration with the Supabase MCP (`apply_migration`), copy it into `supabase/migrations/`, regenerate `dashboard/utils/supabase/database.types.ts`, run the security advisor.

## Known upstream issues (as of 2026-11-05)
- `search_feeds` filters work on our pin: re-tested 2026-11-05, `sort_by` 最多点赞 / 最新 and `publish_time` 一周内 work alone and combined. The "元素无可点击区域" failure seen once on 2026-11-04 did not reproduce.
- `get_my_profile` times out (loads `/explore`, which an overseas IP gets redirected away from) — account snapshot step is skipped until fixed.
- No follow tool; `publish_content` has no AI-content declaration — tick 【笔记含AI合成内容】 by hand when publishing AI-assisted drafts.
