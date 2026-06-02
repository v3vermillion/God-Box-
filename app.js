/* The God Box — a quiet place to give every worry to God.
 * Vanilla PWA. Local-first (localStorage). No build step.
 */
(function () {
  'use strict';

  // ---- Constants -----------------------------------------------------------
  var STORAGE_KEY = 'godbox:data:v2';
  var LEGACY_KEY = 'godbox:data';
  var SETTINGS_KEY = 'godbox:settings:v1';
  var REMINDER_STATE_KEY = 'godbox:reminders:v1';
  var SUBSCRIPTION_KEY = 'godbox:push-subscription';

  // VAPID public key — pairs with the private key in tools/send-push.js.
  // Lets an installed PWA subscribe to Web Push; sending requires the
  // included Node sender (true background push needs a server you run).
  var VAPID_PUBLIC_KEY = 'BMo0DTAnJY1M4UrpC9sqR-CRrQv7fYPAhppCGa8OmDUZRbOQewhZ3ihvL53bKhQH9CwYth8bbooJkNIRkcVnJ-8';

  var DEFAULT_SETTINGS = {
    notificationsEnabled: false,
    dailyReminder: true,
    dailyReminderTime: '09:00',
    carryingReminder: false,
    carryingReminderHours: 6,
    sound: true,
    haptics: true,
  };

  // Verses rotate daily, so reopening the app stays fresh.
  var VERSES = [
    ['"Therefore I tell you, do not worry about your life."', 'Matthew 6:25'],
    ['"Cast all your anxiety on Him, because He cares for you."', '1 Peter 5:7'],
    ['"Come to me, all who are weary and burdened, and I will give you rest."', 'Matthew 11:28'],
    ['"Do not be anxious about anything, but in everything, by prayer, present your requests to God."', 'Philippians 4:6'],
    ['"When anxiety was great within me, your consolation brought me joy."', 'Psalm 94:19'],
    ['"Be still, and know that I am God."', 'Psalm 46:10'],
    ['"Commit to the Lord whatever you do, and He will establish your plans."', 'Proverbs 16:3'],
    ['"Cast your cares on the Lord and He will sustain you."', 'Psalm 55:22'],
    ['"Peace I leave with you; my peace I give you. Do not let your hearts be troubled."', 'John 14:27'],
    ['"The Lord is my shepherd, I lack nothing."', 'Psalm 23:1'],
    ['"Trust in the Lord with all your heart, and lean not on your own understanding."', 'Proverbs 3:5'],
    ['"He will not let your foot slip — He who watches over you will not slumber."', 'Psalm 121:3'],
  ];

  // ---- State ---------------------------------------------------------------
  var state = {
    view: 'rest', // rest | compose | open | settings
    returnTo: 'rest',
    settingsReturn: 'rest',
    loading: true,
    draft: '',
    data: { worries: [], answered: [] },
    settings: Object.assign({}, DEFAULT_SETTINGS),
    ui: {
      surrenderingId: null,
      justArrivedId: null,
      takingBackId: null,
      editingId: null,
      removingId: null,
      saveStatus: 'idle', // idle | saving | saved | error
    },
  };

  var app = document.getElementById('app');
  var audioCtx = null;

  // ---- Storage -------------------------------------------------------------
  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.worries)) {
          return {
            worries: parsed.worries.map(normalizeWorry),
            answered: Array.isArray(parsed.answered) ? parsed.answered : [],
            surrenderDays: Array.isArray(parsed.surrenderDays) ? parsed.surrenderDays : [],
          };
        }
      }
      // Migrate from the original artifact shape if present
      var legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        var lp = JSON.parse(legacy);
        var arr = (lp && (lp.worries || lp.current)) || [];
        return { worries: arr.map(normalizeWorry), answered: [], surrenderDays: [] };
      }
    } catch (e) {
      console.warn('loadData failed', e);
    }
    return { worries: [], answered: [], surrenderDays: [] };
  }

  function validIso(s, fallback) {
    if (s && !isNaN(new Date(s).getTime())) return s;
    return fallback;
  }

  function normalizeWorry(w) {
    var nowIso = new Date().toISOString();
    var created = validIso(w.createdAt, nowIso);
    var st = w.state === 'surrendered' ? 'surrendered' : 'carrying';
    return {
      id: w.id || (Date.now().toString() + Math.random().toString(36).slice(2, 6)),
      text: w.text || '',
      createdAt: created,
      state: st,
      stateSince: validIso(w.stateSince || w.surrenderedAt, created),
      surrenderedAt: w.surrenderedAt ? validIso(w.surrenderedAt, null) : (st === 'surrendered' ? created : null),
      counts: {
        surrendered: (w.counts && w.counts.surrendered) || (st === 'surrendered' ? 1 : 0),
        reclaimed: (w.counts && w.counts.reclaimed) || 0,
        edited: (w.counts && w.counts.edited) || 0,
      },
      history: Array.isArray(w.history) ? w.history : [{ type: 'created', at: created }],
    };
  }

  function persist(next) {
    // Keep the change in memory regardless, so a storage failure (e.g. iOS
    // private mode / quota) doesn't lose the session's work.
    state.data = next;
    state.ui.saveStatus = 'saving';
    renderSaveIndicator();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      state.ui.saveStatus = 'saved';
      renderSaveIndicator();
      setTimeout(function () {
        state.ui.saveStatus = 'idle';
        renderSaveIndicator();
      }, 1400);
    } catch (e) {
      console.error('persist failed', e);
      state.ui.saveStatus = 'error';
      renderSaveIndicator();
    }
  }

  // Merge a partial change into the data object, preserving answered /
  // surrenderDays, then persist.
  function commit(partial) {
    persist(Object.assign({}, state.data, partial));
  }

  function haptic(pattern) {
    try {
      if (state.settings.haptics && 'vibrate' in navigator) navigator.vibrate(pattern);
    } catch (e) {}
  }

  function todayKey() { return new Date().toISOString().slice(0, 10); }

  function recordSurrenderDay() {
    var days = Array.isArray(state.data.surrenderDays) ? state.data.surrenderDays.slice() : [];
    var k = todayKey();
    if (days.indexOf(k) === -1) days.push(k);
    return days;
  }

  function surrenderedToday() {
    return (state.data.surrenderDays || []).indexOf(todayKey()) !== -1;
  }

  function computeStreak() {
    var days = (state.data.surrenderDays || []).slice().sort();
    if (!days.length) return { current: 0, longest: 0 };
    var set = {};
    days.forEach(function (d) { set[d] = true; });
    function dayStr(date) { return date.toISOString().slice(0, 10); }
    // current streak ending today or yesterday
    var current = 0;
    var cursor = new Date();
    if (!set[dayStr(cursor)]) cursor.setDate(cursor.getDate() - 1); // allow grace if not yet today
    while (set[dayStr(cursor)]) { current++; cursor.setDate(cursor.getDate() - 1); }
    // longest streak overall
    var longest = 0, run = 0, prev = null;
    days.forEach(function (d) {
      if (prev) {
        var diff = (new Date(d) - new Date(prev)) / 86400000;
        run = diff === 1 ? run + 1 : 1;
      } else run = 1;
      if (run > longest) longest = run;
      prev = d;
    });
    return { current: current, longest: longest };
  }

  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
    } catch (e) {}
    return Object.assign({}, DEFAULT_SETTINGS);
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch (e) {}
  }

  function loadReminderState() {
    try {
      return JSON.parse(localStorage.getItem(REMINDER_STATE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }
  function saveReminderState(s) {
    try {
      localStorage.setItem(REMINDER_STATE_KEY, JSON.stringify(s));
    } catch (e) {}
  }

  // ---- Worry actions -------------------------------------------------------
  function addWorry(text) {
    var trimmed = (text || '').trim();
    if (!trimmed) return;
    var now = new Date().toISOString();
    var entry = {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      text: trimmed,
      createdAt: now,
      state: 'carrying',
      stateSince: now,
      surrenderedAt: null,
      counts: { surrendered: 0, reclaimed: 0, edited: 0 },
      history: [{ type: 'created', at: now }],
    };
    commit({ worries: [entry].concat(state.data.worries) });
    state.draft = '';
    haptic(20);
    state.returnTo = 'open';
    state.view = 'open';
    render();
  }

  function exists(id) {
    return state.data.worries.some(function (w) { return w.id === id; });
  }

  function surrender(id) {
    if (!exists(id) || state.ui.surrenderingId) return;
    state.ui.surrenderingId = id;
    haptic([18, 40, 30]);
    render();
    setTimeout(function () {
      if (!exists(id)) { state.ui.surrenderingId = null; render(); return; }
      var now = new Date().toISOString();
      commit({
        surrenderDays: recordSurrenderDay(),
        worries: state.data.worries.map(function (w) {
          if (w.id !== id) return w;
          return Object.assign({}, w, {
            state: 'surrendered',
            stateSince: now,
            surrenderedAt: now,
            counts: Object.assign({}, w.counts, { surrendered: w.counts.surrendered + 1 }),
            history: w.history.concat([{ type: 'surrendered', at: now }]),
          });
        }),
      });
      state.ui.surrenderingId = null;
      state.ui.justArrivedId = id;
      render();
      setTimeout(function () {
        state.ui.justArrivedId = null;
        render();
      }, 1800);
    }, 1400);
  }

  function takeBack(id) {
    if (!exists(id) || state.ui.takingBackId) return;
    state.ui.takingBackId = id;
    haptic(30);
    render();
    setTimeout(function () {
      if (!exists(id)) { state.ui.takingBackId = null; render(); return; }
      var now = new Date().toISOString();
      commit({
        worries: state.data.worries.map(function (w) {
          if (w.id !== id) return w;
          return Object.assign({}, w, {
            state: 'carrying',
            stateSince: now,
            counts: Object.assign({}, w.counts, { reclaimed: w.counts.reclaimed + 1 }),
            history: w.history.concat([{ type: 'reclaimed', at: now }]),
          });
        }),
      });
      state.ui.takingBackId = null;
      render();
    }, 700);
  }

  function editWorry(id, newText) {
    var trimmed = (newText || '').trim();
    if (!trimmed) return;
    var now = new Date().toISOString();
    commit({
      worries: state.data.worries.map(function (w) {
        if (w.id !== id || w.text === trimmed) return w;
        return Object.assign({}, w, {
          text: trimmed,
          counts: Object.assign({}, w.counts, { edited: w.counts.edited + 1 }),
          history: w.history.concat([{ type: 'edited', at: now }]),
        });
      }),
    });
  }

  // Remove a worry. If it was surrendered and `answer` is provided, keep a
  // small memorial of an answered/passed prayer for encouragement.
  function removeWorry(id, answer) {
    var w = state.data.worries.filter(function (x) { return x.id === id; })[0];
    var answered = (state.data.answered || []).slice();
    if (w && answer) {
      answered.unshift({ text: w.text, resolvedAt: new Date().toISOString(), outcome: answer });
    }
    commit({
      worries: state.data.worries.filter(function (x) { return x.id !== id; }),
      answered: answered,
    });
    if (answer) haptic([18, 40, 18, 40, 30]);
    render();
  }

  // ---- Helpers -------------------------------------------------------------
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function daysSince(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return 0;
    return Math.max(0, Math.floor((Date.now() - t) / 86400000));
  }
  function dayLabel(n) {
    if (n === 0) return 'today';
    return n + (n === 1 ? ' day' : ' days');
  }
  function surrendered() {
    return state.data.worries.filter(function (w) { return w.state === 'surrendered'; });
  }
  function carrying() {
    return state.data.worries.filter(function (w) { return w.state === 'carrying'; });
  }
  function movementSummary(w) {
    var parts = [];
    if (w.counts.surrendered > 0) parts.push('given ' + w.counts.surrendered + '×');
    if (w.counts.reclaimed > 0) parts.push('reclaimed ' + w.counts.reclaimed + '×');
    if (w.counts.edited > 0) parts.push('edited ' + w.counts.edited + '×');
    return parts.join(' · ');
  }

  // ---- Rendering -----------------------------------------------------------
  function render() {
    if (state.loading) {
      app.innerHTML = '<div class="loading">…</div>';
      return;
    }
    var html = '';
    if (state.view === 'rest') html = renderRest();
    else if (state.view === 'compose') html = renderCompose();
    else if (state.view === 'open') html = renderOpen();
    else if (state.view === 'settings') html = renderSettings();
    app.innerHTML = html;

    renderSaveIndicator();

    if (state.view === 'compose') {
      var ta = document.getElementById('worry-input');
      if (ta) {
        ta.value = state.draft || '';
        ta.focus();
        // place caret at end
        try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
      }
    }
    // Re-attach the edit modal only if it isn't already on screen, so an
    // in-progress edit isn't wiped by an unrelated re-render.
    if (state.ui.editingId && !document.getElementById('edit-modal-overlay')) renderEditModal();
  }

  function renderSaveIndicator() {
    var el = document.getElementById('save-indicator');
    if (!el) return;
    var s = state.ui.saveStatus;
    if (s === 'idle') { el.hidden = true; return; }
    el.hidden = false;
    el.className = 'save-indicator save-' + s;
    el.textContent = s === 'saving' ? 'Saving…' : s === 'saved' ? '✓ Saved' : '⚠ Save failed';
  }

  function verseOfDay() {
    // Deterministic per calendar day so it doesn't flicker between renders.
    var key = todayKey();
    var sum = 0;
    for (var i = 0; i < key.length; i++) sum = (sum + key.charCodeAt(i)) % 100000;
    return VERSES[sum % VERSES.length];
  }

  function header() {
    var v = verseOfDay();
    return (
      '<div class="ornament">✦ &nbsp; ✦ &nbsp; ✦</div>' +
      '<div class="title">The God Box</div>' +
      '<p class="verse">' + esc(v[0]) + '</p>' +
      '<div class="verse-cite">— ' + esc(v[1]) + '</div>'
    );
  }

  function topbar(opts) {
    opts = opts || {};
    var left = opts.back
      ? '<button class="back-btn" data-action="' + esc(opts.back) + '">‹ ' + esc(opts.backLabel || 'Back') + '</button>'
      : '<span></span>';
    var right = opts.settings
      ? '<button class="settings-btn" data-action="settings" aria-label="Settings" title="Settings">⚙</button>'
      : '<span></span>';
    return '<div class="topbar">' + left + right + '</div>';
  }

  function renderRest() {
    var sCount = surrendered().length;
    var cCount = carrying().length;
    return (
      topbar({ settings: true }) +
      header() +
      '<button class="box-stage" data-action="open-box" aria-label="Open the box">' +
        '<div class="box-glow"></div>' +
        '<div class="box"><div class="box-body"></div><div class="box-slot"></div><div class="box-lid"></div></div>' +
      '</button>' +
      '<div class="rest-hint">Tap the box to look inside</div>' +
      '<div class="stats">' +
        '<div class="stat"><div class="stat-num">' + sCount + '</div><div class="stat-label">In God\'s Hands</div></div>' +
        '<div class="stat carrying-stat"><div class="stat-num">' + cCount + '</div><div class="stat-label">Still In Mine</div></div>' +
      '</div>' +
      '<div class="actions"><button class="btn btn-primary" data-action="compose-rest">Add a Worry</button></div>' +
      (state.data.worries.length
        ? '<div class="footer-text">When something has truly passed, remove it — out of respect for what was real.</div>'
        : '<div class="footer-text">Name what weighs on you. Place it in the box. Let God carry it.</div>')
    );
  }

  function renderCompose() {
    return (
      topbar({ back: 'cancel-compose', backLabel: 'Back', settings: true }) +
      header() +
      '<div class="composer">' +
        '<div class="composer-label">What is weighing on you?</div>' +
        '<textarea id="worry-input" placeholder="Name it plainly. It does not need to be eloquent."></textarea>' +
        '<div class="composer-help">It will land in <em>"Still In My Hands"</em> first.<br/>Surrendering it is its own act.</div>' +
        '<div class="actions">' +
          '<button class="btn btn-primary" data-action="add-worry">Add to the Box</button>' +
          '<button class="btn btn-ghost" data-action="cancel-compose">Not Yet</button>' +
        '</div>' +
      '</div>'
    );
  }

  function worryCard(w, kind) {
    var ui = state.ui;
    var cls = 'worry-card card-' + kind;
    if (kind === 'carrying' && ui.surrenderingId === w.id) cls += ' departing';
    if (kind === 'surrendered' && ui.justArrivedId === w.id) cls += ' arriving';
    if (kind === 'surrendered' && ui.takingBackId === w.id) cls += ' taking-back';

    var days = daysSince(w.stateSince);
    var badge, meta = movementSummary(w);
    if (kind === 'carrying') {
      var warn = days >= 3 ? ' badge-warn' : '';
      badge = '<span class="badge badge-held' + warn + '">Held ' + dayLabel(days) + '</span>';
    } else {
      badge = '<span class="badge badge-given">In God\'s hands ' + dayLabel(days) + '</span>';
    }

    var actions;
    if (kind === 'carrying') {
      actions =
        '<button class="action-btn action-surrender" data-action="surrender" data-id="' + esc(w.id) + '">Surrender to God ↑</button>' +
        '<button class="action-btn action-edit" data-action="edit" data-id="' + esc(w.id) + '">Edit</button>' +
        '<button class="action-btn action-remove" data-action="remove" data-id="' + esc(w.id) + '">Remove ✕</button>';
    } else {
      actions =
        '<button class="action-btn action-takeback" data-action="takeback" data-id="' + esc(w.id) + '">I\'ve taken this back ↓</button>' +
        '<button class="action-btn action-edit" data-action="edit" data-id="' + esc(w.id) + '">Edit</button>' +
        '<button class="action-btn action-remove" data-action="remove" data-id="' + esc(w.id) + '">Remove ✕</button>';
    }

    return (
      '<div class="' + cls + '">' +
        '<div class="worry-date"><span>' + formatDate(w.createdAt) + '</span>' + badge + '</div>' +
        '<div class="worry-text">' + esc(w.text) + '</div>' +
        (meta ? '<div class="worry-meta">' + esc(meta) + '</div>' : '') +
        '<div class="worry-actions">' + actions + '</div>' +
      '</div>'
    );
  }

  function renderOpen() {
    var sur = surrendered();
    var car = carrying();
    var surHtml = sur.length
      ? sur.map(function (w) { return worryCard(w, 'surrendered'); }).join('')
      : '<div class="empty">Nothing surrendered yet.</div>';
    var carHtml = car.length
      ? car.map(function (w) { return worryCard(w, 'carrying'); }).join('')
      : '<div class="empty">Nothing carried right now.</div>';

    return (
      topbar({ back: 'close-box', backLabel: 'Close', settings: true }) +
      header() +
      '<div class="open-view">' +
        '<div class="section"><div class="section-header section-header-surrendered">In God\'s Hands</div>' + surHtml + '</div>' +
        '<div class="section-divider">∙ ∙ ∙</div>' +
        '<div class="section"><div class="section-header section-header-carrying">Still In My Hands</div>' + carHtml + '</div>' +
        '<div class="actions" style="margin-top:2rem">' +
          '<button class="btn btn-primary" data-action="compose-open">Add Another</button>' +
          '<button class="btn btn-ghost" data-action="close-box">Close the Box</button>' +
        '</div>' +
      '</div>'
    );
  }

  function permBadge() {
    var p = (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported';
    if (p === 'granted') return '<span class="perm-status perm-granted">Allowed</span>';
    if (p === 'denied') return '<span class="perm-status perm-denied">Blocked</span>';
    if (p === 'unsupported') return '<span class="perm-status perm-default">Unsupported</span>';
    return '<span class="perm-status perm-default">Not yet</span>';
  }

  function toggleRow(id, label, sub, checked, disabled) {
    return (
      '<div class="setting-row' + (disabled ? ' is-disabled' : '') + '">' +
        '<div><div class="setting-label">' + label + '</div>' + (sub ? '<div class="setting-sub">' + sub + '</div>' : '') + '</div>' +
        '<label class="switch setting-control">' +
          '<input type="checkbox" data-setting="' + id + '"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + '>' +
          '<span class="slider"></span>' +
        '</label>' +
      '</div>'
    );
  }

  function renderSettings() {
    var s = state.settings;
    var masterOff = !s.notificationsEnabled;
    var hourOpts = [1, 3, 6, 12, 24].map(function (h) {
      return '<option value="' + h + '"' + (s.carryingReminderHours === h ? ' selected' : '') + '>' +
        (h === 24 ? 'every 24 h' : 'every ' + h + ' h') + '</option>';
    }).join('');

    return (
      topbar({ back: 'back-from-settings', backLabel: 'Back' }) +
      '<div class="title" style="font-size:1.15rem">Settings</div>' +
      '<div class="ornament" style="margin-bottom:1.5rem">✦</div>' +
      '<div class="settings-view">' +

        '<div class="settings-group">' +
          '<div class="settings-group-title">Notifications</div>' +
          '<div class="setting-row">' +
            '<div><div class="setting-label">Reminders</div><div class="setting-sub">Permission: ' + permBadge() + '</div></div>' +
            '<label class="switch setting-control"><input type="checkbox" data-setting="notificationsEnabled"' + (s.notificationsEnabled ? ' checked' : '') + '><span class="slider"></span></label>' +
          '</div>' +
          toggleRow('dailyReminder', 'Daily surrender reminder', 'A gentle nudge to bring the day to God.', s.dailyReminder, masterOff) +
          '<div class="setting-row' + (masterOff || !s.dailyReminder ? ' is-disabled' : '') + '">' +
            '<div><div class="setting-label">Reminder time</div><div class="setting-sub">When the daily nudge arrives.</div></div>' +
            '<input class="setting-input setting-control" type="time" data-setting="dailyReminderTime" value="' + esc(s.dailyReminderTime) + '"' + (masterOff || !s.dailyReminder ? ' disabled' : '') + '>' +
          '</div>' +
          toggleRow('carryingReminder', 'Watch what I\'m still holding', 'Reminds me about worries I haven\'t given to God — or have taken back — and makes a sound.', s.carryingReminder, masterOff) +
          '<div class="setting-row' + (masterOff || !s.carryingReminder ? ' is-disabled' : '') + '">' +
            '<div><div class="setting-label">How often</div><div class="setting-sub">Frequency of the "still holding" check (daytime only).</div></div>' +
            '<select class="setting-select setting-control" data-setting="carryingReminderHours"' + (masterOff || !s.carryingReminder ? ' disabled' : '') + '>' + hourOpts + '</select>' +
          '</div>' +
          toggleRow('sound', 'Notification sound', 'Play a soft chime when a reminder arrives while the app is open.', s.sound, masterOff) +
          toggleRow('haptics', 'Vibration', 'A subtle buzz when you surrender or take a worry back.', s.haptics, false) +
          '<div class="actions" style="margin-top:1rem;max-width:none">' +
            '<button class="btn btn-ghost" data-action="test-notification"' + (masterOff ? ' disabled' : '') + '>Send a test reminder</button>' +
          '</div>' +
          '<div class="settings-note">On iPhone, <strong>Add to Home Screen</strong> first (Share → Add to Home Screen), then open from the icon and allow notifications. Scheduled reminders fire while the app is open or when you reopen it. For true background push, the repo includes a sender script you can run yourself.</div>' +
        '</div>' +

        '<div class="settings-group">' +
          '<div class="settings-group-title">Your Practice</div>' +
          renderPracticeStats() +
        '</div>' +

        '<div class="settings-group">' +
          '<div class="settings-group-title">Your Data</div>' +
          '<div class="setting-sub" style="margin-bottom:0.8rem">Everything lives only on this device. Export to keep a safe copy, or import one back.</div>' +
          '<div class="actions" style="max-width:none;gap:0.6rem">' +
            '<button class="btn btn-ghost" data-action="export-data">Export my worries</button>' +
            '<button class="btn btn-ghost" data-action="import-data">Import a backup</button>' +
            '<button class="btn btn-ghost" data-action="share-app">Share The God Box</button>' +
            '<button class="danger-btn" data-action="clear-data">Erase everything</button>' +
          '</div>' +
          '<input id="import-file" type="file" accept="application/json,.json" hidden>' +
        '</div>' +

        '<div class="footer-text">"Cast all your anxiety on Him, because He cares for you." — 1 Peter 5:7</div>' +
      '</div>'
    );
  }

  function renderPracticeStats() {
    var sur = surrendered();
    var car = carrying();
    var totalGiven = state.data.worries.reduce(function (a, w) { return a + w.counts.surrendered; }, 0);
    var totalReclaimed = state.data.worries.reduce(function (a, w) { return a + w.counts.reclaimed; }, 0);
    var longestHeld = car.reduce(function (m, w) { return Math.max(m, daysSince(w.stateSince)); }, 0);
    var longestGiven = sur.reduce(function (m, w) { return Math.max(m, daysSince(w.stateSince)); }, 0);
    var streak = computeStreak();
    var answeredCount = (state.data.answered || []).length;
    var rows = [
      ['Current surrender streak', streak.current === 0 ? '—' : dayLabel(streak.current)],
      ['Longest streak', streak.longest === 0 ? '—' : dayLabel(streak.longest)],
      ['In God\'s hands now', sur.length],
      ['Still in my hands', car.length],
      ['Longest in God\'s hands', sur.length ? dayLabel(longestGiven) : '—'],
      ['Longest currently held', car.length ? dayLabel(longestHeld) : '—'],
      ['Times surrendered', totalGiven],
      ['Times taken back', totalReclaimed],
      ['Worries resolved', answeredCount],
    ];
    return rows.map(function (r) {
      return '<div class="setting-row"><div class="setting-label">' + r[0] + '</div><div class="setting-control" style="font-family:\'Cinzel\',serif;color:var(--gold)">' + r[1] + '</div></div>';
    }).join('');
  }

  function renderEditModal() {
    var w = state.data.worries.filter(function (x) { return x.id === state.ui.editingId; })[0];
    if (!w) return;
    var existing = document.getElementById('edit-modal-overlay');
    if (existing) existing.remove();
    var div = document.createElement('div');
    div.id = 'edit-modal-overlay';
    div.className = 'modal-overlay';
    div.innerHTML =
      '<div class="modal">' +
        '<div class="modal-title">Reword this worry</div>' +
        '<textarea id="edit-input"></textarea>' +
        '<div class="modal-actions">' +
          '<button class="btn btn-ghost" data-action="edit-cancel">Cancel</button>' +
          '<button class="btn btn-primary" data-action="edit-save">Save</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(div);
    var ta = document.getElementById('edit-input');
    ta.value = w.text;
    ta.focus();
  }

  function closeEditModal() {
    state.ui.editingId = null;
    var existing = document.getElementById('edit-modal-overlay');
    if (existing) existing.remove();
  }

  // ---- Event handling ------------------------------------------------------
  document.addEventListener('click', function (e) {
    primeAudio();
    var t = e.target.closest('[data-action]');
    if (!t) return;
    var action = t.getAttribute('data-action');
    var id = t.getAttribute('data-id');

    switch (action) {
      case 'open-box': go('open', 'rest'); break;
      case 'close-box': go('rest', 'rest'); break;
      case 'compose-rest': go('compose', 'rest'); break;
      case 'compose-open': go('compose', 'open'); break;
      case 'cancel-compose': go(state.returnTo, 'rest'); break;
      case 'add-worry': {
        var ta = document.getElementById('worry-input');
        addWorry(ta ? ta.value : '');
        break;
      }
      case 'surrender': surrender(id); break;
      case 'takeback': takeBack(id); break;
      case 'remove': {
        var w = state.data.worries.filter(function (x) { return x.id === id; })[0];
        if (!w) break;
        if (w.state === 'surrendered') {
          openRemoveModal(id); // offer to mark it answered / passed
        } else {
          var label = '"' + (w.text.length > 40 ? w.text.slice(0, 40) + '…' : w.text) + '"';
          if (confirm('Remove ' + label + ' from the box? This cannot be undone.')) removeWorry(id);
        }
        break;
      }
      case 'remove-answered': removeWorry(state.ui.removingId, t.getAttribute('data-outcome')); closeRemoveModal(); break;
      case 'remove-plain': removeWorry(state.ui.removingId); closeRemoveModal(); break;
      case 'remove-cancel': closeRemoveModal(); break;
      case 'edit': state.ui.editingId = id; renderEditModal(); break;
      case 'edit-cancel': closeEditModal(); break;
      case 'edit-save': {
        var input = document.getElementById('edit-input');
        if (input) editWorry(state.ui.editingId, input.value);
        closeEditModal();
        render();
        break;
      }
      case 'settings': state.settingsReturn = state.view; go('settings'); break;
      case 'back-from-settings': go(state.settingsReturn || 'rest', 'rest'); break;
      case 'test-notification':
        fireReminder('A test from The God Box', 'This is how a reminder will feel. Breathe — and let it go.');
        break;
      case 'export-data': exportData(); break;
      case 'import-data': {
        var fi = document.getElementById('import-file');
        if (fi) fi.click();
        break;
      }
      case 'share-app': shareApp(); break;
      case 'clear-data':
        if (confirm('Erase ALL worries, history, and resolved prayers? This cannot be undone.')) {
          persist({ worries: [], answered: [], surrenderDays: [] });
          render();
        }
        break;
    }
  });

  // Keep the compose draft in memory so re-renders never lose it.
  document.addEventListener('input', function (e) {
    if (e.target && e.target.id === 'worry-input') state.draft = e.target.value;
  });

  // Settings change events (toggles, selects, time) + import file picker
  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'import-file') { handleImportFile(e.target.files && e.target.files[0]); return; }
    var el = e.target.closest('[data-setting]');
    if (!el) return;
    var key = el.getAttribute('data-setting');
    var val = el.type === 'checkbox' ? el.checked : el.value;
    if (key === 'carryingReminderHours') val = parseInt(val, 10);

    if (key === 'notificationsEnabled' && val) {
      enableNotifications();
      return; // enableNotifications re-renders
    }
    state.settings[key] = val;
    saveSettings();
    render();
  });

  // Overlay click closes modals
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'edit-modal-overlay') { closeEditModal(); render(); }
    if (e.target && e.target.id === 'remove-modal-overlay') { closeRemoveModal(); }
  });

  function go(view, returnTo) {
    state.view = view;
    if (returnTo) state.returnTo = returnTo;
    closeEditModal();
    closeRemoveModal();
    window.scrollTo({ top: 0, behavior: 'auto' });
    render();
  }

  // ---- Remove (with answered-prayer memorial) ------------------------------
  function openRemoveModal(id) {
    state.ui.removingId = id;
    var existing = document.getElementById('remove-modal-overlay');
    if (existing) existing.remove();
    var div = document.createElement('div');
    div.id = 'remove-modal-overlay';
    div.className = 'modal-overlay';
    div.innerHTML =
      '<div class="modal">' +
        '<div class="modal-title">Before you remove it</div>' +
        '<p class="composer-help" style="margin:0 0 1rem">Was this one resolved? Marking it keeps a quiet record of God\'s faithfulness.</p>' +
        '<div class="actions" style="max-width:none;gap:0.6rem">' +
          '<button class="btn btn-primary" data-action="remove-answered" data-outcome="answered">God answered this 🙏</button>' +
          '<button class="btn btn-ghost" data-action="remove-answered" data-outcome="passed">It simply passed</button>' +
          '<button class="btn btn-ghost" data-action="remove-plain">Just remove it</button>' +
          '<button class="action-btn action-remove" data-action="remove-cancel" style="margin-top:0.25rem">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(div);
  }
  function closeRemoveModal() {
    state.ui.removingId = null;
    var existing = document.getElementById('remove-modal-overlay');
    if (existing) existing.remove();
  }

  // ---- Export / Import / Share ---------------------------------------------
  function exportData() {
    var payload = { app: 'god-box', version: 2, exportedAt: new Date().toISOString(), data: state.data, settings: state.settings };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'god-box-export.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function handleImportFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var incoming = (parsed && parsed.data) || parsed;
        if (!incoming || !Array.isArray(incoming.worries)) throw new Error('No worries found in file.');
        if (!confirm('Import ' + incoming.worries.length + ' worry/worries? This merges with what you already have.')) return;

        // Merge by id, preferring existing entries.
        var byId = {};
        state.data.worries.forEach(function (w) { byId[w.id] = w; });
        incoming.worries.map(normalizeWorry).forEach(function (w) { if (!byId[w.id]) byId[w.id] = w; });
        var mergedWorries = Object.keys(byId).map(function (k) { return byId[k]; })
          .sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });

        var mergedAnswered = (state.data.answered || []).concat(Array.isArray(incoming.answered) ? incoming.answered : []);
        var mergedDays = (state.data.surrenderDays || []).slice();
        (incoming.surrenderDays || []).forEach(function (d) { if (mergedDays.indexOf(d) === -1) mergedDays.push(d); });

        commit({ worries: mergedWorries, answered: mergedAnswered, surrenderDays: mergedDays });
        if (parsed && parsed.settings) { state.settings = Object.assign({}, DEFAULT_SETTINGS, parsed.settings); saveSettings(); }
        render();
        showBanner('Restored ' + mergedWorries.length + ' worries from your backup.');
      } catch (e) {
        alert('Could not import this file: ' + (e && e.message ? e.message : 'invalid file.'));
      }
    };
    reader.readAsText(file);
  }

  function shareApp() {
    var shareData = {
      title: 'The God Box',
      text: 'A quiet place to give every worry to God — it has helped me. Maybe it helps you too. 🤍',
      url: location.href.split('?')[0],
    };
    if (navigator.share) {
      navigator.share(shareData).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(shareData.url).then(function () {
        showBanner('Link copied — share it with someone who needs it.');
      }).catch(function () { showBanner(shareData.url); });
    } else {
      showBanner(shareData.url);
    }
  }

  // ---- Notifications -------------------------------------------------------
  function primeAudio() {
    try {
      if (!audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {}
  }

  function playChime() {
    if (!state.settings.sound) return;
    primeAudio();
    if (!audioCtx) return;
    try {
      var now = audioCtx.currentTime;
      // a soft two-note bell
      [ [880, 0], [1174.66, 0.18] ].forEach(function (pair) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = pair[0];
        var start = now + pair[1];
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.18, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.1);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + 1.2);
      });
    } catch (e) {}
  }

  function showBanner(text) {
    var banner = document.getElementById('reminder-banner');
    var span = document.getElementById('reminder-banner-text');
    if (!banner || !span) return;
    span.textContent = text;
    banner.hidden = false;
    clearTimeout(showBanner._t);
    showBanner._t = setTimeout(function () { banner.hidden = true; }, 9000);
  }

  var dismissBtn = document.getElementById('reminder-banner-dismiss');
  if (dismissBtn) dismissBtn.addEventListener('click', function () {
    document.getElementById('reminder-banner').hidden = true;
  });

  function fireReminder(title, body) {
    playChime();
    // OS-level notification (via the service worker) if allowed.
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' &&
          navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(function (reg) {
          reg.showNotification(title, {
            body: body,
            icon: './icons/icon-192.png',
            badge: './icons/icon-192.png',
            tag: 'godbox-reminder',
            renotify: true,
            vibrate: [60, 40, 60],
            data: { url: './' },
          });
        }).catch(function () {});
      }
    } catch (e) {}
    // Always reinforce in-app when the app is on screen.
    if (document.visibilityState === 'visible') showBanner(body);
  }

  function enableNotifications() {
    if (typeof Notification === 'undefined') {
      // No OS notifications, but in-app reminders still work.
      state.settings.notificationsEnabled = true;
      saveSettings();
      showBanner('This device shows reminders inside the app only.');
      render();
      return;
    }
    Notification.requestPermission().then(function (perm) {
      // Only flip the master on if not explicitly blocked, so the toggle never lies.
      state.settings.notificationsEnabled = (perm !== 'denied');
      saveSettings();
      if (perm === 'granted') {
        subscribePush();
        fireReminder('Notifications on', 'The God Box will gently remind you to keep surrendering.');
      } else if (perm === 'denied') {
        showBanner('Notifications are blocked. Allow them in iOS Settings to receive reminders.');
      }
      render();
    }).catch(function () { render(); });
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function subscribePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (existing) {
        if (existing) return existing;
        return reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        });
      });
    }).then(function (sub) {
      if (sub) {
        try { localStorage.setItem(SUBSCRIPTION_KEY, JSON.stringify(sub)); } catch (e) {}
      }
    }).catch(function (e) {
      // iOS may reject without home-screen install — non-fatal.
      console.info('Push subscribe unavailable:', e && e.message);
    });
  }

  // ---- Reminder scheduler (runs while app is open / on reopen) -------------
  function reminderTick() {
    var s = state.settings;
    if (!s.notificationsEnabled) return;
    if (document.getElementById('install-hint') && !document.getElementById('install-hint').hidden) return; // don't pile on first run
    var rs = loadReminderState();
    var now = new Date();
    var tKey = now.toISOString().slice(0, 10);
    var hour = now.getHours();
    var firedThisTick = false;

    // Daily surrender reminder — once per day, and not if you already surrendered today.
    if (s.dailyReminder && s.dailyReminderTime) {
      var hm = s.dailyReminderTime.split(':');
      var due = new Date(now);
      due.setHours(parseInt(hm[0], 10) || 9, parseInt(hm[1], 10) || 0, 0, 0);
      var notTooLate = (now - due) < 14 * 3600000; // don't fire a "morning" nudge near midnight
      if (now >= due && notTooLate && rs.lastDailyKey !== tKey && !surrenderedToday()) {
        var c = carrying().length;
        var body = c > 0
          ? 'You\'re still holding ' + c + (c === 1 ? ' worry' : ' worries') + '. Open the box and give ' + (c === 1 ? 'it' : 'them') + ' to God.'
          : 'Bring today to God before you carry it yourself.';
        fireReminder('A moment with God', body);
        rs.lastDailyKey = tKey;
        saveReminderState(rs);
        firedThisTick = true;
      }
    }

    // "Still holding" reminder — daytime only, and not stacked on the daily nudge.
    var quietHours = hour < 8 || hour >= 22;
    if (s.carryingReminder && !firedThisTick && !quietHours) {
      var held = carrying();
      if (held.length > 0) {
        var gap = (s.carryingReminderHours || 6) * 3600000;
        var last = rs.lastCarryingAt ? new Date(rs.lastCarryingAt).getTime() : 0;
        if (Date.now() - last >= gap) {
          var oldest = held.reduce(function (a, b) {
            return new Date(a.stateSince) < new Date(b.stateSince) ? a : b;
          });
          var d = daysSince(oldest.stateSince);
          fireReminder(
            'Still in your hands',
            held.length + (held.length === 1 ? ' worry is' : ' worries are') + ' still yours to carry' +
              (d >= 1 ? ' — one for ' + dayLabel(d) : '') + '. Have you given ' + (held.length === 1 ? 'it' : 'them') + ' to God?'
          );
          rs.lastCarryingAt = new Date().toISOString();
          saveReminderState(rs);
        }
      }
    }
  }

  // ---- Install hint (iOS Safari, not yet installed) ------------------------
  function maybeShowInstallHint() {
    try {
      var isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
      var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      var dismissed = localStorage.getItem('godbox:install-hint-dismissed');
      if (isIOS && !isStandalone && !dismissed) {
        var hint = document.getElementById('install-hint');
        if (hint) {
          hint.hidden = false;
          document.getElementById('install-hint-close').addEventListener('click', function () {
            hint.hidden = true;
            try { localStorage.setItem('godbox:install-hint-dismissed', '1'); } catch (e) {}
          });
        }
      }
    } catch (e) {}
  }

  // ---- Service worker ------------------------------------------------------
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch(function (e) {
        console.info('SW registration failed', e);
      });
    }
  }

  // ---- Boot ----------------------------------------------------------------
  function boot() {
    state.settings = loadSettings();
    state.data = loadData();
    state.loading = false;
    render();
    registerServiceWorker();
    maybeShowInstallHint();

    // If notifications were enabled and permission already granted, refresh subscription.
    if (state.settings.notificationsEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      subscribePush();
    }

    reminderTick();
    setInterval(function () {
      if (document.visibilityState === 'visible') reminderTick();
    }, 60000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') reminderTick();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
