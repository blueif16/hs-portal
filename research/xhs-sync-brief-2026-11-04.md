# 小红书/rednote 养号 sync: vendors, platform, strategy (research brief)
_scope: Jun–Nov 2026 · real-browser MV3 lens · deep dive · generated 2026-11-04_
_source tags: [V] vendor-code analysis (local, read-only) · [E] Exa web · [R] Reddit. Each claim names its leg report; full evidence (URLs, file:line, verbatim snippets) is in that report._
_leg reports (same folder): `redaily-3.5.4-teardown-2026-11-04.md` [V-RD] · `xhs-all-in-one-update-2026-11-04.md` [V-AIO] · `xhs-yanghao-strategy-exa-2026-11-04.md` [E-S] · `xhs-tool-landscape-2026-11-04.md` [E-T] · `rednote-reddit-2026-11-04.md` [R]_

**How to read this.** Official platform figures are announcements (weibo 薯管家, thepaper, stdaily, 21jingji), so treat them as fact about the stated enforcement. Operator numbers (caps, risk cycles) are anecdotal. Every "this causes our 461" claim is a **hypothesis** until an A/B test confirms it (see Next moves).

## TL;DR
1. **2026 is the year XHS formally banned automated 养号.** On 3-10 it banned "利用技术手段模拟真人…虚假互动", stating that 托管 accounts get 封禁. The 4-27 AI rules name "利用 AI 工具自动运营账号、冒充真人互动" as a violation. Mass sweeps followed: about 302万 script accounts in July, 179.9万 accounts in one month (August), and 49.5万 more caught via linked devices. An operator reports the plugin risk cycle dropping from about 14 days to 1. [E-S]
2. **Our account is very likely now a rednote account.** Under the ToS split (2025-12-08), a +86 account used from a US IP gets auto-converted and redirected to rednote.com (WIRED, 2026-04). That matches our `www.rednote.com/404?source=/404/sec_…` risk signal. rednote has different hosts (`webapi.rednote.com`, `as.rednote.com`, `.rednote.com` cookies), and creator.xiaohongshu.com blocks overseas logins ("系统升级中暂不支持海外用户登录"). [E-S]
3. **Our extension makes itself easy to spot, and Redaily doesn't.** We block `shield/webprofile` (the fingerprint report XHS has required since July). We make unsigned edith `fetch`es at every run's end. We leave a `window.__hsNetHook` global and non-native fetch/XHR wrappers, and open automation windows unfocused. Redaily 3.5.4 has **no MAIN-world script and makes zero XHS API calls**. Our network layer was an addition beyond "copy Redaily", and it is the strongest 461 suspect. [V-AIO, V-RD]
4. **Redaily 3.5.4 moved on.** It added:
   - a region switch (rednote.com vs xiaohongshu.com);
   - **focused** main windows;
   - a new search-input cascade with a usability/honeypot filter;
   - live/suggestion card filtering;
   - new profile-note link shapes, under which our `getProfileNotes` finds nothing;
   - an 80% early stop when reading;
   - context-specific follow selectors;
   - fail-fast workflows.
   [V-RD]
5. **XHS publishes no daily caps.** The 养号 day-count rituals trace back to a 2024 tutorial. What *is* official: search is dominant (77% of DAU search), real and declared-AI content is not penalized, undeclared AI content gets "限制分发", and 导流/评论区配合 is the harshest category. [E-S]

## Key findings (in depth)

