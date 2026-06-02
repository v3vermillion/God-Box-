const { chromium } = require('playwright');
const path = require('path');
const EXE = path.join(__dirname, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
const OUT = path.join(__dirname, '..', 'audit');
const BASE = 'http://localhost:4178/';
const DEVICE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1' };
function iso(d){const x=new Date();x.setDate(x.getDate()+d);return x.toISOString();}
const SEED = { worries: [
  { id:'s1', text:'My job interview on Thursday.', createdAt:iso(-9), state:'surrendered', stateSince:iso(-7), surrenderedAt:iso(-7), counts:{surrendered:2,reclaimed:1,edited:1}, history:[] },
  { id:'c1', text:'Money this month. The numbers do not add up and I keep checking.', createdAt:iso(-5), state:'carrying', stateSince:iso(-5), surrenderedAt:null, counts:{surrendered:1,reclaimed:1,edited:0}, history:[] },
], answered:[{text:'A healing we prayed for',resolvedAt:iso(-2),outcome:'answered'}], surrenderDays:[iso(-2).slice(0,10),iso(-1).slice(0,10),iso(0).slice(0,10)] };

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox','--disable-gpu'] });
  const page = await (await browser.newContext(DEVICE)).newPage();
  await page.goto(BASE);
  await page.evaluate((s)=>{localStorage.setItem('godbox:data:v2',JSON.stringify(s));localStorage.setItem('godbox:install-hint-dismissed','1');localStorage.setItem('godbox:settings:v1',JSON.stringify({notificationsEnabled:true,dailyReminder:true,dailyReminderTime:'09:00',carryingReminder:true,carryingReminderHours:6,sound:true,haptics:true}));}, SEED);
  await page.reload(); await page.waitForTimeout(600);
  await page.click('[data-action="settings"]'); await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT,'10-settings-full.png'), fullPage: true });
  console.log('shot 10 full settings');
  // remove/answered modal on a surrendered worry
  await page.click('[data-action="back-from-settings"]'); await page.waitForTimeout(200);
  await page.click('[data-action="open-box"]'); await page.waitForTimeout(300);
  await page.click('[data-action="remove"]'); await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT,'11-answered-modal.png') });
  console.log('shot 11 answered modal');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
