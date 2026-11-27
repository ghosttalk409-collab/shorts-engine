# Shorts Engine

A small machine that makes short vertical videos, shows them to you in the morning, and posts the
ones you approve to **YouTube Shorts, Instagram Reels and Facebook** — on its own, twice a day.

It is **one separate repository**. It never touches your app's repo, server or Render service, so it
cannot break Ghost Talk. Delete the repo and the machine is gone.

It is not tied to Ghost Talk. Add a second brand to `config.json` and it will post for that one too,
from a different account, with its own secrets.

---

## How a day works

| Time (IST) | What happens |
|---|---|
| 03:00 | It builds tonight's videos from your ideas, your uploaded photos/clips, and old footage it has kept. Uploads them somewhere public and puts them in a queue. |
| 09:30 | It posts whatever you approved, then records what it did. |
| 19:30 | Second posting slot, same rule: approved only. |
| 23:00 | It reads views and likes for everything posted, saves them in `content/metrics.csv`, and notes which hooks worked. |

You do one thing: **approve in the morning**.

---

## One-time setup

### 1. The repo already exists

It is at `github.com/ghosttalk409-collab/shorts-engine`. Everything is already committed.

Keep it **public** — the video links have to be readable by YouTube and Meta.

### 2. The approval page publishes itself

The workflow `4 · Publish approval page` deploys it to GitHub Pages on the first run, at:

**https://ghosttalk409-collab.github.io/shorts-engine/**

If that address shows a 404, open **Settings → Pages** and set Source to **GitHub Actions**, then run
that workflow once from the Actions tab. Bookmark the address. That page is your dashboard:
approve, skip, and pause everything.

### 3. Connect the page to your repo

On that page, open **Settings**, paste your repo name (`ghosttalk409-collab/shorts-engine`) and a token.

Make the token at GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained
 tokens → Generate new**: choose only that one repo, and give it **Contents: Read and write**.
Nothing else. It stays in your browser.

### 4. Connect the accounts

Follow [`SETUP-CREDENTIALS.md`](SETUP-CREDENTIALS.md) — one section per platform. Add the resulting
values as repo **Settings → Secrets and variables → Actions → New repository secret**.

Skip any platform you don't want yet; just leave it switched off in `config.json`.

### 5. Test before going live

Open the **Actions** tab → **1 · Build tonight's shorts** → **Run workflow**.

Then look at `content/queue.json`: there should be new items with a `videoUrl`. If there are none, the
inbox is empty — drop a few images into `content/assets/inbox/` first. Open the approval page, play
one. If it plays, the machine works.

Posting stays fake until you say otherwise: `config.json` has `"dryRun": true`, which means every
step runs but the final "publish" call is skipped and logged instead. Once one video plays fine,
set `"dryRun": false`.

---

## Daily use

- **Add material (optional).** Drop photos or short clips into `content/assets/inbox/` — on a phone
  the easiest way is the GitHub website: open the folder → **Add file → Upload files**. Keep each
  file under ~30 MB. Long videos are automatically sliced into reusable 6-second pieces in
  `content/library/`.
- **Add ideas (optional).** Edit `content/ideas.json` — a few subjects and hooks for the day.
  Anything you write there is used word-for-word.
- **Approve.** Next morning, open the approval page. Watch each video, tap **Approve** or **Skip**.
  Approved videos post at the next slot. That is the whole job.
- **Pause.** The button at the top of the approval page. Or set `"enabled": false` in `config.json`.
  Everything stops within one scheduled run — nothing is ever posted while paused.
- **Change the account or app.** Everything brand-specific lives in `config.json`: name, hashtags,
  end card, which platform is on, and *which secret name to read*. Two brands = two sets of secrets.

---

## What "it improves itself" actually means

Honest version, because this is where these tools usually lie:

- It measures views, likes, comments, saves and shares for every post, per hook format.
- It scores each format and **prefers the ones that did well** when picking tomorrow's hooks
  (80% exploit, 20% explore — so a losing format can still come back and prove itself).
- Formats that beat your own average by 15% get flagged as winners and reused deliberately.
- Once there are a few posts per hour, it reports your best posting hour.

What it cannot do: invent a hook that makes people stop scrolling. Those still come from
`content/ideas.json` or from you. Keep feeding it lines that worked in your emails and in real
conversations — that is what makes the difference, not more posting.

---

## Honest limits

- **New accounts get few views.** 1 post/day beats 3 posts/day. The machine will not change that.
- **No money spent, so no muscle.** Free tiers, free APIs, public release links. If GitHub is down,
  that day's post is late, not lost.
- **YouTube logins expire.** While your Google app is unverified, the upload token dies every 7 days
  and the log will say so. Refreshing it takes a minute — see `SETUP-CREDENTIALS.md`.
- **Instagram needs a Business/Creator account.** Posting to your own account does not need Meta
  review; posting for strangers' accounts would.
- **Text in the video is rendered by ffmpeg**, not a designer. Clean and readable, not beautiful.
- **This machine sells nothing by itself.** It gets your videos in front of people; the app still
  has to be installable and worth keeping.

---

## Files that matter

```
config.json                 brands, platforms, kill switch, style
content/ideas.json          today's subjects, hooks and lines
content/assets/inbox/       drop photos and clips here
content/library/            auto-made 6-second clips recycled on quiet days
content/queue.json          every candidate: pending → approved → posted
content/metrics.csv         raw results, one row per platform per post
content/report.json         what is working right now
ui/index.html               the approval page
engine/                     build (video creator), post, metrics, check
```

The two fonts are downloaded automatically by `engine/fonts.js` before every build, so the repo holds
no binaries and renders look the same on any machine.

Run it yourself, without GitHub: `npm run check`, `npm run build`, `npm run post`, `npm run metrics`.
(Needs `ffmpeg` and `ffprobe` installed; everything else is built into Node 20+.)