### A. Platform enforcement in 2026 [E-S]
- **3-10:** "平台严格禁止任何利用技术手段模拟真人、进行非真实内容创作或虚假互动的行为"; "对于直接通过AI托管工具注册、发布、互动的账号…平台将予以封禁处理". Occasional tool use gets a warning or 限流; fully 托管 accounts get 封禁 (21jingji 2026-03-11).
- **4-27 AI rules:** "AI 违规运营：利用 AI 工具自动运营账号、冒充真人互动…"; "AI 低质：套用模板批量生产同质化内容". 80万+ AI托管 accounts and ~15万 AI造假 notes handled so far this year. Head of the program (吉吉): "非违规内容，AI贴条不会影响流量" (stdaily, ithome).
- **2-12:** "此类未主动标识的AI生成合成内容，平台将限制分发". To declare: 【笔记内容声明】→【笔记含AI合成内容】 (thepaper, sina).
- **6-10 search/问答 rules:** ban "评论区配合、账号矩阵联动" and "利用AI技术或自动化手段批量生产同质内容"; penalties run 降权 → 下架 → 封禁. The Skill upload rules oppose "内置自动化运营小红书账号的功能" (weibo, donews).
- **7-23:** "约302万个涉及脚本操作的自动化异常账号" and "约13万个「AI托管发布」账号" (thepaper).
- **8-26 (薯管家, highest-signal):** 179.9万 accounts in one month:

  | Category | Accounts |
  |---|---|
  | 互动数据作弊 | 17.8万 |
  | 违规营销 | 46.9万 |
  | 水下商家 (DM/comment-section dealing) | 71.4万 |
  | 抄袭/同质化 | 42.7万 |
  | 虚假仿冒 | 1.1万 |
  | Caught via "关联风险设备" (linked devices) | 49.5万 |

  Appeals get human review within 48h.
