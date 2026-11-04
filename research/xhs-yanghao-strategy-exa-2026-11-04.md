# 小红书/rednote 养号 practice & risk-control changes, 2026 (Exa leg)

- Compiled: 2026-11-04. Tools used: Exa `web_search_exa` (13 searches, zh and en) and `web_fetch_exa` (3 full fetches: thepaper 302万, TheRedScroll algorithm, WIRED rednote split).
- Coverage: about 95 unique pages came back as search highlights, plus the 3 full fetches. No xiaohongshu.com or rednote.com page was opened by me. One xiaohongshu.com note did come back in Exa's own index result. I quote it only as Exa returned it, and it is cross-checked against media reprints.
- Scoring: **5** = primary or official source, or first-hand operator data with numbers and dates. **4** = original reporting, or a first-hand technical or operator report. **3** = a credible secondary source, or first-hand but anecdotal or vendor-tinged. **2** = an unsourced SEO or vendor guide. **1** = a recycled listicle.
- **Date flags:** anything dated before 2026 is marked `[pre-2026]`. Undated pages are marked `[undated]`.

---

## 1. New-account warming curve in 2026: days, daily norms, first post, and whether 养号 still matters

**Official position: no 养号 period and no daily numbers exist.**
- A cross-check dated 2026-10-20 went through the 用户服务协议 (2025-12-08 version), 社区公约 2.0, and the 2026-03-10 and 2026-04-27 announcements. It found "里面都没有「养号」这个流程，也没有「新号要养 N 天才能发笔记」的说法". It also traces the popular "3–5 days / 10 min / 5–10 likes" recipe to a 2024 woshipm tutorial that cites no official source. https://noobclaw.com/cn/blog/xiaohongshu-account-warming-tips/ (score 4)
- 用户协议 2.4: accounts that are "注册后未及时进行初次登录使用或长期未登录" can be reclaimed. Leaving a new account idle therefore has a documented downside, not an upside. https://www.elawcn.com/agreement/2026/0301/1751.html (score 4)

**Operator norms circulating in 2026.** All of these are unsourced and the numbers disagree with each other:

| Source (date, score) | Days before first post | Daily like / collect / comment / follow | Notes |
|---|---|---|---|
| fensi168 (2026-09-26, 2) https://www.fensi168.net/article/12.html | First post on day 6–7 | like 5–10 / collect 3–5 / comment 1–3 / follow ≤5 | 30–60 min/day split morning, noon and evening. Expects 200–500 views on the first note; below 100 means check for a violation |
| toolmeow (2026-10-10, 2) https://www.toolmeow.com/post/51.html | Notes on day 3 and day 5 | Day 1: like 2–3, collect 1 | Under 50 views for 24h means "没有进入正常推荐池"; 100–500 is normal. Advises stop posting and only browse for 7 days if stuck |
| sungtv [undated] (1) https://sungtv.com/zixun/2692.html | 3 days | like 3–5 / collect 2–3 / comment 1–2 | Claims "信用分＞90" or the initial pool is only 50–100. Unverified |
| yujianseo (2026-01-15, 1) https://www.yujianseo.com/tuiguangzs/5995.html | Day 7 | Follow 20–30 博主 on days 3–4 | Contradicts the ≤5 follows/day in the other guides |
| woshipm `[pre-2026, 2024-07-15]` (2) https://www.woshipm.com/operate/6082342.html | 3–5 days | follow 2–3, like/collect 5–10, comment 3–5 | This 2024 baseline is the one recycled into the 2026 posts above. It also recommends "自己的几个号之间互相进行点赞/收藏/评论", which is now explicitly sanctioned (see Q2) |
| NoobClaw vendor (2026-08-09, 2) https://noobclaw.com/cn/blog/xiaohongshu-nurturing-strategy-comments-growth/ | Week 1: 0–1 notes | New account (0–2 wk): like 20 / comment 20 / follow 5 / **total ≤30**. Weeks 2–4: 30/15/10/≤50. Mature: 50/25/15/≤80 | Random 3–8s or 3–30s gaps. "每周至少离线1天". Claims 47→2300 fans in a month with 0 new notes. The vendor sells an automated commenter, and its own 2026-10-20 article says these numbers have no official basis |

**Does 养号 still matter versus "直接发内容"?** The 2026 consensus is turning against ritual 养号:
- "不需要仪式化的养号…刻意「点赞 21 个再退出」之类的操作没有任何依据". Their plan posts the first note on day 4. https://www.cardcrafter.cn/blog/xiaohongshu-new-account-7-day-plan (2026-09-10, 2)
- "最好的养号，就是不养号". Over-regular browsing (fixed times, exact like counts) "反而更容易被系统判定为异常". https://www.xiaohongshuzc.com/articles/bi-keng-xi-lie-04-yang-hao (2026-08-24, 2)
- NoobClaw: "第一周发出带搜索词的原创笔记…其余时间不必花在「养」上". https://noobclaw.com/cn/blog/xiaohongshu-account-warming-tips/ (2026-10-20, 4)
- Counter-signal: new accounts are more fragile under automation. One tester said: "之前开了小号用这个刷了刷帖子评论了几个就被封控了，可能是新号没有权重吧，我主号就不会". https://linux.do/t/topic/2750988 (2026-08-13, 3)
- Speed of detection: "我自己写的插件原本风控周期约 14 天，现在缩短到 1 天". https://github.com/xpzouying/xiaohongshu-mcp/issues/668 (2026-04-17, 4)

