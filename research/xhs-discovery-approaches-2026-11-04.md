# How practitioners discover XHS trends in 2026, and what our discovery worker should look like (2026-11-04)

Scope: a daily discovery worker for a small creator account in the AI / 智能体 niche. The operator is US-based and the account is mainland. The engine is `xpzouying/xiaohongshu-mcp` (tools: `search_feeds`, `list_feeds`, `get_feed_detail`, `user_profile`, `get_my_profile`, `list_notifications`). Output goes to a shared store and a dashboard.

Method: Exa search/fetch, `gh api` READMEs, docs and issues, and a read-only grep of `ref/XHS_ALL_IN_ONE` (already on disk). Nothing was run against xiaohongshu.com or rednote.com, and no repo code was edited. I built on `xhs-tool-landscape-2026-11-04.md` and `xhs-sync-brief-2026-11-04.md` rather than redoing them.

Labels used throughout:
- **[evidence]**: a primary source, or the vendor or repo's own artifact describing itself factually (README, issue, bundle code).
- **[opinion]**: a practitioner's judgement, a secondary blog, or a vendor marketing claim. Price figures from aggregator blogs are also [opinion], because they conflict with each other and none came from a vendor price page.
- **[inference]**: my own reasoning, not directly sourced.

---

## 1. Commercial data platforms (2026)

**Which ones are still active**

| Platform | Status in 2026 | XHS signals offered | Price tier (secondary, conflicting) | API / export |
|---|---|---|---|---|
| **千瓜数据** (qian-gua.com) | Active. Owned by **果集** (福州果集信息科技有限公司). It published a 2026 H1 industry report on 2026-07-17, and its app is v2.9.5 (2026-08-07). [evidence] | 热门笔记排行榜, 热搜词, 话题热度, 笔记关键词 analysis, 品牌投放 tracking, 低粉爆文榜 [opinion, aggregator]. Its own metric definitions are **笔记传播指数**, **千瓜达人指数** (activity : creation : fan-activity = 2:5:3) and **热度指数** ("热词相关笔记下的互动量数据经一定权重汇总得出") [evidence, app listing] | Varies by source [opinion]: 基础版 ~¥300–500/月, 专业版 ¥1000–2000, 企业版 ¥3000–8000 (HDU Wiki 2026-09-20); "约 500 元/月起" (xiaohongpao 2026-08); 豪华版 ¥1999/年 (2025-09) | Excel/PDF export in paid tiers [opinion]. API: HDU says "企业版", jzl.com says "不支持". **Conflicting, unverified.** |
| **新红数据** (xh.newrank.cn, part of 新榜) | Active. Its own domain publishes articles (2025-08-28). [evidence] | 热搜词排行, a 关键词搜索热度 curve, 爆款笔记 sorted by 24h/7d/30d interaction, 达人/品牌 analysis [opinion] | Free 体验版 with daily query caps; paid from ~¥200–400/月 (HDU) or "Pro 约 300 元/月" (aiproducthub) [opinion] | Export on paid tiers. API only on "旗舰版" (HDU) [opinion] |
| **灰豚数据** (huitun.com) | Active and multi-platform (douyin, kuaishou, bilibili, XHS). It leans toward e-commerce and livestream data [opinion] | 爆款笔记, 关键词词云, 话题/标签 analysis [opinion] | Free tier; ~¥200–400/月 standard [opinion]. One source says ¥688–3988/月 [opinion] | "高级版" API [opinion] |
| **蝉妈妈 / 蝉小红** | 蝉妈妈 is douyin-first. Its XHS product is **蝉小红**, which offers **爆文率** and 达人报价 [opinion] | 爆文率, 关键词排名 monitoring [opinion] | ¥150–400/月 for 蝉小红 [opinion] | Unknown |
| **果集** | **Not a separate XHS tool.** It is the parent group of 千瓜 (XHS), 飞瓜 (douyin), 西瓜 (公众号) and others. [evidence: qian-gua.com 2025-03-05 says "果集作为社交媒体全链路服务商，携旗下飞瓜、千瓜等产品"] | — | — | — |
| **飞瓜 / 火烧云 / 卡思 / 5118** | Mentioned in 2026 comparisons [opinion]. 5118 mines Baidu long-tail terms and is used for "百度高频但小红书没覆盖" blue-ocean terms [opinion] | — | — | — |
| **API resellers** (极致了数据 jzl.com, TikHub) | Active. They sell pay-per-call XHS endpoints. jzl lists 21 endpoint directions: note/user/search/comment/topic [evidence, vendor self-description] | Raw note, search and comment data | Pay per call [evidence, vendor] | API is the product. Compliance and provenance are unclear [inference] |

