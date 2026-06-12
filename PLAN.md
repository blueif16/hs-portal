# hs-portal — Plan

> **Project:** A local, GUI-first Chrome extension for **mainland Xiaohongshu (小红书, xiaohongshu.com)** engagement / account-nurturing (养号), built by forking the **Redaily** extension, fixing its documented weaknesses, and grafting the best ideas from three reference repos.
> **Date:** 2026-06-06
> **Companion docs:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) (modules, data model, MV3 constraints, messaging) · [`RISK-MODEL.md`](./RISK-MODEL.md) (signals / red lines / limits — drives the governor + GUI) · [`redaily-extension-teardown.md`](./redaily-extension-teardown.md) (what we fork) · [`小红书养号博客研究总结.md`](./小红书养号博客研究总结.md) (operator playbook).

---

## Table of contents

0. TL;DR
1. Goals, non-goals & success criteria
2. Why the extension approach (decision record)
3. What we fork, keep, and cut
4. Fork mechanics — how to start
5. Tech stack
6. Architecture overview
7. Engagement & targeting model
8. Account lifecycle — the 养号 state machine
9. Multi-account orchestration
10. GUI / Web UI design
11. Build backlog (Tier 1 → 5)
12. Milestones & acceptance criteria
13. Testing & validation (without burning accounts)
14. Privacy & data handling
15. Legal / ToS / Web Store compliance
16. Risk model
17. Future pathways (merits from the repos)
18. Open decisions & prerequisites
19. Non-negotiables
20. Glossary

---

## 0. TL;DR

Build a **governed** version of Redaily. Redaily's engine is *behaviorally naive* but survives because it (a) runs inside the user's real logged-in Chrome and (b) blocks one risk-telemetry endpoint. We keep those two strengths and add everything it lacks: jittered/humanized behavior, a **user-visible frequency governor**, risk-signal detection + backoff, per-account identity isolation on a consistent **mainland-CN residential IP**, and a local-only architecture with no cloud phone-home. The GUI is the product's centerpiece — every signal, cap, and status is observable and tunable — because the goal is to **ship to the Chrome Web Store** (with the compliance caveats in §15).

**Core thesis (one line):** *Be a real browser, blind one telemetry endpoint, sit on a consistent CN IP, govern behavior with visible caps, and keep publishing as a separate higher-ceremony path.*

---

## 1. Goals, non-goals & success criteria

### Goals
- A single-operator tool to **safely keep mainland XHS accounts active and growing** (browse, like, collect, follow, comment, targeted 截流) without tripping 风控.
- **GUI-first**: everything observable and tunable; no config files required for normal use.
- **Local & private**: no third-party phone-home; the operator owns all data.
- **Survivable at small matrix scale** (3–10 accounts) with per-account isolation.
- **Distributable** (Chrome Web Store *or* self-hosted — see §15).

### Non-goals (explicitly out of scope for v1)
- ❌ The signed-API engine (`XHS_ALL_IN_ONE` style) — optional far-later for bulk read-only scraping only.
- ❌ Auto-**publishing** in the engagement engine (separate, later path — §17 roadmap step 3).
- ❌ Multi-platform (Douyin/Weibo/etc.).
- ❌ Mass scale (100s of accounts) / selling access / SaaS.
- ❌ Bypassing captchas on the publish path automatically in v1 (human-confirm first).

### Success criteria
- A warming (养号) account run by the tool stays **un-throttled** through a full 7–15 day cycle.
- Operator can read **at a glance** how close each account is to every cap, and why it paused.
- Zero data leaves the device except XHS traffic itself.
- A XHS DOM change can be recovered via **config update, not a re-ship**.

---

## 2. Why the extension approach (decision record)

Chosen over the two other transports we evaluated:

| Approach | Verdict | Why |
|---|---|---|
| **Real-browser extension (chosen)** | ✅ | Page self-signs `x-s` (no signature arms race); no fabricated device profile; real fingerprint/IP/TLS; native GUI; distributable; strongest stealth-per-effort |
| Signed-API (à la `XHS_ALL_IN_ONE`) | ❌ core | Must forge `x-s` on every request **and** feed a fake profile to `shield/webprofile` — two permanent maintenance burdens + max detection surface |
| CDP / stealth browser (à la skills) | ⚠️ borrow | Real-browser benefits but no native GUI; we borrow its `isTrusted:true` input trick via `chrome.debugger` for high-risk actions |

