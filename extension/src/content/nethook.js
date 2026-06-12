// nethook.js — MAIN-world response interceptor (runs at document_start, in the PAGE's
// JS realm, NOT the isolated content-script world). This is the mechanism ARCHITECTURE.md
// §"Injected page-context hook" prescribes: MV3 webRequest cannot read response BODIES, so
// to read XHS's own JSON we wrap the page's window.fetch + XMLHttpRequest and observe the
// responses the page already makes (the page self-signs x-s, so these are valid where our
// own cross-origin fetch would 461). We NEVER block or mutate — we clone/read and forward
// findings to the isolated world via window.postMessage; engine.js relays them to the bg.
//
// Captured:
//   • /user/me        → our own { userId, nickname }  (lightweight session probe)
//   • /user/otherinfo → a profile's { targetUserId, nickname, interactions[] }  (counts)
//   • block signals   → 461 / {code:-1}/限流  → a risk hint
//
// Defensive throughout: any failure is swallowed so we can never break the page or its XHR.

(function () {
  if (window.__hsNetHook) return;
  window.__hsNetHook = true;

  // Last findings, so a late-attaching engine.js can ask us to replay (the page typically
  // calls /user/me before document_idle, when the relay listener isn't up yet).
  const last = { me: null, profile: null };

  const post = (payload) => {
    try {
      window.postMessage(Object.assign({ __hs_net: true }, payload), "*");
    } catch (e) {}
  };

  const isMe = (u) => /\/user\/me(\b|\?|$)/.test(u);
  const isOther = (u) => /\/user\/(otherinfo|info)\b/.test(u);
  const isYou = (u) => /\/you\/(likes|connections)\b/.test(u);
  // Content-Studio feed capture: the page's OWN signed recommend feed (/homefeed) and
  // keyword search results (/search/notes). These carry note cards with engagement counts —
  // the raw material for the "today's best notes to remix" trend radar. Passive, same as above.
  const isHome = (u) => /\/homefeed(\b|\/|\?|$)/.test(u);
  const isSearchN = (u) => /\/search\/notes\b/.test(u);
  // DEEP source capture (for remix): the note-detail /feed and its comments. /feed carries the
  // FULL note_card — desc (正文), the entire image_list (every carousel image, watermark-free),
  // tag_list, interact_info, upload time. /comment/page carries the top comments (评论区 signals).
  // Shapes are evidence-backed by ref/XHS_ALL_IN_ONE data_util.py (handle_note_info/handle_comment_info).
  const isFeed = (u) => /\/sns\/web\/v1\/feed(\b|\?|$)/.test(u); // note detail (NOT /homefeed)
  const isComment = (u) => /\/comment\/(page|sub\/page)\b/.test(u);
  const noteIdOf = (u) => {
    const m = String(u).match(/[?&]note_id=([0-9a-zA-Z]+)/);
    return m ? m[1] : null;
  };
  // mapNoteDetail — /feed data.items[0].note_card → the full source dossier fields. Images
  // prefer info_list[1] (the WB_DFT no-watermark variant per data_util.py), else any url.
  const mapNoteDetail = (data) => {
    try {
      const it = (data && data.items && data.items[0]) || null;
      const card = it && (it.note_card || it.noteCard);
      if (!card) return null;
      const ii = card.interact_info || card.interactInfo || {};
      const user = card.user || {};
      const images = (card.image_list || [])
        .map((im) => {
          const list = im.info_list || im.infoList || [];
          const pick = list[1] || list[0] || {};
          return pick.url || im.url || "";
        })
        .filter(Boolean);
      const tags = (card.tag_list || []).map((t) => t && t.name).filter(Boolean);
      return {
        noteId: (it.id || card.note_id || "") + "",
        type: card.type === "video" ? "video" : "normal",
        title: (card.title || "").trim(),
        desc: (card.desc || "").trim(),
        images,
        tags,
        likes: ii.liked_count,
        collects: ii.collected_count,
        comments: ii.comment_count,
        shares: ii.share_count,
        authorName: user.nickname || user.nick_name || "",
        authorId: user.user_id || user.userId || "",
        uploadTime: card.time || null,
        ipLocation: card.ip_location || "",
      };
    } catch (e) {
      return null;
    }
  };
  // mapComments — /comment/page data.comments[] → slim {content,likeCount,ip,nickname}. Top 20.
  const mapComments = (data) => {
    try {
      const arr = (data && data.comments) || [];
      return arr
        .slice(0, 20)
        .map((c) => ({
          content: (c.content || "").trim(),
          likeCount: c.like_count,
          ipLocation: c.ip_location || "",
          nickname: (c.user_info && (c.user_info.nickname || c.user_info.nick_name)) || "",
        }))
        .filter((x) => x.content);
    } catch (e) {
      return null;
    }
  };
  // mapFeedItem — one feed/search item → a slim hot-note candidate. Counts are forwarded RAW
  // (strings like "1.2万"); the background parses + scores them. Skips non-note rows
  // (rec_query/hot_query/ads have no note_card). Defensive: any shape miss → null (dropped).
  const mapFeedItem = (it) => {
    try {
      const card = (it && (it.note_card || it.noteCard || it.note)) || null;
      if (!card) return null;
      const id = it.id || it.note_id || card.note_id || card.id || "";
      if (!id) return null;
      const ii = card.interact_info || card.interactInfo || {};
      const user = card.user || {};
      const cover = card.cover || {};
      const coverUrl =
        cover.url_default || cover.url_pre || cover.url ||
        (cover.info_list && cover.info_list[0] && cover.info_list[0].url) || "";
      return {
        noteId: String(id),
        xsecToken: it.xsec_token || it.xsecToken || "",
        type: card.type === "video" ? "video" : "normal",
        title: (card.display_title || card.title || "").trim(),
        coverUrl,
        authorName: user.nickname || user.nick_name || "",
        authorId: user.user_id || user.userId || "",
        likes: ii.liked_count,
        collects: ii.collected_count,
        comments: ii.comment_count,
        shares: ii.shared_count,
      };
    } catch (e) {
      return null;
    }
  };
  const targetIdOf = (u) => {
    const m = String(u).match(/[?&]target_user_id=([0-9a-zA-Z]+)/);
    return m ? m[1] : null;
  };
  // mapNotif — one /you/* message item → { id, t } (received-engagement event). The reference
  // client doesn't document the item internals, so we read the timestamp/id defensively.
  const mapNotif = (it) => {
    const t = it.time || it.timestamp || (it.score_info && it.score_info.time) || it.create_time || null;
    const id =
      (it.id != null && String(it.id)) ||
      (it.track_id != null && String(it.track_id)) ||
      (it.user_info && (it.user_info.userid || it.user_info.user_id)) ||
      (t != null ? "t" + t : null);
    return { id, t: typeof t === "string" ? parseInt(t, 10) || null : t };
  };

  // Turn a parsed JSON body into a finding and emit it. `url` is the request URL.
  function handle(url, json) {
    if (!json) return;
    const data = json.data || json;
    // block / rate-limit signal (semantic — status alone misses these)
    const code = json.code != null ? json.code : data && data.code;
    const text = (json.msg || json.message || "") + "";
    if (code != null && code !== 0 && code !== 200) {
      post({ kind: "risk", signal: "code " + code + (text ? " " + text.slice(0, 40) : "") });
    }
    if (isMe(url)) {
      const userId = (data && (data.user_id || data.userId || data.id)) || "";
      if (userId) {
        last.me = { kind: "me", userId, nickname: (data && (data.nickname || data.name)) || "" };
        post(last.me);
      }
    } else if (isOther(url)) {
      const basic = (data && data.basic_info) || {};
      const interactions = (data && data.interactions) || [];
      if (interactions.length || basic.nickname) {
        last.profile = {
          kind: "profile",
          targetUserId: targetIdOf(url) || (data && data.user_id) || null,
          nickname: basic.nickname || "",
          interactions: interactions.map((it) => ({ type: it.type || "", name: it.name || "", count: String(it.count == null ? "" : it.count) })),
        };
        post(last.profile);
      }
    } else if (isYou(url)) {
      // received-engagement: /you/likes (赞和收藏) or /you/connections (新增关注). Envelope
      // confirmed by the reference client: data.message_list[] (+ cursor/has_more).
      const stream = /\/you\/connections/.test(url) ? "followers" : "likes";
      const items = (data && data.message_list) || [];
      if (items.length) post({ kind: "received", stream, items: items.map(mapNotif) });
    } else if (isHome(url) || isSearchN(url)) {
      // recommend feed / search results → hot-note candidates for the Content Studio.
      const items = (data && (data.items || data.notes)) || [];
      const notes = items.map(mapFeedItem).filter(Boolean);
      if (notes.length) post({ kind: "feed", source: isHome(url) ? "homefeed" : "search", notes });
    } else if (isFeed(url)) {
      // note detail → the full source dossier for remix.
      const detail = mapNoteDetail(data);
      if (detail && detail.noteId) post({ kind: "noteDetail", detail });
    } else if (isComment(url)) {
      // a source note's comments → 评论区 signals for remix.
      const comments = mapComments(data);
      if (comments && comments.length) post({ kind: "noteComments", noteId: noteIdOf(url), comments });
    }
  }

  // ---- wrap fetch ----------------------------------------------------------
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      const url = (input && input.url) || input || "";
      const p = origFetch.apply(this, arguments);
      try {
        if (isMe(url) || isOther(url) || isYou(url) || isHome(url) || isSearchN(url) || isFeed(url) || isComment(url)) {
          p.then((res) => {
            try {
              res.clone().json().then((j) => handle(url, j)).catch(() => {});
            } catch (e) {}
          }).catch(() => {});
        } else if (typeof url === "string" && /\/api\/sns\//.test(url)) {
          // status-only block probe for any XHS API call
          p.then((res) => {
            if (res && (res.status === 461 || res.status === 403)) post({ kind: "risk", signal: "HTTP " + res.status });
          }).catch(() => {});
        }
      } catch (e) {}
      return p;
    };
  }

  // ---- wrap XMLHttpRequest --------------------------------------------------
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function (method, url) {
      try {
        this.__hsUrl = url;
      } catch (e) {}
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      try {
        const url = this.__hsUrl || "";
        if (isMe(url) || isOther(url) || isYou(url) || isHome(url) || isSearchN(url) || isFeed(url) || isComment(url) || /\/api\/sns\//.test(String(url))) {
          this.addEventListener("load", function () {
            try {
              if (this.status === 461 || this.status === 403) post({ kind: "risk", signal: "HTTP " + this.status });
              if (isMe(url) || isOther(url) || isYou(url) || isHome(url) || isSearchN(url) || isFeed(url) || isComment(url)) {
                const ct = (this.getResponseHeader && this.getResponseHeader("content-type")) || "";
                if (/json/.test(ct) || (this.responseText && this.responseText[0] === "{")) handle(url, JSON.parse(this.responseText));
              }
            } catch (e) {}
          });
        }
      } catch (e) {}
      return send.apply(this, arguments);
    };
  }

  // ---- replay (engine.js asks once it attaches) ----------------------------
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.__hs_net_req !== "replay") return;
    if (last.me) post(last.me);
    if (last.profile) post(last.profile);
  });
})();
