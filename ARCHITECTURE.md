# hs-portal — Architecture

> Technical companion to [`PLAN.md`](./PLAN.md). Covers modules, MV3 constraints, messaging, the data model, network interception, selector resilience, the shield/leak handling, and the `isTrusted` strategy.
> **Date:** 2026-06-06 · **Base:** forked Redaily v3.3.2 (Plasmo/React, MV3).

---

## 1. Component map (Manifest V3)

```
┌────────────────────────────────────────────────────────────────┐
│ GUI surfaces (React + Zustand, shared store)                     │
│   popup  ·  options (full dashboard)  ·  side panel (live bars)  │
└───────────────▲────────────────────────────────────────────────┘
                │ chrome.runtime messaging + storage.onChanged
┌───────────────┴────────────────────────────────────────────────┐
│ BACKGROUND service worker (orchestrator — ephemeral!)           │
│  ┌ Governor ┐ ┌ Scheduler ┐ ┌ Risk Detector ┐ ┌ Identity/Proxy ┐│
│  ┌ Storage(enc/Dexie) ┐ ┌ Knowledge Base ┐ ┌ AI-comment svc ┐   │
│  ┌ DNR rule manager (shield/headers) ┐ ┌ (opt) chrome.debugger ┐│
└───────────────▲────────────────────────────────────────────────┘
                │ tabs.sendMessage / long-lived Port per tab
┌───────────────┴────────────────────────────────────────────────┐
│ CONTENT SCRIPT (driven XHS tab)                                  │
│  Humanizer · Selector engine · Action executors · State reader  │
│  captcha/DOM watcher · injected page-context fetch/XHR hook      │
└───────────────▲────────────────────────────────────────────────┘
                │ acts on DOM; page JS self-signs x-s
        Xiaohongshu page
```

Permissions (least-privilege target): `storage`, `alarms`, `declarativeNetRequest`, `cookies`, `webNavigation`, `scripting`, `webRequest` (observe), host-scoped to `*.xiaohongshu.com` (+ `*.rednote.com` only if ever needed). `debugger` is **phase-2, opt-in** (see §8) and is the heaviest review-risk permission.

---

## 2. MV3 lifecycle constraints (the thing that bites you)

The background **service worker is ephemeral** — Chrome may kill it after ~30s idle. A naive long-running `setInterval` warming loop will silently die. Design rules:

- **No in-memory long-lived loops.** All scheduling is **`chrome.alarms`-driven ticks**; the SW wakes, reads persisted state, does one slice of work, persists, sleeps.
- **All state is persisted** (Dexie/IndexedDB + `chrome.storage`), never only in SW memory. The Governor's counters, the schedule, the per-account cursor — all survive a SW restart.
- **Keep the driven tab as the work anchor.** The actual pacing waits (jittered `sleep`) happen **in the content script**, which lives as long as the tab does; the SW just dispatches the next task and records results. (This also matches how Redaily already works — pacing lives in the content script.)
- **Offscreen document** only if we need a persistent DOM/audio context the SW can't hold.
- **Alarms minimum period is 1 min** — sub-minute pacing is content-script-side; the alarm is the coarse heartbeat / watchdog.

---

## 3. Module responsibilities

