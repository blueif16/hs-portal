# Reddit leg — rednote / Xiaohongshu restrictions, verification walls, overseas users, growth (2025–2026)

Collected 2026-11-04 via `mcp__apify-reddit__macrocosmos--reddit-scraper` (posts only, no comment trees).
Scored 1–5 (5 = first-hand report with specifics: what they did, what happened, dates; 1 = noise).

## Method and tool caveats (read first)

| # | Call | Result |
|---|---|---|
| 1 | subs `rednote, Xiaohongshu, China, chinalife, SocialMediaMarketing, socialmedia`, keyword `rednote account banned verification`, sort top, limit 15 | **0 items** (keyword is a substring match on title/body; a 4-word phrase is too narrow) |
| 2 | site-wide (subreddits omitted), keyword `xiaohongshu account restricted`, sort top, limit 10 | **0 items**. The actor's schema default for `subreddits` is `["python","bittensor_"]`, so leaving it out does NOT search site-wide. I inferred this from the schema and did not inspect the run INPUT record. |
| 3 (retry) | subs `rednote, Xiaohongshu, RedNoteApp`, keyword `account`, limit 25 | **28 items**: 25 r/rednote (hit the cap; window 2026-09-24 → 2026-11-04), 3 r/xiaohongshu (2025-01 → 2025-04), 0 r/RedNoteApp |
| 4 (retry) | subs `China, chinalife, SocialMediaMarketing, socialmedia, Chinese, shanghai`, keyword `xiaohongshu`, limit 15 | **30 items**: 15 r/socialmedia, 15 r/shanghai; 0 from the other four |
| 5 | `{url}` follow-up on r/rednote 1x91s8u (US bans before posting) | 1 item = the post itself (`dataType: post`, 11 comments not returned). This confirms the tool gives no comment trees. |

- **`sort: "top"` is ignored.** Per the actor schema, only `new` is exact, and `top`/`hot`/`relevance` return newest-first. So these are the **newest** keyword matches, not the top-voted ones.
- r/rednote hit the 25-post cap, so older 2025–mid-2026 r/rednote posts were not seen.
- Total scanned: **58 posts** (28 + 30). The URL follow-up duplicated one of them.
- There are no comment trees, so every "verbatim" quote below is the OP's own words.

## Scored posts — r/rednote and r/xiaohongshu (on-topic core)

