# XHS automation tool landscape — 2026-11-04 (Exa leg)

Scope: open-source + commercial Xiaohongshu / rednote automation active in 2026, evaluated as candidate
reference vendors for hs-portal (governed MV3 extension driving the real logged-in page; page self-signs;
DNR blocks `as.xiaohongshu.com/api/sec/v1/shield/webprofile`; governor caps; dry-run default).
Source: Exa search/fetch only (10 calls). Nothing cloned or run; xiaohongshu.com / rednote.com were not contacted.
Dates are the last commit on the default branch (GitHub API `commits?per_page=1`) unless marked otherwise.
"Stars" is the count shown at fetch time.

Existing refs, how current they are: `leeguooooo/xhs-skill` last commit 2026-03-02 · `Xiangyu-CAS/xiaohongshu-ops-skill`
last commit 2026-03-19 (1,887★, CDP) · `cv-cat/XHS_ALL_IN_ONE`: its author's live repo is now `cv-cat/Spider_XHS`
(see #3) · Redaily is now branded **红薯养号器** (yanghao.app), **v3.5.4, updated 2026-09-28** (our bundle notes are from 3.3.2).

## Candidates table

Approach key: EXT = MV3 extension · CDP = CDP/Playwright/go-rod · API = signed-API (self-signed HTTP) · MCP = MCP-over-browser.

| # | Name · URL | Approach | Last activity | Stars | What it does | Anti-detection it claims | Known breakages / bans | Rel. | Why |
|---|---|---|---|---|---|---|---|---|---|
| 1 | autoclaw-cc/xiaohongshu-skills · https://github.com/autoclaw-cc/xiaohongshu-skills | CDP **+ EXT bridge** (`extension/` ↔ `ws://localhost:9333` ↔ `bridge_server.py`) + SKILL.md | 2026-05-23 (PR #86) | 1,992 | search/feed/detail/profile, comment/reply/like/collect, publish (fill→preview→confirm) | `interceptor.js` hooks fetch/XHR in the MAIN world at `document_start`; `risk_analyzer.py` parses the intercepted APM report (`isRiskUser`); stealth.py; CDP `Input.*` isTrusted events; human.py | PR #86: an XHS anti-scraping update made click-publish fail silently; honeypot tabs; -9136 publish ban | **5** | Same architecture as ours (MAIN-world interceptor + extension). Its honeypot filter and risk-verdict parsing fill gaps we have. |
| 2 | 红薯养号器 / Redaily · https://chromewebstore.google.com/detail/abbnjgmnjeidchddihllfjjaogbdommm (https://yanghao.app/zh) | EXT (commercial) | v3.5.4, 2026-09-28 | 4.3 (21 ratings) | discovery / comment-section / profile plans, per-action probability, AI comments, scheduling, user collection, CSV/JSON export; **xiaohongshu.com + rednote.com**, zh/en | "simulates real browsing"; explicitly promises no protection from platform limits | none found | **5** | Already our canonical ref. The 3.3.2→3.5.4 jump plus rednote.com support means the bundle needs a re-diff. |
| 3 | cv-cat/Spider_XHS · https://github.com/cv-cat/Spider_XHS | API (pure-algorithm signing, no browser) | 2026-10-22 (PR #192) | not shown | PC + creator + 蒲公英 + 千帆 APIs; DMs (WebSocket), live room, publish | b1 matched to the browser byte for byte; webprofile reference profile rebuilt; 461/471 verification chain; auto-retry on the 406 probability gate | PR #192: fixed 471 after login, -9059 on publish, 40001 「为了保护账号安全」 | **4** | Successor to our XHS_ALL_IN_ONE ref. It has the most current account of what webprofile/b1 contain (Oct 2026), which tells us what our DNR block removes. |
| 4 | cmingxu/auto-xhs · https://github.com/cmingxu/auto-xhs | EXT (MV3, vanilla JS) + Go backend | 2026-06-10 | 0 | char-by-char search typing, feed scroll, random note open, comment harvest (API intercept + DOM), **hover_card trigger for commenter profiles**, auto-follow (daily cap), DeepSeek comments, comment likes, looped runs | per-day caps, de-dup, typing simulation | none reported (tiny user base) | **4** | Closest open-source twin (MV3 + `core/` API interception + `actions/`). hover_card enrichment could replace our separate-window profile visit. |
| 5 | xpzouying/xiaohongshu-mcp · https://github.com/xpzouying/xiaohongshu-mcp | CDP (go-rod + stealth, own headless browser) / MCP over StreamableHTTP `:18060/mcp` | 2026-11-03 | 16,892 | login QR, publish 图文/视频 (schedule, original, visibility, products), search with filters, feeds, detail + all comments, comment/reply, like/favorite, profile | stealth; reads `__INITIAL_STATE__`; author claims more than a year without a ban | one web session per account (logging in elsewhere kicks the MCP); new accounts get a 实名认证 prompt; issue #56 collects deploy problems | 3 | The MCP benchmark everything else derives from. Useful for interaction semantics and search-filter vocabulary. Headless CDP is the opposite of our model. |
| 6 | white0dew/XiaohongshuSkills · https://github.com/white0dew/XiaohongshuSkills | CDP (raw websockets, `scripts/cdp_publish.py` ~192KB) | 2026-11-04 (bot commit; date of last real change unknown) | 3,525 | publish first, plus search/detail/comment/like/collect/profile/notifications, CSV dashboard export | per-account user-data-dir, remote CDP | had to re-select after the **creator-center redesign of Feb–Mar 2026** | 3 | Reference for drift in publisher `PSEL` selectors. |
| 7 | socai-io/socai · https://github.com/socai-io/socai | CDP (Rust, attaches to the user's existing Chrome) | 2026-11-04 | 245 | read-only research: search_notes, topic_scan, extract_note/comments/profile, collect_carousel_images; OCR, vision, video transcription | runs on the real profile; anti-scraping rule "click into cards from search/profile, never build URLs yourself" | none | 3 | Its `docs/xhs-tools-landscape.md` (2026-06-07) is the best ecosystem write-up. Its extractors parallel our Content Studio remix. |
| 8 | ops120/xiaohongshu-hudong-tools · https://github.com/ops120/xiaohongshu-hudong-tools | MCP (BrowserMCP extension: HTTP→WS→`chrome.*`), DOM only | 2026-08-13 | 99 | collect, reply (normal / targeted), like (by channel / by search), search filter, Excel export | per-character typing plus a review pause, a long rest every N actions, `min_likes` threshold, skip if `#liked`, same-author de-dup across runs | none | 3 | All of its humanization lives in config ranges (`browse` / `like` sections). Good to check against our `human.js`. |
| 9 | 波波-小红书自动养号评论助手 · https://chromewebstore.google.com/detail/iokmpbpakmcjmmpjeefhhnjmbgcphhbh (code: https://crxpeek.com/extension/iokmpbpakmcjmmpjeefhhnjmbgcphhbh) | EXT (commercial, 40.96KiB) | v1.0.0, 2026-10-21 | no ratings | 养号 browsing, comment-section lead capture (截流) | permissions include `declarativeNetRequest`, `alarms`, `webNavigation` | none (brand new) | 3 | Tiny bundle that also uses DNR. Compare its rules with our `shield.json` (static read via crxpeek). |
| 10 | NanmiCoder/MediaCrawler · https://github.com/NanmiCoder/MediaCrawler | API (xhshow) + Playwright/CDP attach to the real Chrome (`ENABLE_CDP_MODE`) | 2026-11-04 | 70,177 | crawl only (search/detail/comments/creator), WebUI | CDP attach to Chrome ≥144 via `chrome://inspect/#remote-debugging`; `libs/stealth.min.js` | issue #915 (2026-06-12): "检查到AI操作" while only viewing; reports of permanent bans in early 2026; codes 300012 (IP), -510001 (note abnormal) | 2 | Evidence of breakage, not a code ref. One commenter (2026-08-27): "还是不如浏览器插件好用稳定". |
| 11 | jackwener/xiaohongshu-cli · https://github.com/jackwener/xiaohongshu-cli | API (xhshow wrapper + own creator signing) | 2026-03-21 (stalled) | 2,717 | search/read/interact/publish/notifications, agent-friendly YAML/JSON | fixed macOS Chrome fingerprint, `sec-ch-ua` aligned, stable session identity, **Gaussian jitter**, **exponential cooldown on captcha** | maintenance stalled | 2 | Only the pacing ideas transfer (jitter distribution, captcha cooldown) for comparison with the governor. |
| 12 | xpzouying/x-mcp · https://github.com/xpzouying/x-mcp | EXT (closed source) + cloud relay `wss://mcp.aredink.com/ws` | 2026-09-10 | 477 | publish (图文 / video / scheduled), covers, `xhs_*` tools mirroring xiaohongshu-mcp | "reuses your browser login, no foreign-IP risk" | none in repo; 20 open issues | 2 | No source in the repo, and the cloud relay breaks our no-cloud rule. The CWS bundle could be studied like Redaily's. |
| 13 | 小红书自动运营助手 (TIYBAI) · https://xhs.tiybai.com/ | EXT (Chrome + Edge, commercial) | v0.10.16 (date unknown) | — | 养号 by keyword with chosen like/collect/comment, live hot topics, search-sample AI reports, long-tail keywords | none specific | site states "may trigger platform limits" | 2 | Overlaps our trend radar, not our 养号 engine. |
| 14 | 小红书助手 · https://chromewebstore.google.com/detail/npgmifppemfggkgleogddadhopjalfeb | EXT (commercial) | v1.0.0, 2025-10-21 | — | batch browse (dwell 5–120 s), auto like/collect/follow/comment, extraction | "simulates real users" | — | 2 | Simple competitor; nothing new. |
| 15 | 自动薯 · https://shinewaycargo.com/xhs-auto/ | EXT (.crx sideload, commercial) | date unknown | claims 12,000+ users | AI comments, comment-section capture (截流), like/collect | claims "0 封控", "智能安全策略"; advises **≤60 min per session, ≤3 sessions per day** | — | 2 | Marketing only. The session/day limits are a datapoint for the governor. |
| 16 | hanliang97/MatrixMedia · https://github.com/hanliang97/MatrixMedia | Electron + puppeteer-core real Chrome | commits 2026-05-19, 2026-06-28 | not shown | multi-platform publish | moved from `<webview>` to its own BrowserWindow, then to the user's real Chrome; click jitter and mouse paths | `<webview>` GuestView fingerprint (websectiga / sec_poison_id / `window.parent !== self` / Canvas) poisoned sessions and caused repeated login loops | 2 | Detection evidence: XHS fingerprints embedded/guest contexts. |
| 17 | cadl/ax-xhs-cli · https://github.com/cadl/ax-xhs-cli | macOS Accessibility API (Rust), no injection | last push 2026-04-02 | 5 | drives existing Chrome; reads like/collect state from screenshot color | **zero JS injection** | needs `xsec_token` in URLs | 2 | Unusual zero-injection approach. A conceptual contrast, not a code ref. |
| 18 | bonyren/redbook (红薯狗) · https://github.com/bonyren/redbook | EXT (MV3; product at wsworking.com) | 2026-02-15 ("发布manifest v3版本") | 0 | lead harvesting, auto follow, DeepSeek comments | "模拟人工操作的智能化算法" | — | 2 | Same feature set as our self-feeding loop. Source availability unverified. |
| 19 | Cloxl/xhshow · https://github.com/Cloxl/xhshow | API signing lib (`x-s`, `x-s-common`, `x-rap-param`) | 2026-06-11 | 1,100 | `sign_headers_get/post` | — | breaks with every XHS signing change | 1 | We let the page sign, so this is only useful for decoding header fields. |
| 20 | ReaJason/xhs · https://github.com/ReaJason/xhs | API (pluggable sign) | 2025-07-01 (stalled) | 2,222 | `XhsClient`, includes sliced upload | — | stalled | 1 | Historical. |
| 21 | xiaoshi569/Automatic-xhs (红薯AI养号助手) · https://github.com/xiaoshi569/Automatic-xhs | EXT (closed source, Quark-pan download) | 2025-10-09 | 23 | LLM-decision mode or local probability mode, keyword search, follow, skips already-browsed notes | random delays | — | 1 | Closed source and stale. |
| 22 | xin-Easy/yuHai · https://github.com/xin-Easy/yuHai | closed binaries | 2026-02-11 (last push seen on forks; upstream date unknown) | — | "AI 智能养号", passive network listener, multi-account | — | — | 1 | Binaries only. |

Also seen, not separately scored: iFurySt/RedNote-MCP https://github.com/ifuryst/rednote-mcp (1,041★, last push 2025-05-11);
sykuang/rednote-mcp https://github.com/sykuang/rednote-mcp (Playwright port of xiaohongshu-mcp for rednote.com, 2026-05-10);
yuymf/xiaohongshu-skills https://github.com/yuymf/xiaohongshu-skills (autoclaw fork with a stealth table; date unknown).

## Detection-technique notes

**Signing and identity** (socai landscape, 2026-06-07)
- Every edith request carries `x-s` (path + body + timestamp + cookie `a1`; custom Base64 alphabet, CRC32 variant `mrc()`), `x-t`, `x-s-common` (SDK version, OS, `xhs-pc-web`, `a1`, localStorage `b1`, CRC of each) and `x-b3-traceid`.
- `b1` lives in localStorage, so pure-HTTP tools cannot obtain it. This is the built-in weakness of signed-API tools.
- Creator uses a separate `XYW_` signing scheme and `customer.` uses another.

**Entry-path gating**
- `xsec_token` + `xsec_source` (`pc_feed` / `pc_search`) bind a note read to the list it came from.
- A cold `/explore/<id>` lands on a blank or verify page. This confirms our "never cold deep-URL" rule.

**Server-side verdict loop**
- After a few runs, the front-end SDK reports the server's risk verdict (`isRiskUser`) through APM.
- Escalation ladder: captcha → throttling or empty results → feature restriction → ban.

**Honeypot DOM (May 2026, creator publish page)** (autoclaw PR #86)
- Tabs are rendered three times: an off-screen decoy with no attribute, a honeypot with `data-hp-kind`, and the real tab with `data-hp-bound="1"`.
- The 发布 button is a Vue web component inside a **closed shadow DOM**, with a `publish` CustomEvent on the host.
- Ban codes are `-913x` (`-9136` = 因违反社区规范禁止发笔记).
- XHS nests its own XHR interceptors (s1-main / interceptor.js / axios), so wrapper hooks **miss responses**. A `console.error/log/warn` hook caught -9136 when the wrapper did not.
- Not established: whether honeypots exist on `/explore` too.

**Risk-verification chain** (Spider_XHS PR #192, 2026-10-22)
- 461 / 471 (antiSpider / antiSpam) → app QR verification with `verifytype 124`: `qr/init` → `rid` → QR → status polling.
- The security bootstrap must re-run before `qr/init`, or the result is 40001.

**webprofile contents** (Spider_XHS PR #192)
- The reference profile has **82 fields**, webBuild 6.57.6, Chrome 155.
- Encoding: PC DES→base64→JSON; Creator base64(JSON); `profileData` is 35,632 hex.
- `b1` is PC 1784 / Creator 1868 bytes and includes telemetry counters (`x82`, `x84`).
- **Inference, not proven:** because webprofile is tied to `b1` and telemetry, blocking it may itself be a signal, since the server never receives a profile it expects. Worth an A/B test.

**First-visit security and telemetry endpoints** (trenchcoat.tools)
- `as.xiaohongshu.com/api/sec/v1/{shield/webprofile, scripting, sbtsource}`, `as…/api/p/pj`
- `spider-tracker.xiaohongshu.com/api/data`, `apm-fe.xiaohongshu.com/api/data`, `t2.xiaohongshu.com/api/v2/collect`
- edith `redcaptcha/v2/{getconfig, web/log, qr/init, qr/status/query}`, `racing_report`, `note/metrics_report`
- localStorage keys: `b1b1`, `p1`, `webSsk`, `last_tiga_update_time`, `XHS_STRATEGY_BOX`, `MF_STATISTICS`
- Cookie lifetimes: `websectiga` ~3 days, `sec_poison_id` session.

**Extension detection** (XHS-Downloader #283, 2025-08)
- The XHS web app showed a 有害插件 (harmful extension) warning for some data-collection extensions. Users cleared it by disabling an "AI 社媒创作助手" extension.
- The detection method is unknown.

**CDP tells** (yousali 2026-02-13; MediaCrawler)
- `navigator.webdriver`, `--enable-automation`, and the `Runtime.enable` / `Console.enable` leaks (patched by Patchright).
- Chrome 136+ refuses remote debugging on the default profile.
- Overriding the UA creates a mismatch with Client Hints and is detectable.
- CDP `Input.dispatchMouseEvent` produces `isTrusted=true` events. Content-script `el.click()` / `dispatchEvent` are `isTrusted=false`. This is the inherent gap for any MV3-only tool.

**Embedded-context fingerprint** (MatrixMedia 2026-05-19)
- Electron `<webview>`: websectiga / sec_poison_id / `window.parent !== self` / Canvas → poisoned session → forced re-login.

**Practitioner pacing datapoints**
| Source | Limit |
|---|---|
| 自动薯 | ≤60 min per session, ≤3 sessions per day |
| redbook-search-comment-mcp2.0 | ≤30 comments per day |
| rednote-analyzer-mcp | ≤10 requests per min, ≥3 s apart |
| MediaCrawler (bot advice) | 5–15 s sleeps, concurrency 1, residential IP, no proxy |
| XHS-Downloader | 3–8 s between items |

## Recommendation — add under `ref/` (static study only)

1. **autoclaw-cc/xiaohongshu-skills**. Study:
   - `extension/` (content.js, `interceptor.js`) and compare it to our `nethook.js`.
   - `risk_analyzer.py`: the APM `isRiskUser` parse, a new risk input for governor backoff.
   - PR #86: (a) the honeypot filter (`data-hp-bound="1"` + in viewport + no `data-hp-kind`), to apply to every engine `SEL` click target; (b) the console-hook risk capture for `-913x`; (c) the `chrome.runtime?.id` guard against "Extension context invalidated" after a reload.
2. **cv-cat/Spider_XHS** (refresh or replace XHS_ALL_IN_ONE). Study:
   - PR #192's webprofile 82-field schema and `b1` layout, to decide with evidence whether DNR-blocking webprofile is a net gain or a missing-telemetry signal.
   - The 461/471/40001/-9059 codes, to map into nethook `onRisk`.
   - `apis/xhs_pc_apis.py` endpoint shapes (same lineage as our current ref).
3. **cmingxu/auto-xhs**. Study:
   - `chrome-extension/content/core/` (API interception) and `actions/` (search, feed, detail, follow, comment, like).
   - In particular, the hover_card commenter-enrichment trick and the per-day caps.
   - Diff against our engine/background split. Ignore the Go backend.

Runners-up:
- `socai-io/socai` — read `docs/xhs-tools-landscape.md` and `page_scripts.js` extractors for Content Studio.
- Redaily 3.5.4 — re-extract the bundle and diff against 3.3.2. It is already installed locally, so no new ref is needed.