| Module | Lives in | Responsibility | Key APIs |
|---|---|---|---|
| **Governor** | background | Enforce caps/cooldowns/working-hours/错峰; decide if an action is allowed *now*; emit "cap reached → stop" | reads Dexie counters; emits events to GUI |
| **Scheduler** | background | Alarm-driven heartbeat; pick next account/action respecting stagger + golden hours | `chrome.alarms` |
| **Risk Detector** | background + content | Watch responses (461/empty/限流) + DOM (captcha/slider) + session-health probe; raise signals → pause + backoff + health drop | `webRequest.onCompleted`, injected hook, DOM watcher |
| **Identity/Proxy** | background | Per-account env binding, IP/region/timezone consistency check, gate start if mismatch | `chrome.proxy` (browser-wide caveat §6), cookies |
| **Storage (enc)** | background | Encrypted accounts/cookies/keys; action log; targets; KB; risk events | Dexie + WebCrypto |
| **Knowledge Base** | background | Record action outcomes; rank targets/comment styles by engagement | Dexie |
| **AI-comment svc** | background | Generate persona comments; run anti-AI gate before returning | fetch to LLM (local key) |
| **DNR manager** | background | Write/refresh shield block + header-normalize rules; watch for new `sec` endpoints | `declarativeNetRequest.updateDynamicRules` |
| **Humanizer** | content | Jittered timing, variable scroll, hover+dwell, realistic event sequence | DOM events |
| **Selector engine** | content | Resilient, hot-updatable selectors; self-heal; report drift | `querySelector` + config |
| **Action executors** | content | `like/collect/follow/comment/reply/gather/scroll/dwell` | DOM |
| **State reader** | content | Read current note/engage-bar/active state/counts | DOM |
| **GUI** | popup/options/side panel | Observe + tune everything; transparent governor | messaging + `storage.onChanged` |

---

## 4. Messaging architecture

