# XHS_ALL_IN_ONE upstream update — protocol diff analysis (2026-11-04)

**Scope.** `ref/XHS_ALL_IN_ONE` diff `cedcb77` (2026-06-01, local HEAD, left untouched) → `origin/master` `e86f82b`.
Read only with `git diff` / `git show` / `git log`. No network calls to XHS or rednote, and nothing was executed.
Citations use the form `origin/master:<path>:L<line>` (new) or `cedcb77:<path>:L<line>` (old). hs-portal citations are working-tree paths under `extension/`.

**Labels.** **[FACT]** means the cited code shows it directly. **[HYP]** means an inference. Every HYP is marked with a confidence (high, med, or low).

**Timing caveat (read first).** Upstream's protocol snapshot dates from July 2026. Evidence: `reference_profile.json:L3` `"source": "xhs-pc-browser-fixtures-20260718"`, the mns fixtures are dated `20260716` (`mns_0101_keystream.json`), and the algorithm commit is 2026-07-25. No algorithm commit has landed since then: the only later commit is the 2026-08-18 README. Our breakage began on **Oct 17 2026, about 3 months later**, so this diff **cannot show an Oct-17 server change**. What it does show is the July protocol state and the enforcement surface. Several of those July changes collide with how hs-portal is built.

---

## 1. Commit summary

