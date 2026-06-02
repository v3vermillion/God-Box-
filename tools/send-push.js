#!/usr/bin/env node
/* Optional: send a real Web Push to your installed God Box PWA.
 *
 * GitHub Pages is static, so it cannot push on a schedule by itself.
 * The app's in-app + on-reopen reminders cover daily use. If you also
 * want a true background push (banner while the app is closed), run this
 * from any machine with Node installed.
 *
 * Steps:
 *   1. Install your God Box to the Home Screen and enable notifications.
 *      The app saves your push subscription under localStorage key
 *      "godbox:push-subscription". Copy that JSON into subscription.json
 *      next to this file (Settings → you can also read it from the console).
 *   2. cd tools && npm install web-push   (already installed here)
 *   3. node send-push.js "Your reminder text"
 *
 * NOTE: These keys are for personal use. If you publish/share a public
 * copy of this app, generate your own pair with:
 *   node -e "console.log(require('web-push').generateVAPIDKeys())"
 */
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const VAPID_PUBLIC = 'BMo0DTAnJY1M4UrpC9sqR-CRrQv7fYPAhppCGa8OmDUZRbOQewhZ3ihvL53bKhQH9CwYth8bbooJkNIRkcVnJ-8';
const VAPID_PRIVATE = 'e_U9EYqIUYWs2s2tPxKKAf5lMRKhxUnt_IFA9xdzyaU';

webpush.setVapidDetails('mailto:you@example.com', VAPID_PUBLIC, VAPID_PRIVATE);

const subPath = path.join(__dirname, 'subscription.json');
if (!fs.existsSync(subPath)) {
  console.error('Missing subscription.json — paste your push subscription there first.');
  process.exit(1);
}
const subscription = JSON.parse(fs.readFileSync(subPath, 'utf8'));

const body = process.argv.slice(2).join(' ') || 'A moment to surrender to God.';
const payload = JSON.stringify({ title: 'The God Box', body });

webpush.sendNotification(subscription, payload)
  .then(() => console.log('Push sent:', body))
  .catch((err) => { console.error('Push failed:', err.statusCode, err.body || err.message); process.exit(1); });
