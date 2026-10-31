# Platforms

AutoCast uses each platform's **official API** with your own login. You make one "app" per platform (free) and paste its keys in **Settings**.

## Overview

| Platform | Post videos | Go live | Before it works fully |
|---|---|---|---|
| YouTube | ✅ Google login | ✅ Google login (auto broadcast) or stream key | Google app verification; daily upload quota |
| Facebook Page | ✅ Meta login | ✅ Meta login (auto live video) or stream key | Meta App Review |
| Instagram | ✅ Meta login (Reels) | Stream key | Business or Creator account linked to a Facebook Page |
| TikTok | ✅ TikTok login | Stream key (only accounts TikTok allows) | TikTok audit — until then posts are private |
| Twitch | — | Stream key | — |
| Kick | — | Stream key | — |
| X | — | Stream key | — |
| Any RTMP / RTMPS | — | Server URL + key | — |

The redirect URIs below look like `https://cast.yourdomain.com/oauth/<app>/callback`. **Settings** shows the exact ones with a Copy button.

---

## YouTube (Google)

1. Open [Google Cloud Console](https://console.cloud.google.com/) and make a project.
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **OAuth consent screen** → External → fill in name and email → add scopes `youtube.upload` and `youtube`.
4. **Credentials → Create credentials → OAuth client ID** → *Web application*.
5. Add the redirect URI: `https://cast.yourdomain.com/oauth/google/callback`.
6. Copy **Client ID** and **Client secret** into **Settings → Google app**.
7. **Accounts → YouTube → Log in**. Every channel on that Google login is added.

Limits and approvals:

- **Testing mode**: logins expire after 7 days, and only test users you add can log in. Publish the consent screen to avoid this.
- **Unverified apps**: videos uploaded through the API may be locked as *private* until Google verifies your app.
- **Quota**: the default 10,000 units/day allows about 6 uploads per day per project. You can ask Google for more.
- **First live**: a channel must have live streaming turned on. The first time can take 24 hours.
- **Custom thumbnails** need a verified channel (phone check). If not allowed, the post still goes up; the note says why.

Live with login: AutoCast makes one reusable stream per account and a new broadcast each time a station starts, then ends it when the station stops.

## Facebook Page + Instagram (Meta)

1. Open [Meta for Developers](https://developers.facebook.com/apps) → **Create app** → type *Business*.
2. Add **Facebook Login** and **Instagram Graph API**.
3. Facebook Login → Settings → **Valid OAuth Redirect URIs**: `https://cast.yourdomain.com/oauth/meta/callback`.
4. Copy **App ID** and **App secret** into **Settings → Meta app**.
5. **Accounts → Facebook + Instagram → Log in**. Every Page you manage is added, plus the Instagram account linked to it.

Permissions used: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `publish_video`, `business_management`, `instagram_basic`, `instagram_content_publish`.

Limits and approvals:

- In **development mode** only people with a role on the app can use it. For other users you need **App Review**.
- Instagram must be a **Business or Creator** account linked to a Facebook Page. Personal accounts can't be posted to.
- Personal Facebook profiles can't be posted to by API. Only Pages.
- Page tokens from this login don't expire unless you change your password or remove the app.

## TikTok

1. Open [TikTok for Developers](https://developers.tiktok.com/apps) → **Create app**.
2. Add **Login Kit** and **Content Posting API** (turn on *Direct Post*).
3. Redirect URI: `https://cast.yourdomain.com/oauth/tiktok/callback`.
4. Scopes: `user.info.basic`, `video.upload`, `video.publish`.
5. Copy **Client key** and **Client secret** into **Settings → TikTok app**.
6. **Accounts → TikTok → Log in**.

Limits and approvals:

- **Until TikTok audits your app, every post is private** ("only me"). AutoCast says so in the post's note.
- TikTok LIVE by API is not public. If your account has a LIVE stream key (TikTok LIVE Studio / creator tools), add it as a stream key.
- TikTok does not allow pre-recorded video shown as live. Only use it for real live content.

## Stream keys (any live app)

**Accounts → ＋ Stream key**, pick the app, paste the key. The server URL is filled in for you:

| App | Server URL (default) | Where to find the key |
|---|---|---|
| YouTube | `rtmp://a.rtmp.youtube.com/live2` | YouTube Studio → Go live → Stream |
| Facebook | `rtmps://live-api-s.facebook.com:443/rtmp` | Live Producer → Streaming software |
| Twitch | `rtmp://live.twitch.tv/app` | Creator Dashboard → Settings → Stream |
| Kick | shown in your Kick dashboard | Kick → Settings → Stream key |
| TikTok LIVE | shown in LIVE Studio | Only if TikTok gave you one |
| Instagram LIVE | shown when you start a live in Live Producer | Changes per live |
| X | shown in Media Studio → Producer | — |
| Custom RTMP | any `rtmp://` or `rtmps://` | — |

Keys are stored encrypted and never shown again.

## Account settings

In **Accounts** each account has:

| Setting | What it does |
|---|---|
| Group | Pick many accounts at once ("Finance", "Games"). Also usable as `group:Finance` in CSV and the push script. |
| Post times | The daily slots used by "Next free slot". AI can suggest them. |
| Video shape (⚙) | Auto (9:16 for TikTok and Instagram), always vertical, or as-is |
| Daily limit (⚙) | Most posts per day. Full days are skipped. |

## Platform rules

Each platform has its own rules on automation, repeated content, AI labels and live streams. AutoCast helps (AI label switch, duplicate guard, daily limits, safety check), but **you are responsible** for following them.
