# Redaily 3.3.2 → 3.5.4 change teardown, mapped onto hs-portal (2026-11-04)

**Scope.** Static, read-only analysis of the installed Redaily **v3.5.4** bundle
(`~/Library/Application Support/Google/Chrome/Default/Extensions/abbnjgmnjeidchddihllfjjaogbdommm/3.5.4_0/`).
The 3.3.2 bundle is gone, so "3.3.2" below means **what our baseline files document**:
`extension/src/content/engine.js` (SEL map + per-op "Redaily …" comments), `extension/src/background.js`,
`extension/rules/shield.json`, `extension/manifest.json`, `redaily-extension-teardown.md`, and the CLAUDE.md
handout ("Verified-matching" list + "Redaily workflows" paragraph). Where the baseline is silent, this report says
"not documented in baseline". It does not guess 3.3.2 behaviour.

**Method.** Python substring search with ±context, plus a Parcel-module extractor (`id:[function(e,t,r){…}`).
Snippets are verbatim from the bundle. Chinese strings are shown **decoded** (the raw file holds `\uXXXX`
escapes). Module ids and raw-file char offsets are given so every snippet can be found again.
Re-extraction recipe: `python3 -I` → `re.search(r'[,{]"?<ID>"?:\[function\(', data)` → slice to the next `}],"?ID"?:[function(`.

**Built-in changelog (the authoritative change list).** The bundle ships its own release catalog
(`static/background/index.js` @575970, the same in every content bundle). Entries newer than 3.3.2, verbatim (zh decoded):

| ver | date | change (verbatim) |
|---|---|---|
| 3.4.0 | 2026-07-18 | `🎉 feat: 发现页养号新增随机搜索词开关` · `🐛 fix: 修复 AI 评论超时导致养号中断的问题` |
| 3.5.0 | 2026-07-31 | `评论区养号的点赞、关注和评论用户收集新增"任一/全部"条件匹配开关` · `发现页养号的评论用户收集新增"任一/全部"条件匹配开关` · `新任务默认满足任一条件即可执行，旧任务保持原有全部条件逻辑` |
| 3.5.1 | 2026-08-20 | `🐛 fix: 修复发现页养号采集笔记时误抓直播卡片和搜索推荐卡片的问题` |
| 3.5.2 | 2026-09-11 | `🐛 fix: 修复指定搜索在切换第二个关键词时中断的问题` |
| 3.5.3 | 2026-09-15 | `修复海外账号发现页养号只搜索、不打开笔记的问题` · `修复海外主页笔记识别和去重异常` · `🎉 feat: 主页区养号根据账号地区自动切换用户主页链接域名` · `修复评论区养号的笔记类型识别异常` |
| 3.5.4 | 2026-09-27 | `统一扩展与服务端的 Pro 权限判断…` · `根据已同步的付费与试用有效期判断权限…` (billing only) |
| (3.3.2, for reference) | 2026-06-02 | `🐛 fix: 修复由于点点ai导致的搜索笔记任务执行失败的bug` |

**Install facts.** Chrome `Secure Preferences` → this extension: `"path": "abbnjgmnjeidchddihllfjjaogbdommm/3.5.4_0"`,
`last_update_time` = **2026-09-28 15:36 UTC**, `"disable_reasons": []`, which means **Redaily is still installed and
enabled** in the same profile hs-portal runs in. It updated about 3 weeks **before** our failures began on Oct 17,
so the update itself does not line up with when the failures started. The parent dir mtime is Oct 17 16:39. That is
probably when Chrome removed the old `3.3.2_0` folder on a restart, not when the update happened.

---

## 1. Bundle inventory

| File | Bytes | Role | vs baseline teardown §1 |
|---|---|---|---|
| `static/background/index.js` | 588,525 | SW: workflow engines, DNR, alarms, tRPC | baseline "575 KB" (same order) |
| `explore.e52e0709.js` | 2,626,508 | content script, all XHS pages except `/user/profile/*` | **same filename hash** as 3.3.2, but the content was rebuilt (it contains the 3.5.4 changelog @2462647). Plasmo filename hashes are NOT content hashes. |
| `user-profile.04aac1fc.js` | 2,617,309 | content script, `/user/profile/*` only | same filename hash, rebuilt (3.5.4 changelog @2578958) |
| `popup.5361fdc2.js` / `options.ea76cfc4.js` / `tabs/welcome.48eb5124.js` (+ `.css` 56,356) | 2,700,457 / 3,725,937 / 2,209,764 | React UIs | — |
| `wechat-qrcode.6da5fc5e.jpg`, 5 icons, `_locales/{en,zh_CN}` | — | assets | — |
| Persisted DNR: `Default/DNR Extension Rules/<id>/rules.json` | 965 | runtime dynamic rules (mtime Nov 4 10:54, so the SW ran today) | baseline also 965 B; contents identical (see §4) |

### Manifest diff (3.5.4 `manifest.json` vs baseline teardown §2)

| Field | 3.5.4 (verbatim) | Baseline | Verdict |
|---|---|---|---|
| `permissions` | `[ "storage", "webNavigation", "alarms", "cookies", "declarativeNetRequest" ]` | same list | **unchanged** |
| `host_permissions` | `[ "https://*/*", "http://localhost:3000/*", "http://localhost/*" ]` | same | **unchanged** (rednote.com is covered only by `https://*/*`; no explicit entry) |
| content_scripts[0].matches | `"*://*.xiaohongshu.com/*", "*://xiaohongshu.com/*", "*://*.rednote.com/*", "*://rednote.com/*"` | `"*://*.xiaohongshu.com/*", "*://*.rednote.com/*"` | **changed**: apex `xiaohongshu.com` and `rednote.com` patterns added |
| content_scripts[0].exclude_matches | `"*://*.xiaohongshu.com/user/profile/*", "*://xiaohongshu.com/user/profile/*", "*://*.rednote.com/user/profile/*", "*://rednote.com/user/profile/*"` | `".../user/profile/*"` (abridged) | apex variants present; the baseline was abridged |
| content_scripts[1] | `"js": [ "user-profile.04aac1fc.js" ]`, matches = the 4 `/user/profile/*` patterns | same file | unchanged routing (profile selectors still live only in `user-profile.*.js`) |
| `world` / `run_at` | **absent** (searched `world`, `MAIN`, `document_start`, `run_at`: 0 workflow hits) | — | Redaily has **no MAIN-world / document_start script** |
| `web_accessible_resources` | `"resources": [ "explore.5aa08c21.css" ]` (listed twice, matches the 4 host patterns). **The file does not exist on disk.** | not documented in baseline | cosmetic |
| `declarative_net_request` | **absent**. Rules are dynamic only. | baseline: dynamic via `updateDynamicRules` | unchanged |
| `version` / `default_locale` / `options_ui` | `"3.5.4"` / `"zh_CN"` / `{ "open_in_tab": true, "page": "options.html" }` | — | — |