**Takeaways for us**

- **[evidence]** These platforms read only public data, and every vendor and aggregator says official per-account data stays inside the official backends.
- **[opinion]** Third-party numbers are estimates. HDU cites a 10–20% gap from official data, and aiproducthub cites a 1–3 day lag.
- **[opinion → inference]** The platforms are built for brand and MCN marketing in 美妆, 母婴, 家居 and 服饰. jzl.com cites "78% 企业用户" for 千瓜, and 千瓜's 2026 H1 report covers 服饰/美妆/食品/母婴/家居/运动. Coverage of a niche like **AI/智能体 is probably thin**, and paying ¥2k–50k a year for brand-投放 data does not fit a single small creator. A one-month entry tier (新红 or 千瓜) is defensible only as a cross-check of 热搜词 heat curves.
- **[evidence of absence]** None of the platforms publicly documents a self-serve API at the entry tiers.

## 2. Official XHS tools usable by a normal creator account

| Tool | Reachable on web by a regular personal account? | What it exposes | Source |
|---|---|---|---|
| **创作服务平台 → 笔记灵感 / 热点榜单** (creator.xiaohongshu.com) | **Yes**, on web and app. One source claims some 灵感 features need 专业号认证 [opinion, aoxox], which is a conflict. | 热点榜单 with 24h/7d/30d filters, "本周热门话题" by 垂类 with live heat, plus official 活动/话题. It does not expose search volume. | duoduodashi 2026-01-20, zhongyiweb 2026-01-27, jingpinwen 2025-04-10 [opinion; consistent across 3 sources] |
| **搜索 下拉联想词** | Yes, in the web search box. | Real query completions. Practitioners call it "最准", because it reflects real user queries. Typing the seed plus suffixes ("多少钱/怎么选/避坑") digs out more. | xiaohongshuzc 2026-08-25, zhongyiweb [opinion]. The endpoint is **`GET /api/sns/web/v1/search/recommend?keyword=`** [evidence: `ref/XHS_ALL_IN_ONE/apis/xhs_pc_apis.py:412` + the web bundle] |
| **猜你想搜 / 热榜** | Yes, on web. | Trending queries in the empty search box, and a hot list. | Web bundle endpoints **`/api/sns/web/v1/search/querytrending`** (summary `"web猜你想搜trending"`) and **`/api/sns/web/v1/search/hotlist`** (summary `"web_hot_list"`, level `S2`) [evidence: `ref/XHS_ALL_IN_ONE/static/xhs_a1_other.js:29546,29636`]. In the app, "小红书热点" updates 10 items daily at 19:00 [opinion, jingpinwen] |
| **话题页 浏览量** | Topic pages show note counts. | Searching `#话题` shows "X万+篇笔记" [opinion, yixiaoer 2026-01-07]. Third-party 薯薯秀 claims 话题总浏览量 and 24h/7d/30d trends [opinion]. | **No 2026 primary source found** for the official topic-page 浏览量 field |
| **聚光 关键词规划** (ad.xiaohongshu.com/aurora/ad/tools/keywordTool) | **No.** It needs an ad account with 企业资质 [opinion, yixiaoer]. One source says "部分基础数据免费开放" [opinion, zhongyiweb], which is a conflict. "官方未向个人账号开放精确搜索量数据" [opinion, zhongyiweb]. | **月均搜索指数**, 市场出价, related words, a 90-day trend | URL plus a daily cookie-scraper: `cminmaj9/keyword_crawler` (2025-03-10) [evidence] |
| **蒲公英 内容广场** | **No.** Access requires "近一年蒲公英月均消耗>=1w", refreshed monthly. | 热门/飙升/推荐 keywords by industry, **搜索指数** ("结合近90天用户关键词搜索总量计算"), 关联内容量/阅读量/互动量 | xiao-ad.com 2025-04-28 [opinion, agency doc, detailed] |
| **灵犀** | **No.** It opened free to "企业专业号" from 2025-08. | 行业热搜词, audience insight | jzl.com 2026-08-19, xiaohongshuzc [opinion] |
| **蒲公英 (creator side)** | Gated by fan count. The threshold is reported as ≥5000 fans [opinion, hwds868 2026-04-14]; other sources differ. | Commercial collaboration only, not trend discovery | — |

