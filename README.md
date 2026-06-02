# The God Box 🤍

A quiet, beautiful place to **give every worry to God** — and to stay honest
about what you're still holding onto.

> "Therefore I tell you, do not worry about your life." — Matthew 6:25

The God Box is a small, installable web app (PWA) built for daily practice:
name a worry, **surrender** it to God, and — if you find you've quietly taken
it back — be honest about that too. It keeps gentle track of how long each
worry has been in your hands versus in God's, so the habit of *letting go*
becomes visible and real.

## What it does

- **The Box** — tap it to look inside. Two places live there:
  - *In God's Hands* — what you've surrendered.
  - *Still In My Hands* — what you're still carrying.
- **Surrender / Take back / Edit / Remove** every worry, with quiet animations.
- **Accountability tracking** — each worry shows how many days it's been held
  vs. given, and how many times you've surrendered, reclaimed, or reworded it.
  Settings → *Your Practice* shows your overall totals.
- **Reminders** — a daily nudge to surrender, plus an optional *"watch what
  I'm still holding"* reminder (with a soft chime) for worries you haven't
  given to God or have taken back.
- **Local & private** — everything is saved on your device (localStorage).
  Nothing is sent anywhere. Export a copy anytime from Settings.
- **Works offline** — once opened, it runs without a connection.

## Install on iPhone (iPhone 16e and any iOS 16.4+)

1. Open the GitHub Pages URL in **Safari**.
2. Tap **Share** → **Add to Home Screen**.
3. Open it from the new icon (the glowing golden box).
4. Go to **Settings ⚙ → Notifications** and turn reminders on, then allow
   notifications when prompted.

## A note on notifications

GitHub Pages is static hosting, so the site itself can't run a server to push
notifications on a schedule. The app handles daily-use reminders by firing
them **while the app is open and when you reopen it** (iOS doesn't allow web
apps to schedule true background alarms). The notification **sound/chime**
plays when a reminder appears while the app is open.

If you also want a real **background push** (a banner while the app is fully
closed), the repo includes `tools/send-push.js`. With your saved push
subscription it can send a push from any computer running Node. See the
comments at the top of that file.

> If you publish a public/shared copy, generate your own VAPID keys:
> `node -e "console.log(require('web-push').generateVAPIDKeys())"`
> and replace them in `app.js` and `tools/send-push.js`.

## Hosting (GitHub Pages)

Everything is plain static files with **relative paths**, so it works from a
project page (`https://<user>.github.io/god-box-/`) with no build step.

- Settings → **Pages** → deploy from the branch this lives on, root (`/`).
- `.nojekyll` is included so all files are served as-is.

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell + iOS/PWA meta tags |
| `styles.css` | All styling |
| `app.js` | App logic: worries, tracking, settings, reminders, push |
| `service-worker.js` | Offline cache + push handling |
| `manifest.webmanifest` | PWA manifest |
| `icons/` | App icons (the glowing golden box with a cross) |
| `assets/` | Source SVGs for the icon |
| `tools/send-push.js` | Optional background-push sender |

Made for daily surrender. Share it with anyone walking through a hard season. 🤍
