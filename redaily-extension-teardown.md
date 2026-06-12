# Redaily — Chrome Extension Teardown

> **What it is:** `Redaily` (v3.3.2, ID `abbnjgmnjeidchddihllfjjaogbdommm`) is a **Xiaohongshu / RED (小红书, rednote.com) account‑farming bot** — marketed as "automated account maintenance, simulating human‑like interactions." 养号 ("yǎng hào" = account nurturing) is literally its backend domain. It auto‑browses, likes, collects, follows, and comments to keep an account looking active.
>
> **Author:** Leo Hunter `<leohuntercn@gmail.com>` · **Backend:** `https://yanghao.app` · **Framework:** [Plasmo](https://www.plasmo.com/) (React) · **Manifest:** V3
>
> This document is a static reverse‑engineering summary based on the unpacked source on disk. Nothing here was inferred from marketing material; every claim maps to code in the installed bundle.

---

## 1. On‑disk layout

Installed (unpacked, fully readable) at:

```
~/Library/Application Support/Google/Chrome/Default/Extensions/
    abbnjgmnjeidchddihllfjjaogbdommm/3.3.2_0/
```

`Default` is the profile internally; its display name is **tk**. State lives alongside the code in the same profile:

| Path | Contents |
|---|---|
| `…/3.3.2_0/` | Unpacked source (manifest + bundles) |
| `…/Local Extension Settings/<id>/` | `chrome.storage.local` (LevelDB) → stores `auth_session`, `user`, `email` |
| `…/DNR Extension Rules/<id>/rules.json` | declarativeNetRequest header/block rules (anti‑detection) |

Key files in the bundle:

| File | Size | Role |
|---|---|---|
| `static/background/index.js` | 575 KB | Service worker — orchestrator, tRPC client, window/tab control, DNR rules |
| `explore.e52e0709.js` | 2.6 MB | Content script on all `xiaohongshu.com` / `rednote.com` pages (feed engine) |
| `user-profile.04aac1fc.js` | 2.6 MB | Content script on `/user/profile/*` (profile actions) |
| `popup` / `options` / `tabs/welcome` | — | React control‑panel UIs |

The code is **bundled and minified (Plasmo/Parcel) but not obfuscated** — it deobfuscates cleanly with standard tools.

---

## 2. Manifest summary

```jsonc
{
  "manifest_version": 3,
  "background": { "service_worker": "static/background/index.js" },
  "content_scripts": [
    { "js": ["explore.e52e0709.js"],      "matches": ["*://*.xiaohongshu.com/*", "*://*.rednote.com/*"],
      "exclude_matches": [".../user/profile/*"] },
    { "js": ["user-profile.04aac1fc.js"], "matches": [".../user/profile/*"] }
  ],
  "permissions": ["storage", "webNavigation", "alarms", "cookies", "declarativeNetRequest"],
  "host_permissions": ["https://*/*", "http://localhost:3000/*", "http://localhost/*"],
  "key": "MIIBIjAN…"   // RSA pubkey → pins the extension ID; NOT a license key
}
```

Notable:
- **No `nativeMessaging`, no `debugger`, no `tabs`, no `externally_connectable`.** It does **not** launch a separate Chrome binary or use CDP/DevTools Protocol.
- `host_permissions: https://*/*` + read/change data on **all sites** → very broad reach beyond Xiaohongshu.
- `localhost:3000` is the **dev** backend; production is `https://yanghao.app`.

---

## 3. Architecture

```
                       ┌──────────────────────────────┐
   https://yanghao.app │   CLOUD (tRPC server)         │  membership/VIP, task plans,
   (auth_session)  ◄───┤   - WHAT to do (targets,      │  target lists, status sync
                       │     comment text, counts)     │
                       └──────────────┬───────────────┘
                                      │ tRPC (httpBatchLink), auth_session cookie
                       ┌──────────────▼───────────────┐
                       │   SERVICE WORKER (background) │  orchestrator:
                       │   - opens/closes popup window  │  - windows.create / remove
                       │   - navigates tab             │  - tabs.update + waitTabLoaded
                       │   - dispatches task messages  │  - declarativeNetRequest rules
                       └──────────────┬───────────────┘
                                      │ chrome.tabs.sendMessage  {action:"task:*:exec"}
                       ┌──────────────▼───────────────┐
                       │   CONTENT SCRIPT (in tab)     │  THE "HOW" (all local):
                       │   explore.js / user-profile.js│  - element selection
                       │                               │  - synthetic DOM events
                       │                               │  - scroll, timing, state read
                       └──────────────┬───────────────┘
                                      │ acts on
                       ┌──────────────▼───────────────┐
                       │   Xiaohongshu page DOM        │
                       └──────────────────────────────┘
```

**The local ↔ cloud boundary is the most important design fact:**

| | Where | Contains |
|---|---|---|
| **The "HOW"** (every gesture) | **Local — content scripts** | Element selection, synthetic events, scrolling, timing, state detection |
| **The "WHAT"** (the plan) | Cloud `yanghao.app` → background → content script | Which `noteId`/`userId` to act on, comment text, target counts, membership gating, status sync |

The cloud **cannot and does not** send pixel‑level instructions. It sends a high‑level job ("like note X, follow user Y, post comment Z, count 5"); the browser computes every interaction locally.

---

## 4. How it sets up & controls Chromium

It does **not** spawn a new Chrome process. It opens a **detached popup window in the same profile** and drives the tab inside it. The "local Chrome instance" a user perceives is this popup.

### Window lifecycle (background orchestrator)

> **Source:** `static/background/index.js` — `windows.create` ×6, `tabs.update` ×3, `waitTabLoaded` ×8, `tabs.sendMessage` ×18, `windows.remove` ×4. (None of these appear in the content scripts; window/tab control is background‑only.)

```js
// FILE: static/background/index.js
// 1. Open a detached popup window (same profile → reuses your XHS login cookies).
//    Usually focused:false so it runs in the background. NOT incognito.
const win = await chrome.windows.create({ url, type:"popup", width:1024, height:768, focused:false });
const targetTabId = win.tabs[0].id;

// 2. Navigate that tab and wait for it to finish loading (20 s timeout).
await chrome.tabs.update(targetTabId, { url });
await waitTabLoaded({ tabId: targetTabId, ms: 20000 });

// 3. Tell the content script to execute a task.
chrome.tabs.sendMessage(targetTabId, { action: "task:explore:exec", data: { taskType, args } });
//   variants: "task:comments:exec", "task:profile:exec"

// 4. When the workflow finishes, close the window.
chrome.windows.remove(win.id);
```

Counts in the bundle: `chrome.windows.create` ×6, `windows.remove` ×4, `tabs.update` ×3, `tabs.sendMessage` ×18.

### Messaging bus (Plasmo)

> **Source:** message names appear in `static/background/index.js` and the content scripts; routed via `chrome.runtime.onMessage` + Plasmo `sendToBackground`/ports.

Two layers of message passing coordinate background ↔ content script:

- **Workflow control:** `workflow:start`, `workflow:stop`, `workflow:stopFromContentScript`, `workflow:getDataFromContentScript`, `workflow:getRunningWorkflows`, `workflow:closeCurrentTab`, `comments-workflow:openUserProfile`.
- **Task execution:** `task:explore:exec`, `task:comments:exec`, `task:profile:exec`, `runTask`.
- **Status:** `started`, `stopped`, `workflowStopped`.

### Scheduling

> **Source:** `static/background/index.js` — `chrome.alarms.create` ×1, `chrome.webNavigation.onErrorOccurred` listener.

- The **only** `chrome.alarms` is `version_checkUpdate` (`periodInMinutes:180`) — a 3‑hour **update check**, *not* a farming cron.
- Farming runs are **workflow‑triggered** (the user/UI starts a workflow), with pacing handled *within* the run (see §7). There is no autonomous 24/7 background scheduler.
- `chrome.webNavigation.onErrorOccurred` is used to detect navigation failures in the driven tab.

---

## 5. Backend, auth, and the "key"

> **Source:** all in `static/background/index.js` — base‑url module `@shared/lib/base-url` (`yanghao.app` ×2), `createTRPCClient`/`httpBatchLink` (×10), `auth_session` (×10), `chrome.cookies.onChanged` (×1). The `key` field is in `manifest.json`.

- Base URL resolver returns `https://yanghao.app` in production, `http://localhost:3000` in dev:
  ```js
  // FILE: static/background/index.js  (module "@shared/lib/base-url")
  function prod() { return "https://yanghao.app"; }
  function dev()  { return `http://localhost:${3000}`; }
  ```
- Transport is **tRPC** (`createTRPCClient` + `httpBatchLink`).
- **Auth = a server session cookie named `auth_session`**, *not* a local license:
  1. User logs in at `yanghao.app` in a normal tab → server sets the `auth_session` cookie.
  2. A `chrome.cookies.onChanged` listener copies that cookie into `chrome.storage.local` (background reads it with `chrome.cookies.get({url: baseUrl, name:"auth_session"})`).
  3. Every tRPC request attaches it:
     ```js
     // FILE: static/background/index.js
     headers: async () => {
       const { auth_session } = await chrome.storage.local.get("auth_session");
       return auth_session ? { /* attached to tRPC request */ } : {};
     }
     ```
- Persisted state confirmed in LevelDB: `auth_session`, `user`, `email`.
- The manifest `"key"` field is unrelated — it is the RSA public key that deterministically pins the extension ID.

**So "everything is local" is false:** membership state and task plans are server‑side; only execution is local.

---

## 6. Action protocol (what it can do)

> **Source:** dispatched from `static/background/index.js` (`task:*:exec` messages) and executed in `explore.e52e0709.js` / `user-profile.04aac1fc.js`. `action:"gather"` appears ×4 in `explore.e52e0709.js`, ×2 in `user-profile.04aac1fc.js`.

Tasks arrive as `chrome.tabs.sendMessage(tabId, {action:"task:*:exec", data:{taskType, args}})`; richer actions also flow over Plasmo ports as `{action, body:{noteId, commentId, userId, content/commentContent, count}}`.

| Action | Payload | DOM target / mechanics |
|---|---|---|
| `scroll` | `top`, polling interval | `scrollBy({behavior:"smooth", top})` on a fixed `setInterval`; feed‑browsing / "appear active" |
| `like` | `noteId` | `#noteContainer .engage-bar` like icon; reads `.engage-bar.active` + SVG `<use>` to detect already‑liked, reads `.count` |
| `collect` (⭐) | `noteId` | same engagement toolbar, collect/favorite icon |
| `follow` | `noteId` / `userId` | follow button (`.reds-button-new-text`, RED design system); also in `user-profile.js` |
| `comment` | `noteId`, `commentContent` | focuses `.engage-bar .chat-wrapper`, types via `insertText` + `KeyboardEvent` keydown/keypress/keyup, submits |
| `reply` | `noteId`, `commentId`, `content` | `.comment-item .interactions .reply` → scroll parent comment into view → type reply |
| `gather` | `noteId`, `commentId`, `userId` | **Scrapes users who commented on a note** into a target list, marks `isProcessed`/`data-yhq-ai-*` to dedupe (`gatherUserFromExplore`, `gatherCount`) |

**`gather` is the targeting pipeline:** browse → harvest commenter `userId`s → dedupe → feed them into `follow`/`reply`. The full loop is *browse → gather targets → engage → sync status to yanghao.app*.

---

## 7. Execution primitives (the local engine)

> **Source:** bundled into **both** content scripts (`explore.e52e0709.js` and `user-profile.04aac1fc.js`). Occurrence counts: `simulateClickElement` 27 / 23, `sleep(` 46 / 36, `scrollIntoView` 3 / 2, `.engage-bar` selector 8 / 8, `data-yhq-ai-*` markers 11 / 11.

### Clicking — synthetic events on the element (not coordinates)

```js
// FILE: explore.e52e0709.js  (also bundled in user-profile.04aac1fc.js)
function simulateClickElement(e) {
  if (!e) { log("元素为空,小红书 DOM 可能已变更"); return; } // "element empty, XHS DOM may have changed"
  const t = { bubbles: true, view: window };
  e.dispatchEvent(new MouseEvent("mousedown", t));
  e.dispatchEvent(new MouseEvent("mouseup",   t));
  e.click ? e.click() : e.dispatchEvent(new PointerEvent("click", { bubbles: true }));
  e.focus?.();
}
```

There is **no x/y coordinate**, no mouse‑movement path, no hover dwell. All synthetic events have `isTrusted === false` (unavoidable from a content script).

### Scrolling

`element.scrollIntoView({ behavior:"smooth", block:"center" })` before acting, plus `scrollBy({ top })` for feed scrolling. Fixed amounts, polling `setInterval` at 300–1000 ms. No variable velocity, momentum, or reading pauses.

### Timing — **fixed constants, no jitter**

`sleep(ms) = new Promise(r => setTimeout(r, ms))` (defined `~modules/shared` helper, imported as `sleep`), called with hardcoded values across `explore.e52e0709.js` (46 calls) and `user-profile.04aac1fc.js` (36 calls):

```
sleep(2000) ×24   sleep(1000) ×16   sleep(500) ×16
sleep(5000) ×9    sleep(3000) ×5    sleep(800/1200/1500/3500) ×1 each
```

`Math.random` is **never** wired into any `sleep`/`setTimeout`/`delay`. `randomInt`/`shuffle` exist in the bundle only as library code — not applied to action timing or target ordering.

### DOM selectors (Xiaohongshu‑specific)

> **Source:** `explore.e52e0709.js` (and `user-profile.04aac1fc.js` for follow). Grep e.g. `grep -o 'querySelector[^)]*)' explore.e52e0709.js`.

| Selector | Purpose |
|---|---|
| `#noteContainer .engage-bar` / `.engage-bar.active` | like/collect/comment toolbar; `.active` = current state |
| `.engage-bar .chat-wrapper` | comment input box |
| `.count` | like/collect counts |
| `use` (SVG `<use>`) | icon identity / filled‑vs‑empty state |
| `.comment-item .interactions .reply` | reply buttons |
| `.reds-button-new-text` | RED design‑system buttons (follow, etc.) |
| `[data-yhq-ai-*]` | the extension's **own** bookkeeping markers (seen / hidden / overlaid) to avoid reprocessing |

---

## 8. Anti‑AI / anti‑detection analysis

**Verdict: one deliberate network‑layer evasion; behaviorally naive.** Many "evasion" signals found on first pass were library noise (`asterisk` contains the substring "risk"; Lucide `shield`/`sliders` icons; React's `navigator.scheduling`).

### What it actually has

1. **Shield neutralization (the only intentional mechanism).** Rules are written at runtime by `static/background/index.js` (`chrome.declarativeNetRequest.updateDynamicRules` ×5) and persisted by Chrome to `DNR Extension Rules/<id>/rules.json` (965 bytes). They target XHS's anti‑bot endpoint `as.xiaohongshu.com/api/sec/v1/shield/webprofile`:
   - **Block** it (stops XHS collecting fingerprint/behavior telemetry).
   - **Normalize** headers it can't block — pins `User-Agent` (Chrome 120), `sec-ch-ua`, `sec-ch-ua-platform:"macOS"`, `sec-ch-ua-mobile:?0`; sets `Access-Control-Allow-Origin:*` + `Allow-Credentials:true` on responses.

   ```jsonc
   // FILE: ~/Library/Application Support/Google/Chrome/Default/
   //         DNR Extension Rules/abbnjgmnjeidchddihllfjjaogbdommm/rules.json (abridged)
   { "id":1, "priority":1, "action": { "type":"modifyHeaders",
       "requestHeaders":[ {"header":"User-Agent","operation":"set","value":"…Chrome/120…"},
                          {"header":"sec-ch-ua-platform","operation":"set","value":"\"macOS\""}, … ] },
     "condition": { "urlFilter":"*as.xiaohongshu.com/api/sec/v1/shield/webprofile*",
                    "resourceTypes":["xmlhttprequest","other"] } }
   { "id":2, "priority":2, "action": { "type":"block" }, "condition": { /* same shield URL */ } }
   ```

2. **Realistic event sequence** — `mousedown → mouseup → click → focus` instead of a bare `.click()`.

3. **Smooth `scrollIntoView`** before each action.

### What it does NOT have

| Mechanism | Present? | Evidence |
|---|---|---|
| Timing jitter / randomized delays | ❌ | All `sleep()` values are fixed constants; `Math.random` never feeds a delay |
| Smart scrolling (velocity, momentum, reading pauses, scroll‑back) | ❌ | fixed `scrollBy` amounts, fixed `setInterval` |
| Smart clicking (coordinates, mouse path, hover dwell) | ❌ | `.click()` on element; `isTrusted=false`, unhidden |
| Frequency control (daily caps, per‑hour limits, cooldowns, rest, working hours) | ❌ (locally) | none found; `count` comes from cloud task |
| `navigator.webdriver` hiding / `cdc_` cleanup | ❌ | no spoof code |
| Canvas / WebGL / font fingerprint randomization | ❌ | none |
| Captcha / slider‑challenge detection or solving | ❌ | none |
| Risk‑control / ban response / backoff | ❌ | 验证 / 风控 / 封号 / 频率 / 间隔 / 休息 → **0 occurrences** |

### Why it still works

Its stealth rests on two things — only one is code:

1. **It runs inside the user's real, logged‑in Chrome profile.** The popup reuses genuine cookies, IP, TLS fingerprint, and a real browser environment. To a *server‑side fingerprint* check it genuinely **is** a real human's Chrome. This is its strongest evasion and it is free, not engineered.
2. **Suppressing the one `shield/webprofile` telemetry endpoint.**

Everything *behavioral* is robotic: fixed 0.5–5 s delays, fixed scroll, fixed order, `isTrusted:false` events, no caps. A platform running **behavioral** analysis (inter‑action timing variance, `isTrusted` checks, perfectly centered clicks, zero mouse movement) could flag it. The fixed 2000 ms rhythm is arguably *more* detectable than no automation — the product bets XHS's behavioral layer never fires once the fingerprint endpoint is killed and the session is real.

---

## 9. Permissions & risk

- `host_permissions: https://*/*` + "read and change all your data on websites you visit" + `cookies` on every site → far more reach than Xiaohongshu alone. Capability for broad data access exists, though no credential‑exfiltration logic was observed.
- The XHS account session is fully exposed to the extension **and** to `yanghao.app`, which it phones home to.
- Membership/VIP gating and the task list are server‑controlled; disabling/uninstalling stops all automation locally.

---

## 10. Reproduction / audit notes

- **Read the source:** files are unpacked at the path in §1 — open directly, no extraction needed. (Alternatively download the `.crx` by ID and unzip.)
- **Deobfuscate bundles:** `webcrack` / `wakaru` / `humanify` make the minified Plasmo output readable.
- **Inspect live:** `chrome://extensions` → Redaily → "Inspect views: service worker" for runtime tracing; set breakpoints in the driven tab to watch `simulateClickElement` and the task messages.
- **Inspect stored state (keys only, don't leak the token):** the LevelDB at `…/Local Extension Settings/<id>/` holds `auth_session`, `user`, `email`.

---

## 11. Source reference map

Every mechanism in this document maps to a concrete file in the installed bundle. Paths are relative to:
`~/Library/Application Support/Google/Chrome/Default/Extensions/abbnjgmnjeidchddihllfjjaogbdommm/3.3.2_0/`
(state files are under the sibling `Default/Local Extension Settings/<id>/` and `Default/DNR Extension Rules/<id>/`).

| Mechanism (§) | File | Anchor / occurrences |
|---|---|---|
| Manifest, permissions, `key` (§2) | `manifest.json` | whole file |
| Open/close popup window (§4) | `static/background/index.js` | `chrome.windows.create` ×6, `windows.remove` ×4 |
| Navigate driven tab (§4) | `static/background/index.js` | `chrome.tabs.update` ×3, `waitTabLoaded` ×8 |
| Dispatch task to content script (§4,§6) | `static/background/index.js` | `chrome.tabs.sendMessage` ×18, `task:explore:exec` / `task:comments:exec` / `task:profile:exec` |
| Workflow messaging bus (§4) | `static/background/index.js` + content scripts | `workflow:start` / `:stop` / `:getDataFromContentScript` / `:closeCurrentTab` |
| Update‑check alarm (§4) | `static/background/index.js` | `chrome.alarms.create("version_checkUpdate", {periodInMinutes:180})` ×1 |
| Backend base URL (§5) | `static/background/index.js` | module `@shared/lib/base-url`, `yanghao.app` ×2 |
| tRPC transport (§5) | `static/background/index.js` | `createTRPCClient` / `httpBatchLink` ×10 |
| Auth `auth_session` cookie→storage→header (§5) | `static/background/index.js` | `auth_session` ×10, `chrome.cookies.get`/`onChanged` ×1 |
| Persisted session/user (§1,§5) | `Default/Local Extension Settings/<id>/*.log` (LevelDB) | keys `auth_session`, `user`, `email` |
| `simulateClickElement` (§7) | `explore.e52e0709.js` **and** `user-profile.04aac1fc.js` | ×27 / ×23; `new MouseEvent("mousedown")` ×1 each |
| `sleep()` fixed delays (§7,§8) | `explore.e52e0709.js` / `user-profile.04aac1fc.js` | ×46 / ×36, all constant args |
| Scrolling (§7) | `explore.e52e0709.js` / `user-profile.04aac1fc.js` | `scrollIntoView` ×3 / ×2, `scrollBy` |
| XHS DOM selectors (§7) | `explore.e52e0709.js` (+ `user-profile.*` for follow) | `.engage-bar` ×8 / ×8, `.chat-wrapper`, `.reds-button-new-text`, `<use>` |
| `gather` targeting + dedupe (§6) | `explore.e52e0709.js` / `user-profile.04aac1fc.js` | `action:"gather"` ×4 / ×2, `data-yhq-ai-*` ×11 / ×11 |
| Shield block + header spoof (§8) | written by `static/background/index.js` (`updateDynamicRules` ×5) → persisted to `Default/DNR Extension Rules/<id>/rules.json` (965 B) | rule ids 1 (modifyHeaders) & 2 (block) on `*shield/webprofile*` |
| Verified **absences** (§8) | `explore.e52e0709.js` / `user-profile.04aac1fc.js` / `static/background/index.js` | `navigator.webdriver`=0, captcha/slider‑solve=0, 验证/风控/封号/频率/间隔/休息=0, `Math.random`→delay=0 |

### Reproduce the grep counts

```bash
cd ~/Library/Application\ Support/Google/Chrome/Default/Extensions/abbnjgmnjeidchddihllfjjaogbdommm/3.3.2_0
BG=static/background/index.js; EX=explore.e52e0709.js; UP=user-profile.04aac1fc.js

grep -oc "chrome.windows.create" $BG          # 6  — opens popup window
grep -oc "chrome.tabs.sendMessage" $BG        # 18 — task dispatch
grep -o  "yanghao.app" $BG | wc -l            # 2  — cloud backend
grep -oc "auth_session" $BG                   # 10 — session auth
grep -oc "simulateClickElement" $EX           # 27 — click engine (content script)
grep -oh "sleep)(" $EX | wc -l                # 46 — fixed delays
grep -o  'action:"gather"' $EX | wc -l        # 4  — target harvesting
grep -oc "navigator.webdriver" $BG $EX $UP    # 0  — no webdriver evasion

# DNR anti-detection rules (rendered JSON):
python3 -m json.tool < ~/Library/Application\ Support/Google/Chrome/Default/"DNR Extension Rules"/abbnjgmnjeidchddihllfjjaogbdommm/rules.json
```

---

*Summary generated from static analysis of the installed v3.3.2 bundle. Mechanisms (§4–§7) are directly observed in code; anti‑detection findings (§8) include verified absences, not just presences.*