| Score | Date (UTC) | Thesis | URL |
|---|---|---|---|
| 5 | 2026-10-03 | ABC artist gets an indefinite restriction after posting drawings (CN captions), maybe "too many within 30 minutes"; profile reset; passport NFC + face check passed on the 7th try but the phone was ruled "unsafe" | https://www.reddit.com/r/rednote/comments/1wwexvn/indefinite_restriction_denied_passport/ |
| 5 | 2026-10-04 | 3-month restriction for putting contact info in comments ("rule 6"); can't post or chat; main page disappeared; in-app and email appeals fail | https://www.reddit.com/r/rednote/comments/1wxih2s/how_to_appeal_the_right_way/ |
| 5 | 2025-01-17 | US user (TikTok-refugee wave) suspended after posting 2 TikTok-reposted videos: can't post/comment/DM but CAN like/watch/follow; flagged "illegal"; appeal asks for ID | https://www.reddit.com/r/xiaohongshu/comments/1i38e9x/someone_help_me_through_the_appeal_process/ |
| 4 | 2026-10-18 | US-based user's accounts repeatedly banned right after registration, before any post; suspects IP/phone/device/registration signals | https://www.reddit.com/r/rednote/comments/1x91s8u/my_rn_account_gets_banned_before_i_even_post/ |
| 4 | 2026-10-06 | Spain phone number: every function works except posts, which get 0 impressions (shadow ban); AI chatbot useless; email made a 申诉中心 ticket with no progress | https://www.reddit.com/r/rednote/comments/1wz92kk/foreigners_using_rednote_how_can_i_post/ |
| 4 | 2026-10-26 | New French user "experimenting with different posts" gets restricted, then a "restriction lifted" notice, but the account still behaves restricted | https://www.reddit.com/r/rednote/comments/1xg4314/my_rednote_account_is_still_restricted_even/ |
| 4 | 2026-10-09 | Korean user: no restriction notice and can post/buy, but shop customer-service DMs fail with a fake "network unstable" error while personal DMs work | https://www.reddit.com/r/rednote/comments/1x1qxy6/cant_send_messages_to_sellers_customer_service_on/ |
| 4 | 2025-04-04 | Account deletion now requires national ID or a face scan holding the ID; the phone-number option glitched for non-CN numbers, then disappeared | https://www.reddit.com/r/xiaohongshu/comments/1jrabux/how_to_delete_rednotexiaohongshu_account/ |
| 3 | 2026-10-31 | "Banned for no reason"; 3 appeals pending; CS gives copy-paste answers (28 comments, not retrievable) | https://www.reddit.com/r/rednote/comments/1xkdip7/banned_on_rednote_for_no_reason/ |
| 3 | 2026-10-30 | 2,275 followers but "basically zero reach" and posts absent from Plaza/Discover; OP solicits likes/follows via an xhslink | https://www.reddit.com/r/rednote/comments/1xjs0b8/help_me_get_some_exposure_my_rednotexiaohongshu/ |
| 3 | 2026-10-30 | Old account deleted, but the phone number is still restricted, so a new account can't be created | https://www.reddit.com/r/rednote/comments/1xj9j45/phone_number_restricted_how_to_unrestrict_phone/ |
| 3 | 2026-10-25 | New account suspended for "suspected suspicious activity" (post in French) | https://www.reddit.com/r/rednote/comments/1xeygtv/mon_compte_rednote_vient_dêtre_banni/ |
| 3 | 2026-10-17 | Phone number bound to an old 2024 account; the rebind confirmation phrase is never accepted | https://www.reddit.com/r/rednote/comments/1x89nx7/error_adding_phone_number_to_the_new_account/ |
| 3 | 2026-10-11 | US number never receives a verification code; WeChat and Gmail sign-up also fail | https://www.reddit.com/r/rednote/comments/1x3foxb/not_getting_verification_code/ |
| 3 | 2026-10-08 | Appeal rejected; CS said they "do not have the authority to remove the restriction" (posted twice, 1x0lxar is the duplicate) | https://www.reddit.com/r/rednote/comments/1x0lyaw/rednote_account_banned_issue/ |
| 3 | 2026-10-05 | Boost/promote screen flipped from English to Chinese and stays that way across a different device AND a fresh account (region flag not tied to the account) | https://www.reddit.com/r/rednote/comments/1wy2sdv/changed_regions_for_promoting_post/ |
| 3 | 2026-09-25 | Appeal can't be submitted without a Chinese phone number | https://www.reddit.com/r/rednote/comments/1wpi7w7/i_need_help_from_someone_with_a_chinese_phone/ |
| 3 | 2026-09-24 | Overseas real-estate company stuck in 专业号 verification review; "strict with overseas company documents" | https://www.reddit.com/r/rednote/comments/1word4m/anyone_verified_an_overseas_real_estate_company/ |
| 3 | 2025-02-11 | Ban appeal returns "Function upgrade, not open" (title only) | https://www.reddit.com/r/xiaohongshu/comments/1immw3y/help_im_trying_to_appeal_the_banning_of_my/ |
| 2 | 2026-11-04 | Account can't send messages or comment | https://www.reddit.com/r/rednote/comments/1xnbznm/rednote_not_sending_message/ |
| 2 | 2026-10-24 | A purchase requires a mainland-China account | https://www.reddit.com/r/rednote/comments/1xe5v8d/need_help_buying_brushes/ |
| 2 | 2026-10-21 | Claims posting needs a Chinese ID | https://www.reddit.com/r/rednote/comments/1xbepsu/account_creation/ |
| 2 | 2026-10-20 | One phone number = one verified account; can't make a second | https://www.reddit.com/r/rednote/comments/1xak50h/is_there_any_way_to_make_two_accounts/ |
| 2 | 2026-10-07 | The "verify real name" option doesn't navigate anywhere for a foreign user | https://www.reddit.com/r/rednote/comments/1wzwwlt/how_can_i_verify_my_account_help/ |
| 2 | 2026-09-29 | A US-based account that used to buy fine is suddenly blocked from purchasing | https://www.reddit.com/r/rednote/comments/1wsytwu/anyone_has_an_account_based_in_china/ |
| 1 | 2026-10-11 | "Looking for a RedNote Account" — [removed] (account trading) | https://www.reddit.com/r/rednote/comments/1x2u0w0/looking_for_a_rednote_account/ |
| 1 | 2026-09-26 | Looking for a creator (noise) | https://www.reddit.com/r/rednote/comments/1wqw564/need_help_finding_a_creator_on_rednote/ |