---

## 2. What triggers 验证码 / 461 / 滑块 / 限流 / 封号 for web users; 2026 crackdowns on plugins, automation and 群控

**Escalation ladder, from first-hand web reports:**
- A Playwright `launch()` publisher went: run 3 → 滑块, run 4 → "操作频繁，请稍后再试", run 5 → "账号被标记异常，要手机验证". Signals the author identified: `navigator.webdriver`, a HeadlessChrome UA, WebGL/Canvas, fixed 500ms rhythm, and an empty profile with "no life traces". The fix was CDP into the real Chrome. https://yousali.com/posts/20260213-browser-automation-anti-detection/ (2026-02-13, 4)
- Order of escalation: "先是验证码（滑块、点选），再是限流（降速或者直接给你空结果），然后功能受限，最后封号". Risk ≈ "请求像不像真人" × "写操作的频率". `xsec_token` + `xsec_source` bind each note read to a normal browsing path. The front-end SDK reports a server verdict similar to `isRiskUser`. https://socai.io/blog/zh/xiaohongshu-automation-tools (2026-06-07, 3)
- Response codes: 461/471 with a `verify` response header means a captcha (verifyType 102 is a rotate-slider). Code 124 appeared when posting in 2025-08. One commenter: "461是小红书针对腾讯云的ip的spam响应". https://github.com/ReaJason/xhs/issues/93 `[pre-2026, 2024–2025]` (3)
- MediaCrawler (2025-07): fetching note details triggered a captcha. In a real browser the note showed 安全验证, which a phone scan cleared ("近期增强风控后的行为"). Its docs recommend CDP into the user's real browser. https://github.com/NanmiCoder/MediaCrawler/issues/668 `[pre-2026]` (3); https://nanmicoder.github.io/MediaCrawler/%E5%B8%B8%E8%A7%81%E9%97%AE%E9%A2%98.html `[undated]` (3)
- RPA collector data, said to be stable for 3 months: more than 300 notes per account per day → "第二天大概率会弹出验证码". Caps used: ≤50 notes per keyword, ≤200 per run, 1.5–2.5s random scroll waits. After a captcha, stop that keyword for 24h, because "反复重试只会让风控升级". The web login state lasts about 3–5 days. https://developer.volcengine.com/articles/7660412027533770762 (2026-07-09, 3)
- xiaohongshu-mcp thread, April–May 2026, all first-hand:
  - Auto-reply checking every 2h → "1天就封号了".
  - Auto-posting → "第二天全是封号".
  - "一条就会被检测，只不过第二天10点40-11点才会出审核结果".
  - "不发文只浏览被警告了".
  - "仅浏览，总是返回500 internal server error，第一天被警告，第二天再用直接封号3天".
  - Ladder: "未实名发文--冻结--实名解冻之后--再自动化发文就是警告--然后是7天…直接就是喜提永久".
  - Source: https://github.com/xpzouying/xiaohongshu-mcp/issues/668 (4)
- A Grok Bot cloud browser logged into an account to crawl topics daily → banned after 3 days. https://www.sina.cn/news/detail/5355097762301379.html (2026-10-17, 3)
- A maintainer, 2026-06-19: "目前国内小红书，浏览器的方式被检测到了". https://github.com/dreammis/social-auto-upload/issues/226 (4)