- **9-23 (period 8/22–9/20):** 7.6万 accounts and 35.7万 notes; 1.7亿 fake follows and 9.8亿 fake likes/collects cleared. Penalties: "清理虚假互动数据、限制账号功能、账号冻结/封禁".
- **10-28 / 11-04:** AI虚假营销 (9.3万 notes; 禁言 5612, 封禁 3203) and 虚假人设 (1.9万+ notes, 718 accounts; "加强对违规账号变换身份、再次引流行为的识别").
- **User agreement 4.1:** forbids logging in or using XHS "通过非小红书公司开发、授权、许可的第三方软件、插件、外挂、系统". An automation extension is a ToS violation in itself.
- **Operator reports** (xiaohongshu-mcp issue #668, 2026-04): "插件原本风控周期约 14 天，现在缩短到 1 天"; "仅浏览…第一天被警告，第二天再用直接封号3天". Another write-up (yousali 2026-02) describes an escalation ladder: 滑块, then 操作频繁, then 账号异常 with phone verification. Triggers are the webdriver flag, fingerprint and fixed timing.
- **Restricted accounts can still look normal** [R]: they can usually like, watch and follow while post, comment and DM are blocked, sometimes behind a fake "网络不稳定" error. "Restriction lifted" notices are sometimes wrong. A like-only runner wouldn't detect the restriction.

### B. The 小红书 / rednote split, and what it means for our US-based account [E-S, R]
- **ToS 2025-12-08:** a mainland number, or a non-+86 number registered before 2025-12-08, makes you a 小红书 user. Later non-+86 registrations are rednote. ToS 2026-03-23 applies only to "注册于中国境内的用户". The rednote privacy policy took effect 2026-08-05; its servers are in Singapore, Malaysia or the US.
- **Conversion banner (WIRED 2026-04-23):** "Your account is a rednote account. We have automatically redirected you to rednote.com." This was a +86 account used from a US IP.
- **rednote web differs:** `webapi.rednote.com` (API), `as.rednote.com` (security), `.rednote.com` cookies, no `web_session` cookie (OpenCLI #1136). Sources disagree on whether the DOM differs (OpenCLI #1136 vs xiaohongshu-mcp #609). XHS_ALL_IN_ONE has no rednote host, only the cookies `x-rednote-datactry` / `x-rednote-holderctry` [V-AIO]. Redaily 3.5.4 has a region switch and rewrites profile hosts to match [V-RD].
- **Publishing:** creator.xiaohongshu.com refuses overseas logins; creator.rednote.com works (social-auto-upload #226). Our `publisher.js` only targets creator.xiaohongshu.com.
- **Reddit pattern** [R]: in 2026, overseas accounts get restricted early with opaque reasons. Recovery needs mainland artifacts: a CN phone number, an NFC passport scan, and a phone the app considers "safe". Restrictions are tied to the device and region, persisting across new accounts and devices. Phone numbers stay restricted after the account is deleted. Nobody reported the rednote.com redirect or VPN bans; the Reddit sample is mostly native rednote users.

### C. How XHS identifies the client in mid-2026 [V-AIO, E-T]
- **Always-sent headers:** `x-s`, `x-t`, `x-s-common`, `x-b3-traceid`, `x-xray-traceid`. Conditional: `x-rap-param` (whitelist: homefeed, search v1/v2, user_posted, feed, comment/post) and `xy-direction` (homefeed, feed), where `xy-direction = murmurHash3_32(user_id,151488) % 100 + 1` (localStorage `xhs_sharding_key`; formerly the constant "13"). `x-mns` was removed.
- `x-s = "XYS_" + b64({x0:"4.3.7", x1:"xhs-pc-web", x2:"Windows", x3:"mns0301_…"|"mns0201_…"|"mns0101_…", x4:…})`. The signing level (0301 vs 0201/0101) depends on a successful `shield/webprofile` + `gid`.
- `x-s-common` carries `x5:a1`, `x8:b1`, `x9:crc(b1)`, `x10:signCount`. `b1` is a telemetry blob: `b1.x82` lists non-standard window globals, and `b1.x84` carries mouse, keyboard, focus and visibility counters.
- **Security endpoints:**
  - `as.xiaohongshu.com/api/sec/v1/{ds,scripting,sbtsource,shield/webprofile}` (webprofile body `{"platform":"Windows","sdkVersion":"4.3.7","svn":"2","profileData":…}`, an 82–84-field fingerprint since July; in June an empty profileData was accepted)
  - `/api/p/pj` (honeypot)
  - `edith…/api/redcaptcha/v2/getconfig`
  - telemetry: `spider-tracker.xiaohongshu.com/api/data`, `apm-fe.xiaohongshu.com/api/data`, `t2.xiaohongshu.com/api/v2/collect`. The page SDK reports the server's `isRiskUser` verdict through APM. [E-T]
- **Search moved** to `POST https://so.xiaohongshu.com/api/sns/web/v2/search/notes`, with body `{keyword,page,page_size:20,search_id,sort,note_type,ext_flags:[],geo,image_formats:["jpg","webp","avif"],session_id:<uuid4>}`.
- **`xsec_source` ∈ `pc_feed | pc_search | pc_user`.** We always send `pc_feed`, even for tokens captured from search (`background.js:584`, `:1868`), which may trigger -9109 (hypothesis).
- **Verification flow:** 461/471 with a `verify` header lead to captcha / app-QR verification (`verifytype 124`, `qr/init → rid → 二维码 → status 轮询`). Skipping the security re-bootstrap gives 40001. Ban codes include `-9136 "因违反社区规范禁止发笔记"`, `IP_ERROR_CODE 300012`, `NOTE_ABNORMAL_CODE -510001` (we currently count -510001 as risk). [E-T, V-AIO]
- **Honeypots** (creator publish page, May 2026): decoy tabs filtered by `data-hp-bound="1"` + in viewport + no `data-hp-kind`, and a publish button inside a closed shadow DOM (`host.dispatchEvent(new CustomEvent('publish'))`). Redaily's search filter also skips `[button-hp-installed]`, so honeypots are on the explore/search UI too. XHS's own nested interceptors can make fetch/XHR wrappers miss responses. [E-T autoclaw PR #86, V-RD]
- **Event trust:** content-script `.click()`/`dispatchEvent` produce `isTrusted=false`; only CDP input is trusted. Every MV3-only tool, Redaily included, has this gap.
- **Extension detection:** XHS showed a "有害插件" warning for some data-collection extensions (2025-08); the method is unknown. [E-T]

### D. Redaily 3.3.2 → 3.5.4 [V-RD] (the bundle ships its own 3.4.0–3.5.4 changelog)
- **Windows:** main `chrome.windows.create({url,type:"popup",width:1024,height:768,focused:!0})` with the overlay "运行中请不要关闭或最小化浏览器窗口". Only commenter-profile side windows use `focused:!1` and close afterwards. Ours are unfocused (`background.js:337`, `:779`); this explains the 4.5-hour runs.
- **Region:** `https://${"global"===e?"rednote.com":"xiaohongshu.com"}/explore?_t=${Date.now()}` (apex domain, no `www`; e = localStorage "region", default "cn"). Profile URLs get the same host rewrite. Nothing detects 404/sec-gate pages.
- **Search:** the input cascade is `textarea#search-input-in-feeds`, `textarea#search-input-ai`, `#search-input-in-feeds textarea[name="aiSearchTextarea"]`, …, `.header-container input.search-input:not([aria-hidden="true"])`.
  - The usability filter skips elements that are hidden, inert or `[button-hp-installed]`, have opacity ≤ .01, zero size, or are disabled/readonly.
  - The submit button is scoped to `.wendian-wrapper`.
  - The open note is closed before typing.
  - Keywords are ordered or randomized, one `searchNote` each.
- **Cards:** excludes `.query-note-wrapper, .xhs-live-note-item, [class*='live-note-item']`. The note link must match host `/(^|\.)(xiaohongshu|rednote)\.com$/` and path `/^\/(?:explore|search_result|discovery\/item|user\/profile\/[a-f\d]{24})\/([a-f\d]{24})\/?$/i`; the cover is `a.querySelector("img")`. **`a[href^='/explore/']` is gone from profiles**, so our `engine.js:90` and `:799-814` break.
- **Reading:** each 500px scroll step waits 2s, then stops with 80% probability unless gathering is on. Ours always scrolls to the bottom (`engine.js:404-423`).
- **Follow:** note author `.author .follow` (state `.followed` / "已关注"). On the comments-workflow profile it's `.follow-button:contains('关注')`; the profile workflow still uses `.user-info .follow-btn`.
- **Closing:** profile `.close-circle` + 2s; explore `.close-circle .close` + 3.5s. focusComment uses `scrollIntoView({behavior:"smooth",block:"start"})` + 2s, and getCommentList sleeps 5s first.
- **Fail-fast:** `simulateClickElement` throws on a missing element, and workflows stop on any failed task except AI-comment errors (`AI_TIMEOUT`, `AI_RATE_LIMITED`, `AI_PROVIDER_UNAVAILABLE`, `AI_INVALID_RESPONSE`).
- **No handling** for -9109, `redirectPath`, 404/sec/captcha, and no `xsec_token` refresh. The DNR shield rules are unchanged and identical to ours. Redaily blocks webprofile too, but it makes no network calls of its own.
- **Redaily 3.5.4 is installed and enabled in the same Chrome profile as hs-portal.** Two automation extensions inject into every XHS page.

### E. Growth strategy signals [E-S, R]
- **No official 养号 process, day count or per-day caps** (noobclaw 2026-10-20). The CES formula and traffic-pool ladders are unpublished. Published: 77% of DAU search, 75% browse; 800M searches, 9M notes and 70M comments per day (theredscroll 2026-09).
- **Vendor/operator caps (unverifiable):**
  - New accounts: ≤30 interactions/day (20 likes, 20 comments, 5 follows), one offline day a week (noobclaw 2026-08).
  - RPA: more than 300 notes per account per day brings a captcha the next day; ≤200 per run; stop for 24h after a captcha (volcengine 2026-07).
  - Sessions: ≤60 min each, ≤3 per day (shinewaycargo).
- **AI niche:** one case study shows CTR 8.5% and an interaction rate of 19.4% (median 4.3%), with search only 16.9% of views (leiazuo, undated). Our own 69-note benchmark: lists, teardowns, single-diagram explainers and "save this" posts; saves ≈ likes; 90% image-and-text.
- **Reddit** [R]: in Chinese-caption niches, posts break out beyond followers. Face-cam and Q&A formats help new foreign creators. Content-farm editors running 50–100 accounts each were hit by 2025 enforcement.

## What's working (claimed)
- Declared-AI, non-violating content keeps its distribution (official, 4-27) [E-S].
- Search-driven content (77% of DAU search) and save-worthy formats [E-S; our benchmark].
- Copying Redaily's DOM mechanics while staying off the network layer: Redaily 3.5.4 makes zero API calls [V-RD].
- Native-language, niche, real-person content (face-cam / Q&A) [R].

## What's broken / contested
- **Automated interaction on any account** is now named, enforced, and linked by device [E-S].
- **Blocking webprofile.** It was our founding thesis, and Redaily does it too. But since July the fingerprint report gates the `gid` cookie and the normal signing level [V-AIO]. A webprofile-blocked browser may look *more* anomalous than one that sends a real profile. Contested, so it needs an A/B test.
- **MAIN-world fetch/XHR wrappers.** They're detectable through `b1.x82` globals and non-native function shapes, and XHS's nested interceptors can make them miss responses [V-AIO, E-T].
- **Content-script clicks are `isTrusted=false`** for every MV3 tool [E-T].
- **Sources disagree** on whether a platform AI label limits distribution (2-12 "限制分发" for *undeclared* vs 4-27 "不会影响流量" for compliant), and on whether rednote's DOM differs [E-S].

## Numbers worth verifying
- 14 days → 1 day risk cycle (one operator, xiaohongshu-mcp #668).
- 84-field webprofile since July; "b1 … PC 1784 / Creator 1868"; webBuild 6.57.6 (Spider_XHS PR #192) vs 6.32.2 (XHS_ALL_IN_ONE July snapshot). The two references disagree on the version.
- Vendor caps: ≤30 interactions/day, ≤60 min/session, ≤3 sessions/day (unverified).
- The 302万 July figure has no stated time period [E-S Gaps].

## Next moves
1. **Stop the bleed (operator):** in `chrome://extensions`, reload or remove hs-portal and **disable Redaily**. Today a run started at 10:25 and was still searching at 10:55, and the next was due 13:54.
2. **Control test (no extension):** with both extensions disabled, browse the account by hand on xiaohongshu.com for a few minutes. Do you get redirected to rednote.com? Do note opens 461? Is there a verification prompt? This separates an **account/region-level** state from an **extension-induced** one, and the redesign depends on the answer.
3. **Decide the product direction** before touching code (see the options in the chat summary). The platform's 2026 rules target exactly the automated-interaction core.
4. **Follow-up searches:**
   - rednote.com web DOM and creator.rednote.com publish flow for a converted account;
   - whether converted accounts can be moved back to 小红书 (mainland) with a +86 number and a CN IP.
5. **Candidate refs** to add under `ref/` [E-T]:
   - `autoclaw-cc/xiaohongshu-skills`: interceptor + risk-verdict parser + PR #86 honeypot fixes;
   - `cv-cat/Spider_XHS`: webprofile/b1 schema, risk codes (Oct 2026);
   - `cmingxu/auto-xhs`: the closest MV3 twin.

## Sources
See each leg report's Sources section for full URL lists with dates and scores:
- [E-S] about 95 pages (13 searches, 3 fetches)
- [E-T] 22 tools (GitHub API dates)
- [R] 58 posts (r/rednote, r/xiaohongshu, r/socialmedia)
- [V-RD] Redaily 3.5.4 bundle at `~/Library/Application Support/Google/Chrome/Default/Extensions/abbnjgmnjeidchddihllfjjaogbdommm/3.5.4_0/`
- [V-AIO] `ref/XHS_ALL_IN_ONE` `cedcb77..origin/master` (commit `17d42a6`)

## Method notes
- Legs run: Redaily teardown, XHS_ALL_IN_ONE diff, Exa strategy, Exa tool landscape, Reddit. **YouTube (yt-rag) was skipped: the server was unreachable.**
- Reddit tool caveats: substring keyword matching, the "site-wide" call fell back to the default subs, and results are newest-first (r/rednote covers 2026-09-24 → 11-04 only).
- No agent contacted xiaohongshu.com or rednote.com. All vendor analysis was read-only, and `ref/XHS_ALL_IN_ONE` was left at `cedcb77`.