## Scored posts — r/socialmedia (growth / platform behavior)

| Score | Date (UTC) | Thesis | URL |
|---|---|---|---|
| 3 | 2025-12-13 | Second-hand "reports": CN content farms had editors running 50–100 accounts each at 10–20 posts/day, then hit "platform enforcement actions in 2025" | https://www.reddit.com/r/socialmedia/comments/1plbbws/do_largescale_organized_content_operations_exist/ |
| 3 | 2025-08-30 | Art account with Chinese captions: posts randomly take off beyond followers; more interaction than Instagram despite fewer followers | https://www.reddit.com/r/socialmedia/comments/1n44hmc/different_experience_between_instagram_and/ |
| 3 | 2025-02-09 | Self-test: new users get low engagement unless branded "TikTok Refugee"; face-cam, Q&A, and lifestyle posts work; many abandon within days | https://www.reddit.com/r/socialmedia/comments/1il9oiq/tiktok_refugees_whats_really_happening/ |
| 2 | 2025-09-14 | (score 47) On RedNote, micro/niche KOLs beat macro influencers; users search posts before buying | https://www.reddit.com/r/socialmedia/comments/1ngfib1/influencer_marketing_works_so_differently_in/ |
| 2 | 2025-02-05 | LA realtor asks whether to use a VPN to reach mainland users (question only, no outcome) | https://www.reddit.com/r/socialmedia/comments/1iicmai/leveraging_xiaohongshu_to_attract_chinese_buyers/ |
| 1 | 2026-09-11 | XHS now lets you publish a small app like a note (feature aside) | https://www.reddit.com/r/socialmedia/comments/1wddcjn/software_as_content/ |
| 1 | various | Noise or [removed]: NZ personal IP x2 (1p4z57y, 1p4z4pv), e-commerce essay (1ob6xcf), tier list (1jyjver), "xiaohongshu code" (1izm2co), Threads (1iwxoo4), UK creators x2 (1i4xg9h, 1i4xfed), yap dollar (1i4dp9z) | — |

## r/shanghai (15 posts) — all score 1 (XHS used as a lifestyle search engine; nothing on accounts)