| commit | date | what |
|---|---|---|
| `cf23044`…`8336a46`, `2819d74`, `e86f82b` | 06-07 → 08-18 | README only (star-history host, group-chat images) |
| **`17d42a6` "feat: 更新算法"** | 2026-07-25 | **the only substantive one** (merged via PR #19 `63b85de`, 07-26). 69 files, +10 311 / −474 884 |

What `17d42a6` did:
- **Deleted every old signer bundle** under `static/` (`xhs_main_260411.js`, `xhs_xray*.js`, `xhs_rap.js`, `xhs_a1*.js`, `xhs_creator_sign*.js`, `xhs_websectiga_env.js`, about 470k lines of obfuscated or VM bundles run through `execjs`).
- **Replaced them with "pure-algorithm" JS** run by Node subprocesses:
  - `xhs_utils/xhs_core/js/{sign,mns,xs_common,b1,websectiga_env,websectiga_cli}.js`
  - `xhs_utils/xhs_pc/js/{rap,rap_cli,rap_crypto,deflate,aes_*,profile}.js`
- **Added a stateful device and session model:**
  - `xhs_pc/{auth,state,params,runtime,dsl,http}.py`
  - `xhs_core/{auth,cookies,http,dsl,params,runtime}.py`
  - Creator mirrors of the above
  - Captured device fixtures `reference_profile.json` and `rap_fingerprint_template.json`
- **Changed transport:** `requests` was replaced by **`curl_cffi`** impersonating Chrome over HTTP/2 (`requirements.txt` now includes `curl_cffi`; `xhs_pc/http.py:L10-12` uses `impersonate='chrome146'` and `http_version='v2tls'`).
- **Changed the API surface:** `XHS_Apis()` no longer takes `cookies_str` per call. It is built from an `XHSPcAuth` object (`apis/xhs_pc_apis.py:L52-81`), and `bootstrap()` calls `/user/me` to learn `user_id`.

---

## 2. Signing / anti-bot changes

### 2.1 Headers on edith business requests

Upstream's own contract (`origin/master:apis/xhs_pc_apis.py:L111-118`):
- **Always present:** `x-s / x-t / x-s-common / x-b3-traceid / x-xray-traceid`.
- **Conditional:** `x-rap-param` (only on the RAP whitelist) and `xy-direction` (only on homefeed and feed).
- **Absent:** `x-mns`. The source comment reads "无 x-mns（浏览器 edith 业务请求未带）", i.e. the browser does not send it on edith business requests.

| header | before (cedcb77) | after (origin/master) | evidence |
|---|---|---|---|
| `x-s` | `"XYS_"+b64({x0:"4.3.2",x1:"xhs-pc-web",x2:"Windows",x3:mnsv2(...),x4:"object"})`. `x3` came from an emulated `window.mnsv2` VM; `x4` was always `"object"` | `x0` = signVersion **4.3.7**. `x3` is a **tiered MNS token** `mns0301_` / `mns0201_` / `mns0101_` (see 2.4). `x4` is `''` for GET, `'object'` or `'string'` for bodies | old `static/xhs_main_260411.js:L349-357`; new `xhs_core/js/sign.js:L31-42`, `L85-91`, `L108-125` |
| MNS pack inside `x3` | opaque VM | 144-byte TLV holding: magic, `version`, `ts`, **`loadts`**, **`seq`** (per-session request counter), **`envConst`**, body length, md5(url+body)[:8], `a1`, `appId`, **`envFp`** (14 env bytes), **`deviceTag`** (`a3` once the DS script has run, `nop` before), and a 16-byte `dsSig` (from `_dsf`) | `xhs_core/js/mns.js:L144-202`, `L162-166` |
| `x-t` | `Date.now()` | `Date.now()` sampled again **after** MNS is built | `sign.js:L126-127` |
| `x-s-common` | `{s0:5,s1:"",x0:"1",x1:"4.3.2",x2,x3,x4:"4.84.1",x5:a1,x6:xt,x7:xs,x8:<fixed constant fff>,x9:crc(md5(xt+xs+fff)),x10:0,x11:"normal"}` | `{…x1:"4.3.7",x4:webBuild "6.32.2",x5:a1,x6:'',x7:'',`**`x8:b1`** (or JSON `null` before b1 is collected)`,x9:CRC32-variant(b1)`, **`x10:signCount`** (`sc`)`,x11:"normal",`**`x12:"<dsllt>;<_dsl>"`** (new)`}` | old `xhs_main_260411.js:L402-421`; new `xhs_core/js/xs_common.js:L44-75` |
| `x-b3-traceid` | 16 random hex | unchanged | `xhs_pc/params.py:L94-98` |
| `x-xray-traceid` | from `static/xhs_xray.js` | pure: `hex16((now_ms<<23)\|seq) + hex16(random64)`. Upstream treats it as a tracing header, not a signature | `params.py:L201-209` |
| `x-mns` | sent as `"unload"` | **removed** (explicitly popped) | old `xhs_utils/xhs_util.py:L110`; new `xhs_pc_apis.py:L115`, `L134` |
| `x-rap-param` | only on `/v1/feed` and `/v1/search/notes` | whitelist: `v1/homefeed`, `v1/search/notes`, **`v2/search/notes`**, `v1/user_posted`, `v1/feed`, `v1/comment/post`. Value is `ByQ…`, built as AES-128-ECB (key `kqI1DTcwKX90ZtAy`) + DEFLATE + XOR envelope around a **219-byte "behavior/detection" fingerprint** plus xxHash32(url+body) | old `xhs_pc_apis.py:L392`, `L525`; new `L36-44`, `L135-141`; `params.py:L213-244`; `xhs_pc/js/rap.js:L1-18`, `L68-106`; `rap_fingerprint_template.json` |
| `xy-direction` | constant `"13"`, `/feed` only | **`murmurHash3_32(user_id, 151488) % 100 + 1`**, cached as `localStorage.xhs_sharding_key`, sent on **homefeed and feed** | old `xhs_pc_apis.py:L393`; new `xhs_pc_apis.py:L45-49`, `L120-121`; `params.py:L269-276`, `L431-435` |
| `x-login-mode` | — | new, login QR-status only (empty string) | `apis/xhs_pc_login_apis.py:L611` |
| header **order** | none | an enforced per-request-shape wire order (signed GET/POST, RAP, XY+RAP). Upstream raises an error on drift | `params.py:L44-74`, `L393-409`; `xhs_core/http.py:L34-76` |
| UA / client hints | Chrome 121/122 and Edge strings | Chrome **150** Windows; `sec-ch-ua: "Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"` | old `xhs_util.py:L82`, `L102`, `L108`; new `params.py:L13-18`, `L325-361`; `reference_profile.json:L11-12` |
| TLS / HTTP2 | python-requests | `curl_cffi` impersonating `chrome146` over HTTP/2. **[HYP-high]** XHS fingerprints the TLS/H2 stack; this does not affect a real browser | `xhs_pc/http.py:L10-12`; `xhs_core/http.py:L94-100` |

### 2.2 Cookies, storage and tokens (where each is computed)

| name | source | computed / consumed | evidence |
|---|---|---|---|
| `a1` | local (unchanged algorithm) | in the MNS pack and in `x-s-common.x5` | `xhs_utils/common_util.py:L34-39`; `mns.js:L188-189` |
| `webId` | `md5(a1)` (unchanged) | cookie | `common_util.py:L42-43` |
| `abRequestId` | **now server-issued** by the initial `www` navigation ("must not be forged") | cookie | `xhs_pc/state.py:L54-62`; `xhs_pc_login_apis.py:L480-503`. Before, a uuid4 was forged: `cedcb77:apis/xhs_pc_login_apis.py:L93` |
| `ets`, `loadts`, `webBuild`, `xsecappid` | local, written in browser order | `webBuild` is now **6.32.2** (was 6.7.4). `loadts` feeds the MNS pack | `state.py:L38-71`; old `xhs_pc_login_apis.py:L95` |
| `websectiga` | 64-hex output of a **server-issued JSVMP program**: POST `as…/api/sec/v1/scripting {callback:"seccallback"}`, then run the program | cookie; refreshed every 5 min (`TIGA_REFRESH_INTERVAL_MS`) | `xhs_pc_login_apis.py:L373-392`; `xhs_pc/runtime.py:L146-198`; `state.py:L31` |
| `sec_poison_id` | the `secPoisonId` field of that scripting response | cookie | `xhs_pc_login_apis.py:L379`, `L390` |
| `gid` | **Set-Cookie from `as…/api/sec/v1/shield/webprofile`** once a full `profileData` is accepted | **gates the steady MNS tier**: `fingerprint_ready = bool(gid)` | `xhs_pc_login_apis.py:L429-478`, `L528-535`; `state.py:L405-416`, `L476-477` |
| `acw_tc` | edge cookie, **host-only** (edith's copy is never sent to `as`/`so`) | cookie jar scoping | `xhs_core/cookies.py:L10`, `L44-50` |
| `web_session`, `id_token`, `secure_session` | server-issued, HttpOnly (hidden from `document.cookie`) | `web_session` is required | `xhs_pc/auth.py:L270-274`; `state.py:L443-459` |
| `unread` | server | session state | `state.py:L427`, `L472-473` |
| **`x-rednote-datactry`, `x-rednote-holderctry`** | **Set-Cookie on QR-login completion** (`/api/sns/web/v1/login/qrcode/status`) | cookie (likely data-country / holder-country) | `xhs_pc_login_apis.py:L604-632` |
| `window._dsl` | `getdss()` value from `GET as…/api/sec/v1/ds?appId=xhs-pc-web` (an obfuscated VMP; the server returns an anchor timestamp, not `now`) | becomes `x-s-common.x12 = dsllt;_dsl` | `xhs_pc/dsl.py:L7-41`, `L51`; `xhs_pc_login_apis.py:L358-369` |
| `window._dsn` / `_dsf` | DS VMP | `deviceTag` is `a3` (ready) or `nop` (not ready); `_dsf` produces `dsSig` | `dsl.py:L22-25`, `L184-186`; `mns.js:L162-176` |
| localStorage `dsllt`, `last_tiga_update_time`, `p1` (profile-report count), `sc` (sign count), `RWP_LOGIN_TOKEN`, `xhs_sharding_key` | page | session counters feeding the signatures | `state.py:L401-428`, `L626-652`; `params.py:L272` |
| sessionStorage `XHS_TAB_DEVICE_ID` (uuid4), `XHS_RWP_FINGERPRINT` | page | per-tab identity | `state.py:L313-323`, `L422-423` |
| `b1` | 19-field env snapshot, RC4 (`xhswebmplfbt`) + custom base64 | `x-s-common.x8`, plus its CRC in `x9` | `xhs_core/js/b1.js:L5-11`, `L80-84`, `L132-169` |

The full parameter ownership map is in `xhs_pc/auth.py:L21-50` (`PC_PARAMETER_SOURCES`).

### 2.3 Cold-start security bootstrap (browser order, as upstream reproduces it)

Source: `apis/xhs_pc_login_apis.py:L346-396` and `L505-526`.
1. GET `www/` then `www/explore`, which yields `abRequestId`.
2. POST `as…/api/p/pj` **honeypot** with body `{"callFrom":"xhs-pc-web"}` (`L246-275`).
3. POST `edith…/api/redcaptcha/v2/getconfig` (tier 0201) (`L277-299`).
4. GET `pages.xiaohongshu.com/data/sem_sdk` (0201) (`L301-319`).
5. POST `as…/api/sec/v1/scripting {type:"ds"}` (0201), which yields `_dsl` (`L358-369`).
6. POST `as…/api/sec/v1/sbtsource` (0201) (`L321-344`).
7. POST `as…/api/sec/v1/scripting {callback:"seccallback"}` (0101). This yields `websectiga` + `sec_poison_id` and switches the session to tier 0301 (`L373-396`).
8. POST `edith…/api/sns/web/v1/login/activate`, which yields a visitor `web_session` (`L398-427`).
9. POST `as…/api/sec/v1/shield/webprofile` (0301) with `{platform:"Windows", sdkVersion:"4.3.7", svn:"2", profileData:<10k–20k hex>}`. This yields **`gid`** (`L429-478`). Upstream refuses to continue without `gid` (`L528-535`).

**Before:** the old client did scripting(ds) and then webprofile with **`profileData: ""`, `sdkVersion: "4.3.5"`**, and still received `gid` (`cedcb77:apis/xhs_pc_login_apis.py:L63-87`, `L65`; `cedcb77:xhs_utils/common_util.py:L99-105`). **[HYP-high]** Upstream switching to a full 84-field profile means that by July the server no longer issued `gid` for an empty or missing profile.

### 2.4 MNS tiers

| tier | name | encoding | when used | evidence |
|---|---|---|---|---|
| `0101` | coldContent | fixed keystream XOR + custom **base58** | content requests before the fingerprint is ready | `mns.js:L236-245` |
| `0201` | security | **XXTEA** (key `e6483ca2a1eed5e3`, δ=0x3C6EF373) + custom base64 | `/api/sec/v1/*`, `/api/redcaptcha/*`, `sem_sdk` before ready | `mns.js:L247-322` |
| `0301` | steadyContent | keystream XOR + custom base64 | **all requests once `gid` exists or webprofile has been reported** | `mns.js:L230-234` |

Supporting code:
- Tier selection: `xhs_pc/params.py:L77-91` and `state.py:L479-490`. The comment at `state.py:L405-408` reads "A successful webprofile report is the only transition that moves subsequent requests to the steady MNS tier."
- Output gates (prefix + exact length 205/208/200): `runtime.py:L28-32`.
- Per-tier env material (`envConst` 1315/1327/1352 and a 14-byte `envFpTail`): `reference_profile.json:L200-219`.

### 2.5 What `state` / `runtime` / `reference_profile.json` imply about fingerprint and environment checks

- **`webprofile` `profileData`** has 84 fields `x1..x84`. It is a JSON → base64 → DES-ECB (key `zbp30y86`) → hex blob of 10k–20k hex characters (`xhs_pc/js/profile.js:L6`, `L38-93`; `runtime.py:L34`, `L262-268`). The captured fields (`reference_profile.json:L94-198`) include:
  - UA (`x1`)
  - WebGL vendor/renderer (`x7` L101, `x56` L148)
  - screen and available screen (`x9` L103, `x10`)
  - timezone offset and name (`x11` -480 L105, `x12` Asia/Shanghai L106)
  - plugins (`x21` L115)
  - a hash (`x22` L116)
  - `webdriver`-style flags (`x46` L139)
  - sec-canvas (`x45`)
  - `document.cookie` (`x57`)
  - **referrer / location / frame** (`x66` L159)
  - **a list of DOM APIs, `location, getElementById, getElementsByTagName, querySelector, querySelectorAll, evaluate`** (`x70` L167). **[HYP-med]** XHS records whether these are hooked.
  - font bounding box (`x78` L182)
  - **window globals** (`x82` L195)
  - a telemetry string (`x84` L197)
- **`b1`, which rides on *every* request inside `x-s-common.x8`/`x9`**, is a behavioral and environment snapshot (`b1.js:L92-164`; `reference_profile.json:L14-70`). It includes:
  - `x46` = `navigator.webdriver`
  - **`x82` = the page's non-standard window global names, truncated to 300 characters** (`b1.js:L134-138`). The captured value starts `_BHjFmfUMEtxhI|_AUuXfEG27Xa3x|__xhsPendingNotePoint25300ReportMap|…|__rap_hijack_installed__|…|__hp_xhs_search_input_state__|__hp_xhs_search_submit_state__` (`reference_profile.json:L21-36`).
  - **`x84` = interaction telemetry**:
    - mouse `{me,mm,md,mu,c,dc}`, apparently enter, move, down, up, click, double-click (my reading of the abbreviations)
    - keyboard counts
    - page `{ulr,ps,f,b,vc,rs,sc}`, apparently unload-reload, pageshow, focus, blur, visibilitychange, resize, scroll
    - state `{h,f,kr}`, apparently hidden, focused, key-repeat
    - features `{ae,ak,cdr,bf,fi}`, where `fi` is first-interaction ms (`b1.js:L92-127`).
- **The websectiga JSVMP probes the environment.** The reversers had to fake `navigator.*` (including `webdriver:false` and `hardwareConcurrency`), `location`, `document.hidden/visibilityState/referrer`, `screen`, `history.length`, `Image`, `External.toString`, and an `HTMLDivElement.appendChild(self)` that throws "Illegal invocation" (`websectiga_cli.js:L43-191`, `L82-86`). They also had to globally fake **native `name` / `length` / `toString` ("[native code]")** for every stub function (`websectiga_env.js:L28-69`). **[HYP-high]** XHS's security program checks whether host functions are native.
- **RAP** carries a 219-byte "behavior/detection" fingerprint (`rap.js:L16-17`; `rap_cli.js:L15`). The page exposes `__rap_hijack_installed__`, `__rap_report__`, `__rap_last_sign_cost__`, `__rap_last_transform_cost__` (`reference_profile.json:L28-32`). **[FACT]** RAP installs its own fetch/XHR hijack to attach `x-rap-param`.
- **Honeypots.** There is the `as…/api/p/pj` endpoint, plus the page globals `anti_hp_sign_config`, `__hp_xhs_search_input_state__`, `__hp_xhs_search_submit_state__` (`reference_profile.json:L27`, `L34-35`). **[HYP-med]** XHS tracks *how* the search box was filled and submitted.
- **Note-impression reporting.** The globals `__xhsPendingNotePoint25300ReportMap` and `__xhsReportedNotePoint25300RecordMap` (`reference_profile.json:L24-25`) show the page reports note exposure (point 25300) alongside `/feed` reads.

---

## 3. Endpoint & param changes (our 8, plus notable others)

| endpoint | before (cedcb77) | after (origin/master) | evidence |
|---|---|---|---|
| `/api/sns/web/v1/feed` (POST, edith) | body `{source_note_id, image_formats, extra.need_body_topic, xsec_source (default pc_search), xsec_token}`; headers `x-rap-param` + `xy-direction:"13"` | **path and body unchanged**; `xy-direction` is now computed from `user_id`; RAP algorithm replaced | old `L377-394`; new `L470-503`, `L45-49`, `L36-44` |
| `/api/sns/web/v1/homefeed` (POST, edith) | same body (`num:20`, `need_num:10`); no RAP, no xy | **path unchanged**; `num`/`need_num` now parameters ("页面会按视口/阶段动态调整", i.e. the page adjusts them by viewport and stage); **gains `x-rap-param` and `xy-direction`** | old `L47-85`; new `L171-220`, `L36-49` |
| `/api/sns/web/v1/search/notes` (POST, edith) | v1 on edith with a 5-entry `filters[]` always present; `sort:"general"` | **the browser now calls `POST https://so.xiaohongshu.com/api/sns/web/v2/search/notes`** ("2026-07 浏览器实抓（非 edith v1）", i.e. captured from the real browser in July 2026, not edith v1). The body adds **`session_id` (UUIDv4)**; `sort` and `note_type` move into the body; `filters` is sent only for non-default filters. v1 remains in the RAP list only | old `L426-532`; new `L526-597` (`L555-591`), `params.py:L124-129`; `xhs_core/auth.py:L61` |
| `/api/sns/web/v2/comment/page` (GET, edith) | `note_id, cursor, top_comment_id, image_formats, xsec_token` | **unchanged**; not on the RAP list | old `L630-656`; new `L692-717` |
| `/api/sns/web/v1/user/otherinfo` (GET, edith) | `target_user_id` | **unchanged**; fully signed (standard 5 headers) | old `L118-139`; new `L252-272` |
| `/api/sns/web/v2/user/me` (GET, edith) | present | **unchanged path**; now also the `bootstrap()` source of `user_id` for `xy-direction`; signed like every other call | old `L160-176`; new `L72-81`, `L275-290` |
| `/api/sns/web/v1/you/likes` (GET, edith) | `num:20, cursor` | **unchanged** | old `L838-860`; new `L892-913` |
| `/api/sns/web/v1/you/connections` (GET, edith) | `num:20, cursor` | **unchanged** | old `L888-910`; new `L940-961` |
| *(removed)* `/api/sns/web/v1/user/selfinfo` | `get_user_self_info` | **gone** (zero occurrences in new `apis/`) | old `L141-158`; `git grep selfinfo origin/master -- apis/` is empty |
| *(new, security)* `as…/api/sec/v1/ds?appId=xhs-pc-web`, `/api/sec/v1/scripting`, `/api/sec/v1/sbtsource`, `/api/sec/v1/shield/webprofile`, `/api/p/pj`; `edith…/api/redcaptcha/v2/getconfig`; `pages…/data/sem_sdk` | only scripting(ds) and webprofile (empty profile) | full chain (see 2.3) | `dsl.py:L51`; `xhs_pc_login_apis.py:L217-478` |
| *(creator)* `/api/galaxy/creator/note/user/posted` | v1 | **`/api/galaxy/v2/creator/note/user/posted`**. Creator `appId` is `ugc`, signVersion 4.3.6, webBuild 1.18.0, login on `customer.xiaohongshu.com` | old `apis/xhs_creator_apis.py:L416`; new `L747`; `xhs_creator/js/reference_profile.json:L3-12`; `xhs_core/auth.py:L70-84` |

**`xsec_token` / `xsec_source` [FACT]: unchanged.**
- The token is still required in the `/feed` body (`L494`), in `comment/page` (`L707`) and in `user_posted` (`L307`).
- The source values are still `pc_search` (the default when absent), `pc_user` and `pc_feed` (`L474`, `L493`, `L334`, `L393`).
- Explore URLs are still built as `/explore/<id>?xsec_token=<t>` (`spider/spider.py:L77`, `L109`).

---

## 4. Response-shape changes vs our field paths

`xhs_utils/data_util.py` is **byte-identical** between the two commits (`git diff --stat cedcb77 origin/master -- xhs_utils/data_util.py` prints nothing). The July rewrite also kept the same unwrapping: `note_info['data']['items'][0]` (`spider/spider.py:L31`), search `data.items` + `has_more` (`xhs_pc_apis.py:L621-626`), homefeed `data.items` (`L236-238`), comments `data.comments` (`L732`). So every path below is **still valid per the reference**. The one caveat: upstream re-validated the parser against live responses in July, not in October.

| our path (nethook.js) | still valid? | evidence (origin/master) |
|---|---|---|
| `/feed` `data.items[0].note_card.desc` (nethook `L52-53`, `L69`) | ✅ | `data_util.py:L84`; `spider.py:L31` |
| `note_card.image_list[].info_list[1].url` (`L57-63`) | ✅ (`info_list[1]` = WB_DFT) | `data_util.py:L89-93` |
| `note_card.tag_list[].name` (`L64`) | ✅ | `data_util.py:L112-116` |
| `/user/otherinfo` `data.basic_info.*` (`L167`, `L173`) | ✅ (`nickname`, `imageb`, `red_id`, `gender`, `ip_location`, `desc`) | `data_util.py:L32-43` |
| `data.interactions[0/1/2].count` = 关注 / 粉丝 / 获赞收藏 (following / fans / likes+collects) (`L168`, `L174`) | ✅ | `data_util.py:L44-46` |
| `/you/*` `data.message_list[]` (`L182`) | ✅ (+ `cursor`, `has_more`) | `xhs_pc_apis.py:L879`, `L927`, `L975` |

The search v2 body still returns `data.items[]` with `model_type`, `id` and `xsec_token` (`spider.py:L106-109`). nethook's `mapFeedItem` path (`it.note_card`, `it.id`, `it.xsec_token`) agrees with that. That `note_card` is nested inside v2 items is **[HYP-med]**: upstream never dereferences `note_card` for search items.

Minor, not a protocol change: nethook `L128` reads `ii.shared_count` while `/feed` uses `share_count` (`data_util.py:L88`). This is cosmetic.

---

## 5. rednote.com / domain handling

- **[FACT]** Upstream has **no rednote.com host anywhere**. All PC origins are `*.xiaohongshu.com`: `web=www`, `api=edith`, `search=so`, `security=as`, `captcha=edith`, `sem=pages` (`xhs_core/auth.py:L54-67`). A host grep (`xiaohongshu|xhscdn|xhslink|rednote|fengkongcloud` `.com`) over every new `.py`/`.js`/`.json` file finds xiaohongshu.com and xhscdn.com hosts and no rednote host.
- **[FACT]** The only "rednote" strings are the two Set-Cookie names **`x-rednote-datactry`** and **`x-rednote-holderctry`**, set when QR login finishes on edith (`apis/xhs_pc_login_apis.py:L626-631`).
- **[FACT] Host switch for search:** `so.xiaohongshu.com` (`xhs_pc_apis.py:L70`, `L555-591`). The claim "edith only" in hs-portal's CLAUDE.md ("www /api 500s → edith only") is now incomplete. edith still serves everything else, including feed, homefeed, comment, user and you.
- **[HYP-med]** The `https://www.rednote.com/404?source=/404/sec_…` redirect we see is **not explained by upstream**. Two plausible readings: (a) XHS moved its sec-gate page onto the rednote brand domain after July; (b) the session or IP is classified via the `x-rednote-datactry`/`holderctry` cookies as non-CN data or holder country, which would route it to rednote. A read-only check of these two cookie values in the operator's browser would separate the two.
- **[FACT] hs-portal already copes with the rednote redirect.** The manifest matches and has host permissions for `*://*.rednote.com/*` (`extension/manifest.json:L10`, `L28`, `L34`). `XHS_RE` includes rednote (`background.js:L137`). `SEC_RE` matches both `/404?` and `/sec_` (`background.js:L724`; `engine.js:L150`).

---

## 6. Implications for hs-portal (ranked)

hs-portal never signs requests itself; the page does. So upstream's signing changes matter only where **our extension changes what the page reports or sends**. Ranked by likely contribution to 461, -9109, the `/login` redirect, and the sec gate:

### #1 Our DNR shield BLOCKS `as…/api/sec/v1/shield/webprofile` [FACT]. Consequence: [HYP-high]

- **[FACT]** `extension/rules/shield.json` rule id 2 (priority 2) is `{"type":"block"}` on `*as.xiaohongshu.com/api/sec/v1/shield/webprofile*`. Rule id 1 (priority 1) would spoof UA/sec-ch-ua to Chrome 120 macOS on the same URL, but the higher-priority block wins. These rules were "lifted from Redaily" (initial commit `b3ae7e7`) and apply on www **and** creator pages (creator login also posts webprofile: `apis/xhs_creator_login_apis.py:L609`).
- **[FACT, upstream]** webprofile is the **only** path to a `gid` cookie and to the steady `mns0301` signing tier (`state.py:L405-416`, `L476-477`; `xhs_pc_login_apis.py:L429-478`, `L528-535`). In June an empty `profileData` was accepted (`cedcb77…L65`). By July upstream had to send a full 84-field fingerprint.
- **[HYP-high]** With the report blocked, the page never delivers a fresh fingerprint for its current `a1`/`loadts`/`web_session`. That leaves two possibilities: (a) content requests are signed at a pre-fingerprint tier while logged in, or (b) a stale `gid` no longer matches the `b1`/MNS env bytes. Either way, the inconsistency is exactly what a server-side check would 461 or -9109 on. The timing fits a later server enforcement ramp of the July client change.
- **Action:** delete both rules (the entire `shield.json` array) or disable the `xhs_shield` ruleset (`manifest.json` `declarative_net_request`). Do **not** keep rule 1 alone: a Chrome-120-macOS UA on webprofile next to a real-Chrome UA everywhere else is worse. This is not a nethook edit.

### #2 Our extension makes UNSIGNED authenticated API calls [FACT]. Consequence: [HYP-high]

- **[FACT]** `engine.js:L684-706` (`fetchMe`) sends up to 3 bare `fetch(…, {credentials:"include"})` calls: edith `v2/user/me`, edith **`v1/user/me` (an endpoint that exists in neither upstream version)**, and www `v2/user/me`. `engine.js:L711-740` (`fetchSelfInfo`) sends 2 bare calls to `v1/user/otherinfo` (www, then edith). Both run at **every run's end** through `snapshotAccount` (`background.js:L348`, `L357`; called at `L2179`). None of them carries `x-s`, `x-t`, `x-s-common`, `x-b3-traceid` or `x-xray-traceid`.
- **[FACT, upstream]** Browser edith business requests always carry those 5 headers (`xhs_pc_apis.py:L111-115`). Upstream signs `/user/me` too (`L282-284`). Our own CLAUDE.md records otherinfo as 406/461 for unsigned callers.
- **[HYP-high]** These calls put **self-inflicted 461/406 responses and unsigned-request evidence on the account's session**. This is direct bot evidence independent of the page.
- **Action:** remove both network ops. The page itself calls `/user/me` on load, so nethook already captures it (`nethook.js:L160-165`). Use the profile-DOM and nethook path for counts.

### #3 `window.__hsNetHook` leaks into `b1.x82` on every request [FACT mechanism]. Consequence: [HYP-high]

- **[FACT]** `nethook.js:L17-18` sets `window.__hsNetHook = true` at `document_start`, in the MAIN world, before any XHS script runs.
- **[FACT, upstream]** `b1.x82` = the page's non-standard window global names, truncated to 300 characters, sent in `x-s-common` on every request (`b1.js:L134-138`; `reference_profile.json:L21-36`, `L195`).
- **[HYP-high]** Our global is the first non-standard name defined, so it almost certainly appears at the head of `x82`. That would make every one of our sessions trivially distinguishable.
- **Action (nethook `L17-18`):** drop the window property. nethook is injected only through the manifest (no `executeScript`/`registerContentScripts` in `background.js`), so it runs once per document and no guard is needed. If one is wanted, use an unexported closure variable, not a window property.

### #4 nethook's fetch/XHR wrappers are visibly non-native [FACT]. Consequence: [HYP-med]

- **[FACT]** `nethook.js:L203` `window.fetch = function (input, init)` gives `.name === ""` (native is `"fetch"`), `.length === 2` (native is 1), and a `toString()` that returns our source rather than `[native code]`. The same applies to `XHR.prototype.open`/`send` at `L229`/`L235`.
- **[FACT, upstream]** The reversers had to fake exactly `name`, `length` and native `toString` for host functions to pass XHS's sec program (`websectiga_env.js:L28-69`). `webprofile.x70` lists the DOM APIs whose integrity XHS records (`reference_profile.json:L167-174`). RAP installs its own hijack on top of ours (`__rap_hijack_installed__`).
- **Action (nethook `L200-252`):** either make the wrappers native-indistinguishable (preserve `name`/`length` and patch `Function.prototype.toString`, which is itself detectable), or **remove the interceptor from 养号 (account-warming) runs** and keep it only for Content-Studio scans. The second is the safer design choice; it is the caller's call.

### #5 Synthetic interaction telemetry now rides on every request. [HYP-med]

- **[FACT]** `b1.x84` carries mouse, keyboard, page and focus counters plus first-interaction timing (`b1.js:L92-127`). The search box has honeypot state globals (`__hp_xhs_search_input_state__`, `__hp_xhs_search_submit_state__`).
- **[HYP-med]** Three of our interaction patterns could produce a non-human telemetry profile, now baked into `x-s-common.x8`/`x9` for the whole session: (a) programmatic `.click()` without a preceding mousemove/down/up, (b) `execCommand` typing into the search box without key events, and (c) unfocused popup windows (`focused:false`, giving `state.h`/`f`/`vc` values).
- **Action:** an engine-side design question. Do not patch until #1–#3 are fixed and re-tested.

### #6 `xsec_source` is always `pc_feed`, even for tokens captured from search. [HYP-low/med] (for -9109 参数错误)

- **[FACT]** `background.js:L584` and `L1868` append `&xsec_source=pc_feed` unconditionally. The capture source *is* stored per note (`background.js:L1774`, from `nethook.js:L188`).
- **[FACT, upstream]** `xsec_source` is one of `pc_feed`, `pc_search` or `pc_user`, with `pc_search` as the default (`xhs_pc_apis.py:L474`, `L493`).
- **Action:** map `source:"search"` to `pc_search`.

### #7 Search moved to `so.xiaohongshu.com` + v2 [FACT]. No functional nethook edit needed

- `isSearchN` (`nethook.js:L37`, `/\/search\/notes\b/`) matches `/api/sns/web/v2/search/notes`. The MAIN-world wrapper sees page requests to any host.
- **Action:** update the comments at `nethook.js:L33-35` and `L41`, and the "edith only" claim in CLAUDE.md.

### #8 Account-level risk cannot be excluded. [HYP]

- A 461 followed by a forced `/login` (server revoking `web_session`) also happens to accounts flagged regardless of client. The only clean discriminator is a **control run with the extension disabled**: a clean Chrome profile, the same account, a normal manual browse, then compare. Run it after #1–#3 are fixed, at very low volume, and only if the operator accepts the risk.

### nethook.js lines needing edits

| lines | change |
|---|---|
| `L17-18` | remove `window.__hsNetHook` (#3) |
| `L24-28` | `postMessage(…, "*")` broadcasts `{__hs_net:true,…}` to every page `message` listener. **[HYP-low/med]** observable; switch to a less visible channel or drop it along with #4 |
| `L200-222`, `L224-252` | wrapper nativeness or removal (#4) |
| `L33-35`, `L41` | comments only (#7) |
| `L128` | `shared_count` → `share_count` (cosmetic) |
| URL regexes `L30-43` and field mappers `L48-148` | **verified, no change needed** (sections 3 and 4) |

Outside nethook:
- `extension/rules/shield.json` (#1)
- `engine.js:L684-740` and `background.js:L348-357` (#2)
- `background.js:L584`, `L1868` (#6)

---

## 7. Self-check against the bar

| required item | result | evidence |
|---|---|---|
| All 8 endpoints get a verdict with origin/master file:line | **PASS** | §3 rows for feed L470-503, homefeed L171-220, search L526-597, comment/page L692-717, otherinfo L252-272, user/me L275-290, you/likes L892-913, you/connections L940-961 |
| All 6 field paths get a verdict with file:line | **PASS** | §4: `data_util.py` L84, L89-93, L112-116, L32-43, L44-46; `xhs_pc_apis.py` L879/L927/L975; diff-stat shows `data_util.py` unchanged |
| Every new header, cookie and token named with where it is computed | **PASS** | §2.1 headers (x-s, x-t, x-s-common, x-b3, x-xray, x-mns removed, x-rap-param, xy-direction, x-login-mode); §2.2 (a1, webId, abRequestId, ets, loadts, webBuild, xsecappid, websectiga, sec_poison_id, gid, acw_tc, web_session, id_token, secure_session, unread, x-rednote-datactry/holderctry, _dsl/_dsn/_dsf, b1, the localStorage and sessionStorage keys) |
| Hypotheses labeled separately from facts | **PASS** | every implication carries [FACT] or [HYP-x]; the timing caveat is stated up front |
| No change claimed without a git citation | **PASS** | every before/after cell cites a `cedcb77:` or `origin/master:` line; hs-portal facts cite working-tree lines |
| Scope fence respected | **PASS** | only `git diff`/`show`/`log`; ref working copy still at `cedcb77`; no network; no hs-portal code edits; only this report file written |