**Official rules and crackdowns, in date order:**
- 用户协议 4.1 (2025-12-08 version): users may not "通过非小红书公司开发、授权、许可的第三方软件、插件、外挂、系统，登录或使用小红书平台". That covers any unlicensed browser extension, whatever its frequency. https://noobclaw.com/cn/blog/xiaohongshu-user-agreement-automation-clauses/ (2026-10-19, 4)
- **2026-01-19 社区公约 2.0:** bans 虚假人设 and 伪装科普, and adds an "有序经营" section. https://www.21jingji.com/article/20260126/herald/4cb81c4c08e1e67ccbb0ba87f5bfd1f7.html (5)
- **2026-03-10 AI托管 announcement:** "平台严格禁止任何利用技术手段模拟真人、进行非真实内容创作或虚假互动的行为". Occasional use → 警告 or 限制内容分发. Accounts registered, posting and interacting entirely via tools → 封禁. https://www.21jingji.com/article/20260311/herald/5cca3e6e473c9998b318f2f3578e28ab.html (5)
- **2026-04-27 AI治理规则:** "AI 违规运营：利用 AI 工具自动运营账号、冒充真人互动". Year-to-date figures: "AI托管账号超80万个、AI造假笔记近15万篇". https://www.ithome.com/0/944/156.htm (5); https://www.stdaily.com/web/gdxw/2026-04/27/content_508976.html (5)
- **2026-06-10 Skill上传规范:** opposes Skills with "内置自动化运营小红书账号的功能，如自动发布笔记、自动回复评论等". https://www.donews.com/news/detail/4/6590586.html (4)
- **2026-06-10 搜索及问答 announcement:** bans 刷量, "通过评论区配合、账号矩阵联动等方式人为制造口碑", and "利用AI技术或自动化手段批量生产同质内容". Penalties are 降权, 下架 or 封禁. https://weibo.com/5859555080/R3uBx0e5G (5)
- **2026-07-23:** "约302万个涉及脚本操作的自动化异常账号" and "约13万个「AI托管发布」账号", punished with 封号 or 禁言. No time period is given, and the piece reads like a PR placement ("据了解"). https://www.thepaper.cn/newsDetail_forward_33644081 (fetched; 3)
- **2026-08 AI治理 (secondary):** opposes "使用AI工具、手机脚本等自动化工具代替真人运营账号，利用AI自动回复评论、私信或模拟真人互动". https://www.3elife.net/Art/internet/202608/09/109308.html (3)
- **2026-08-26 恶意起号 & 违规营销:** 179.9万 accounts handled in one month. 互动数据作弊 17.8万. Accounts under linked risk devices 49.5万. Full figures are in Keep-verbatim. https://weibo.com/5859555080/RfcuK5wlb (5)
- **2026-09-23 互动作弊:** covers 8/22–9/20. 7.6万 accounts, 35.7万 notes, 1.7亿 fake follows and 9.8亿 fake likes + collects cleared. Penalties: "清理虚假互动数据、限制账号功能、账号冻结/封禁". https://feng.ifeng.com/c/8weVPNRU5zu (5)
- **2026-10-28 AI虚假营销:** 9.3万 notes, 5612 accounts muted, 3203 banned. https://www.sina.cn/news/detail/5359075577038609.html (5)
- **2026-11-04 虚假人设 (二):** 1.9万+ notes and 718 accounts. Adds "加强对违规账号变换身份、再次引流行为的识别". https://feng.ifeng.com/c/8xmUnC0WuJO (5)

**Redaily itself.** This matters for hs-portal. The Chrome Web Store listing for 红薯养号器, with the same extension ID `abbnjgmnjeidchddihllfjjaogbdommm`, is now **v3.5.4, updated 2026-09-28**. The project copies v3.3.2. The listing supports both xiaohongshu.com and rednote.com with a "中国大陆或海外地区" selector. Pro features: auto-comment, AI comments, user collection, scheduling. Disclaimer: "工具不承诺增加曝光、粉丝或账号权重，也不能保证免于平台限制". https://chromewebstore.google.com/detail/%E7%BA%A2%E8%96%AF%E5%85%BB%E5%8F%B7%E5%99%A8-%E5%B0%8F%E7%BA%A2%E4%B9%A6%E4%B8%80%E9%94%AE%E8%87%AA%E5%8A%A8%E5%85%BB%E5%8F%B7%EF%BC%8C%E6%B5%81%E9%87%8F%E6%BB%9A%E6%BB%9A%E6%9D%A5/abbnjgmnjeidchddihllfjjaogbdommm (4)

**No source found:** an official web-specific cap (N likes per day and so on). The platform publishes none. Every per-day number above comes from operators or vendors.

---

## 3. Overseas users: rednote.com routing, 国内号 from a US IP, 异地登录, the 2025–26 split

**Timeline:**
- **Mid-2025:** Rednote Technology PTE LTD is registered in Singapore. https://www.wired.com/story/rednote-draws-a-line-between-china-and-the-world/ (2026-04-23, fetched; 4)
- **2025-12-08 ToS:** users are split by phone number. "通过中国大陆地区手机号码进行注册的用户和2025年12月8日之前已经使用非中国大陆地区手机号注册成为小红书用户" count as 小红书 users. Non-+86 registrations after 12-08 are rednote users. https://www.elawcn.com/agreement/2026/0301/1751.html (4)
- **2026-03-23/24 ToS:** the rule becomes "本协议适用于小红书用户，即注册于中国境内的用户" and "如您注册于中国境外，您是rednote用户". The pre-12-08 grandfather clause is **deleted**. https://termshub.cn/public/version/5261 (4)
- **2026-04 (WIRED):** a US user who registered years ago with a **Chinese phone number** saw "Your account is a rednote account. We have automatically redirected you to rednote.com." He "suspects his account was converted because of using a non-Chinese IP address". https://www.wired.com/story/rednote-draws-a-line-between-china-and-the-world/ (4)
- **2026-04-24:** the forced-redirect banner is confirmed; international data goes to Singapore servers (privacy-policy update of 3-23). https://unwire.hk/2026/04/24/rednote-international-split-singapore-data-2026/fun-tech/ (3)
- **2026-10-22:** the Xiaohongshu privacy policy was updated 2026-04-27. The rednote privacy policy took effect 2026-08-05, with "servers in Singapore, Malaysia or the United States". The two services stay interoperable (public content and DMs work across them). How to check which one you are on: "Me → Settings and look at the agreements displayed at the bottom of the page". https://www.saikonetwork.com/blog/xiaohongshu-rednote-mainland-international-data-separation (3)