---

## 2. Selector diff — every key in our `SEL` map (`engine.js:19-91`)

Legend: **unchanged** = the same selector string is used by the 3.5.4 workflow code. Bundle locations:
EX-act = `explore.e52e0709.js` module `d9zms` (explore-workflow-actions, @2602018). EX-cmt = module `hkdFa`
(comments-workflow-actions, @2586279, **byte-identical copy in `user-profile.*.js` @335417**). AS = `hMkC2`
(actions-shared, @2470668). NC = `Ao5ug` (note-card, @2619579, **new module name**). SD = `a756f`
(search-note-dom, @2620798). UP-act = `user-profile.04aac1fc.js` module `dwyUv` (profile-workflow-actions, @2600915).

| our SEL key | our selector | 3.5.4 selector | evidence snippet (verbatim) |
|---|---|---|---|
| noteContainer | `#noteContainer` | unchanged | AS: `(0,n.default)("#noteContainer").data("type")` |
| feedCards | `.feeds-container .note-item` | unchanged, **but cards are now filtered** | EX-act x(): `(0,c.default)(".feeds-container .note-item").toArray()` → `(0,u.getExploreNoteCoverUrlList)(e)`; NC: `let o=".query-note-wrapper, .xhs-live-note-item, [class*='live-note-item']";function l(e){if(e.matches(o)\|\|e.querySelector(o))return null;` |
| feedCovers | `.feeds-container .note-item a.cover img, … .cover img, [elementtiming="note-cover"] img, … .note-item img` | **changed**: cover = the `img` inside the first `a[href]` whose URL is an XHS/rednote note link | NC: `for(let t of e.querySelectorAll("a[href]")){… new URL(e,"https://www.xiaohongshu.com");if(!["http:","https:"].includes(t.protocol)\|\|!/(^\|\.)(xiaohongshu\|rednote)\.com$/.test(t.hostname))return null;let r=t.pathname.match(/^\/(?:explore\|search_result\|discovery\/item\|user\/profile\/[a-f\d]{24})\/([a-f\d]{24})\/?$/i)` … `t.querySelector("img")` → `getAttribute("src")\|\|.src`. Searched `a.cover`: **0 hits** in all 6 bundles. `[elementtiming="note-cover"]` appears only in `6FUmH` (AI-comment cover context), not in cover discovery. |
| closeNote | `.close-circle .close` | unchanged (explore) | EX-act F(): `let e=(0,c.default)(".close-circle .close")[0];e&&(0,d.simulateClickElement)(e),await (0,l.sleep)(3500)` |
| closeNoteAlt | `.close-circle` | used as the **primary** close in the profile workflow | UP-act M(): `let e=(0,c.default)(".close-circle")[0];e&&((0,d.simulateClickElement)(e),await (0,l.sleep)(2e3))` |
| likeWrap | `.interactions .buttons .like-wrapper` | unchanged | EX-act D(): `(0,c.default)(".interactions .buttons .like-wrapper").eq(0)[0],t=e.querySelector("use")?.getAttribute("xlink:href")==="#liked"` |
| collectWrap | `.interactions .buttons .collect-wrapper` | unchanged | EX-act M(): `(0,c.default)(".interactions .buttons .collect-wrapper").eq(0)[0],t=e.querySelector("use")?.getAttribute("xlink:href")==="#collected"` |
| followBtn | `#noteContainer .follow-button, .follow-button` | explore: `.follow-button` (unchanged); **profile workflow: `.author .follow`** | EX-act C(): `let e=(0,c.default)(".follow-button")[0],t=e.querySelector(".reds-button-new-text")?.textContent==="已关注"`; UP-act L(): `let e=(0,c.default)(".author .follow").eq(0)[0];if(e){let t=(0,c.default)(e).hasClass("followed")\|\|"已关注"===(0,c.default)(e).text().trim()`. `#noteContainer .follow-button`: 0 hits. |
| chatWrapper | `.engage-bar .chat-wrapper, #noteContainer .chat-wrapper` | `.chat-wrapper` (bare, first match) | EX-act _(): `let i=(0,c.default)(".chat-wrapper").eq(0)[0];(0,d.simulateClickElement)(i),await (0,l.sleep)(2e3)`. `.engage-bar .chat-wrapper` appears only in the AICommentHelper UI (@218944), not in workflows. |
| editor | `#noteContainer [contenteditable='true'], .engage-bar [contenteditable='true']` | **not used**. 3.5.4 uses only `getElementById("content-textarea")` | searched `contenteditable`: **0 hits** in all bundles |
| submit | `.engage-bar .submit, #noteContainer .submit, .submit` | `.submit` (bare, `[0]`) | EX-act _(): `let e=(0,c.default)(".submit")[0];(0,d.simulateClickElement)(e),await (0,l.sleep)(5e3)`. `.engage-bar .submit` / `#noteContainer .submit`: 0 hits. |
| searchInputs | 5-entry cascade starting `#search-input-in-feeds textarea[name="aiSearchTextarea"]` | **changed**: 7 entries, **two new ones first**, plus a visibility/usability filter | SD: `let o=["textarea#search-input-in-feeds","textarea#search-input-ai",'#search-input-in-feeds textarea[name="aiSearchTextarea"]',"#search-input-in-feeds textarea.textarea",'.search-area textarea[name="aiSearchTextarea"]',"#search-input",'.header-container input.search-input:not([aria-hidden="true"])']`; filter `if(!e.isConnected\|\|e.closest('[aria-hidden="true"], [hidden], [inert], [button-hp-installed], .button-hp-installed'))return!1;` … `"none"===e.display\|\|"hidden"===e.visibility\|\|…\|\|.01>=Number.parseFloat(e.opacity)` … `r.width>0&&r.height>0` and `e.matches(':disabled, [readonly], [aria-disabled="true"]')` |
| searchSubmits | 3-entry cascade | list unchanged, **but scoped to `.wendian-wrapper` when the input is inside it**, plus a visibility filter | SD: `l=["#search-input-in-feeds .submit-button-wrapper:not(.disabled)",".search-area .bottom-box-right-submit-button .submit-button-wrapper:not(.disabled)",".header-container button.reds-button-new.min-width-search-icon"]` … `function i(e=document){let t=c(e)?.closest(".wendian-wrapper"),r=t??e;for(let e of t?[".submit-button-wrapper:not(.disabled)"]:l)` |
| noteScroller | `.note-scroller` | unchanged | EX-act v(): `t=o()?(0,c.default)(".note-scroller")[0]:(0,c.default)(".note-container")[0]` |
| noteContainerScroll | `.note-container` | unchanged | (same snippet) |
| commentsEl | `.comments-el` | unchanged | EX-cmt p(): `let e=(0,c.default)(".comments-el")[0];if(!e)return …"未找到评论容器"` |
| noComments | `.comments-el .no-comments` | unchanged | EX-cmt p(): `let t=(0,c.default)(".comments-el .no-comments")[0]` |
| commentItems | `.comments-el .parent-comment > .comment-item` | unchanged (ids = the element's own `id` attribute) | EX-cmt p(): `(0,c.default)(".comments-el .parent-comment > .comment-item").toArray();…r.map(e=>(0,c.default)(e).attr("id")\|\|"").filter(e=>""!==e)` |
| parentComment | `.parent-comment` | unchanged | EX-cmt f(): `let a=(0,c.default)(r).closest(".parent-comment")[0]` |
| commentReply | `.interactions .reply` | unchanged | EX-cmt x(): `let u=(0,c.default)(d).find(".interactions .reply")[0]` |
| commentLikeWrap | `.interactions .like .like-wrapper` | unchanged | EX-cmt j(): `(0,c.default)(r).find(".interactions .like .like-wrapper")[0]` … `a.querySelector("use")?.getAttribute("xlink:href")==="#liked"` |
| contentTextarea | `content-textarea` (by id) | unchanged | EX-act _(): `let u=document.getElementById("content-textarea");await (0,l.sleep)(500)` |
| arrowRight | `.arrow-controller.right` | unchanged | EX-act g(): `let t=(0,c.default)(".arrow-controller.right")[0]` |
| fraction | `.fraction` | unchanged | EX-act getImageCount: `let e=(0,c.default)(".fraction")[0];if(!e)return 1;let t=e.textContent,r=t.substring(t.lastIndexOf("/")+1)` |
| videoTime | `.xgplayer-time span:last-child` | unchanged on Redaily's side (`span:last`, a jQuery extension). Ours is a CSS approximation, as before. | EX-act k(): `let e=(0,c.default)(".xgplayer-time span:last").eq(0),t=e.text().split(":")` |
| detailTitle | `#noteContainer #detail-title` | unchanged | EX-cmt u(): `r=(0,c.default)("#noteContainer #detail-title").text()` |
| detailDesc | `#noteContainer #detail-desc` | unchanged | EX-cmt u(): `a=(0,c.default)("#noteContainer #detail-desc").text()` |
| cmtContent | `.content .note-text` | unchanged | EX-cmt f(): `(0,c.default)(a).find(".content .note-text")[0]` |
| cmtLikeCount | `.interactions .like .count` | unchanged | EX-cmt f(): `(0,c.default)(a).find(".interactions .like .count")[0]` |
| cmtReplyCount | `.interactions .reply .count` | unchanged (`"回复"` → 0) | EX-cmt f(): `o.replies="回复"===e?0:d(e)` |
| cmtAvatarLink | `.avatar a[href*='/user/profile/']` | unchanged | EX-cmt f(): `(0,c.default)(a).find(".avatar a[href*='/user/profile/']")[0];m&&(o.profileUrl=m.href,o.userId=(0,c.default)(m).attr("data-user-id"))` |
| cmtUserName | `.author-wrapper .author .name` | unchanged | EX-cmt f(): `(0,c.default)(a).find(".author-wrapper .author .name")[0]` |
| cmtLocation | `.info .date .location` | unchanged | EX-cmt f(): `(0,c.default)(a).find(".info .date .location")[0];return x&&(o.commenter_location=…` |
| userName | `.user-name` | unchanged | EX-cmt m(): `let o=(0,c.default)(".user-name")[0];o&&(t.nickname=…` |
| userRedId | `.user-redId` | unchanged (regex uses a full-width colon) | EX-cmt m(): `(0,c.default)(".user-redId")[0]…e.match(/小红书号：([^\s]+)/)` |
| userIP | `.user-IP` | unchanged | EX-cmt m(): `(0,c.default)(".user-IP")[0]…e.match(/IP属地：(.+)/)` |
| userInteractions | `.user-interactions` | unchanged | EX-cmt m(): `let a=(0,c.default)(".user-interactions")[0]` |
| userInteractionRow | `.user-interactions > div` | unchanged (`find("> div")`, `.count` + `.shows`) | EX-cmt m(): `(0,c.default)(a).find("> div").toArray();…find(".count")[0],o=(0,c.default)(r).find(".shows")[0]` … `l.includes("关注")?…:l.includes("粉丝")?…:l.includes("获赞与收藏")` |
| genderTag | `.user-tags .tag-item:has(.gender)` | unchanged | EX-cmt m(): `r=(0,c.default)(".user-tags .tag-item:has(.gender)")[0];…find("svg use")[0]…"#male"===r?…"#female"===r` |
| profileFollowBtn | `.user-info .follow-btn` | unchanged in the **profile** workflow. The **comments** workflow follows the same profile page with a different selector. | UP-act j(): `(0,c.default)(".user-info .follow-btn").filter((e,t)=>{let r=(0,c.default)(t).text().trim();return"关注"===r\|\|"Follow"===r})[0]`; EX-cmt h() (runs on the profile tab): `let t=(0,c.default)(".follow-button:contains('关注')")[0]` |
| profileNoteCards | `.feeds-container .note-item` | unchanged | UP-act m(): `let e=(0,c.default)(".feeds-container .note-item").toArray();…let t=(0,u.getNoteCardDataList)(e)` |
| profileNoteLink | `a[href^='/explore/']` | **CHANGED, now removed**: replaced by note-card URL parsing (accepts `/user/profile/<uid>/<noteId>`) | searched `a[href^='/explore/']` and `a[href^="/explore/"]`: **0 hits**; `explore/` occurs only in options (UI placeholders). UP-act m() warns `"主页有卡片但未识别到可打开的笔记"`. NC regex above includes `user\/profile\/[a-f\d]{24})\/([a-f\d]{24})`. |

**Inline selectors inside our ops (not SEL keys):**
- `openNextNote` (`engine.js:479`) uses `a.cover img`. **0 hits** in the bundle (see feedCovers).
- `openNextNote` link (`engine.js:482`) uses `a[href*='/explore/'], a[href*='/discovery/item/']`. 3.5.4 also accepts `/search_result/<id>` and `/user/profile/<uid>/<id>` (NC regex).
- `getNoteType` fallback (`engine.js:354`) uses `.xgplayer, .xgplayer-poster, #noteContainer video`. 3.5.4 uses only `$("#noteContainer").data("type")` followed by `sleep(2e3)` (AS m()).
- `getNoteId` (`engine.js:112-115`) uses the regex `(?:explore|discovery\/item)\/…`. 3.5.4 AS: `let e=new URL(window.location.href).pathname.split("/").pop();return e`, which takes the last path segment and so works on `/search_result/<id>` and `/user/profile/<uid>/<id>`.

**New readouts in 3.5.4 that our baseline does not document.** All are from EX-cmt and EX-act:
- `.info .date span:first-child` (comment time, with a full 刚刚/分钟前/小时前/昨天/前天/天前/MM-DD/YYYY-MM-DD parser)
- `.avatar img.avatar-item` (commenter avatar)
- `.user-info .avatar img.user-image` (avatar)
- `.user-desc` (bio)
- `.user-tags .tag-item:not(:has(.gender))` (tags)
- `.gender-text` + `/(\d+)岁/` (age)
- `.author-wrapper .info a`, `.author-wrapper .info .avatar-item` (5×1 s retry), `.author-wrapper .info .username` (note author, read in openNote/getNoteInfo)

### CLAUDE.md "Verified-matching" list, checked one by one

| CLAUDE.md claim | 3.5.4 verdict |
|---|---|
| closeNote `.close-circle .close` | unchanged (explore). Profile closes with `.close-circle` + `sleep(2e3)`. |
| `.comments-el` / `.comments-el .no-comments` | unchanged |
| like/collect `.interactions .buttons .like-wrapper`/`.collect-wrapper`, state `<use> xlink:href === "#liked"/"#collected"` | unchanged |
| openNote = click `img[src=…]` | unchanged. EX-act y(): ``let t=(0,c.default)(`img[src="${e}"]`)[0];if(t){t.scrollIntoView({behavior:"smooth",block:"center"}),await (0,l.sleep)(1e3),(0,d.simulateClickElement)(t),await (0,l.sleep)(3e3);let e=window.location.href`` |
| editor `#content-textarea` (innerText + InputEvent), submit `.submit` | unchanged. `new InputEvent("input",{bubbles:!0,cancelable:!0,inputType:"insertText",data:r})` |
| likeComment `.interactions .like .like-wrapper` | unchanged |
| gather `.avatar a[href*='/user/profile/']` `data-user-id` + `.content .note-text` | unchanged |
| readUser `.user-info` / `.user-interactions > div .count/.shows` / gender `svg use` | unchanged (plus the new fields above) |
| profile-owner follow `.user-info .follow-btn` | unchanged (profile workflow). The comments workflow uses `.follow-button:contains('关注')` on the same page. |
| getProfileNotes `.feeds-container .note-item` img + `a[href^='/explore/']` | **STALE.** The `a[href^='/explore/']` half is gone; see profileNoteLink. |
| search input `#search-input-in-feeds textarea[name="aiSearchTextarea"]` | **demoted to 3rd.** `textarea#search-input-in-feeds` and `textarea#search-input-ai` now come first. |

---

## 3. Workflow / DAG diff

Engines: `static/background/index.js` modules **`7mT7S`** (explore, @117730), **`jyuoV`** (comments, @255192),
**`dtJ4L`** (profile, @270376). The manager is `7L1hI`. All three still use the 3.3.2-documented queue model
(`addTask` splices the next tasks in right after the current index). Tasks run back to back with **no inter-task
delay**. All pacing lives inside the content actions.

### 3.1 Window / navigation (all three engines)

| Step | 3.5.4 verbatim | Our code | Diff |
|---|---|---|---|
| Entry URL | `await this.openXHS(\`https://${"global"===e?"rednote.com":"xiaohongshu.com"}/explore?_t=${Date.now()}\`)` where `e=await (0,u.localStorage).get(c.StorageKeys.REGION)` | `background.js:773` `"https://www.xiaohongshu.com/explore?_t=" + Date.now()` | **changed**: the host comes from a region setting, and it is the **apex** host (no `www.`). |
| Main window | `chrome.windows.create({url:e,type:"popup",width:1024,height:768,focused:!0})` → `waitTabLoaded({tabId,ms:2e4})` → `sendMessage({action:"showModal"})` (identical in `7mT7S`, `jyuoV`, `dtJ4L`) | `background.js:779` `{ url, type: "normal", width: 1024, height: 768, focused: false }` | **changed**: 3.5.4 uses **`focused:!0`**. Our baseline teardown §4 said "Usually focused:false". Our `type:"normal"` is our own deviation. |
| Overlay text shown during a run | EX @150404: `"运行中请不要关闭或最小化浏览器窗口"` | none | Redaily tells the operator not to minimize or close the window (it relies on the window being visible). |
| Commenter-profile visit | `chrome.windows.create({url:a,type:"popup",width:1024,height:768,focused:!1})` → waitTabLoaded 20 s → showModal; later `chrome.windows.remove(this.userProfileWindowId)` | `background.js:1099` `chrome.tabs.create({ windowId: winId, url: c.profileUrl, active: false })` | our deviation: we use a background tab in the (unfocused) main window instead of a separate popup window |
| Comments seed nav | `await chrome.tabs.update(this.targetTabId,{url:a}),await (0,n.waitTabLoaded)({tabId:this.targetTabId,ms:2e4})` + showModal (retried once after 1 s) | `background.js:1195` tabs.update(seed) | same mechanism |
| Profile seed nav | `o=(0,c.resolveProfileUrlForRegion)(t[0],a);await chrome.tabs.update(this.targetTabId,{url:o})` | `background.js:1361` tabs.update(seed), no host rewrite | **new**: host rewrite by region (`aGVas`: `r.hostname.replace(/(xiaohongshu\|rednote)\.com$/,"global"===t?"rednote.com":"xiaohongshu.com")`, applied only to paths matching `/^\/user\/profile\/\w+\/?$/`) |
| Explore nav | no `tabs.update` in `7mT7S`. It opens straight onto `/explore`, then searches and opens notes in-SPA. | runDiscovery, same idea | same |
| `waitTabLoaded` (`jl9pQ`) | polls `chrome.tabs.get` every 1 s while `"loading"`. Ignores `"net::ERR_BLOCKED_BY_CLIENT","net::ERR_ABORTED"`. Default `ms:1e4`, workflows pass `2e4`. | `background.js:666` onUpdated `complete`, 20 s | equivalent |

### 3.2 Explore (discovery) DAG (`7mT7S.addNextTasks`)

Verbatim switch:
`case"openXHS":this.handleOpenXHS();break;case"searchNote":this.addTask("filterNote",[this.workflowData.config.filter]);break;case"filterNote":this.addTask("getCoverUrlList");break;case"getCoverUrlList":this.handleGetCoverUrlList(t);break;case"openNote":this.addTask("getNoteType");break;case"getNoteType":this.handleGetNoteType(t);break;case"getImageCount":this.addTask("browseImage",[t]);break;case"browseImage":case"browseVideo":this.addTask("browseContentAndComments",[this.workflowData.config.gather?.allow||!1]);break;case"browseContentAndComments":this.handleBrowseContentWithGather();…`

```
openXHS
 ├─ search.allow && keywords → searchNote(kw) for EACH kw in orderSearchKeywords(keywords, randomizeKeywords)   [NEW: all keywords, optional shuffle]
 │     searchNote → filterNote(filter) → getCoverUrlList
 └─ else → filterNote(filter) → getCoverUrlList
getCoverUrlList → [openNote(cover) for covers not seen in earlier getCoverUrlList logs] + getCoverUrlList   (pagination by re-listing; no explicit feed scroll)
openNote → getNoteType → normal: getImageCount → browseImage(n) | video: browseVideo | other: (nothing queued)
browse* → browseContentAndComments(gather.allow)
  → [getCommentListForGather if gather] + [likeNote if p] + [collectNote if p] + [followUser if p] + [comment task if p] + closeNote
getCommentListForGather → focusCommentForGather(id, requiredFields)×N → (filters pass or profile fields needed) visitUserProfileForGather(popup focused:false)
  → getUserProfileDataForGather (runs on the profile tab) → gatherUserFromExplore + closeUserProfileTabForGather
```

- **Keyword handling.** `kdWsR`: `function n(e,t,r=Math.random){let a=[...e];if(!t)return a;for(let e=a.length-1;e>0;e-=1){…}` (Fisher–Yates when `randomizeKeywords`, which is the 3.4.0 feature). Every keyword gets its own `searchNote`. Ours runs only `plan.seeds[0]` (`background.js:988`).
- **searchNote now closes any open note first.** EX-act h(): `async function h(e){(0,s.contentScriptLogger).info("searchNote",e),await F();let t=(0,f.findSearchNoteInput)();` (`F` = closeNote). This lines up with the 3.5.2 "second keyword" fix. The Enter → `search_result` check → submit-button fallback → `sleep(3e3)` sequence is unchanged vs our `engine.js:311-343`.
- **Engagement roll.** `shouldPerformAction(e){return e.allow&&(0,a.isTrue)(e.probability)}`, with `isTrue(e)=Math.random()<e/100` (`ekGsC`). Each action has its own probability in percent.
- **Gather filter matching (3.5.0).** `dnfrt`: `function o(e){return e??!0}function s(e,t){return 0===e.length\|\|(o(t)?e.every(Boolean):e.some(Boolean))}` with `NEW_FILTER_MATCH_ALL=!1` (new workflows default to Any).
- **browseContentAndComments early-exit (behaviour change vs our baseline).** EX-act v(e=!1):
  `(0,d.simulateScroll)(t,500),await (0,l.sleep)(2e3),!(!e&&(0,l.isTrue)(80))&&r!==t.scrollTop`.
  When gather is off, each 500 px step has an **80 % chance of stopping**, and the target is a computed reference
  scrollTop (`.note-content` + `.note-scroller .comments-el` − `.note-scroller` heights, or the single-column variant
  using `.media-container`, `#pagination-teleport-container`, `.author`, `.engage-bar`). Our `engine.js:404-423`
  always scrolls up to 8×500 px to the bottom.
- **Unknown note type.** `handleGetNoteType(e){"normal"===e.noteType?this.addTask("getImageCount"):"video"===e.noteType&&this.addTask("browseVideo")}`. Any other type queues nothing (no engage, no close). Ours treats unknown as image (`background.js:951`).
- **Order.** 3.5.4 opens covers in **feed DOM order**, scrolling each into view. Ours picks a random card (`engine.js:502`), which is our own deliberate change.

### 3.3 Comments (comment_section) DAG (`jyuoV`)

`case"openXHS":this.handleOpenXHS();break;case"openNoteUrl":this.currentNoteInfo=t.noteInfo||{},this.addTask("getNoteInfo");break;case"getNoteInfo":this.currentNoteInfo={...this.currentNoteInfo,...t},this.addTask("getNoteType");break;case"getNoteType":this.addTask("getCommentList");break;case"getCommentList":this.handleCommentList(t);…`

```
openXHS → openNoteUrl(url,{isAuthor})×N   (noteUrls entries are a string or {url,isAuthor}; isAuthor is NEW)
openNoteUrl → getNoteInfo (now also returns noteType, the 3.5.3 fix) → getNoteType → getCommentList (sleep 5e3 first)
getCommentList → [focusComment(id, requiredFields) for ids not in earlier lists] + getCommentList
focusComment → if follow-filter ∨ gather-filter ∨ profile-fields-required → visitUserProfile(popup focused:false)
                 → getUserProfileData → [followUserOnProfile?] [gatherUser?] closeUserProfileTab [likeComment?] [reply (first matching content)?]
             else → [likeComment?] [reply?]
```

- getNoteInfo now embeds the type. EX-cmt u(): `o=await (0,i.getNoteType)(),n=o.noteType`.
- Reply selection: `for(let t of r.contents)if(this.checkFilters(t.filters,e)){switch(t.type){case"manual":…case"ai-style":…case"ai-persona":…}break}`. The first content whose filters pass wins.
- Comment pagination never jumps the scroll position. focusComment does `a.scrollIntoView({behavior:"smooth",block:"start",inline:"nearest"}),await (0,l.sleep)(2e3)` per comment. Ours does `scroller.scrollTop = scroller.scrollHeight` (`engine.js:530`).
- 3.5.4 order when a profile is visited: follow → gather → **close the window** → like → reply. Ours (`background.js:1249-1293`) visits, closes, then likes and replies. Same order.

### 3.4 Profile DAG (`dtJ4L`)

```
openXHS → openProfileUrl(url)×N (Fisher–Yates shuffled; url rewritten by region)
openProfileUrl → processedNoteIds.clear(); [followUserProfile if p] + getProfileNotes
getProfileNotes → drop ids seen earlier in this run, then drop notes DB-processed for any enabled action
                  (isNoteProcessed like/comment/collect) → [openProfileNote(coverUrl,noteId)×N] + getProfileNotes
openProfileNote → [followUser if p  (selector `.author .follow`)] + getNoteType
getNoteType → getImageCount→browseImage | browseVideo → browseContentAndComments (always 80% early-exit)
  → [likeNote?] [collectNote?] [comment?] closeNote
closeNote → notesLimit: if processedNoteIds.size >= count → clearPendingNoteTasks()
```

- notesLimit now counts only notes that were actually engaged (3.5.3 "去重"). `likeNote:()=>{t.data?.hasLiked&&(this.statistics.likeCount++,t.data?.noteId&&(this.processedNoteIds.set(t.data.noteId,!0)…` and `clearPendingNoteTasks(){this.taskQueue=this.taskQueue.filter((e,t)=>t<=this.currentTaskIndex\|\|"openProfileNote"!==e.type&&"getProfileNotes"!==e.type)}`. The count is **per profile** (`processedNoteIds.clear()` on each openProfileUrl). Ours caps notes *opened* (`background.js:1422`).

### 3.5 Timings (all from 3.5.4 content actions; ms)

| Op | 3.5.4 | Ours (`engine.js`) |
|---|---|---|
| searchNote | closeNote(3500) → type → 800 → Enter → 1200 → [submit] → 3000 | type → 800 → Enter → 1200 → [submit] → 3000 (no closeNote) |
| getCoverUrlList | 2000 after listing | — |
| openNote / openProfileNote | scrollIntoView → 1000 → click → 3000 (+ avatar retry 5×1000) | 700–1600 → click → wait `#noteContainer` ≤6000 |
| getNoteType | 2000 after read | none |
| browseImage(n) | n× `getRandomIntInRange(2e3,3e3)`, clicking the arrow after each sleep while n≠1 (so n clicks) | (n−1)× 2000–3000 + click |
| browseVideo | `min(duration, 6e4)` | same (5–8 s fallback) |
| browseContentAndComments | 500 px + 2000 per step, 80 % stop per step unless gather | 500 px + 1500–2500, ≤8 steps, stop at bottom |
| like/collect/follow (note) | click → 2000 | 300–900 → click → verify poll |
| comment / reply | click → 2000 / 1000 → 500 → fill → 500 → submit → 5000 | 1600–2400 / 900–1300 → 400–700 → fill → 400–700 → submit → 4500–5500 |
| getCommentList | 5000 before listing | — |
| focusComment | scrollIntoView(start) → 2000 (comments) / 1500 (explore gather) | none |
| likeComment | click → 1000 | 400–1000 → click |
| followUserOnProfile / followUserProfile | click → 2000 | 400–1000 → click |
| closeNote | 3500 (explore) / 2000 (profile) | wait for modal gone ≤4000 |

### 3.6 Failure handling (changed vs our baseline teardown)

- `simulateClickElement` now **throws** on a null element. AS: `function u(e){if(!e)throw Error("simulateClickElement: 目标元素为空,小红书 DOM 可能已变更");`. Our baseline teardown §7 documents a log-and-return. The click events themselves are unchanged: `{bubbles:!0,view:window}`, mousedown → mouseup → click → focus. Ours adds `cancelable:true` (`human.js:24`).
- Explore and profile engines **stop the whole workflow** on any failed task, except AI-comment request errors. `if("skip"===(0,d.decideAICommentFailure)(e.type,r).action){this.skippedAIComments++…return}await this.stop({code:"FAIL",…})`. `hsq6E`: `n=new Set(["commentNoteWithAIStyle","commentNoteWithAIPersona"]),o=new Set(["AI_TIMEOUT","AI_RATE_LIMITED","AI_PROVIDER_UNAVAILABLE","AI_INVALID_RESPONSE"])` (the 3.4.0 fix).
- AI comments re-check that the workflow is still running before submitting. `2T5iE.assertWorkflowStillRunning` → `workflow:isRunningForContentScript`.
- `timeLimit` → `setTimeout(()=>{this.stop({code:"TIMEOUT",…})},6e4*e.duration)`.

---

## 4. Anti-detection / risk handling changes

| Area | 3.5.4 evidence | Verdict vs baseline |
|---|---|---|
| Shield DNR | `IiotF.setupInterceptor()` (id 1 modifyHeaders: UA `…Chrome/120.0.0.0…`, `sec-ch-ua` v120, `?0`, `"macOS"`; response ACAO `*` + credentials `true`, urlFilter `*as.xiaohongshu.com/api/sec/v1/shield/webprofile*`) + `blockShieldRequest()` (id 2 BLOCK, priority 2), both called at SW init (`4HpfL`: `await (0,o.requestInterceptor).setupInterceptor(),await (0,o.requestInterceptor).blockShieldRequest()`). The persisted `rules.json` (965 B) is identical to our `extension/rules/shield.json`. | **unchanged** |
| Shield redirect | `modifyShieldResponse()` (id 3, `redirect:{regexSubstitution:"data:application/json,{}"}`) is defined but **never called** (`modifyShieldResponse` count = 1, the definition only) | dormant |
| rednote shield | searched `as.rednote`: **0** | none. There is no shield rule for a rednote.com host. |
| 461 / 403 | searched `===461`, `461===`, `status:461`: 0. The 7 raw `461` hits are Lucide icon ids/paths. | **not handled** |
| sec gate / 404 | `/404`, `300031`, `verifyMsg`, `sec_`: 0 in workflow bundles | **not handled** |
| captcha / 风控 / 验证码 / 滑块 / 安全验证 / 限流 / 频繁 / 封号 | 0 (decoded search) | **not handled** |
| XHS login state | `redirectPath`, `website-login`: 0. `/login` (bg ×1) is Redaily's own `` `${…getBaseUrl()}/auth/login` ``. | **not handled** |
| XHS API / signing | `/api/sns`, `sns/web`, `edith`: **0**. No `window.fetch=`, `XMLHttpRequest.prototype.open/send` patching, no MAIN-world script. | Redaily **never touches XHS's network layer** |
| Region / rednote | the region setting `"国区（xiaohongshu.com）"` / `"海外（rednote.com）"` (options; default `"cn"`: `y(e\|\|"cn")`), the entry URL by region, `resolveProfileUrlForRegion`, apex + rednote content-script matches, note-card host check `/(^\|\.)(xiaohongshu\|rednote)\.com$/` | **new** (3.5.3). Manual setting only, with no auto-detection. |
| xsec_token | options: `"添加小红书笔记链接，链接必须包含 xsec_token 参数（用于验证访问权限）。 获取方式：在浏览器中打开笔记页面，复制完整的地址栏链接即可。"`. URL validation only checks `e.includes("xiaohongshu.com")\|\|e.includes("rednote.com")`. | no token refresh. Redaily never builds a token URL. Explore `openNote` returns `noteUrl:e` where `e=window.location.href` after the in-SPA open. |
| Fail-fast | the throwing click + stop-on-fail (§3.6) | stricter than our baseline |
| Window visibility | main window `focused:!0` + "don't minimize" overlay | changed (§3.1) |

### Verdicts on our 7 live failures

1. **HTTP 461 on every note open (`/api/sns/web/v1/feed`).** No evidence in the bundle. Redaily has no 461 handling and makes no XHS API calls; its only network measure is the shield rule, which is unchanged and identical to ours. The one relevant **divergence** found: Redaily injects nothing into the page's MAIN world, while we wrap `window.fetch` and `XHR.prototype.open/send` at `document_start` (`manifest.json:26-31`, `nethook.js:200-252`), set `window.__hsNetHook` and a per-XHR `this.__hsUrl`, `postMessage` `__hs_net` payloads to `"*"`, and `engine.js:684-741` fetches edith directly. *Hypothesis, not bundle evidence:* this page-world tampering is the strongest candidate for x-s or env flagging. Confirm with an A/B dry-run with nethook removed.
2. **Business code −9109 参数错误.** No evidence in the bundle (`9109`: 0 hits in all 6 files).
3. **Runs ending on `/login?redirectPath=…`.** No evidence. Redaily has no XHS login or session detection (`redirectPath`: 0).
4. **Sec-gate redirect to `https://www.rednote.com/404?source=/404/sec_…`.** Partially addressed. 3.5.4 adds a manual region setting that opens `https://rednote.com/explore?_t=…`, rewrites profile hosts, and matches apex and rednote hosts in content scripts. It does **not** detect a 404/sec redirect (0 hits). Separately, the 3.5.1 card filter (`.query-note-wrapper, .xhs-live-note-item, [class*='live-note-item']`) keeps Redaily from clicking live and search-suggestion cards, which our `openNextNote` can pick (`engine.js:478-489`). Whether such a click leads to a sec-404 is unverified.
5. **In-feed search no longer reaching `search_result`.** Addressed. Evidence: the new leading input selectors `textarea#search-input-in-feeds`, `textarea#search-input-ai`; the `isUsableSearchNoteInput` visibility filter (skips hidden, inert, `[button-hp-installed]` and 0-size boxes); submit scoped to `.wendian-wrapper`; closeNote before typing (all in SD + EX-act h()).
6. **Stale `xsec_token` seed URLs.** No evidence of any refresh. Redaily relies on user-pasted address-bar URLs (the options text above) and never builds `?xsec_token=` URLs. The nearest pattern is explore `openNote` capturing `window.location.href` right after the in-SPA open, which gives a fresh token.
7. **Automation popups opened `focused:false` running very slowly.** Addressed by design. The main window is `focused:!0` in all three engines, and the overlay says `"运行中请不要关闭或最小化浏览器窗口"`. Only the short-lived commenter-profile popups are `focused:!1`. (Rationale, not bundle evidence: Chrome throttles timers in hidden or occluded pages.)

---

## 5. New in 3.5.4 vs 3.3.2 (per the changelog + code)

- Random search-keyword order toggle, and **all** keywords searched in sequence (3.4.0, `kdWsR`).
- AI-comment failures (timeout, rate limit, provider down, bad response) are **skipped, not fatal** (3.4.0, `hsq6E`). There is also a typed `TaskExecutionError{code,message,retryable,scope}` (`uLPiE`).
- Any/All filter matching for comment like/follow/gather and explore gather. New workflows default to Any (3.5.0, `dnfrt`).
- Live-card and search-suggestion-card exclusion in cover discovery (3.5.1, NC).
- closeNote before each search, so the 2nd+ keyword works (3.5.2, EX-act h()).
- rednote.com region: entry host, profile-URL host rewrite, note-card host/path parser that accepts `/search_result/<id>` and `/user/profile/<uid>/<id>` (3.5.3).
- getNoteInfo returns noteType in the comments workflow (3.5.3).
- Profile notesLimit counts only engaged notes, per profile (3.5.3, `dtJ4L`).
- `isAuthor` per seed note, passed to AI replies (comments workflow).
- Pro-entitlement fix (3.5.4, cloud/billing; not applicable to us).
- Present in 3.5.4 but not documented in our baseline: the badge text (`chrome.action.setBadgeText({text:e})` = number of running engines, `7L1hI`), the `workflow_<id>` alarms that start an engine (`2Yt2D`), and the `version_checkUpdate` alarm every 180 min (`giQsw`).
- **AICommentHelper** (from 3.3.0, default ON: `b(!1!==r&&"false"!==r)`) runs on every note page. It installs `new MutationObserver(t)` on `document.body` plus `window.setInterval(t,1e3)`, and overlays AI buttons on `.engage-bar .chat-wrapper` and `.comment-item .interactions .reply`. Because Redaily is still enabled, **this runs inside our automation window too**.

---

## 6. Required changes for hs-portal (ranked)

> "Must" items copy a verified 3.5.4 mechanism. Items marked *(hypothesis)* fit the evidence but have to be A/B-tested before we treat them as fixes.

1. **[P0, failure 1, hypothesis] Stop tampering with the page's network layer during automation.** Redaily 3.5.4 has no MAIN-world script and no XHS API calls.
   - `extension/manifest.json:26-31`: drop or gate the `world:"MAIN"` nethook entry.
   - `extension/src/content/nethook.js:200-252`: fetch/XHR wrappers. Also `:17-18` `window.__hsNetHook` and `:24-27` `postMessage(…,"*")`.
   - `extension/src/content/engine.js:684-741`: `fetchMe` / `fetchSelfInfo` direct edith fetches.
   - A/B test: one dry-run with nethook off vs on, then compare 461s on `/feed`.
2. **[P0, failure 7] Open the automation window like 3.5.4 does.**
   - `background.js:779`: `windows.create({url, type:"popup", width:1024, height:768, focused:true})`. Keep the governor.
   - The aux commenter visit (`background.js:1099`) should become a separate `type:"popup", focused:false` window closed with `windows.remove`. That is Redaily's exact mechanism, instead of a background tab in an unfocused window.
   - Review the other `focused:false` windows: `background.js:337` (snapshot), `:1796` (scan), `:1869` (remix).
   - Show an in-window "don't minimize" notice. Our pill at `engine.js:836` could carry it.
3. **[P0, failure 5] Search parity.**
   - `engine.js:43-49` (searchInputs): prepend `"textarea#search-input-in-feeds"` and `"textarea#search-input-ai"`.
   - `engine.js:98-104` (`qFirst`) / `:313`: add the `isUsableSearchNoteInput` filter (isConnected; not inside `[aria-hidden="true"], [hidden], [inert], [button-hp-installed], .button-hp-installed`; no ancestor with `display:none` / `visibility:hidden|collapse` / `opacity<=.01`; non-zero rect; not `:disabled, [readonly], [aria-disabled="true"]`).
   - `engine.js:50-54` + `:336`: scope the submit to `.wendian-wrapper` → `.submit-button-wrapper:not(.disabled)` when the input sits inside it, and apply the same visibility filter.
   - `engine.js:311`: call `closeNote` first.
   - `background.js:987-1003`: search **every** keyword (optionally shuffled), each followed by its own browse loop, not just `plan.seeds[0]`.
4. **[P0, failure 4] Card filtering + note-id parsing (3.5.1/3.5.3).**
   - `engine.js:28-29` (feedCovers) and `engine.js:478-489` (openNextNote collect): skip cards that match or contain `.query-note-wrapper, .xhs-live-note-item, [class*='live-note-item']`.
   - Take the cover from the `img` inside the first `a[href]` whose URL host matches `/(^|\.)(xiaohongshu|rednote)\.com$/` and whose path matches `/^\/(?:explore|search_result|discovery\/item|user\/profile\/[a-f\d]{24})\/([a-f\d]{24})\/?$/i`. Capture group 1 is the noteId.
   - `engine.js:112-115` getNoteId: use `new URL(location.href).pathname.split("/").pop()`.
5. **[P0] Profile notes are broken on current XHS.**
   - `engine.js:90` (profileNoteLink `a[href^='/explore/']`) and `getProfileNotes` `engine.js:799-814`: replace with the same note-card parser. 3.5.4 removed `a[href^='/explore/']` and accepts `/user/profile/<uid>/<noteId>`.
6. **[P1, failure 4] Region-aware origin.**
   - Hardcoded `https://www.xiaohongshu.com` at `background.js:557` (XHS_ORIGIN), `:773`, `:801`, `:337`, `:365`, `:381`, `:1796`, `:1867`.
   - Route them through one origin resolver: Redaily uses `https://${region==="global"?"rednote.com":"xiaohongshu.com"}` (apex). Add a region config, or derive it from the host the first warm load actually landed on.
   - Rewrite profile-URL hosts the way `aGVas` does before `background.js:1361` (and when building `pickProfileSeeds` URLs, `background.js:624`).
   - Optional: add apex patterns to `manifest.json:28,34`. *Note:* Chrome's `*.` host wildcard should already match the apex. Check this against the Chrome match-pattern docs before treating it as a gap.
7. **[P1] Note reading depth.**
   - `engine.js:404-423` browseContentAndComments: copy the reference-scrollTop target plus the **80 % per-step early stop unless gathering** (`!(!e&&isTrue(80))`). Pass `gather` from `background.js:952` (browseNote).
   - In profile mode, always use the random stop.
8. **[P1] Follow selectors by context.**
   - Profile-mode note-author follow (`background.js:1442` → `engine.js:768` followUser / SEL.followBtn `engine.js:36`): 3.5.4 uses `.author .follow` with `hasClass("followed")` or text `已关注`. Add a profile-context op or extend the selector.
   - Commenter-profile follow (`background.js:1145` → followUserProfile `engine.js:781`): keep `.user-info .follow-btn` and add the comments-workflow fallback `.follow-button:contains('关注')`, implemented as a text filter since `:contains` is jQuery-only.
9. **[P1] Comment pagination without scroll jumps.**
   - `engine.js:525-535` loadComments sets `scrollTop = scrollHeight`. Instead, copy getCommentList (`sleep 5e3`, list ids) + focusComment (per comment `scrollIntoView({behavior:"smooth",block:"start",inline:"nearest"})` + `sleep 2e3`, reading the fields), and re-list after each batch.
   - Wire this in at `background.js:1214-1222`.
10. **[P2, failure 6] Fresher comment seeds.**
    - `background.js:583-585` hotNoteSeedUrl builds `?xsec_token=` URLs from stored captures. Copy 3.5.4's `noteUrl: window.location.href` captured right after the in-SPA open: record it in runDiscovery after `background.js:1035` and prefer it, harvested soon after, for comment_section seeds. Treat older tokens as expired.
11. **[P2] browseImage count.** `engine.js:374-377`: 3.5.4 sleeps n times and clicks while n≠1. Ours does n−1 iterations. Minor.
12. **[P2] Coexistence confound.** Redaily 3.5.4 is enabled in this profile (`disable_reasons: []`). Its content scripts plus the AICommentHelper observer, interval and button overlays run inside our automation window. Disable Redaily, or at least its "AI评论入口", in this profile while debugging 461s. This is an operator action; no code change.
13. **[P3] Docs.** These CLAUDE.md lines are now inaccurate and need correcting (proposal only; needs approval):
    - the Verified list `getProfileNotes … a[href^='/explore/']` and the search-input entry;
    - the main-window `focused:!1` claim in `background.js:777-778`;
    - the "nav … then `tabs.update` inside it" claim, which holds for comments/profile only (explore opens straight onto `/explore`).
- **No change needed:** `extension/rules/shield.json` (identical to 3.5.4's live rules).

---

## 7. Self-check

| Required | Status | Evidence |
|---|---|---|
| (1) every changed/unchanged claim has a verbatim snippet or a stated search | PASS | each SEL row cites a module snippet. Absences cite the search string and a 0 count (`a.cover`, `contenteditable`, `a[href^='/explore/']`, `9109`, `redirectPath`, `/api/sns`, `as.rednote`, …). |
| (2) every SEL key covered | PASS | 42/42 keys in §2 (noteContainer … profileNoteLink), plus the inline op selectors and the CLAUDE.md verified list |
| (3) each of the 7 failures has a verdict | PASS | §4 "Verdicts" 1–7 |
| (4) required changes name file:line | PASS | §6 items 1–13 cite `engine.js`, `background.js`, `manifest.json`, `nethook.js` lines |
| Must-NOT: no inferred 3.3.2 behaviour | PASS | "3.3.2" is only ever our baseline files or Redaily's own changelog. Diffs are phrased vs baseline. |
| Must-NOT: no invented selectors | PASS | every 3.5.4 selector is quoted from the bundle |