- **Background → content:** `tabs.sendMessage(tabId, {action:"task:*:exec", data})` (keep Redaily's pattern) for one-shot tasks; a **long-lived `Port`** per driven tab for streaming progress/state.
- **Content → background:** results, harvested users, detected risk/DOM-change, action acks.
- **GUI ↔ background:** request config/state; subscribe to live updates via `chrome.storage.onChanged` (counters, health, risk feed) + a Port for the live action stream.
- **Single source of truth:** background owns state; GUI is a reactive view; content is stateless-ish executor. Never let two surfaces hold divergent counters.

Message families (extend Redaily's): `workflow:start|stop|status`, `task:explore|comments|profile:exec`, `risk:signal`, `dom:changed`, `gather:result`, `account:health`.

---

## 5. Network interception (MV3 reality)

Three layers, because MV3 removed blocking `webRequest`:

1. **`declarativeNetRequest`** — the only way to **block/modify** requests. Used for the shield block + header normalization (§7).
2. **`chrome.webRequest.onCompleted` (observe-only)** — read **status codes** (461/403/empty) per request to feed the Risk Detector. Cannot read bodies in MV3.
3. **Injected page-context hook** — a content script injects a small script into the page that wraps `window.fetch` / `XMLHttpRequest` to observe **response bodies/codes** (e.g. `{"code": -1, ...}`, 限流 messages) and `postMessage`s findings back. This is how we see *semantic* risk signals the status code alone misses.

DOM-level: the **captcha/slider watcher** observes for the 数美 slider / rotation iframe / `verifyBiz=461` redirect and raises a signal (engagement should never reach this; if it does → pause).

---

## 6. Identity, proxy & isolation (the hard architectural limit)

- **`chrome.proxy` sets a browser-wide proxy**, not per-tab/per-account. Therefore **one extension instance cannot run two accounts on two different CN IPs**.
- **Resolution:** isolation is at the **browser-profile** level, not inside one extension:
  - **Separate Chrome profiles**, each with its own extension instance + its own proxy (system/profile-level), one account each; **or**
  - **A fingerprint browser** (AdsPower-style) that binds fingerprint + proxy per profile, with our extension installed in each.
- The extension's **Identity module** still owns: the IP/region/timezone **consistency check** (gate start if account region ≠ current egress region), per-account cookie vault, and health 巡检.
- **Leak control** (can't be done by DNR): disable IPv6 and WebRTC at the browser/OS layer per profile; the extension runs a **self-test** and surfaces pass/fail in the GUI.

> Net: the extension governs *behavior + identity bookkeeping*; the *network identity* (IP + fingerprint isolation) is provided by the profile/fingerprint-browser it runs in. The plan's "one account ⇄ one environment" rule is enforced at that layer.

---

## 7. Shield & header handling (inherited, hardened)

- **DNR rules** (from teardown §8): (1) `modifyHeaders` to pin `User-Agent`, `sec-ch-ua`, `sec-ch-ua-platform`, etc. on the shield request; (2) `block` the `*as.xiaohongshu.com/api/sec/v1/shield/webprofile*` request.
- **Hardening:** the rule's URL/SDK assumptions can go stale. The DNR manager keeps the rule **config-driven** and watches `onCompleted` for *new* `/api/sec/*` endpoints (e.g. post-v8.42 additions) to flag for a config update — same philosophy as selector resilience (§9).
- **Header coherence:** the spoofed UA/platform in the DNR rule must match the *actual* browser/profile (don't pin macOS UA on a Windows profile) — tie it to the per-profile fingerprint.

---

## 8. `isTrusted` strategy (the content-script ceiling)

- Content-script synthetic events (`MouseEvent`, `.click()`) are permanently **`isTrusted:false`** — Redaily's unfixable ceiling. Fine while XHS doesn't check it for engagement; a latent risk.
- **Phase-2 upgrade:** use the extension's **`chrome.debugger`** API to attach CDP to the driven tab and dispatch **`Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`**, which produce **`isTrusted:true`** events — for *high-risk actions only* (comment submit, follow), keeping cheap synthetic events for scroll/dwell.
- **Cost:** `chrome.debugger` shows a persistent "extension is debugging this browser" banner and is a **Web-Store review red flag** (§ PLAN 15). Make it an explicit, opt-in setting, off by default. Document the trade-off in the GUI.

---

## 9. Selector resilience system

Redaily hardcodes XHS selectors and logs *"元素为空,小红书 DOM 可能已变更"* when they break. Replacement:

- **Selector config** (`selectors.json`, versioned) keyed by logical role (`engageBar`, `likeBtn`, `commentInput`, `followBtn`, `commentItem`, …), each with an **ordered fallback list** + a role-based/semantic fallback.
- **Self-heal:** on miss, try fallbacks; if all miss, raise `dom:changed`, pause the action, surface in GUI.
- **Hot-update:** selector config is data, loadable without re-shipping the extension (local edit / optional fetch from operator's own source).
- **Contract tests:** snapshot selectors in CI; flag drift early (PLAN §13).

---

## 10. Data model (Dexie / IndexedDB)

| Store | Key fields |
|---|---|
| `accounts` | id, nickname, niche, persona, state (NEW/WARMING_EARLY/WARMING/ACTIVE/FLAGGED/COOLDOWN/RETIRED), isBackup, envId, createdAt |
| `sessions` | accountId, encrypted cookies (a1/web_session/gid/webId…), lastHealthCheck, valid |
| `envs` | id, profile/fingerprint ref, proxy (region/city/ISP), timezone, leakTestResult |
| `caps` | accountId, preset, per-metric limits + intervals, schedule, goldenHours |
| `counters` | accountId, metric, window, count, windowStart (drives the bars) |
| `actionLog` | id, accountId, type, target (noteId/userId), result, timestamp |
| `targets` | accountId, sourceNoteId, userId, segment, filters, isProcessed |
| `kb` | accountId, signal/pattern, outcome metrics (engagement), rank |
| `riskEvents` | accountId, signal type, raw evidence, governorResponse, timestamp, healthDelta |
| `settings` | passphrase-derived key check, locale, distribution mode, LLM config |

Counters + caps drive the GUI bars directly; riskEvents drive the risk feed; kb drives targeting/comment ranking.

---

## 11. Build & dev loop

- `plasmo dev` for HMR; load unpacked.
- TypeScript strict; shared types for actions/caps/risk/messages across surfaces.
- **Dry-run flag** wired at the executor boundary (PLAN §13) — same code path, no dispatch.
- CI: unit tests (Governor math, Risk Detector fixtures), selector contract snapshots, lint, build.
- Packaging: signed build for self-host; separate manifest profile for a (least-privilege, no-`debugger`) Web-Store candidate vs the (full-power, `debugger`-enabled) self-host build.

---

## 12. Cross-references

- Behavior limits & signals enforced here → [`RISK-MODEL.md`](./RISK-MODEL.md).
- Strategy, milestones, GUI, legal → [`PLAN.md`](./PLAN.md).
- What we forked → [`redaily-extension-teardown.md`](./redaily-extension-teardown.md).