**Web-level effects (first-hand from developers):**
- Non-mainland users get a 302 to `www.rednote.com`. API host `webapi.rednote.com` (versus `edith.xiaohongshu.com`); signing host `as.rednote.com`; cookie root `.rednote.com`; the `web_session` cookie is absent. URL and API paths and `xsec_token` are identical. https://github.com/jackwener/OpenCLI/issues/1136 (2026-04-22, 4)
- **Conflict:** a second report says the rednote DOM differs. The login selector `.main-container .user .link-wrapper .channel` does not exist there, and `MustWaitStable()` hangs on rednote search. https://github.com/xpzouying/xiaohongshu-mcp/issues/609 (2026-03 to 2026-10, 4)
- creator.xiaohongshu.com shows "系统升级中暂不支持海外用户登录", while `creator.rednote.com/login` works. https://github.com/dreammis/social-auto-upload/issues/226 (2026-06, 4); same message reported in https://github.com/xpzouying/xiaohongshu-mcp/issues/579 (2026-06-22, 4)
- VPS timeouts: the maintainer says they are not necessarily IP bot-detection, and a fix shipped for missing navigation timeouts. https://github.com/xpzouying/xiaohongshu-mcp/issues/699 (2026-05-18 to 2026-10, 4)

**异地登录 / IP risk:**
- Anecdotes say US-number accounts get banned instantly while +86 accounts on the same phone get time-limited bans, and some claim device bans ("xhs 对美国账号异常敏感"). https://www.uscardforum.com/t/topic/430312 `[undated]` (2)
- "IP 地址变更会重新触发验证", and datacenter (WSL/server) IPs draw extra verification. https://mottobook.com/3615 (2026-06-12, 3)
- Operator advice: "养号期间不要修改定位，也不要频繁切换城市". https://www.fensi168.net/article/12.html (2026-09-26, 2)
- **No source found:** an authoritative 2026 statement on whether a +86 account used from a US residential IP is down-ranked, or on how its 异地登录 checks differ. Only the WIRED anecdote about account conversion exists.

---

## 4. 2026 AI-content rules: labeling, 限流 of AI notes, and how AI-niche creators grow

**Rules, in date order:**
- **2026-01-19 公约 2.0:** "如果你在创作中使用了AI辅助工具，请主动标明". This is quoted via the 中国日报网 2026-01-20 report in https://noobclaw.com/cn/blog/xiaohongshu-account-warming-tips/ (4)
- **2026-02-12:** "如创作者在发布环节未主动对AI生成合成内容做标记，平台将基于检测结果对未声明内容添加标识。**此类未主动标识的AI生成合成内容，平台将限制分发**". https://www.thepaper.cn/newsDetail_forward_32599956 (5); https://www.cls.cn/detail/2288768 (5)
- **2026-03-10:** occasional AI-托管 writing, posting or interaction → 警告 or 限制内容分发. Fully 托管 accounts → 封禁. https://www.21jingji.com/article/20260311/herald/5cca3e6e473c9998b318f2f3578e28ab.html (5)
- **2026-04-27:**
  - The self-declare path is 【笔记内容声明】→【笔记含AI合成内容】. An appeal channel for platform-applied labels is live. https://www.sina.cn/news/detail/5292329809478069.html (5)
  - 用户信任中心负责人 吉吉: "**非违规内容，AI贴条不会影响流量**". https://www.stdaily.com/web/gdxw/2026-04/27/content_508976.html (5)
  - Directions given 公域流量资源 include "有信息增量的AI创作教程" and "将复杂知识可视化的科普内容". https://news.qq.com/rain/a/20260427A05JSU00 (5)
  - Four banned categories: AI违规运营, AI造假, AI侵权, and AI低质 ("套用模板批量生产同质化内容"). https://www.ithome.com/0/944/156.htm (5)
- **Tension to flag:** February says unlabeled AI content that the platform detects → 限制分发. April says the label itself does not affect traffic for non-violating content. Safe reading: self-declare. The penalty risk sits with *undeclared* AI content and with templated or batch output. An August secondary source still summarizes it as "未标识内容将被限流". https://www.3elife.net/Art/internet/202608/09/109308.html (3)
- **2026-10-28 AI虚假营销:** 9.3万 notes. AI-fabricated travel, 卖课, hiring and 医美 experiences lead to bans. https://www.sina.cn/news/detail/5359075577038609.html (5)

