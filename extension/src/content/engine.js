// engine.js — XHS content-script engine: atomic operations the background orchestrator
// drives. Selectors transcribed verbatim from Redaily's bundle (the `$(...)` dump).
//
// The SESSION LOOP lives in the background (it survives URL navigations and keeps the MV3
// service worker alive via pending message ports). This file exposes one-shot ops:
//   actions  : like / collect / follow / comment(+submit?) / scroll / dwell / sleep / status
//   nav      : openNextNote / closeNote / isNoteOpen / detectRisk
//   gather   : loadComments / gatherComments / likeComment / replyComment
//   profile  : readUser / followUser

(function () {
  const H = (window.__hs && window.__hs.human) || null;
  if (!H) {
    console.error("[hs] human.js not loaded before engine.js");
    return;
  }

  // ---- DOM map (Xiaohongshu, Redaily v3.3.2 selectors) ---------------------
  const SEL = {
    noteContainer: "#noteContainer",
    feedCards: ".feeds-container .note-item",
    // Cover images in the feed — Redaily's openNote clicks the <img> (in-SPA modal open),
    // matched by src. The note card cover is `a.cover img`; [elementtiming=note-cover] is
    // XHS's own cover marker (used by Redaily's cover() reader).
    // The /search_result feed reuses the same .feeds-container .note-item card shell as
    // /explore, but the cover <img> may not sit under a.cover/.cover — append a generic
    // per-card img fallback so openNextNote can read covers on the search page too.
    feedCovers:
      '.feeds-container .note-item a.cover img, .feeds-container .note-item .cover img, [elementtiming="note-cover"] img, .feeds-container .note-item img',
    closeNote: ".close-circle .close",
    closeNoteAlt: ".close-circle",
    // Engage controls — Redaily exact (likeNote/collectNote): $(".interactions .buttons
    // .like-wrapper"); state from the <use> xlink:href === "#liked" / "#collected".
    likeWrap: ".interactions .buttons .like-wrapper",
    collectWrap: ".interactions .buttons .collect-wrapper",
    followBtn: "#noteContainer .follow-button, .follow-button",
    chatWrapper: ".engage-bar .chat-wrapper, #noteContainer .chat-wrapper",
    editor: "#noteContainer [contenteditable='true'], .engage-bar [contenteditable='true']",
    submit: ".engage-bar .submit, #noteContainer .submit, .submit",
    // Search — Redaily findSearchNoteInput / findSearchNoteSubmitButton cascades, tried
    // IN ORDER. The in-feed AI search textarea is the real input on current XHS; the old
    // #search-input / input.search-input are stale and route through a gated navigation.
    searchInputs: [
      '#search-input-in-feeds textarea[name="aiSearchTextarea"]',
      '#search-input-in-feeds textarea.textarea',
      '.search-area textarea[name="aiSearchTextarea"]',
      "#search-input",
      '.header-container input.search-input:not([aria-hidden="true"])',
    ],
    searchSubmits: [
      "#search-input-in-feeds .submit-button-wrapper:not(.disabled)",
      ".search-area .bottom-box-right-submit-button .submit-button-wrapper:not(.disabled)",
      ".header-container button.reds-button-new.min-width-search-icon",
    ],
    noteScroller: ".note-scroller",
    noteContainerScroll: ".note-container", // explore.js y(): single-col scroller fallback
    commentsEl: ".comments-el",
    noComments: ".comments-el .no-comments",
    commentItems: ".comments-el .parent-comment > .comment-item",
    parentComment: ".parent-comment", // explore.js focusCommentForGather closest(".parent-comment")
    commentReply: ".interactions .reply", // explore.js replyComment h(): find(".interactions .reply")
    // explore.js likeComment j(): find(".interactions .like .like-wrapper")[0]; state use href "#liked"
    commentLikeWrap: ".interactions .like .like-wrapper",
    // comment editor — explore.js commentNote m()/replyComment h(): getElementById("content-textarea")
    contentTextarea: "content-textarea",
    // explore.js getNoteType f(): $("#noteContainer").data("type"); image browse + video + read
    arrowRight: ".arrow-controller.right", // explore.js browseImage j(): $(".arrow-controller.right")[0]
    fraction: ".fraction", // explore.js getImageCount: $(".fraction")[0], count after last "/"
    videoTime: ".xgplayer-time span:last-child", // explore.js browseVideo x(): $(".xgplayer-time span:last")
    detailTitle: "#noteContainer #detail-title", // explore.js getNoteInfo: $("#noteContainer #detail-title")
    detailDesc: "#noteContainer #detail-desc", // explore.js getNoteInfo: $("#noteContainer #detail-desc")
    // focusCommentForGather fields (explore.js v())
    cmtContent: ".content .note-text", // find(".content .note-text")[0]
    cmtLikeCount: ".interactions .like .count",
    cmtReplyCount: ".interactions .reply .count",
    cmtAvatarLink: ".avatar a[href*='/user/profile/']", // userId via .attr("data-user-id"); profileUrl = .href
    cmtUserName: ".author-wrapper .author .name",
    cmtLocation: ".info .date .location",
    // profile page (user-profile.04aac1fc.js getUserProfileData m())
    userName: ".user-name",
    userRedId: ".user-redId",
    userIP: ".user-IP",
    userInteractions: ".user-interactions",
    userInteractionRow: ".user-interactions > div", // m(): find("> div"), each .count + .shows
    genderTag: ".user-tags .tag-item:has(.gender)", // m(): find("svg use") xlink:href #male/#female
    // user-profile.js followUserProfile f(): $(".user-info .follow-btn") text 关注/Follow
    profileFollowBtn: ".user-info .follow-btn",
    // user-profile.js getProfileNotes u(): .feeds-container .note-item img + a[href^='/explore/']
    profileNoteCards: ".feeds-container .note-item",
    profileNoteLink: "a[href^='/explore/']",
  };

  // ---- utils ---------------------------------------------------------------
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.from((r || document).querySelectorAll(s));
  // qFirst(list) — first element matching any selector, tried IN ORDER (cascade priority;
  // a comma-joined selector would instead return document-order, losing the priority).
  const qFirst = (list, r) => {
    for (const s of list || []) {
      const el = q(s, r);
      if (el) return el;
    }
    return null;
  };
  const txt = (s, r) => {
    const el = q(s, r);
    return el ? (el.textContent || "").trim() : "";
  };
  const ok = (detail, extra) => Object.assign({ ok: true, detail }, extra || {});
  const fail = (error) => ({ ok: false, error });

  function getNoteId() {
    const m = location.pathname.match(/(?:explore|discovery\/item)\/([0-9a-zA-Z]+)/);
    return m ? m[1] : null;
  }
  // "1.2万" → 12000, "238" → 238
  function parseCount(s) {
    s = (s || "").trim();
    if (!s) return 0;
    const num = parseFloat(s.replace(/[^0-9.]/g, "")) || 0;
    return /万/.test(s) ? Math.round(num * 10000) : Math.round(num);
  }
  function waitFor(sel, timeout = 6000) {
    return new Promise((res) => {
      const t0 = Date.now();
      (function poll() {
        const el = q(sel);
        if (el) return res(el);
        if (Date.now() - t0 > timeout) return res(null);
        setTimeout(poll, 150);
      })();
    });
  }
  function waitForGone(sel, timeout = 4000) {
    return new Promise((res) => {
      const t0 = Date.now();
      (function poll() {
        if (!q(sel)) return res(true);
        if (Date.now() - t0 > timeout) return res(false);
        setTimeout(poll, 150);
      })();
    });
  }

  function _detectRisk() {
    try {
      // URL-level: XHS's risk gate bounces a flagged/unavailable note to a /404/sec_…
      // page with error_code=300031. This is the strongest signal — check it first.
      const href = location.href || "";
      if (/\/404(\?|$|\/)|error_code=300031|\/sec_|[?&]verifyMsg=/.test(href))
        return "404/sec gate (" + (location.pathname || "") + ")";
      if (q('[class*="captcha" i], [class*="verify" i], #nc_1_wrapper, .shumei_captcha, .reds-captcha'))
        return "captcha/slider element present";
      const t = (document.body && document.body.innerText) || "";
      if (/滑动验证|安全验证|请完成.{0,6}验证|完成下方验证|当前页面无法访问|This Page Isn'?t Available/i.test(t)) return "verification/unavailable prompt";
      return null;
    } catch (e) {
      return null;
    }
  }

  // like/collect control: clickable wrapper + current state from its <use> href.
  // Redaily checks the <use> xlink:href EXACTLY === "#liked" / "#collected".
  function engageControl(kind) {
    const wrap = q(kind === "like" ? SEL.likeWrap : SEL.collectWrap);
    if (!wrap) return null;
    const use = q("use", wrap);
    const href = use ? (use.getAttribute("xlink:href") || use.getAttribute("href") || "") : "";
    const done = kind === "like" ? "#liked" : "#collected";
    return { wrap, active: href === done || href.toLowerCase().includes(done.slice(1)) };
  }

  // clickEngageVerify(kind, wrap) — click an engage control, then CONFIRM the state actually
  // flipped to active. A synthetic click or a drifted selector can silently no-op (the click
  // "succeeds" but nothing changes), which a live run would falsely log as success. We poll the
  // control's <use> state and, if the wrapper click didn't take, retry on the inner <svg>.
  // Returns true only when the control is verified active — this is the live-run truth signal.
  async function clickEngageVerify(kind, wrap) {
    const flipped = async () => {
      const s = engageControl(kind);
      return !!(s && s.active);
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      H.simulateClick(attempt === 0 ? wrap : q("svg", wrap) || wrap);
      for (let i = 0; i < 6; i++) {
        await H.delay(160, 240);
        if (await flipped()) return true;
      }
    }
    return false;
  }

  // ---- atomic actions ------------------------------------------------------
  const actions = {
    async status() {
      const like = engageControl("like");
      const collect = engageControl("collect");
      return ok("status", {
        noteId: getNoteId(),
        onNote: !!q(SEL.noteContainer),
        liked: like ? like.active : null,
        collected: collect ? collect.active : null,
      });
    },

    async detectRisk() {
      return ok("risk", { risk: _detectRisk() });
    },

    async isNoteOpen() {
      return ok("isNoteOpen", { open: !!q(SEL.noteContainer) });
    },

    // probeNote — DIAGNOSTIC: report which engage controls the SEL map actually resolves on the
    // currently-open note. A live (or dry) run logs this once so selector drift is unmistakable:
    // a "✗" means the selector matched nothing on live DOM → fix that SEL entry in this file.
    async probeNote() {
      return ok("probe", {
        probe: {
          noteOpen: !!q(SEL.noteContainer),
          like: !!q(SEL.likeWrap),
          collect: !!q(SEL.collectWrap),
          follow: !!q(SEL.followBtn),
          chat: !!q(SEL.chatWrapper),
          editor: !!document.getElementById(SEL.contentTextarea),
        },
      });
    },

    async like() {
      const c = engageControl("like");
      if (!c) return fail("like control not found (no note open?)");
      if (c.active) return ok("already liked");
      await H.scrollIntoViewSmooth(c.wrap);
      await H.delay(300, 900);
      if (await clickEngageVerify("like", c.wrap)) return ok("liked");
      return fail("clicked like but state never flipped (selector drift or click ignored — run probeNote)");
    },

    async collect() {
      const c = engageControl("collect");
      if (!c) return fail("collect control not found (no note open?)");
      if (c.active) return ok("already collected");
      await H.delay(300, 900);
      if (await clickEngageVerify("collect", c.wrap)) return ok("collected");
      return fail("clicked collect but state never flipped (selector drift or click ignored — run probeNote)");
    },

    async follow() {
      const btn = q(SEL.followBtn);
      if (!btn) return fail("follow button not found");
      const t = (btn.textContent || "").trim();
      if (t.includes("已关注") || t.includes("关注中")) return ok("already following");
      await H.delay(300, 900);
      H.simulateClick(btn);
      // Verify the follow took: poll the button text until it shows a followed state.
      for (let i = 0; i < 8; i++) {
        await H.delay(180, 280);
        const now = ((q(SEL.followBtn) || {}).textContent || "").trim();
        if (now.includes("已关注") || now.includes("关注中") || now.includes("互相关注")) return ok("followed");
      }
      return fail("clicked follow but button text never changed (selector drift or click ignored)");
    },

    // comment — Redaily explore.js commentNote m(), copied EXACTLY: click .chat-wrapper
    // (eq 0) → sleep → editor = getElementById("content-textarea") → editor.innerText=text;
    // dispatch InputEvent("input",{inputType:"insertText",data:text}). Submit (j()) = click
    // .submit then sleep(5e3); only when {submit:true} (default off = no-burn safety).
    async comment({ text, submit } = {}) {
      if (!text) return fail("no comment text");
      const box = q(SEL.chatWrapper);
      if (!box) return fail("comment box not found (no note open?)");
      H.simulateClick(box);
      await H.delay(1600, 2400); // Redaily sleep(2e3) after opening editor
      const editor = document.getElementById(SEL.contentTextarea);
      if (!editor) return fail("comment editor (#content-textarea) not found");
      await H.delay(400, 700); // Redaily sleep(500)
      editor.innerText = text;
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
      await H.delay(400, 700); // Redaily sleep(500)
      if (submit) {
        const sb = q(SEL.submit);
        if (!sb) return fail("submit button not found");
        await H.delay(400, 900);
        H.simulateClick(sb);
        await H.delay(4500, 5500); // Redaily sleep(5e3) post-submit
        return ok("comment submitted");
      }
      return ok("comment typed (not submitted)");
    },

    async scroll({ steps } = {}) {
      await H.scrollFeed(steps || 3);
      return ok("scrolled");
    },
    async dwell({ ms } = {}) {
      await H.delay(ms || H.randInt(8000, 15000));
      return ok("dwelled");
    },
    // sleep — background uses this for all pacing so an open message port keeps the SW alive.
    async sleep({ min, max } = {}) {
      await H.delay(min || 1000, max == null ? min || 1000 : max);
      return ok("slept");
    },

    // search — Redaily searchNote, copied EXACTLY: type the keyword into the in-feed AI
    // search textarea via execCommand, press Enter, and ONLY if Enter didn't navigate to
    // /search_result, click the submit button. Verifying the pathname is how Redaily knows
    // the soft in-SPA search fired (vs. our old version, which typed into a stale input and
    // triggered a navigation XHS sec-gated to /404).
    async search({ keyword } = {}) {
      if (!keyword) return fail("no keyword");
      const input = qFirst(SEL.searchInputs);
      if (!input) return fail("search input not found (XHS DOM may have changed)");
      input.focus();
      if (input.select) input.select();
      let typed = false;
      try {
        typed = document.execCommand("insertText", false, keyword);
      } catch (e) {
        typed = false;
      }
      if (!typed) {
        if ("value" in input) input.value = keyword;
        else input.textContent = keyword;
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await H.delay(800);
      const ev = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
      input.dispatchEvent(new KeyboardEvent("keydown", ev));
      input.dispatchEvent(new KeyboardEvent("keypress", ev));
      input.dispatchEvent(new KeyboardEvent("keyup", ev));
      await H.delay(1200);
      if (!location.pathname.includes("search_result")) {
        const btn = qFirst(SEL.searchSubmits);
        if (btn) H.simulateClick(btn);
      }
      await H.delay(3000);
      return location.pathname.includes("search_result")
        ? ok("searched", { keyword })
        : fail("search did not reach search_result (pathname: " + location.pathname + ")");
    },

    // ---- note reading (Redaily explore.js: getNoteType / browseImage / browseVideo /
    //      browseContentAndComments — the real "open + read the note" dwell) -----------

    // getNoteType — Redaily f(): $("#noteContainer").data("type") → "normal"/"video". jQuery
    // .data("type") reads data-type; mirror with dataset.type, fall back to .xgplayer presence.
    async getNoteType() {
      const nc = q(SEL.noteContainer);
      let t = nc && nc.dataset ? nc.dataset.type : "";
      if (!t) {
        if (q(".xgplayer, .xgplayer-poster, #noteContainer video")) t = "video";
        else if (nc) t = "normal";
      }
      const noteType = t === "video" ? "video" : t === "normal" ? "normal" : "unknown";
      return ok("noteType", { noteType });
    },

    // browseImage — Redaily j(e): getImageCount from $(".fraction") (number after last "/",
    // default 1); loop count-1 times: sleep(getRandomIntInRange(2e3,3e3)) then click
    // $(".arrow-controller.right")[0] via simulateClickElement. Self-contained (reads count).
    async browseImage() {
      let count = 1;
      const frac = q(SEL.fraction);
      if (frac) {
        const t = frac.textContent || "";
        const tail = t.substring(t.lastIndexOf("/") + 1);
        const n = parseInt(tail, 10);
        if (n && n > 0) count = n;
      }
      const arrow = q(SEL.arrowRight);
      for (let i = 0; i < count - 1; i++) {
        await H.delay(2000, 3000); // Redaily getRandomIntInRange(2e3,3e3)
        if (arrow) H.simulateClick(arrow);
      }
      return ok("browsedImage", { count });
    },

    // browseVideo — Redaily x(): read $(".xgplayer-time span:last") text, split ":" → parse
    // hh:mm:ss / mm:ss to seconds, sleep min(sec*1000, 6e4). One exact delay.
    async browseVideo() {
      const el = q(SEL.videoTime) || (qa(".xgplayer-time span").slice(-1)[0] || null);
      let sec = 0;
      if (el) {
        const parts = (el.textContent || "").trim().split(":");
        if (parts.length === 3) sec = 3600 * Number(parts[0]) + 60 * Number(parts[1]) + Number(parts[2]);
        else if (parts.length === 2) sec = 60 * Number(parts[0]) + Number(parts[1]);
      }
      if (!sec || Number.isNaN(sec)) {
        const fb = H.randInt(5000, 8000); // unreadable duration → short fallback dwell
        await H.delay(fb);
        return ok("browsedVideo", { ms: 0 });
      }
      const ms = Math.min(sec * 1000, 60000); // Redaily sleep(a<6e4?a:6e4)
      await H.delay(ms);
      return ok("browsedVideo", { ms });
    },

    // browseContentAndComments — Redaily y(): pick scroller (.note-scroller if body width>=960
    // [double-col] else .note-container), repeatedly simulateScroll(el,500)+sleep(2e3) until the
    // computed reference scrollTop is reached. We cap iterations and stop at the natural bottom.
    async browseContentAndComments() {
      const doubleCol = (document.body && document.body.offsetWidth >= 960);
      const scroller =
        (doubleCol ? q(SEL.noteScroller) : q(SEL.noteContainerScroll)) ||
        q(SEL.noteScroller) ||
        q(SEL.noteContainerScroll) ||
        q(SEL.noteContainer);
      if (!scroller) return ok("browsedContent", { scrolled: 0 });
      let i = 0;
      let last = -1;
      for (; i < 8; i++) {
        scroller.scrollBy ? scroller.scrollBy({ top: 500, behavior: "smooth" }) : (scroller.scrollTop += 500);
        await H.delay(1500, 2500); // Redaily sleep(2e3)
        const top = scroller.scrollTop;
        if (top + scroller.clientHeight >= scroller.scrollHeight - 4) break; // reached bottom
        if (top === last) break; // no further movement
        last = top;
      }
      return ok("browsedContent", { scrolled: i });
    },

    // getNoteInfo — Redaily getNoteInfo d(): $("#noteContainer #detail-title").text().trim()
    // and $("#noteContainer #detail-desc").text().trim(). Best-effort (empty if absent).
    async getNoteInfo() {
      return ok("noteInfo", {
        title: txt(SEL.detailTitle),
        desc: txt(SEL.detailDesc),
      });
    },

    // extractNote — DOM fallback/supplement for the remix source dossier when the nethook
    // /feed capture misses. Reads title + full desc/正文 + ALL carousel images + tags. The
    // carousel rule is the ops-skill's (xhs-runtime-rules §轮播详情页抓图): take the active,
    // non-duplicate slide imgs (currentSrc||src); never just the first .img-container. We
    // collect ALL non-duplicate slides (the operator wants every image), deduped by src.
    async extractNote() {
      const title = txt(SEL.detailTitle);
      const desc = txt(SEL.detailDesc);
      const seen = new Set();
      const images = [];
      const push = (el) => {
        if (!el) return;
        const s = el.currentSrc || el.src || el.getAttribute("src") || "";
        if (s && !s.startsWith("data:") && !seen.has(s)) {
          seen.add(s);
          images.push(s);
        }
      };
      qa(
        ".swiper-slide:not(.swiper-slide-duplicate) .img-container img, " +
          ".note-slider .swiper-slide:not(.swiper-slide-duplicate) img, " +
          "#noteContainer .media-container img, #noteContainer .swiper-slide-active img"
      ).forEach(push);
      if (!images.length) qa("#noteContainer img, .note-slider img").forEach(push);
      // tags — anchor chips inside the desc / note text (strip a leading #).
      const tags = qa("#detail-desc a, #noteContainer .note-text a, #noteContainer .tag")
        .map((a) => (a.textContent || "").replace(/^#/, "").trim())
        .filter(Boolean);
      return ok("extractNote", { title, desc, images: images.slice(0, 12), tags: [...new Set(tags)].slice(0, 20) });
    },

    // ---- navigation (discovery: modal open/close, no page reload) ----------
    // Redaily openNote: find a feed cover <img> and CLICK THE IMG — XHS opens the note as an
    // in-SPA modal (#noteContainer). It NEVER clicks the <a href> or navigates to a note URL;
    // a real navigation triggers the /404 sec gate. We layer in RANDOM card selection + stable
    // noteId dedup (research best practice: 模拟真人随机浏览，不要只点头部大爆款) so we don't keep
    // reopening the same first/top post — the prior version always took covers[0] and deduped
    // by cover src, which lazy-swaps, so the same note got reopened endlessly.
    async openNextNote({ visited } = {}) {
      const seen = new Set(visited || []);
      // Candidate pool: each unvisited feed card with its cover <img> + STABLE noteId (from the
      // card's /explore/<id> link). Dedup by noteId first, then cover src.
      const collect = () => {
        const out = [];
        for (const card of qa(SEL.feedCards)) {
          const img = q("a.cover img", card) || q(".cover img", card) || q("img", card);
          if (!img) continue;
          const src = (img.getAttribute && img.getAttribute("src")) || "";
          const link = q("a[href*='/explore/'], a[href*='/discovery/item/']", card);
          const href = link ? (link.getAttribute("href") || link.href || "") : "";
          const m = href.match(/(?:explore|discovery\/item)\/([0-9a-zA-Z]+)/);
          const noteId = m ? m[1] : "";
          if (!noteId && !src) continue;
          if ((noteId && seen.has(noteId)) || (src && seen.has(src))) continue;
          out.push({ img, src, noteId, key: noteId || src });
        }
        return out;
      };
      let candidates = collect();
      // Thin pool → scroll to load more cards first (more variety, fewer repeats).
      if (candidates.length <= 1) {
        await H.scrollFeed(H.randInt(1, 3));
        await H.delay(700, 1400);
        candidates = collect();
      }
      if (!candidates.length) return fail("no unvisited note cover found");
      // RANDOM pick — never deterministically the first/top card. This is what stops the
      // "same post / same people over and over" loop.
      const pick = candidates[H.randInt(0, candidates.length - 1)];
      pick.img.scrollIntoView({ behavior: "smooth", block: "center" });
      await H.delay(700, 1600);
      H.simulateClick(pick.img); // click the cover IMG → in-SPA modal
      const opened = await waitFor(SEL.noteContainer, 6000);
      if (opened) return ok("opened", { noteId: pick.noteId || getNoteId(), cover: pick.src, key: pick.key });
      await actions.closeNote(); // dismiss any half-open state
      return fail("note did not open from random cover");
    },

    async closeNote() {
      const btn = q(SEL.closeNote) || q(SEL.closeNoteAlt);
      if (btn) {
        H.simulateClick(btn);
        await waitForGone(SEL.noteContainer, 4000);
        return ok("closed");
      }
      history.back();
      await H.delay(800, 1500);
      return ok("closed (history.back)");
    },

    // ---- comments / gather (comment-section mode) -------------------------
    async loadComments({ maxScrolls } = {}) {
      const scroller = q(SEL.noteScroller) || q(SEL.noteContainer);
      const n = maxScrolls || 6;
      for (let i = 0; i < n; i++) {
        if (q(SEL.noComments)) break;
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
        else window.scrollBy({ top: 700, behavior: "smooth" });
        await H.delay(800, 1700);
      }
      return ok("comments loaded", { count: qa(SEL.commentItems).length });
    },

    // gatherComments — reads Redaily focusCommentForGather v() fields per .parent-comment:
    //   content  = find(".content .note-text")[0].text().trim()
    //   likes    = find(".interactions .like .count")[0]  (万-aware)
    //   replies  = find(".interactions .reply .count")[0]  ("回复" → 0)
    //   avatar   = find(".avatar a[href*='/user/profile/']")[0]: userId = .attr("data-user-id"),
    //              profileUrl = anchor .href; userName = find(".author-wrapper .author .name")
    //   location = find(".info .date .location")[0]
    // We iterate the same .comments-el .parent-comment > .comment-item Redaily lists in
    // getCommentListForGather, walk to the enclosing .parent-comment for the field reads, and
    // assign a stable it.id so commentId round-trips to likeComment/replyComment.
    async gatherComments() {
      const items = qa(SEL.commentItems);
      const comments = items.map((it, idx) => {
        if (!it.id) it.id = "hs-cmt-" + idx;
        const parent = it.closest(SEL.parentComment) || it;
        const link = q(SEL.cmtAvatarLink, parent);
        const dataUserId = link ? link.getAttribute("data-user-id") : null;
        const href = link ? (link.getAttribute("href") || link.href || "") : "";
        const um = href.match(/user\/profile\/([0-9a-zA-Z]+)/);
        const userId = dataUserId || (um ? um[1] : "idx_" + idx);
        const contentEl = q(SEL.cmtContent, parent);
        const likeEl = q(SEL.cmtLikeCount, parent);
        const replyEl = q(SEL.cmtReplyCount, parent);
        const locEl = q(SEL.cmtLocation, parent);
        const replyTxt = replyEl ? (replyEl.textContent || "").trim() : "";
        return {
          userId,
          commentId: it.id,
          content: contentEl ? (contentEl.textContent || "").trim() : "",
          likeCount: parseCount(likeEl && likeEl.textContent),
          replyCount: replyTxt === "回复" ? 0 : parseCount(replyTxt),
          profileUrl: href || undefined,
          ipLocation: locEl ? (locEl.textContent || "").trim() : undefined,
        };
      });
      return ok("gathered", { comments });
    },

    // likeComment — Redaily explore.js likeComment j(e): getElementById(commentId) →
    // find(".interactions .like .like-wrapper")[0]; skip if already liked (the wrapper's
    // <use> xlink:href === "#liked"); else simulateClickElement.
    async likeComment({ commentId } = {}) {
      const it = commentId && document.getElementById(commentId);
      if (!it) return fail("comment item not found");
      const like = q(SEL.commentLikeWrap, it);
      if (!like) return fail("comment like control not found");
      const use = q("use", like);
      const href = use ? (use.getAttribute("xlink:href") || use.getAttribute("href") || "") : "";
      if (href === "#liked") return ok("comment already liked");
      it.scrollIntoView({ behavior: "smooth", block: "center" });
      await H.delay(400, 1000);
      H.simulateClick(like);
      return ok("comment liked");
    },

    // replyComment — Redaily explore.js replyComment h(e,t), copied EXACTLY: r =
    // getElementById(commentId) → click find(".interactions .reply")[0] → sleep(1e3) →
    // editor = getElementById("content-textarea") → sleep(500) → editor.innerText=text;
    // dispatch InputEvent("input",{inputType:"insertText",data:text}) → sleep(500). Submit
    // (fillAndSubmit) = click .submit then sleep(5e3); only when {submit:true} (no-burn).
    async replyComment({ commentId, text, submit } = {}) {
      const it = commentId && document.getElementById(commentId);
      if (!it) return fail("comment item not found");
      if (!text) return fail("no reply text");
      const reply = q(SEL.commentReply, it);
      if (!reply) return fail("reply button not found");
      it.scrollIntoView({ behavior: "smooth", block: "center" });
      await H.delay(400, 900);
      H.simulateClick(reply);
      await H.delay(900, 1300); // Redaily sleep(1e3)
      const editor = document.getElementById(SEL.contentTextarea);
      if (!editor) return fail("reply editor (#content-textarea) not found");
      await H.delay(400, 700); // Redaily sleep(500)
      editor.innerText = text;
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
      await H.delay(400, 700); // Redaily sleep(500)
      if (submit) {
        const sb = q(SEL.submit);
        if (!sb) return fail("submit button not found");
        await H.delay(400, 900);
        H.simulateClick(sb);
        await H.delay(4500, 5500); // Redaily sleep(5e3) post-submit
        return ok("reply submitted");
      }
      return ok("reply typed (not submitted)");
    },

    // ---- profile mode -----------------------------------------------------

    // readUser — Redaily user-profile.js getUserProfileData m(), STRUCTURAL reads:
    //   gender    = $(".user-tags .tag-item:has(.gender)") find("svg use") xlink:href #male/#female
    //   nickname  = $(".user-name").text().trim()
    //   followers/following = $(".user-interactions") find("> div") each: .count number +
    //               .shows label (关注 → following, 粉丝 → followers, 获赞与收藏 → likes)
    //   redId     = $(".user-redId").text() match /小红书号：([^\s]+)/
    //   ipLocation= $(".user-IP").text() match /IP属地：(.+)/
    async readUser() {
      const name = txt(SEL.userName);
      // redId — exact Redaily regex (full-width colon "："), fall back to stripping label text.
      let redId = "";
      const redIdEl = q(SEL.userRedId);
      if (redIdEl) {
        const rt = redIdEl.textContent || "";
        const rm = rt.match(/小红书号[：:]\s*([^\s]+)/);
        redId = rm ? rm[1] : rt.replace(/小红书号[：:]?/, "").trim();
      }
      // ipLocation — exact Redaily regex.
      let ip = "";
      const ipEl = q(SEL.userIP);
      if (ipEl) {
        const it = ipEl.textContent || "";
        const im = it.match(/IP属地[：:]\s*(.+)/);
        ip = im ? im[1].trim() : it.replace(/IP\s*属地[：:]?/, "").trim();
      }
      // gender — svg use xlink:href on the gender tag.
      let gender = "unknown";
      const gtag = q(SEL.genderTag);
      if (gtag) {
        const use = q("svg use", gtag);
        const href = use ? (use.getAttribute("xlink:href") || use.getAttribute("href") || "") : "";
        if (href === "#male") gender = "male";
        else if (href === "#female") gender = "female";
      }
      // followers/following/likes — iterate .user-interactions > div, match the .shows label.
      // 获赞与收藏 (likes+collects total) is the second traction metric the account-status
      // tile tracks; Redaily parsed it but discarded it — we keep it.
      let followers = null,
        following = null,
        likes = null;
      for (const row of qa(SEL.userInteractionRow)) {
        const countEl = q(".count", row);
        const showsEl = q(".shows", row);
        if (!countEl || !showsEl) continue;
        const n = parseCount(countEl.textContent);
        const label = (showsEl.textContent || "").trim();
        if (label.includes("粉丝")) followers = n;
        else if (label.includes("关注")) following = n;
        else if (label.includes("获赞") || label.includes("收藏")) likes = n;
      }
      return ok("user", { user: { userId: redId || getNoteId(), name, ipLocation: ip, gender, followers, following, likes } });
    },

    // ---- own-account stats (traction tracking) ----------------------------
    // The page self-signs XHS's x-s headers, so OUR cross-origin fetch to a signed
    // endpoint usually 461s. fetchMe hits the lightweight, cookie-authed session probe
    // (/user/me) which is typically UN-signed — it yields our own user_id + nickname.
    // Same-origin first (www proxies it on current builds), then edith as a fallback.
    async fetchMe() {
      // edith serves the API; www /api/sns 500s ("jarvis-gateway"). Confirmed by live probe:
      // edith /user/me returns 200 {code:-101 "无登录信息"} unauth → real user_id once cookies attach.
      const urls = [
        "https://edith.xiaohongshu.com/api/sns/web/v2/user/me",
        "https://edith.xiaohongshu.com/api/sns/web/v1/user/me",
        "https://www.xiaohongshu.com/api/sns/web/v2/user/me",
      ];
      for (const url of urls) {
        try {
          const r = await fetch(url, { credentials: "include", headers: { accept: "application/json" } });
          if (!r.ok) continue;
          const j = await r.json();
          const d = (j && (j.data || j)) || {};
          const userId = d.user_id || d.userId || d.id || "";
          if (!userId) continue;
          return ok("me", { userId, nickname: d.nickname || d.name || "", guest: !!d.guest });
        } catch (e) {
          /* try next */
        }
      }
      return fail("could not resolve own user_id (/user/me unreachable or logged out)");
    },

    // fetchSelfInfo — best-effort signed-endpoint read of our own counts WITHOUT navigation.
    // otherinfo is usually x-s-gated → 461 for our fetch; if so we return fail and the
    // background falls back to navigating the profile and reading the DOM (verified path).
    async fetchSelfInfo({ userId } = {}) {
      if (!userId) return fail("no userId");
      const urls = [
        "https://www.xiaohongshu.com/api/sns/web/v1/user/otherinfo?target_user_id=" + userId,
        "https://edith.xiaohongshu.com/api/sns/web/v1/user/otherinfo?target_user_id=" + userId,
      ];
      for (const url of urls) {
        try {
          const r = await fetch(url, { credentials: "include", headers: { accept: "application/json" } });
          if (!r.ok) continue;
          const j = await r.json();
          if (j && (j.code === 0 || j.success)) {
            const d = (j.data || {}) || {};
            const basic = d.basic_info || {};
            let followers = null, following = null, likes = null;
            for (const it of d.interactions || []) {
              const key = (it.type || "") + "|" + (it.name || "");
              const n = parseCount(String(it.count));
              if (/fans|粉丝/.test(key)) followers = n;
              else if (/follows|关注/.test(key)) following = n;
              else if (/interaction|获赞|收藏/.test(key)) likes = n;
            }
            if (followers != null || likes != null)
              return ok("selfInfo", { followers, following, likes, nickname: basic.nickname || "" });
          }
        } catch (e) {
          /* try next */
        }
      }
      return fail("otherinfo unreadable (likely x-s gated) — use DOM fallback");
    },

    // switchNotifTab — best-effort click of a notification-page tab by visible text (e.g.
    // "关注" for 新增关注), so the page fires its signed /you/connections call which nethook
    // captures. The /notification default tab (赞和收藏) already fires /you/likes on load.
    // Selectors are UNVERIFIED (no Redaily precedent) — a miss is a harmless no-op.
    async switchNotifTab({ label } = {}) {
      try {
        const want = label || "关注";
        const cands = qa("[class*='tab'], [role='tab'], .reds-tab-item, .channel-item, .sub-tab-list *, nav a, .menu *");
        const el = cands.find((t) => {
          const tx = (t.textContent || "").trim();
          return tx && tx.length <= 8 && tx.includes(want);
        });
        if (!el) return fail("notif tab not found");
        el.scrollIntoView({ block: "center" });
        await H.delay(300, 700);
        H.simulateClick(el);
        return ok("switched", { label: want });
      } catch (e) {
        return fail(String((e && e.message) || e));
      }
    },

    // followUser — KEPT: the NOTE-AUTHOR follow button inside an open note modal (Redaily
    // explore.js _(): $(".follow-button"), already = .reds-button-new-text text === "已关注").
    // DISTINCT from followUserProfile (the profile-page owner button).
    async followUser() {
      const btn = q(SEL.followBtn);
      if (!btn) return fail("note-author follow button not found");
      const t = (btn.textContent || "").trim();
      if (t.includes("已关注") || t.includes("互相关注")) return ok("already following");
      await H.delay(400, 1000);
      H.simulateClick(btn);
      return ok("followed");
    },

    // followUserProfile — Redaily user-profile.js followUserProfile f(): the profile OWNER's
    // follow button $(".user-info .follow-btn") filtered to text 关注/Follow; already following
    // when hasClass("followed") OR text === "已关注". DISTINCT from followUser (note-author).
    async followUserProfile() {
      let btn = qa(SEL.profileFollowBtn).find((b) => {
        const t = (b.textContent || "").trim();
        return t === "关注" || t === "Follow" || t === "已关注" || t === "互相关注";
      });
      if (!btn) btn = q(SEL.profileFollowBtn) || q(".follow-btn");
      if (!btn) return fail("profile follow button not found");
      const t = (btn.textContent || "").trim();
      if (btn.classList.contains("followed") || t === "已关注" || t.includes("互相关注"))
        return ok("already following");
      await H.delay(400, 1000);
      H.simulateClick(btn);
      return ok("followed");
    },

    // getProfileNotes — Redaily user-profile.js getProfileNotes u(): iterate
    // $(".feeds-container .note-item"); per card coverUrl = find("img")[0].src, noteId from
    // find("a[href^='/explore/']")[0] href.replace("/explore/",""). Dedup within the call.
    async getProfileNotes() {
      const seen = new Set();
      const notes = [];
      for (const card of qa(SEL.profileNoteCards)) {
        const img = q("img", card);
        const coverUrl = img ? img.src : "";
        const link = q(SEL.profileNoteLink, card);
        const href = link ? (link.getAttribute("href") || "") : "";
        const m = href.match(/\/explore\/([0-9a-zA-Z]+)/);
        const noteId = m ? m[1] : href.replace("/explore/", "");
        if (!noteId || seen.has(noteId)) continue;
        seen.add(noteId);
        notes.push({ noteId, coverUrl });
      }
      return ok("profileNotes", { notes });
    },

    // openProfileNote — Redaily user-profile.js openProfileNote p(e,t), copied EXACTLY:
    // $(`img[src="${coverUrl}"]`)[0] → scrollIntoView({block:"center"}) → sleep(1e3) →
    // simulateClickElement(img) → sleep(3e3) → wait for #noteContainer. Mirrors openNextNote.
    async openProfileNote({ coverUrl, noteId } = {}) {
      if (!coverUrl) return fail("no coverUrl for openProfileNote");
      const img = coverUrl.indexOf('"') === -1 ? q('img[src="' + coverUrl + '"]') : null;
      const target = img || qa("img").find((i) => i.src === coverUrl);
      if (!target) return fail("profile note cover img not found");
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      await H.delay(700, 1300); // Redaily sleep(1e3)
      H.simulateClick(target);
      const opened = await waitFor(SEL.noteContainer, 6000);
      if (!opened) return fail("note did not open from profile cover");
      return ok("openedProfileNote", { noteId: noteId || getNoteId(), cover: coverUrl });
    },

    // ---- status pill overlay (operator visibility in the spawned popup window) ----

    // showPill — creates or updates a fixed top-right overlay showing the current automation
    // status. Safe to call repeatedly; element is reused. Never throws (try/catch wrap).
    async showPill({ text, level } = {}) {
      try {
        const COLORS = { info: "#5b9cff", dry: "#9aa0a6", ok: "#34c759", warn: "#ffb020", err: "#ff453a", risk: "#ff453a" };
        const root = document.body || document.documentElement;
        let el = document.getElementById("hs-status-pill");
        if (!el) {
          el = document.createElement("div");
          el.id = "hs-status-pill";
          el.style.cssText =
            "position:fixed;top:12px;right:12px;z-index:2147483647;pointer-events:none;" +
            "display:flex;align-items:center;gap:7px;max-width:320px;padding:6px 10px;" +
            "border-radius:999px;background:rgba(17,17,17,.88);color:#fff;" +
            "font:12px/1.2 system-ui,-apple-system,sans-serif;" +
            "box-shadow:0 2px 10px rgba(0,0,0,.35);white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
          const dot = document.createElement("span");
          dot.className = "hs-pill-dot";
          dot.style.cssText = "flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:#5b9cff";
          const span = document.createElement("span");
          span.className = "hs-pill-text";
          span.style.cssText = "overflow:hidden;text-overflow:ellipsis";
          el.appendChild(dot);
          el.appendChild(span);
          root.appendChild(el);
        }
        el.querySelector(".hs-pill-dot").style.background = COLORS[level] || COLORS.info;
        el.querySelector(".hs-pill-text").textContent = String(text || "");
        return ok("pill");
      } catch (e) {
        return fail(String((e && e.message) || e));
      }
    },

    // hidePill — removes the pill element if present. Safe to call when no pill exists.
    async hidePill() {
      try {
        const el = document.getElementById("hs-status-pill");
        if (el) el.remove();
        return ok("pill hidden");
      } catch (e) {
        return fail(String((e && e.message) || e));
      }
    },
  };

  async function dispatch(action, args) {
    const fn = actions[action];
    if (!fn) return fail("unknown action: " + action);
    return fn(args || {});
  }

  // ---- message bridge (background → content; one-shot ops) -----------------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== "hs:action") return;
    (async () => {
      try {
        sendResponse(await dispatch(msg.action, msg.args));
      } catch (e) {
        sendResponse(fail(String((e && e.message) || e)));
      }
    })();
    return true; // async sendResponse
  });

  // ---- net-hook bridge (MAIN-world nethook.js → background) -----------------
  // nethook.js (injected at document_start in the page's MAIN world) wraps the page's own
  // fetch/XHR and window.postMessage()s the parsed account/risk findings here (isolated
  // world). We relay them to the background, which stores account snapshots / handles risk.
  // Purely passive: a missing/blocked hook just means no passive captures (the background's
  // active snapshot path still works). On load we ask the hook to replay its last findings,
  // since it may have seen /user/me before this content script attached.
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__hs_net !== true) return;
    try {
      chrome.runtime.sendMessage({ type: "hs:account:observed", payload: d });
    } catch (err) {
      /* SW asleep / context gone — passive capture is best-effort */
    }
  });
  try {
    window.postMessage({ __hs_net_req: "replay" }, "*");
  } catch (e) {}

  console.info("[hs] engine ready", { noteId: getNoteId() });
})();