**Key technical facts behind the choice** (see teardown + [`xhs-anti-detection-findings`] memory):
- The extension never computes `x-s`/`x-t` — the real page's own JS signs every request. The entire signature reverse-engineering problem disappears.
- XHS's risk gate is concentrated at one endpoint, `/api/sec/v1/shield/webprofile`. Redaily **blocks** it (DNR); the API approach must **feed** it. Blocking is simpler and we inherit it.
- Engagement (like/collect/follow/comment/scroll) **never triggers a captcha**; only **publishing** hits the mandatory `x-c-risk` slider. So the engagement core is low-risk by nature.

---

## 3. What we fork, keep, and cut

Fork base: **Redaily v3.3.2** (Plasmo/React, Manifest V3).

**Keep:**
- Local content-script engine (element selection, synthetic events, scroll) + popup/options React GUI.
- The browse → `gather` (harvest commenters) → engage loop.
- The `shield/webprofile` DNR block + header normalization.
- The background ↔ content-script messaging pattern (popup window driving a tab).

**Cut / replace:**
- ❌ Cloud phone-home to `yanghao.app` (exposes your session to a third party + gives them a kill-switch). Replace the cloud "WHAT" plane (task lists, counts) with **local config**.
- ❌ Plaintext `auth_session` in LevelDB → encrypted local storage.
- ❌ Over-broad `host_permissions: https://*/*` → scope to XHS domains only.
- ❌ Membership/VIP gating.
- ❌ Redaily's `manifest.json` `"key"` and `"update_url"` → **omit both**: `key` pins their RSA-derived extension ID (we want our own); `update_url` makes an unpacked build phone the Web Store for updates.

---

## 4. Fork mechanics — how to start

