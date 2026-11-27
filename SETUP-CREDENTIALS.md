# Connecting the accounts

Three platforms, three separate logins. Each one ends with **values you paste into GitHub**:
repo → **Settings → Secrets and variables → Actions → New repository secret**.

Paste the *value* only. The *name* must match exactly what `config.json` asks for.

Take this slowly and do one platform per sitting. Doing all three at once is how people get stuck.

---

## YouTube

You need: a Google Cloud project, the YouTube Data API switched on, and one refresh token.

1. Go to <https://console.cloud.google.com> → **New project** → name it `shorts-engine`.
2. **APIs & services → Library** → search **YouTube Data API v3** → **Enable**.
3. **APIs & services → OAuth consent screen** → **External** → fill app name and your email →
   save. Add your own Gmail as a **test user**. You do **not** need Google's verification.
4. **APIs & services → Credentials → Create credentials → OAuth client ID → Desktop app.** Copy the
   **client ID** and **client secret**.
5. Get a refresh token. Easiest reliable way: open
   <https://developers.google.com/oauthplayground> →
   gear icon → tick **Use your own OAuth credentials** → paste the client ID and secret.
   In step 1, type the scope `https://www.googleapis.com/auth/youtube.upload` → **Authorize APIs** →
   sign in with the account that owns the channel → **Exchange authorization code for tokens**.
   Copy the **refresh_token**.
6. Add three secrets:

| Secret name | Value |
|---|---|
| `YT_CLIENT_ID` | the client ID |
| `YT_CLIENT_SECRET` | the client secret |
| `YT_REFRESH_TOKEN` | the refresh token |

**The one gotcha.** While the Google app is in "testing", Google kills refresh tokens after **7 days**.
The post job will fail with *"token refresh failed"*. Fix: repeat step 5 and update
`YT_REFRESH_TOKEN`. If you want to stop doing that, publish the OAuth app (Google review, free but
slow) — or accept the weekly minute.

Then set `platforms.youtube.enabled` to `true` in `config.json`.

---

## Instagram

Instagram publishes from a **public video URL**, which this engine already creates for you.

1. Convert the account to **Business** or **Creator** (Instagram app → Settings → Account type).
2. Link it to a **Facebook Page** you admin (Instagram → Settings → linked accounts, or from the Page).
3. Go to <https://developers.facebook.com> → **My Apps → Create app → Business** type.
4. Add the product **Instagram** (API setup with Facebook Login) and **Facebook Login for Business**.
5. In the app dashboard, open **Tools → Graph API Explorer**, pick your app, and request these
   permissions: `instagram_basic`, `instagram_content_publish`, `pages_show_list`,
   `pages_read_engagement`, `business_management`. Generate a **User token**, then
   **Debug → Extend** it to a long-lived token (60 days).
6. Find the Instagram account ID: in the Explorer run
   `GET /me/accounts` → copy a Page id → then `GET /{page-id}?fields=instagram_business_account`
   → that `id` is your **IG user id**.
7. Add two secrets:

| Secret name | Value |
|---|---|
| `IG_USER_ID` | the numeric Instagram account id |
| `IG_ACCESS_TOKEN` | the long-lived token |

**Gotchas.**
- You are posting to *your own* account, so you do **not** need Meta's app review. That requirement is
  only for posting to other people's accounts. Keep the app in Development mode.
- The token dies after **60 days**. When it does, the log says *"Instagram 190"*. Re-extend and update
  the secret. Put a reminder in your calendar now.
- The video URL is fetched by Meta's servers, so the repo has to be **public**.

Then set `platforms.instagram.enabled` to `true`.

---

## Facebook (Page videos)

Reuses the same Meta app as Instagram.

1. In the Graph API Explorer, request `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`.
2. `GET /me/accounts` → copy the **Page id** and that Page's **access token**.
3. Add two secrets:

| Secret name | Value |
|---|---|
| `FB_PAGE_ID` | the Page id |
| `FB_PAGE_TOKEN` | the Page access token |

**Gotcha.** If the Page requires Publishing Authorization, posts wait until that is done. Meta shows
this in Page settings; the log will say the publish was refused.

Then set `platforms.facebook.enabled` to `true`.

---

## Adding a second app or account later

Nothing in the code changes. In `config.json` add another entry to `brands` with a new `id`, its own
`endCard` and hashtags, and its own `env` names — for example `YT_REFRESH_TOKEN_APP2`,
`IG_ACCESS_TOKEN_APP2`. Add those secrets to the repo. The build rotates between brands, and the
approval page shows all of them together.

---

## When something fails

Open the **Actions** tab → the red run → the failing step. The engine prints one line per problem,
for example:

- `YouTube token refresh failed` → refresh token expired (7-day rule above).
- `Instagram needs a public video URL` → the render upload step failed; check `GITHUB_TOKEN` permission
  is `contents: write`.
- `Instagram processing failed` → the video never finished processing; usually an odd aspect ratio or
  a file over ~100 MB.
- `Facebook 200` → the Page token is not a Page token, it's a user token.
- `daily cap reached` → not an error. It is deliberately staying quiet.