**How AI-niche (AI工具 / 智能体) creators grow:**
- 阿亮 (跟着阿亮学AI) is an ex-big-tech programmer. He started in 2025-08 and reached about 100k fans in about half a year. The OpenClaw (小龙虾) wave of 2026-03 made the account "起飞". Core lesson: "活人感". https://www.xiaoyuzhoufm.com/episode/6a2e1f20d1efce7e44820aea (2026-06-14, 3)
- A WorkBuddy AI-workbench tutorial reached 34万+ exposure and 5万+ views. Creator-center figures against the category median:
  - CTR 8.5% vs 7.7%.
  - 5s completion 69.6% vs 46%.
  - Interaction 19.4% vs 4.3%.
  - Average watch 45.9s vs 41s.
  - Traffic sources: video-recommend 43.3%, home-recommend 28%, search 16.9%.
  - Topic choice came from "低粉高赞". Prompts were sent via 1:1 DM.
  - Source: https://leiazuo.com/work/xiaohongshu-ai-workbench `[undated]` (4)
- 0→2500 fans with AI tutorials and news, no paid boosting. Every tutorial is run by the author first ("可复现"). Content is split into 涨粉 / 收藏 / 信任 pieces. The comment section is used as the topic backlog. https://www.jxxy.net/ai/articles/Smartpigai-2083776342710239241/ (2026-08-29, 3)
- An AI-hardware brand account: the first 10 notes averaged 2000–5000 exposure at 5–8% interaction, taking the account from 0 to 800 fans. Note #12 hit 128k exposure, 6.2k likes and 2.4k fans. An over-marketed note got about 300 exposure. Caveat: they used 小号 to seed comments, which conflicts with the 6-10 rule against "评论区配合". https://agentaibox.com/articles/kaihe-aibox-xiaohongshu-promotion-case (2026-05-28, 3)
- A 00后 creator reached 2万 fans in about half a year with Vibe Coding and Skill content, and uses a self-built multi-platform publishing Skill. https://www.jxxy.net/ai/articles/Sunkeke_AI-2090076119865405448/ (2026-08-21, 3)
- An SEO guide claims, from 千瓜's 90-day new-万粉 account data, that AI工具测评, AI副业 and AI学习 are the easiest lanes. The data is unverifiable. https://www.tixiaolu.com/posts/ai-writing-xiaohongshu/ (2026-04-17, 2)

---

## 5. 2026 algorithm and traffic changes relevant to a small account

**What is evidence-backed:**
- "77% of Xiaohongshu's daily active users use search to solve a problem, and 75% browse the recommendation feed" (Huxiu, May 2026). Also 400M+ MAU and 800M searches per day (北京商报 via Sina, 2026-05-27). Also 9M+ notes and 70M+ comments per day (WILL 2026 conference, Dec 2025). Also "Notes published in the last day are close to half of all homepage feed exposure", from the platform tech team in `[pre-2026, Mar 2023]`. All via https://www.theredscroll.com/insights/xiaohongshu-algorithm/ (2026-09-15, fetched; 4)
- Official: "小红书搜索结果的排序以及AI问答的内容生成与引用，均以内容的真实质量与用户的真实互动为核心依据". https://weibo.com/5859555080/R3uBx0e5G (2026-06-10, 5)
- From a reading of the official tech articles (2025-01 to 2026-05): search relevance is judged by a model looking at 类目, 主题, 关键词命中 and 核心内容占比. Cold start = content representation + first-batch feedback, so don't mix directions on a new account. https://www.woshipm.com/share/6406921.html (2026-06-03, 3)