1. **Acquire & unpack** the Redaily bundle (already unpacked on disk at the path in the teardown §1; or pull the `.crx` by ID and unzip).
2. **Deobfuscate** the Plasmo/Parcel bundles for reading (`webcrack` / `wakaru` / `humanify`). Code is minified, not obfuscated — reads cleanly.
3. **Stand up a clean codebase** (don't build *on top of* the minified bundle — rebuild). **M0 ships as zero-build vanilla MV3** (`extension/`, load-unpacked — fastest to a browser-testable build); the **Plasmo/React/TS** stack (§5) is introduced at **M2** when the GUI gets real. Either way the engine is *extracted-and-reimplemented* from the deobfuscated bundle (the ~few-hundred lines of XHS selectors + action sequences), **not** the 2.6 MB minified blob — which can't run standalone anyway (cloud-gated) and can't be edited to add the Tier-1 survival layer.
4. **Strip the cloud plane first** — remove `@shared/lib/base-url`, the tRPC client, `auth_session` exfiltration, membership gating. Replace with a local config store.
5. **Verify the skeleton**: extension loads on `xiaohongshu.com`, popup opens, one manual action (e.g. like the open note) works end-to-end through background→content messaging.
6. **Lift the DNR shield rules** (teardown §8). The real `rules.json` carries *two* rules on the same `shield/webprofile` URL — `modifyHeaders` (id 1) **and** `block` (id 2, higher priority); block wins, so the endpoint is blocked. Carried over verbatim into `extension/rules/shield.json` — revisit block-vs-spoof mode at Tier 1. Then begin Tier 1.

> Treat the original bundle as **reference, not foundation** — we want a clean, typed, testable codebase we can ship, not a patched minified blob.

---

## 5. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Extension framework | **M0: zero-build vanilla MV3**; **M2+: Plasmo** (or WXT) | M0 loads unpacked with no toolchain (fastest to test); Plasmo/React introduced when the GUI grows. Engine (`human.js`/`engine.js`) ports as-is |
| Language | **TypeScript** | typed action/cap/risk models |
| UI | **React** + Tailwind (or keep Redaily's) | dashboard-heavy |
| UI state | **Zustand** (lightweight) | shared popup/options/side-panel state |
| Local DB | **IndexedDB via Dexie** | accounts, action log, targets, KB, risk events |
| Secrets | **WebCrypto (AES-GCM)** + a key derived from an operator passphrase | encrypt session cookies at rest |
| Scheduling | `chrome.alarms` + persisted state | MV3 service workers are ephemeral — see [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| Net control | `declarativeNetRequest` (shield block/headers) + `chrome.webRequest` (observe status) + injected fetch/XHR hook (response bodies) | layered; MV3 constraints in ARCHITECTURE |
| Trusted input (phase 2) | `chrome.debugger` → `Input.dispatchMouseEvent` | `isTrusted:true`; shows a debugging banner |
| AI comments | pluggable LLM (DeepSeek/OpenAI-compatible) | keys stored locally, never shipped |

---

## 6. Architecture overview

Full detail in [`ARCHITECTURE.md`](./ARCHITECTURE.md). High-level:

```
┌── GUI (popup / options / side panel, React+Zustand) ──┐  observe + tune everything
│   dashboard · caps · accounts · targeting · risk feed │
└───────────────▲───────────────────────────────────────┘
                │ runtime messaging
┌───────────────┴───────────────────────────────────────┐
│ BACKGROUND service worker (orchestrator)               │
│  Governor · Scheduler · Risk Detector · Identity/Proxy │
│  Storage(enc) · KB · AI-comment service · DNR rules     │
└───────────────▲───────────────────────────────────────┘
                │ tabs.sendMessage / ports
┌───────────────┴───────────────────────────────────────┐
│ CONTENT SCRIPT (in the driven XHS tab)                 │
│  Humanizer (scroll/click/dwell) · Selector engine ·    │
│  Action executors · State reader · captcha/DOM watcher │
└───────────────▲───────────────────────────────────────┘
                │ acts on
        Xiaohongshu page DOM  (page JS self-signs x-s)
```

The local↔cloud split that defined Redaily is gone — **there is no cloud**. The "WHAT" (plan/targets/counts) lives in local config + KB; the "HOW" stays in the content script.

---

## 7. Engagement & targeting model

### Action types (the local engine)
`scroll` · `like` · `collect` (⭐, higher weight) · `follow` · `comment` · `reply` · `gather` (harvest commenter userIds) · `dwell` (read pause — *new, not inherited from Redaily's verified set*).

Each action runs through the **Humanizer** (jittered timing, hover+dwell, variable scroll) and is gated by the **Governor** (caps) — see §10/§11 and ARCHITECTURE.

### Targeting modes (from the 养号 blog)
1. **评论区养号 (comment-section)** — paste a target/competitor note → filter its commenters → like/reply/follow/gather. Most precise; doubles as 截流 (lead interception).
2. **主页养号 (profile)** — mine a competitor's followers/profile visitors deeply.
3. **发现页养号 (discovery)** — keyword broad-net on the feed.

### Targeting filters (keep Redaily's, enrich)
keyword include/exclude · comment like-count · comment length · commenter follower/following/likes-collects counts · gender · IP region.

### `gather` pipeline (the targeting loop)
`browse → harvest commenter userIds → dedupe (markers) → segment into target lists → engage → record outcome in KB`. Outcomes feed §8/§17 learning.

---

## 8. Account lifecycle — the 养号 state machine

Each account moves through explicit states; the Governor applies different caps/behavior per state (caps in [`RISK-MODEL.md`](./RISK-MODEL.md) §C).

```
NEW ──register/login──▶ WARMING_EARLY (day 1–3, "most critical")
        │                     │ low-freq browse, a few genuine likes/comments, NO publish
        │                     ▼
        │              WARMING (day 4–15)  gradually raise frequency, build memory points
        │                     ▼
        │                 ACTIVE  full engagement caps; ready for content/截流
        ▼                     │
   FLAGGED ◀──risk signal─────┘   (461 / slider / 限流 / 限流提醒)
        │ auto-pause + backoff + health drop; manual review
        ▼
   COOLDOWN ──recovered──▶ ACTIVE   |   ──repeated flags──▶ RETIRED (swap to 备胎小号)
```

- **WARMING_EARLY** uses Conservative caps + the strictest dwell/jitter.
- **FLAGGED/COOLDOWN** are entered automatically by the Risk Detector; exit is operator-gated.
- Keep **1–2 pre-warmed backup accounts (备胎小号)** so a flagged main can be swapped without downtime.

---

## 9. Multi-account orchestration

- **One account ⇄ one environment ⇄ one consistent CN IP** (hard rule). Practically: a separate Chrome profile per account, or run inside a fingerprint browser (AdsPower-style) that binds fingerprint + proxy per profile. (Per-tab proxy isn't possible from one extension instance — see ARCHITECTURE.)
- **错峰 (stagger)** runs across accounts — never simultaneous identical action bursts; offset schedules.
- **Role division (3-account matrix, from the blog):** 主号 (content) · 副号1 (comment-section activity) · 副号2 (profile deep-interaction) · 副号3 (discovery broad-net).
- **Per-account everything**: fingerprint env, proxy/IP, cookies (encrypted), caps preset, schedule, content niche, health score, action log.

---

## 10. GUI / Web UI design (the centerpiece)

> The reason we picked the extension: set everything up in Chrome, with a great native UI, and ship it. The GUI is a first-class deliverable.

**Design principle — transparent governor:** surface *everything*; avoid opaque automatic behavior changes. Govern with **visible caps** (cross a cap → stop that action, show why) and **visible risk signals** (signal → pause + alert). Keep auto-intervention minimal and legible.

### Pages / panels

**① Dashboard (default)**
- **Behavior bars vs caps** — one progress bar per metric filling toward its cap (likes 18/30·hr, follows 22/50·day, comments 4/10·hr…). Cross = stop that action, bar red, reason shown.
- **Per-account status cards** — running/paused, current action, health score, IP/region/timezone consistency ✓/✗, `shield blocked ✓`.
- **Risk feed** — chronological detected signals + governor response.

```
┌─ Dashboard ──────────────────────────────────────────────┐
│ Account: 美妆小铺 ▸ ACTIVE   health 92  IP 上海✓ TZ✓ shield✓│
│ Likes    ▓▓▓▓▓▓░░░░  18/30 /hr                            │
│ Collects ▓▓░░░░░░░░    3/5  /day                           │
│ Follows  ▓▓▓▓▓░░░░░   22/50 /day                           │
│ Comments ▓▓▓▓░░░░░░    4/10 /hr   ● next in 6m12s          │
│ Window 09:00–21:00  ·  golden 12–13 ●                      │
│ Risk feed:  14:03 empty-response ×1 → backoff 30s          │
│             [ Pause ] [ Stop ] [ Skip current ]            │
└───────────────────────────────────────────────────────────┘
```

**② Accounts** — add/login (QR), bind env+proxy, set niche/persona, warming state, backup-account designation.
**③ Caps & schedule** — sliders/inputs for every limit + interval; presets *Conservative / Standard / Custom*; working-hours + golden-hours toggles; per-account override.
**④ Targeting** — mode (comment-section/profile/discovery), target notes, filter builder, gathered-user lists.
**⑤ AI persona** — persona config, comment styles, anti-AI-gate strictness, LLM key.
**⑥ Logs & analytics** — action history, growth curves, KB outcomes, export (local).
**⑦ Settings** — encryption passphrase, i18n (zh/en), shield/leak self-test, data export/wipe.

---

## 11. Build backlog (Tier 1 → 5, in order)

### Tier 1 — Survival (closes teardown §8 gaps) — **do first**
- [ ] Timing jitter (`Math.random` into every delay; kill the fixed `sleep(2000)`).
- [ ] Humanized motion (variable scroll velocity + reading pauses + scroll-back; hover+dwell; min dwell ≥10s).
- [ ] Frequency governor (local caps/cooldowns/working-hours/错峰; caps from RISK-MODEL §C; all in GUI).
- [ ] Risk-response & backoff (detect 461/empty/限流/slider → pause + exponential backoff + health score).
- [ ] Robust shield + leak-proofing (keep DNR block; monitor new `sec` endpoints; disable IPv6 + WebRTC).
- [ ] `isTrusted` upgrade (phase 2: `chrome.debugger` for high-risk actions).

### Tier 2 — Identity & multi-account
- [ ] One-account-one-environment (separate profiles / fingerprint browser).
- [ ] Per-account CN static-residential proxy, city + timezone matched.
- [ ] Encrypted credential storage + health 巡检.

### Tier 3 — Intelligence
- [ ] Learning loop / local KB (record what produced engagement; feed targeting).
- [ ] Persona-driven AI comments + anti-AI-text gate.

### Tier 4 — Resilience & observability
- [ ] DOM-resilient + hot-updatable selectors.
- [ ] Retry-once-then-reroute (not blind retry).
- [ ] Observability dashboard (the GUI advantage).

### Tier 5 — Trust & distribution
- [ ] Local-only data; no phone-home.
- [ ] Least-privilege perms; no obfuscation; privacy policy; i18n; listing assets (or self-host).

---

## 12. Milestones & acceptance criteria

| M | Scope | "Done" when… |
|---|---|---|
| **M0** Fork bootstrap | §4 | 🚧 *scaffolded → `extension/`* (zero-build MV3, cloud stripped, popup drives like/collect/follow/comment/scroll). **Pending:** live-test one manual action end-to-end on a real XHS note |
| **M1** Survival core | Tier 1 | 🚧 *built* — background-orchestrated runner + governor (`governor.js`): dry-run, jittered pacing, caps enforced, DOM risk-backoff, kill switch (unit-tested). **All 3 modes wired** (discovery+keyword-search / comment-section gather→filter / profile) + plan-editor UI. **Pending:** live-test on real XHS, network-level (461/empty) risk detection. Done when a warming session runs within caps and backs off on an injected risk signal |
| **M2** GUI v1 | §10 ①③ | Every cap tunable from UI; bars reflect real actions live; crossing a cap stops that action with a reason |
| **M3** Identity & matrix | Tier 2 | 2 accounts run isolated (separate env+IP); start is **blocked** if IP region ≠ account region; cookies encrypted at rest |
| **M4** Intelligence | Tier 3 | AI comments pass the anti-AI gate; targeting picks from KB-ranked outcomes |
| **M5** Resilience | Tier 4 | A simulated XHS DOM change is recovered via selector-config update without re-ship |
| **M6** Distribution | Tier 5 | Least-priv perms + privacy policy + i18n done; store submission *or* signed self-host package |

---

## 13. Testing & validation (without burning accounts)

- **Dry-run / simulation mode** — the engine logs *what it would do* (targets, actions, timing) without dispatching events. Validate pacing/caps/targeting safely.
- **Shadow caps** — start every new account far below the real caps; ramp only after clean runs.
- **Canary account** — one low-value account runs each new build ahead of the mains.
- **Live session-health check** — periodically hit an authoritative endpoint (e.g. `/api/sns/web/v2/user/me`, `guest:false`) to confirm the session is still valid; treat failures as a risk signal.
- **Risk-signal fixtures** — unit-test the Risk Detector against recorded 461 / empty / slider / 限流 responses.
- **Selector contract tests** — snapshot the XHS DOM selectors; CI flags drift.
- **Global kill switch** — one control halts all accounts immediately.
- **No-burn rule**: never test new behavior on a main account; canary + dry-run first.

---

## 14. Privacy & data handling

- **Local-only.** No analytics, no phone-home, no third-party backend. (Direct opposite of Redaily's `yanghao.app`.)
- **Encryption at rest** — session cookies + LLM keys encrypted (AES-GCM, operator passphrase).
- **Harvested-user data (`gather`)** — store userIds locally only; provide export + wipe; be aware this is personal data (PIPL/ToS implications — §15). Minimize retention.
- **Least privilege** — host permissions scoped to XHS domains; justify every permission in the listing.
- **No credential logging** — never write cookies/tokens to logs or chat.

---

## 15. Legal / ToS / Web Store compliance (read honestly)

- **XHS ToS:** automated browse/like/follow/comment and user-harvesting are a **gray area that conflicts with platform rules** — the whole category does. Account loss is a real, accepted risk; this tool reduces detection, it does not make activity *compliant*.
- **Chrome Web Store policy risk (important for the ship goal):** the Web Store prohibits extensions whose primary purpose is **spam, fake engagement, or facilitating ToS violations of other services**. An auto-engagement bot is **squarely in the rejection/takedown zone**, and the `debugger` + broad-host permissions draw extra review. Plan for this:
  - **Option A — position as a personal automation/productivity tool**, user-initiated, transparent, minimal permissions. Reduces but does not remove risk.
  - **Option B — self-distribution** (signed `.crx` / unpacked / enterprise policy) as the realistic primary channel; treat the public Web Store as best-effort.
  - **Decide early** — it shapes permissions, naming, and copy. (See §18.)
- **Data law:** harvesting commenter data implicates **PIPL**; keep retention minimal, local, and exportable/wipeable.

> Bottom line: build it, but go in clear-eyed — the biggest threat to "ship to the store" is **store policy**, not the XHS detection we've spent most effort on.

---

## 16. Risk model

The detailed **threatening signals**, **red lines**, and **limits** live in [`RISK-MODEL.md`](./RISK-MODEL.md) — the single source of truth for both the governor logic and the GUI config schema. Summary: signals → detect + surface + back off; red lines → enforced constraints/warnings; limits → adjustable GUI bars/caps.

---

## 17. Future pathways (merits learned from the three repos)

Sequenced so each layer builds on the engagement core without destabilizing it.

### From `xiaohongshu-ops-skill` (the "brain" — research & discovery)
Home-feed recommendation analysis · account analysis · topic ideation · **viral-copy / clone** (URL → similar publishable note) · persistent knowledge base.

### From `XHS_ALL_IN_ONE` (the "engine")
Trend/discovery analytics dashboards · content library + drafts + AI rewrite + AI image studio · scheduler/auto-ops pipeline · competitor monitoring · (multi-platform far later).

### From `xhs-skill` (the "governor") — needed when we add auto-comment/publish
Anti-AI-text gate · content review · real-tag enforcement · source traceability.

### Roadmap order
1. **Engagement core** (Tiers 1–5) ← current focus
2. **Research / trend discovery / viral-copy** (ops-skill features)
3. **Publish path** — separate, lower-volume, with the `x-c-risk` slider gate (human-confirm or 打码) + xhs-skill content gates
4. **Analytics / content library / scheduler** (ALL_IN_ONE features)
5. **Matrix scale & multi-platform**

---

## 18. Open decisions & prerequisites

- **+86 phone numbers** — true mainland (国内池) accounts need a +86 number at registration; overseas numbers → rednote.com overseas pool. Source real or 接码 +86 numbers before scaling.
- **Proxy + isolation provider** — pick a CN static-residential provider; decide separate-profiles vs fingerprint-browser for the matrix.
- **Distribution channel** — Web Store vs self-host (§15) — decide early; it shapes permissions/positioning.
- **`isTrusted` path** — ship content-script first; evaluate `chrome.debugger` later (banner trade-off).
- **LLM provider** — for AI comments (DeepSeek vs OpenAI-compatible); keys local.
- **Backend** — start local-config-only; only add our own backend if cross-device sync is ever needed (never reuse Redaily's cloud).

---

## 19. Non-negotiables (carry into every step)

- Be a **real** browser — never fake fingerprints; the real environment is the asset. (Fingerprint *isolation* across accounts ≠ fingerprint *faking*.)
- **One account ⇄ one environment ⇄ one consistent CN IP.**
- **Local-only** data; no third-party phone-home.
- **Engagement ≠ publishing** — never let publish ride the engagement engine.
- **GUI-first & transparent** — everything observable and tunable; cross-cap stops; risk signal pauses; minimal opaque auto-behavior.
- **No-burn testing** — canary + dry-run before any main account.

---

## 20. Glossary

| Term | Meaning |
|---|---|
| 养号 (yǎng hào) | "Account nurturing" — simulating normal use so the algorithm treats the account as a real, weighted user |
| 起号 (qǐ hào) | Cold-start / launching a new account's reach |
| 截流 (jié liú) | "Lead interception" — engaging a competitor's already-interested commenters to pull them to you |
| 风控 (fēng kòng) | Risk control — the platform's anti-abuse system |
| 权重 (quán zhòng) | Account/content "weight" — affects reach |
| 垂直度 (chuí zhí dù) | Verticality — how consistently an account stays on one niche |
| 限流 (xiàn liú) | Throttling — reduced reach as a soft penalty |
| 备胎小号 | Pre-warmed backup account, swapped in when a main is flagged |
| 错峰 | Stagger — offsetting actions across accounts/time to avoid synchronized bursts |
| shield / `webprofile` | XHS's risk-telemetry endpoint we block via DNR |
| `x-s` / `x-t` / `x-c-risk` | Request signatures / timestamp / publish-slider-derived risk param |
| 打码 | Captcha-solving (manual or service) |
| 数美 (SHUMEI) | The captcha vendor XHS uses (slider + rotation) |
| 国内池 / 海外池 | Domestic vs overseas content pool (xiaohongshu.com vs rednote.com) |