**Takeaway [inference]:** for a personal account, the signals that are free and machine-readable are search results, 联想词, 猜你想搜 and 热榜. The rest are 笔记灵感 / 热点榜单, which are best read manually or captured from page traffic. True search volume (搜索指数) needs ad-account or brand-tier access we don't have.

Two notes on the engine:
- **[evidence]** `xiaohongshu-mcp` exposes **no suggestion or hot-list tool**. Its tools are `search_feeds`, `list_feeds`, `get_feed_detail`, `user_profile` and the write/login tools.
- **[inference]** Getting 联想词 would need either a new tool or a capture of the page's own `/search/recommend` response. Our MV3 `nethook.js` is well placed to do that capture, because the page signs its own requests.

## 3. How the open-source pipelines are structured

| Project | Structure | Evidence |
|---|---|---|
| **NanmiCoder/MediaCrawler** (70,196★, pushed 2026-11-04) | **Deterministic crawl → store → analyze.** CLI `--platform xhs --type search` reads keywords from a config file, then `--type detail` per id. Storage is CSV/JSON/JSONL/Excel/SQLite/MySQL. Analysis is a built-in 评论词云. The paid **MediaCrawlerPro** adds the agents on top: "AI Agent Skill 支持 … 让 Agent 自动爬取数据", "评论分析 Agent: 输入关键词或链接，自动采集评论并生成研究报告", and "自媒体内容拆解 Agent". | README [evidence] |
| **xpzouying/xiaohongshu-mcp** (16,892★) and the author's blog | **Agent-in-the-loop**, interactive. "获取内容或者让 Claude Code 自己调研 … 让 Claude Code 调用 xiaohongshu-mcp 完成发布". Search example: "帮我使用 xiaohongshu-mcp 搜索一下：Claude MCP，告诉我点赞数最高的帖子的信息". It ran for 1–2 weeks at "90%+ 自动化" and reached 6000+ 赞+收藏, then was paused. The author warns posts can be marked "疑似AI生成" and lose traffic. | haha.ai 2025-08-10, README [evidence of the author's claims] |
| **xiaohongshu-mcp-skills** (8 SKILL.md over 13 MCP tools) | Agent-in-the-loop. Tools are split into ReadOnly and Destructive. A reviewer writes: "竞品调研是这个项目最稳的用法 … 让 Agent 定期调研某个关键词下的爆款并总结标题与内容规律". | txtmix.com 2026-04-07 [opinion] |
| **socai-io/socai** (253★, pushed 2026-11-04) | **Hybrid.** An agent follows SKILL.md methods, but the tools are deterministic page scripts (`searchCards`, `searchInput`, `noteWithWait` in `sites/xhs/manifest.json`) and saved data is re-read with `read_saved_notes`, never re-crawled. `xhs-keyword-insights` rules: "优先用 search_suggestions 采集每个种子词的真实可见联想 … 不改用search结果页相关词或模型生成词冒充"; "不能把模型生成词标成平台联想词"; "不将互动或联想排名称为搜索量". `xhs-viral-analysis` takes high/mid/low interaction controls ("避开只挑爆款的偏差") and keeps 赞/藏/评 separate. **`topic_scan`: no such file or symbol found in the repo tree.** | gh api SKILL.md + tree [evidence] |
| **socai `docs/xhs-tools-landscape.md`** (2026-06-07) | Ranks ban risk by route. Lowest is "挂真实浏览器加只读", but "反复批量打开笔记还是可能触发风控". "封号风险差不多等于「请求像不像真人」乘以「写操作的频率」". | gh api [opinion, based on reading the source code] |
| **YiRuiRong/auto_xhs_agent** (2026-04-13) | Deterministic: Playwright keyword crawl with like/collect/comment **thresholds** → structured analysis (高频关键词/标签/标题模式) → LLM topic generation → MCP publish → 飞书. | README [evidence] |
| **Jinsong-Zhou/xhs-autopilot** | Search sorted by 最多点赞/最多收藏/最新 → pattern analysis (titles, structure, tags, comments) → LLM writing. | README [evidence] |
| **cminmaj9/keyword_crawler** | FastAPI cron "每天上午 8 点定时拉取" the 聚光 keyword tool (月均搜索指数 + 市场出价) → MySQL → 飞书. A cookie is maintained by hand daily. | README [evidence] |
| **OpenClaw dual-account post** (mdnice 2026-03-20) | Every 6h: scrape 榜单热点 → SerpAPI keywords → dedupe against published topics → generate → publish → notify. | [opinion, blog] |