**What is NOT evidence-backed and gets recycled as "2026":**
- The CES formula 点赞×1 + 收藏×1 + 评论×4 + 转发×4 + 关注×8 "appears on no platform page, in no engineering talk and in no filing". https://www.theredscroll.com/insights/xiaohongshu-algorithm/ (4)
- One source agrees it is "并非小红书官方发布". https://blog.csdn.net/DBOS_zxhy/article/details/161521865 (2026-05-29, 2)
- Many sources still state it as 2026 fact: https://www.jzl.com/news/xhs-ces (2026-10-10, 2), https://www.opp2.com/384843.html (2026-08-09, 1), https://insight.xiaoduoai.com/e-commerce-information/xiaohongshu-information/xiaohongshu-algorithm-upgrade-2026-traffic-szsshc.html (2026-09-05, 1).
- These same sources assert "2026 upgrades" with no primary source: 15字+ long comments weighted higher, 截图 weighted, and 1–3字 水评 or same-WiFi mutual liking penalized.
- Pool ladders (200 / 500 / 2000…) and timing (5 min / 30 min / 60 min) are not published. "Every ladder you have seen… traces back to an operator post quoting another operator post". https://www.theredscroll.com/insights/xiaohongshu-algorithm/ (4)
- Search-share claims disagree: 30–65% (jzl), 30–70% (opp2), 65% (podcast https://www.xiaoyuzhoufm.com/episode/6a5097d44adef2b36561c4ed, 2026-07-15, 2), and "官方曾公开表示…约35%" (CSDN). Treat all of them as unverified.

**Comment-section behavior and a small account:**
- One anecdote: a polished video stalled near 1400 views with 3 comments in 2h, while a casual text-image note reached 1.2万 views after users asked each other 47 questions in its comments. https://www.jzl.com/news/xhs-ces (2) Anecdote only.
- The first-hand data point above (WorkBuddy tutorial: search was only 16.9% of a viral note's views) cuts against the "search is everything" narrative for fresh notes. https://leiazuo.com/work/xiaohongshu-ai-workbench (4)
- Claims that a new account's initial exposure is 50–100 come from https://www.opp2.com/384843.html and https://blog.csdn.net/DBOS_zxhy/article/details/161521865. Both are unsourced (2).

---

## 6. Comment-section 截流 / 精准引流 and its ban risk in 2026

**Two very different things share the name "截流".**

**(a) Value-add commenting under hot niche notes** to get profile clicks:
- Vendor method: lock 3 keywords, take posts from the last 7 days with more than 100 likes, leave 20 "走心" comments a day, and reply inside hot threads (楼中楼). Claims a large follower gain. https://noobclaw.com/cn/blog/xiaohongshu-nurturing-strategy-comments-growth/ (2026-08-09, 2; vendor)
- A milder version: comment 5–10 per day in your niche to "蹭到同类内容下的精准曝光". https://www.cardcrafter.cn/blog/xiaohongshu-new-account-7-day-plan (2026-09-10, 2)
- No rule bans *genuine* comments. What is banned is automating them: "利用 AI 工具自动运营账号、冒充真人互动". https://www.ithome.com/0/944/156.htm (5)

**(b) 撬客 / off-platform 导流 from comments** is an explicit red line with documented enforcement:
- **2025-02 announcement:** 重点打击评论区"撬客". Accounts that frequently send 撬客私信 get 私信 restricted, and in severe cases "永久禁止私信功能". A 撬客管理 auto-blacklist was later given to 聚光 advertisers with 客资消耗>0 in the last 30 days. https://www.ixunke.com/article/804 `[pre-2026, article 2025-12-08]` (3)
- **2026-06-10:** bans "通过评论区配合、账号矩阵联动等方式人为制造口碑". https://weibo.com/5859555080/R3uBx0e5G (5)
- **2026-08-26:** 水下商家 71.4万, "通过私信或评论区暗中引导交易". 违规营销 46.9万, including "批量注册小号规模化引流". Plus 49.5万 accounts under linked risk devices. https://weibo.com/5859555080/RfcuK5wlb (5)
- **2026-09-18 revised 《交易导流违规管理细则》** (per public interpretations; the full text is not publicly reachable without logging in):
  - Brings 关联账号协同导流 into scope.
  - Risky phrasings include "主页看", "老地方", "其他平台搜同名" and "评论区扣1", when they form an off-site path.
  - Source: https://www.scwepr.com/insights/xiaohongshu-september-18-traffic-diversion-rules.html (2026-09-20, 3)
- **2026-10-20 买手导流:** "10 月至今累计处置违规账号 1500+", with technical recognition of 导流话术. https://www.sina.cn/news/detail/5356123179975825.html (4)
- **Press (南方周末, 2026-05):**
  - "小红书严格禁止任何引导用户加微信、去其他平台交易的导流行为…最严永久封号". https://static.nfnews.com/content/202605/13/c12425097.html (4)
  - One merchant was hit with "笔记包含诱导他人进行点赞、评论、收藏等互动行为的内容" → "账号的流量曝光和商业权益受到限制，且永久生效"; 17 appeals failed. (same source)
  - Support told merchants: "处罚一旦成立，通常无法逆转". (same source)
- Effects reported in practice: on XHS, comments containing "私", "戳我" or "看简介" → "评论被删除或仅自己可见", plus a "评论违规" notice, then lower first-hour recommendation on later notes. https://www.aicheckbao.com/article/30 (2026-10-07, 2)
- Penalty tiers that circulate but are **unverified**:
  - First offence → 私信 restricted 7 days; second → 14-day function ban; third and later → permanent. https://www.jzl.com/industry-news/xhs-ops-9 (2026-11-02, 2)
  - First offence → "禁言 7 天 + 笔记下架 + 限流 30 天". https://www.woshipm.com/share/6458166.html (2026-09-01, 2)
- A user-filed complaint of an account wrongly penalized for 交易导流: posting and interaction blocked, content hidden. https://www.xfb365.com/tousu/102513093 (2026-10-24, 3)

---

## Sources (url · date · score)

| # | URL | Date | Score |
|---|---|---|---|
| 1 | https://weibo.com/5859555080/RfcuK5wlb (薯管家 恶意起号 & 违规营销) | 2026-08-26 | 5 |
| 2 | https://feng.ifeng.com/c/8weVPNRU5zu (互动作弊 公告) | 2026-09-23 | 5 |
| 3 | https://www.guandian.cn/m/show/606205 (互动作弊, 观点网) | 2026-09-23 | 4 |
| 4 | https://www.21jingji.com/article/20260311/herald/5cca3e6e473c9998b318f2f3578e28ab.html (AI托管 公告) | 2026-03-11 | 5 |
| 5 | https://www.ithome.com/0/944/156.htm (AI治理规则) | 2026-04-27 | 5 |
| 6 | https://www.stdaily.com/web/gdxw/2026-04/27/content_508976.html (吉吉 quotes, 80万 AI托管) | 2026-04-27 | 5 |
| 7 | https://news.qq.com/rain/a/20260427A05JSU00 (AI治理规则 full) | 2026-04-27 | 5 |
| 8 | https://www.sina.cn/news/detail/5292329809478069.html (薯管家 AI治理 + declare path) | 2026-04-27 | 5 |
| 9 | https://www.thepaper.cn/newsDetail_forward_32599956 (2-12 AI标识 限制分发) | 2026-02-13 | 5 |
| 10 | https://www.cls.cn/detail/2288768 (2-12 AI标识) | 2026-02-12 | 5 |
| 11 | https://weibo.com/5859555080/R3uBx0e5G (搜索及问答 公告) | 2026-06-10 | 5 |
| 12 | https://finance.sina.com.cn/roll/2026-08-26/doc-iniprumn0953814.shtml (清朗 AI 2nd stage) | 2026-08-26 | 5 |
| 13 | https://www.sina.cn/news/detail/5359075577038609.html (AI虚假营销) | 2026-10-28 | 5 |
| 14 | https://feng.ifeng.com/c/8xmUnC0WuJO (虚假人设 二) | 2026-11-04 | 5 |
| 15 | https://www.21jingji.com/article/20260126/herald/4cb81c4c08e1e67ccbb0ba87f5bfd1f7.html (公约 2.0) | 2026-01-26 | 5 |
| 16 | https://www.thepaper.cn/newsDetail_forward_33644081 (302万 script accounts) — fetched | 2026-07-23 | 3 |
| 17 | https://www.3elife.net/Art/internet/202608/09/109308.html | 2026-08-09 | 3 |
| 18 | https://www.donews.com/news/detail/4/6590586.html (Skill上传规范) | 2026-06-10 | 4 |
| 19 | https://www.sina.cn/news/detail/5356123179975825.html (买手导流 1500+) | 2026-10-20 | 4 |
| 20 | https://static.nfnews.com/content/202605/13/c12425097.html (南方周末 蓝V) | 2026-05-13 | 4 |
| 21 | https://www.scwepr.com/insights/xiaohongshu-september-18-traffic-diversion-rules.html | 2026-09-20 | 3 |
| 22 | https://www.ixunke.com/article/804 (撬客 2025-02 公告) | 2025-12-08 `[pre-2026]` | 3 |
| 23 | https://www.jzl.com/industry-news/xhs-ops-9 | 2026-11-02 | 2 |
| 24 | https://www.woshipm.com/share/6458166.html | 2026-09-01 | 2 |
| 25 | https://www.aicheckbao.com/article/30 | 2026-10-07 | 2 |
| 26 | https://www.xfb365.com/tousu/102513093 | 2026-10-24 | 3 |
| 27 | https://www.wired.com/story/rednote-draws-a-line-between-china-and-the-world/ — fetched | 2026-04-23 | 4 |
| 28 | https://termshub.cn/public/version/5261 (ToS diff 2025-12-12 → 2026-03-24) | 2026-03 | 4 |
| 29 | https://www.elawcn.com/agreement/2026/0301/1751.html (ToS 2025-12-08 text) | 2026-03-01 | 4 |
| 30 | https://www.saikonetwork.com/blog/xiaohongshu-rednote-mainland-international-data-separation | 2026-10-22 | 3 |
| 31 | https://unwire.hk/2026/04/24/rednote-international-split-singapore-data-2026/fun-tech/ | 2026-04-24 | 3 |
| 32 | https://github.com/jackwener/OpenCLI/issues/1136 | 2026-04-22 | 4 |
| 33 | https://github.com/xpzouying/xiaohongshu-mcp/issues/609 | 2026-03 → 2026-10 | 4 |
| 34 | https://github.com/xpzouying/xiaohongshu-mcp/issues/579 | 2026-03 → 2026-06 | 4 |
| 35 | https://github.com/xpzouying/xiaohongshu-mcp/issues/699 | 2026-05-18 | 4 |
| 36 | https://github.com/dreammis/social-auto-upload/issues/226 | 2026-06 | 4 |
| 37 | https://www.uscardforum.com/t/topic/430312 | `[undated]` | 2 |
| 38 | https://mottobook.com/3615 | 2026-06-12 | 3 |
| 39 | https://github.com/xpzouying/xiaohongshu-mcp/issues/668 (封号 thread) | 2026-04-17 → 2026-08 | 4 |
| 40 | https://yousali.com/posts/20260213-browser-automation-anti-detection/ | 2026-02-13 | 4 |
| 41 | https://socai.io/blog/zh/xiaohongshu-automation-tools | 2026-06-07 | 3 |
| 42 | https://developer.volcengine.com/articles/7660412027533770762 (影刀 RPA) | 2026-07-09 | 3 |
| 43 | https://github.com/ReaJason/xhs/issues/93 (461/471) | 2024-04 → 2025-10 `[pre-2026]` | 3 |
| 44 | https://github.com/NanmiCoder/MediaCrawler/issues/668 | 2025-07 `[pre-2026]` | 3 |
| 45 | https://nanmicoder.github.io/MediaCrawler/%E5%B8%B8%E8%A7%81%E9%97%AE%E9%A2%98.html | `[undated]` | 3 |
| 46 | https://www.sina.cn/news/detail/5355097762301379.html (Grok Bot banned 3 days) | 2026-10-17 | 3 |
| 47 | https://chromewebstore.google.com/detail/…/abbnjgmnjeidchddihllfjjaogbdommm (红薯养号器 v3.5.4) | 2026-09-28 | 4 |
| 48 | https://linux.do/t/topic/2750988 | 2026-08-13 | 3 |
| 49 | https://cloud.tencent.com.cn/developer/article/2761880 (MV3 auto-comment plugin, 1–2 min gaps) | 2026-10-15 | 3 |
| 50 | https://noobclaw.com/cn/blog/xiaohongshu-account-warming-tips/ | 2026-10-20 (verified) | 4 |
| 51 | https://noobclaw.com/cn/blog/xiaohongshu-user-agreement-automation-clauses/ | 2026-10-19 | 4 |
| 52 | https://noobclaw.com/cn/blog/xiaohongshu-nurturing-strategy-comments-growth/ | 2026-08-09 | 2 (vendor) |
| 53 | https://www.fensi168.net/article/12.html | 2026-09-26 | 2 |
| 54 | https://www.toolmeow.com/post/51.html | 2026-10-10 | 2 |
| 55 | https://www.cardcrafter.cn/blog/xiaohongshu-new-account-7-day-plan | 2026-09-10 | 2 |
| 56 | https://www.xiaohongshuzc.com/articles/bi-keng-xi-lie-04-yang-hao | 2026-08-24 | 2 |
| 57 | https://www.yujianseo.com/tuiguangzs/5995.html | 2026-01-15 | 1 |
| 58 | https://sungtv.com/zixun/2692.html | `[undated]` | 1 |
| 59 | https://www.woshipm.com/operate/6082342.html | 2024-07-15 `[pre-2026]` | 2 |
| 60 | https://www.theredscroll.com/insights/xiaohongshu-algorithm/ — fetched | 2026-09-15 | 4 |
| 61 | https://www.woshipm.com/share/6406921.html (8 mechanisms from official tech articles) | 2026-06-03 | 3 |
| 62 | https://blog.csdn.net/DBOS_zxhy/article/details/161521865 | 2026-05-29 | 2 |
| 63 | https://www.jzl.com/news/xhs-ces | 2026-10-10 | 2 |
| 64 | https://www.opp2.com/384843.html | 2026-08-09 | 1 |
| 65 | https://insight.xiaoduoai.com/e-commerce-information/xiaohongshu-information/xiaohongshu-algorithm-upgrade-2026-traffic-szsshc.html | 2026-09-05 | 1 |
| 66 | https://www.xiaoyuzhoufm.com/episode/6a5097d44adef2b36561c4ed (AI P&L podcast, 65% search) | 2026-07-15 | 2 |
| 67 | https://leiazuo.com/work/xiaohongshu-ai-workbench | `[undated]` | 4 |
| 68 | https://www.xiaoyuzhoufm.com/episode/6a2e1f20d1efce7e44820aea (阿亮 100k) | 2026-06-14 | 3 |
| 69 | https://www.jxxy.net/ai/articles/Smartpigai-2083776342710239241/ | 2026-08-29 | 3 |
| 70 | https://www.jxxy.net/ai/articles/Sunkeke_AI-2090076119865405448/ | 2026-08-21 | 3 |
| 71 | https://agentaibox.com/articles/kaihe-aibox-xiaohongshu-promotion-case | 2026-05-28 | 3 |
| 72 | https://www.tixiaolu.com/posts/ai-writing-xiaohongshu/ | 2026-04-17 | 2 |