Café/restaurant maps, nails, photoshoots, concerts, an English XHS search site (whatson.red, 2026-05-02), a driving-licence guide. One incidental data point: a user-shared XHS link has the format
`https://www.xiaohongshu.com/discovery/item/688927c80000000023027fa7?source=webshare&xhsshare=pc_web&xsec_token=ABQ1bxe7aIDocIGO08nDSlPvMNis_-Txh6cM0-uHFyhEs=&xsec_source=pc_share`
(https://www.reddit.com/r/shanghai/comments/1mdvg2m/taking_driving_lessons_as_a_complete_beginner_and/, 2025-07-31). Note `xsec_source=pc_share`, which differs from our `pc_feed`.

## Watch-list coverage

| Signal | Found? |
|---|---|
| Redirected to rednote.com | **No posts** |
| Phone/ID verification demands | **Yes, heavy**: passport NFC + face (1wwexvn), national-ID/face to DELETE an account (1jrabux), Chinese phone needed to appeal (1wpi7w7), US number gets no SMS code (1x3foxb), one number per account (1xak50h), a restricted number survives account deletion (1xj9j45), ID asked at appeal (1i38e9x), company docs (1word4m) |
| Shadow-limits | **Yes**: 0 impressions with a Spain number (1wz92kk); 2,275 followers but zero Discover reach (1xjs0b8); "lifted" yet still restricted (1xg4314); silent DM-to-shop block shown as a network error (1x1qxy6) |
| VPN / US IP on a +86 account | **No direct report.** Closest: US user suspects IP/phone/device (1x91s8u); region flag persists across device + new account (1wy2sdv); LA realtor asks about VPN (1iicmai). No one reported a +86 account banned for a US IP. |
| Automation / extension bans | **No posts.** Only the second-hand 2025 content-farm enforcement (1plbbws) and an account-trading post that was [removed] (1x2u0w0) |
| Habits that helped | **Thin**: Chinese captions for the local audience (1n44hmc); face-cam/Q&A/lifestyle (1il9oiq); micro/niche over macro (1ngfib1). Cited as punished: contact info in comments (1wxih2s), reposted TikTok videos (1i38e9x), many posts in a short burst (1wwexvn, OP's guess), "experimenting with different posts" on a new account (1xg4314) |

## Sentiment

Overwhelmingly frustrated and helpless. Almost every 2026 r/rednote account post is a non-mainland user restricted early in the account's life, often before or soon after the first posts, with opaque reasons, AI/copy-paste support, and appeals that need mainland identity artifacts (CN phone, NFC passport + "safe" phone). The few positive notes come from marketers and from creators who post in Chinese to a niche audience.

## Contradictions and surprises

1. **Restriction notices don't match restriction state.** One user was told "lifted" but stays restricted (1xg4314). Another got no notice at all but has a feature silently blocked behind a fake `当前网络不稳定` error (1x1qxy6).
2. **Passive engagement survives a restriction.** A suspended US account could still like, watch, and follow while post/comment/DM were blocked (1i38e9x). A like-only runner would not "see" that it is restricted.
3. **Identity can pass while the device fails.** Face and NFC passport passed on the 7th try, but the phone itself was judged "unsafe", so the verification was rejected (1wwexvn). Device trust is a separate gate from identity.
4. **Deletion doesn't reset anything.** A deleted account's phone number stays restricted (1xj9j45), and deletion itself now needs ID or a face scan (1jrabux).
5. **Reach is generous AND zero for foreigners.** One art creator says XHS pushes posts far beyond followers (1n44hmc). New foreign-number accounts report 0 impressions (1wz92kk). The distinguishing factor in these posts is Chinese-language niche content plus a non-brand-new account. That is an inference, not a tested claim.
6. **Support can't fix bans.** CS told one user they "do not have the authority to remove the restriction" (1x0lyaw).
7. **Region is sticky beyond the account.** The boost UI language flipped and persisted across a new device and a fresh account (1wy2sdv). That implies a network- or number-level signal, which is unconfirmed.

## Keep verbatim (OP text; no comments were retrievable)

- "it needed me to NFC scan my passport. the facial recognition failed many times since my lighting was too bright. after the 7th try they got it, but said my phone is “unsafe”, therefore it’s not valid." / "they’ve restricted the feature to delete this account and make a new one" / "did i post too many within 30 minutes???" — 2026-10-03 — https://www.reddit.com/r/rednote/comments/1wwexvn/indefinite_restriction_denied_passport/
- "a fully resetted profile name, pictures, bio. people won’t see my profile and posts, and i can’t make new posts or comment." — same post
- "Got restricted for 3 months. Mentioned some contact info in the comments in one of my posts and now they won’t lift the ban." / "they banned me for some restrictions rule 6 or like makes my account unable to post or speak in chat. But what’s with the main page disappearance?" — 2026-10-04 — https://www.reddit.com/r/rednote/comments/1wxih2s/how_to_appeal_the_right_way/
- "My account has been suspended of functionality — I can’t post, comment, or send messages. I can still like and watch, follow, but that’s about it." / "it says my account is “illegal”" / "I posted two videos from TikTok, which I think is what got me in trouble" / "When I try to appeal the account, it asks me for my ID" — 2025-01-17 — https://www.reddit.com/r/xiaohongshu/comments/1i38e9x/someone_help_me_through_the_appeal_process/
- "My account keeps getting banned shortly after registration, before I even have a chance to post anything or start using it." / "Could the issue be related to my IP address, phone number, device, account verification, or other registration signals?" — US-based, 2026-10-18 — https://www.reddit.com/r/rednote/comments/1x91s8u/my_rn_account_gets_banned_before_i_even_post/
- "Im registering using a spain mobile number. After my account is created i can access to all function but not posting. Every time i post it just shows 0 impression" / "they created some ticket for my account (i can see inside 申诉中心) but nothing made any progress." — 2026-10-06 — https://www.reddit.com/r/rednote/comments/1wz92kk/foreigners_using_rednote_how_can_i_post/
- "I received a notification saying that my account had been restricted. A little later, I received another notification confirming that the restrictions had been lifted. However, it seems that my account is still restricted" / "I was experimenting with different posts on my profile" — 2026-10-26 — https://www.reddit.com/r/rednote/comments/1xg4314/my_rednote_account_is_still_restricted_even/
- Error string: "Network unstable, please check your network setting!" (当前网络不稳定，请检查你的网络设置) — shown only when messaging a store's customer service; "I've never received any notification saying that my account has been restricted." — Korea, 2026-10-09 — https://www.reddit.com/r/rednote/comments/1x1qxy6/cant_send_messages_to_sellers_customer_service_on/
- "I have 2,275 followers but basically zero reach right now." / "nothing I post shows up in the Plaza/Discover feed" — 2026-10-30 — https://www.reddit.com/r/rednote/comments/1xjs0b8/help_me_get_some_exposure_my_rednotexiaohongshu/
- "The old account have been deleted. But when I try to create, it's restricted." — 2026-10-30 — https://www.reddit.com/r/rednote/comments/1xj9j45/phone_number_restricted_how_to_unrestrict_phone/
- "My account was recently suspended due to suspected suspicious activity." / "I recently created my account" — 2026-10-25 — https://www.reddit.com/r/rednote/comments/1xeygtv/mon_compte_rednote_vient_dêtre_banni/
- "I have 3 appeals pending under my account and even emailed Rednote customer service who keep giving a copy and paste answer" — 2026-10-31 — https://www.reddit.com/r/rednote/comments/1xkdip7/banned_on_rednote_for_no_reason/
- "My appeal has already been rejected, and customer support told me that they do not have the authority to remove the restriction." — 2026-10-08 — https://www.reddit.com/r/rednote/comments/1x0lyaw/rednote_account_banned_issue/
- Rebind prompt: "I confirm that you no longer need to log in to this account to change the binding." (never accepted); account created 2024, reinstalled late 2025 — 2026-10-17 — https://www.reddit.com/r/rednote/comments/1x89nx7/error_adding_phone_number_to_the_new_account/
- "Every time I try to make a rednote account I never get the verification code, I tried using wechat & gmail to make an account as well but nothing works." / "is it just the fact that i have a usa number" — 2026-10-11 — https://www.reddit.com/r/rednote/comments/1x3foxb/not_getting_verification_code/
- "I clicked "boost" again and it all went into Chinese. I tried logging in from a different device, using a fresh new account, all the same problem. It's like Rednote somehow changed my region" — 2026-10-05 — https://www.reddit.com/r/rednote/comments/1wy2sdv/changed_regions_for_promoting_post/
- "i need a chinese phone number in order to submit an appeal" — 2026-09-25 — https://www.reddit.com/r/rednote/comments/1wpi7w7/i_need_help_from_someone_with_a_chinese_phone/
- "It seems like they’ve gotten pretty strict with overseas company documents." — 2026-09-24 — https://www.reddit.com/r/rednote/comments/1word4m/anyone_verified_an_overseas_real_estate_company/
- "it won’t let me verify it with one phone number" — 2026-10-20 — https://www.reddit.com/r/rednote/comments/1xak50h/is_there_any_way_to_make_two_accounts/
- "nor can I click the "verify real name" at the top options, as it simply doesn't get to another page." — 2026-10-07 — https://www.reddit.com/r/rednote/comments/1wzwwlt/how_can_i_verify_my_account_help/
- "you can only delete your account now by providing your national ID or letting them scan your face while holding you ID" / "There used to be an option via phone number but when I tried it months ago it glitched out if it was a non chinese number, but niw that option seems to be gone?" — 2025-04-04 — https://www.reddit.com/r/xiaohongshu/comments/1jrabux/how_to_delete_rednotexiaohongshu_account/
- Appeal error: "Function upgrade, not open" — 2025-02-11 — https://www.reddit.com/r/xiaohongshu/comments/1immw3y/help_im_trying_to_appeal_the_banning_of_my/
- "Each editor managed 50-100 accounts" / "Posted 10-20 pieces of content daily" / "Made significant revenue before platform enforcement actions in 2025" (second-hand "reports") — 2025-12-13 — https://www.reddit.com/r/socialmedia/comments/1plbbws/do_largescale_organized_content_operations_exist/
- "Sometimes a post suddenly gets really high views and takes off, something that never happens on my Instagram even though I actually have more followers there." / "I write in Chinese on Xiaohongshu for the local audience" — 2025-08-30 — https://www.reddit.com/r/socialmedia/comments/1n44hmc/different_experience_between_instagram_and/
- "Engagement is low for most new users unless they explicitly brand themselves as "TikTok Refugees."" / "Some TikTok influencers successfully transitioned by leveraging face-cam content, Q&As, or lifestyle posts." / "many abandon their accounts after a few days" — 2025-02-09 — https://www.reddit.com/r/socialmedia/comments/1il9oiq/tiktok_refugees_whats_really_happening/
- "Micro-influencers and niche KOLs drive way more engagement and trust." / "people literally *search* these posts before buying" — 2025-09-14 — https://www.reddit.com/r/socialmedia/comments/1ngfib1/influencer_marketing_works_so_differently_in/

## Empty

- Call 1: all six subs (rednote, Xiaohongshu, China, chinalife, SocialMediaMarketing, socialmedia) returned 0 for the phrase `rednote account banned verification`.
- Call 2: 0. The site-wide intent was not executed, because omitting `subreddits` falls back to the actor default `python, bittensor_`.
- Call 3: r/RedNoteApp returned 0.
- Call 4: r/China, r/chinalife, r/SocialMediaMarketing, and r/Chinese returned 0 for `xiaohongshu`.
- Call 5 (URL): no comments returned (post only).

## Notes for the synthesizer (my inference, not user claims)

- These are the newest posts, not top-voted ones (sort is ignored). The r/rednote sample only covers about 6 weeks (2026-09-24 → 11-04).
- The population is almost entirely foreign-number or foreign-identity accounts. No post covers a +86/mainland-verified account operated from a US IP, which is the hs-portal case. Absence here is not evidence of safety.
- Two observations bear on a 养号 runner's risk detection. Restrictions can leave like/follow working (1i38e9x), and they can show up as a generic network error rather than a restriction notice (1x1qxy6).
