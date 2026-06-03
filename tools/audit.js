// Visual + behavioural audit of the God Box PWA on an iPhone 16e profile.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const EXE = path.join(__dirname, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
const OUT = path.join(__dirname, '..', 'audit');
const BASE = 'http://localhost:4178/';

// iPhone 16e: 6.1" display, 390x844 CSS px, DPR 3.
const DEVICE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
};

const SEED = {
  worries: [
    { id: 's1', text: 'My job interview on Thursday — I keep rehearsing worst cases.', createdAt: iso(-9), state: 'surrendered', stateSince: iso(-7), surrenderedAt: iso(-7), counts: { surrendered: 2, reclaimed: 1, edited: 1 }, history: [] },
    { id: 's2', text: "My mom's health and the test results we're waiting on.", createdAt: iso(-20), state: 'surrendered', stateSince: iso(-3), surrenderedAt: iso(-3), counts: { surrendered: 1, reclaimed: 0, edited: 0 }, history: [] },
    { id: 'c1', text: 'Money this month. The numbers do not add up and I keep checking.', createdAt: iso(-5), state: 'carrying', stateSince: iso(-5), surrenderedAt: null, counts: { surrendered: 1, reclaimed: 1, edited: 0 }, history: [] },
    { id: 'c2', text: 'That conversation I still need to have with my brother.', createdAt: iso(-1), state: 'carrying', stateSince: iso(-1), surrenderedAt: null, counts: { surrendered: 0, reclaimed: 0, edited: 0 }, history: [] },
  ],
};
function iso(daysAgo) { const d = new Date(); d.setDate(d.getDate() + daysAgo); return d.toISOString(); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'] });
  const ctx = await browser.newContext(DEVICE);
  const page = await ctx.newPage();

  const messages = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) messages.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => messages.push(`[pageerror] ${e.message}`));

  async function shot(name) {
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('shot:', name);
  }

  // Seed storage then load
  await page.goto(BASE);
  await page.evaluate((seed) => {
    localStorage.setItem('godbox:data:v2', JSON.stringify(seed));
    localStorage.setItem('godbox:install-hint-dismissed', '1');
  }, SEED);
  await page.reload();
  await page.waitForTimeout(700);

  // 1. Home / rest
  await shot('01-home');

  // 2. Open the box
  await page.click('[data-action="open-box"]');
  await shot('02-open');

  // 3. Compose + layout-shift check on the "Not Yet" button
  await page.click('[data-action="compose-open"]');
  await page.waitForTimeout(300);
  const ta = await page.$('#worry-input');
  const before = await ta.boundingBox();
  await page.fill('#worry-input', 'A brand new worry I want to name plainly.');
  await page.waitForTimeout(150);
  const afterType = await ta.boundingBox();
  await shot('03-compose');
  // Hover/focus the Not Yet button and re-measure (the reported bug)
  await page.hover('[data-action="cancel-compose"]');
  await page.waitForTimeout(150);
  const afterHover = await ta.boundingBox();
  const shift = {
    typeShiftX: Math.round((afterType.x - before.x) * 100) / 100,
    hoverShiftX: Math.round((afterHover.x - before.x) * 100) / 100,
    textareaLeft: Math.round(before.x),
  };

  // 4. Add it -> back to open view
  await page.click('[data-action="add-worry"]');
  await page.waitForTimeout(600);
  await shot('04-after-add');

  // 5. Surrender a carrying worry (watch animation settle)
  const surBtn = await page.$('[data-action="surrender"]');
  if (surBtn) { await surBtn.click(); await page.waitForTimeout(3600); }
  await shot('05-after-surrender');

  // 6. Settings
  await page.click('[data-action="settings"]');
  await page.waitForTimeout(300);
  await shot('06-settings');

  // 7. Enable the carrying reminder toggles visually (master first)
  await page.evaluate(() => {
    // flip settings directly to show enabled state without permission prompts
    const s = JSON.parse(localStorage.getItem('godbox:settings:v1') || '{}');
    s.notificationsEnabled = true; s.carryingReminder = true; s.sound = true;
    localStorage.setItem('godbox:settings:v1', JSON.stringify(s));
  });
  await page.reload(); await page.waitForTimeout(500);
  await page.click('[data-action="settings"]');
  await page.waitForTimeout(300);
  await shot('07-settings-enabled');

  // 8. Edit modal
  await page.click('[data-action="back-from-settings"]');
  await page.waitForTimeout(200);
  await page.click('[data-action="open-box"]');
  await page.waitForTimeout(300);
  const editBtn = await page.$('[data-action="edit"]');
  if (editBtn) { await editBtn.click(); await page.waitForTimeout(400); await shot('08-edit-modal'); }

  // 9. Empty state (fresh install)
  await page.evaluate(() => { localStorage.removeItem('godbox:data:v2'); });
  await page.reload(); await page.waitForTimeout(500);
  await page.click('[data-action="open-box"]');
  await shot('09-empty-open');

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ layoutShift: shift, consoleMessages: messages }, null, 2));
  console.log('\n=== layout shift ===', JSON.stringify(shift));
  console.log('=== console messages ===');
  console.log(messages.length ? messages.join('\n') : '(none)');

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