**Pattern [inference from the table]:**
- Every pipeline built for **repeated or scheduled** collection (MediaCrawler, auto_xhs_agent, keyword_crawler, MediaCrawlerPro's agents sitting on its crawler) collects deterministically, stores, then runs the LLM over stored data.
- Pure agent-in-the-loop (the xiaohongshu-mcp blog, the -skills set) is shown for **interactive, ad-hoc research and publishing**.
- socai is the middle ground: an agent chooses among a small set of deterministic, schema-fixed tools under explicit budgets and provenance rules.

## 4. Agent-in-the-loop vs deterministic collection

**Reliability**
- **[evidence]** `search_feeds` has been fragile:
  - #813 (closed 2026-08-14): "v2.4.x search_feeds 稳定 60s 超时 … 不带 filters 也复现；同环境 list_feeds 正常".
  - #801 (closed 2026-08-08): the filter panel regressed ("「不限」无可点击区域 / 找不到「笔记类型」组").
  - #685: "MCP服务经常超时".
  - Fixes landed in #816 (2026-08-16, "跳过默认筛选并按可见性挑选选项节点") and #835 (2026-09-01, "wait for search result state").
  - **Our "filters broken" may already be fixed upstream** (last commit 2026-11-03). Check the binary version before working around it.
- **[opinion, anecdote]** With Agent-Reach, XHS search succeeded only "60%". Retries plus a proxy raised it to 85%. Rate-limiting to ≤3 req/s with a 2s gap per platform raised stability "从70%提升到98%" (segmentfault 2026-08-11).
- **[opinion, vendor]** SandBase (an API seller): scraper failures are silent ("数据错了或缺了"), while API failures are explicit and retryable. The general point is sound, but SandBase is commercially interested.

**Cost and speed**
- **[opinion, vendor self-test]** Browserwing (V2EX 2026-02-24): a free agent-browser run took 45–60s, 8000–12000 tokens and succeeded 70–80% of the time. A recorded script took 3–5s, 500–1000 tokens and succeeded 98%+. Advice: "对于重复性任务，一定要用脚本方式，不要每次让 AI 从头开始". This is marketing for their own tool, so take it as directional only.
- **[opinion]** OpenCLI (woshipm 2026-05-21): returning structured JSON instead of DOM or screenshots cuts tokens "一个数量级" compared with Playwright MCP. About 35% of its bugs come from site DOM changes.
- **[opinion, practitioner]** Juejin 2026-07-15, an opportunity scanner over 200+ sources:
  - Feeding raw data to GPT-4 was "Token 费用高得吓人，输出质量还很随机".
  - The fix was "先结构化，再分析": a cheap model cleans the data, then a strong model analyzes it.
  - It requires two independent sources before reporting a trend.
  - After GPT-4o "编了一段用户评论", it added a provenance check ("必须能在原始数据中找到出处").
  - Running weekly full analysis plus daily incremental passes cut cost to about $60 a month.

**Ban risk**
- **[evidence]**
  - xiaohongshu-mcp has **no built-in rate limiting** (dudarik 2026-10-26 [opinion]; consistent with the README).
  - "**小红书的同一个账号不允许在多个网页端登录**", so logging in elsewhere on web kicks the MCP session (README).
  - The author claims "稳定运行一年多，没有出现过封号" [author claim]. The README's "每天的发帖量应该是 50 篇" is a publishing claim and doesn't apply to discovery.
- **[opinion]** socai: low-frequency real-browser reads are the safest. "反复批量读、短时间打开一堆笔记、直接跳详情页，都可能触发风控". Writes are where bans concentrate.
- **[inference]** An LLM agent left to decide how many searches and detail-opens to make is a source of unbounded read volume, which is exactly the "短时间打开一堆笔记" pattern. A script with a fixed daily budget can't overshoot.

**Where LLMs add real value**
1. **Relevance filtering** of search cards and titles, which matters given our measured 99% off-niche home feed. The source table shows this as a common analysis step [inference from the pipelines].
2. **Keyword expansion candidates** mined from comments and titles. Per socai's rule, they must be **validated against real platform 联想词 or search results**, never presented as platform data [evidence: socai SKILL.md].
3. **Decoding why notes work**: hooks, structure, visuals, comment needs, compared against ordinary controls [evidence: socai xhs-viral-analysis; MediaCrawlerPro 内容拆解 Agent].
4. **Idea generation and drafts** with provenance back to note ids [evidence: Juejin provenance check].

**Where a script is better [opinion and inference, consistent across sources]:** scheduling, keyword iteration, pagination, dedupe by note id, snapshotting counts, computing velocity, deltas and ratios, and enforcing budgets and sleeps.

## 5. Recommendation for our setup

**Verdict [inference, grounded in §3–4]:** the mainstream practice for a scheduled job is **deterministic collection → store → LLM analysis**. Agent-in-the-loop is the pattern for interactive research.

Keep Haiku, but move it **downstream of the data**. Call the MCP's HTTP endpoint (`POST http://localhost:18060/mcp`, JSON-RPC) from a plain script with a fixed per-day budget. Then run `claude -p` (Haiku) over the stored JSON for filtering, expansion, decoding and ideas. Haiku should never decide how many XHS calls to make.

**Constraints to respect**
- **[evidence]** Single web session per account. If hs-portal's Chrome is logged into the same account on web, it will collide with the MCP session. Use the same login surface for both, or schedule them so they never overlap.
- **[inference]** US operator → mainland account means foreign egress. xiaohongshu-mcp supports `XHS_PROXY`. MediaCrawler's sponsors pitch CN residential IPs for overseas servers, which is a commercial signal, not a verified need.

**Pipeline**
1. **[code]** A versioned seed-keyword file (AI/智能体 niche, about 10–20 terms). It changes only by approved additions from step 7.
2. **[code]** Daily, sequential, jittered collection. One `search_feeds` per keyword (sort 最新 plus 最多点赞 if filters work on the current version), with 5–15s sleeps and concurrency 1. The sleep and concurrency figures are practitioner pacing from the prior brief (MediaCrawler 5–15s, concurrency 1). Never use `list_feeds` for niche discovery [evidence: our 99% off-niche data].
3. **[code]** Dedupe by note id, then append a raw snapshot (`id, xsec_token, title, likes, collects, comments, shares, publish_time, author_id, collected_at`) to SQLite or JSONL. Daily snapshots are what let us build the "增长榜" signal the paid tools sell [inference].
4. **[code]** Deterministic scoring:
   - engagement velocity (Δ since the last snapshot ÷ hours since publish)
   - collect/like ratio (藏>赞 marks practical value)
   - comment/like ratio
   - new-note count per keyword per day (supply)
   - low-fan 爆文 flag (likes ÷ author fans, using `user_profile` only for the top few)
5. **[LLM]** One batched Haiku call: relevance filter (on/off niche + sub-topic tag) over the new cards, with structured JSON output.
6. **[code]** `get_feed_detail` with comments for only the top K (about 5–10) on-niche candidates a day.
7. **[LLM]** Mine comments and titles for candidate keywords and unmet questions. Then **[code]** validate each candidate with a real search (does it return on-niche results?) and, where possible, real 联想词 captured from `/api/sns/web/v1/search/recommend` via the page, e.g. our `nethook`. The MCP has no suggestion tool. Only validated terms are queued for approval into the seed file.
8. **[LLM]** Opportunity cards and own-post ideas. Decode top notes against ordinary controls. Every claim must cite note ids.
9. **[code]** Provenance check: drop any card citing ids or quotes not in the store. Then write to the shared store and dashboard.
10. **[manual, weekly]** Glance at 创作中心 → 笔记灵感 / 热点榜单, which is official, free and not scriptable via our tools. Optionally run a one-month 新红/千瓜 entry-tier trial to cross-check 热搜词 curves [opinion].

**Signals to collect daily [inference, mapped to the paid-tool signals in §1]**
- Per keyword:
  - top-N note ids with like, collect, comment and share counts plus publish time
  - Δ counts versus yesterday (velocity)
  - number of new notes in 24h
  - collect/like and comment/like ratios
  - recurring tags and 话题
  - author fan counts for the top few (低粉爆文)
- Per detail-opened note: top comments, mined for question phrases and needs.
- Weekly: 联想词 for each seed (if captured) and a 热榜 / 猜你想搜 snapshot (if captured).

---

## Self-check

| Required item | Status | Evidence |
|---|---|---|
| Q1 has ≥1 sourced finding | PASS | 千瓜/果集 ownership (qian-gua.com 2025-03-05, app 2026-08-07), aggregator prices (HDU 2026-09-20 etc.) |
| Q2 has ≥1 sourced finding | PASS | Web endpoints in the bundle (`ref/XHS_ALL_IN_ONE`), 聚光 keywordTool URL (keyword_crawler), 蒲公英 gate (xiao-ad 2025-04-28). 话题页 浏览量 is explicitly "no primary source found". |
| Q3 has ≥1 sourced finding | PASS | MediaCrawler README, socai SKILL.md, xiaohongshu-mcp blog/README, auto_xhs_agent. `topic_scan` is explicitly "not found". |
| Q4 has ≥1 sourced finding | PASS | xiaohongshu-mcp issues #813/#801/#685, Juejin 2026-07-15, segmentfault 2026-08-11, Browserwing (labelled vendor) |
| Q5 has ≥1 sourced finding | PASS | Each step tagged [code]/[LLM] and tied to §3–4 sources; unsourced parts labelled [inference] |
| Every platform/tool claim has a URL + date | PASS | See Sources; undated items say "date unknown" |
| Claims labelled [evidence]/[opinion]/[inference] | PASS | Labels inline throughout |
| No marketing claim presented as fact | PASS | Browserwing, SandBase, jzl and 极致了 are labelled vendor/opinion; prices are labelled conflicting |
| No unlabelled unsourced recommendation | PASS | Velocity, scoring and budgets are labelled [inference] or sourced |

## Sources (url · date · score 1–5)

Scores: 5 = primary or own artifact; 3 = practitioner or secondary with detail; 1–2 = SEO or aggregator, or a vendor promoting itself.

- https://github.com/xpzouying/xiaohongshu-mcp · last commit 2026-11-03 · **5** (tool list, single-session rule, risk notes)
- https://haha.ai/xiaohongshu-mcp · 2025-08-10 · **4** (author's agent-in-the-loop workflow and results)
- xiaohongshu-mcp issues #813/#801/#816/#835/#685/#705/#760/#671 (github.com/xpzouying/xiaohongshu-mcp/issues/N) · 2026-04-20…2026-09-01 · **5**
- https://github.com/NanmiCoder/MediaCrawler · pushed 2026-11-04 · **5**
- https://github.com/socai-io/socai (`core/src/agent/skills/xhs-keyword-insights|xhs-viral-analysis|xhs-content-workflow/SKILL.md`, `core/src/sites/xhs/manifest.json`) · pushed 2026-11-04 · **5**
- https://github.com/socai-io/socai/blob/main/docs/xhs-tools-landscape.md · 2026-06-07 · **4**
- https://socai.io/blog/zh/xiaohongshu-automation-tools · 2026-06-07 · **3**
- `ref/XHS_ALL_IN_ONE/apis/xhs_pc_apis.py:412`, `ref/XHS_ALL_IN_ONE/static/xhs_a1_other.js:29546/29585/29636` (local) · date unknown (bundle snapshot) · **5**
- https://github.com/cminmaj9/keyword_crawler · 2025-03-10 · **4**
- https://github.com/YiRuiRong/auto_xhs_agent · 2026-04-13 · **3**
- https://github.com/Jinsong-Zhou/xhs-autopilot · 2026-02-11 · **3**
- https://txtmix.com/posts/tech/xiaohongshu-mcp-skills-complete-guide/ · 2026-04-07 · **3**
- https://dudarik.com/blog/xiaohongshu-mcp/ · 2026-10-26 · **2**
- https://mdnice.com/writing/e0ce252c292c48f791b2554742f9b536 · 2026-03-20 · **2**
- https://juejin.cn/post/7662298778016694322 · 2026-07-15 · **3**
- https://segmentfault.com/a/1190000048143431 · 2026-08-11 · **3**
- https://www.v2ex.com/t/1193696 (Browserwing) · 2026-02-24 · **2** (vendor self-test)
- https://www.woshipm.com/ai/6399227.html (OpenCLI) · 2026-05-21 · **2**
- https://blog.sandbase.ai/zh-CN/social-data-api-vs-web-scraping-agents-2026/ · 2026-08-01 · **2** (vendor)
- https://www.qian-gua.com/Home/ArticleDetail?id=3103 · 2025-03-05 · **5** (果集 owns 千瓜)
- https://www.qian-gua.com/information/detail/3350 · 2026-07-17 · **4** (千瓜 active, H1 2026 categories)
- https://www.dxt8.com/sygj/23327.html · 2026-08-07 · **3** (千瓜 app, 果集 vendor, metric definitions)
- https://xh.newrank.cn/product/article/article-detail/23bfc7cdd18a4d61 · 2025-08-28 · **3** (新红 active; self-promotional)
- https://www.hdu-wiki.cn/campus/xiaohongshu-data-tools · 2026-09-20 · **2** (price tiers, API tiers)
- https://www.hwds868.com/article/xhs-keyword-research-7-tools-comparison.html · 2026-06-09 · **2**
- https://www.xiaohongpao.com/chanmama-feigua-qiangua · 2026-08-31 · **2**
- https://www.dafaseo.com/wlpt/8742920586.html · 2026-05-22 · **2** (蝉小红 爆文率)
- https://aiproducthub.cn/zt/15145.html · 2026-07-16 · **2**
- https://www.jzl.com/news/xhs-data-25 · 2026-08-19 · **2** (灵犀 free for 企业专业号 since 2025-08; vendor)
- https://www.jzl.com/news/xhsdata-13 · 2026-06-09 · **1** (千瓜 "API 不支持"; vendor competitor)
- https://world.taobao.com/lang/zh-tw/goods/12249586.htm · 2025-09-07 · **1** (年费 prices)
- https://www.zhongyiweb.com/news/541.html · 2026-01-27 · **2** (联想词, 笔记灵感, 聚光 access)
- http://xueyuan.yixiaoer.cn/article/45763 · 2026-01-07 · **2** (聚光 关键词规划师 needs 企业资质)
- https://zsk.duoduodashi.com/xiaohongshu/41627.html · 2026-01-20 · **2** (笔记灵感 → 热点榜单, 24h/7d/30d)
- https://www.jingpinwen.com/4777.html · 2025-04-10 · **2** (热点 daily 19:00; web 路径)
- https://xiaohongshuzc.com/articles/sousuo-guanjianci-buju-quanliucheng-shicao-20260825 · 2026-08-25 · **2** (下拉词 "最准"; 灵犀 热搜词)
- https://www.xiao-ad.com/zx/1637.html · 2025-04-28 · **3** (蒲公英 内容广场 metrics and access gate)
- https://www.hwds868.com/article/xhs-official-website-complete-usage-guide.html · 2026-04-14 · **1** (蒲公英 ≥5000 fans; conflicting)
- https://aoxox.com/sites/3583.html · date unknown (page shows 2026-09-20) · **1** (创作灵感 needs 专业号认证?)
