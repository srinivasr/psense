// RuSense / PredatorSense Cockpit Frontend
// 6-Page Navigation: Dashboard, Keyboard & Pulsar, Fan Control, Scenarios, Monitoring, Settings & Power.
(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const invoke = window.__TAURI__
    ? window.__TAURI__.core.invoke
    : () => Promise.reject('Tauri unavailable (open via rusense-gui)');

  const MAX_RPM = 6000, ARC = 75; // 270° arc (pathLength 100)
  const POLL_MS = 2000;

  const RGB_MODES = [
    'Static', 'Breathing', 'Neon', 'Wave',
    'Shifting', 'Zoom', 'Meteor', 'Twinkle'
  ];

  let current = null;       // latest UiState
  let dragging = false;     // true when a fan slider is being dragged
  let lastPollError = null;
  let gen = 0;
  let renderedGen = 0;

  // Selected global RGB state for driver compatibility
  let selectedRgb = {
    mode: 0,
    speed: 5,
    brightness: 100,
    direction: 0,
    red: 0,
    green: 200,
    blue: 236
  };

  // Per-zone custom colors (hex)
  let currentTargetZone = 'all'; // 'all', '1', '2', '3', '4'
  let zoneColors = {
    1: '#00c8ec',
    2: '#00c8ec',
    3: '#00c8ec',
    4: '#00c8ec'
  };

  try {
    const savedZones = localStorage.getItem('rusense_zone_colors');
    if (savedZones) zoneColors = Object.assign(zoneColors, JSON.parse(savedZones));
  } catch (_) {}

  // ---------- Multi-Page Navigation ----------
  const navTabs = document.querySelectorAll('.nav-tab');
  const pages = document.querySelectorAll('.page-container');

  function switchTab(targetPage) {
    for (const tab of navTabs) {
      tab.classList.toggle('active', tab.dataset.page === targetPage);
    }
    for (const page of pages) {
      page.classList.toggle('active', page.id === 'page-' + targetPage);
    }
    localStorage.setItem('rusense_active_page', targetPage);
  }

  const savedPage = localStorage.getItem('rusense_active_page') || 'dashboard';
  switchTab(savedPage);

  const navBar = $('.cockpit-nav');
  if (navBar) {
    navBar.addEventListener('click', e => {
      const btn = e.target.closest('.nav-tab');
      if (!btn) return;
      switchTab(btn.dataset.page);
    });
  }

  // ---------- Theme Switcher ----------
  const savedTheme = localStorage.getItem('rusense_theme') || 'theme-predator';
  document.documentElement.className = savedTheme;
  updateThemeButton(savedTheme);

  const themeToggle = $('#theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const isPredator = document.documentElement.classList.contains('theme-predator');
      const next = isPredator ? 'theme-nitro' : 'theme-predator';
      document.documentElement.className = next;
      localStorage.setItem('rusense_theme', next);
      updateThemeButton(next);
      toast('Theme → ' + (isPredator ? 'Nitro Fire' : 'Predator Cyan'));
    });
  }

  function updateThemeButton(theme) {
    if (!themeToggle) return;
    const isPredator = theme === 'theme-predator';
    themeToggle.textContent = isPredator ? 'CYBER CYAN' : 'NITRO FIRE';
    const brandSub = $('.brand-sub');
    if (brandSub) brandSub.textContent = isPredator ? 'SENSE' : 'NITRO';
    const brandName = $('.brand-name');
    if (brandName) brandName.textContent = isPredator ? 'PREDATOR' : 'ACER';
  }

  // ---------- Toast Notification ----------
  let toastTimer;
  function toast(text) {
    $('#toast-msg').textContent = text;
    const t = $('#toast');
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }

  // ---------- Color Helpers ----------
  function hexToRgb(hex) {
    const res = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return res ? {
      r: parseInt(res[1], 16),
      g: parseInt(res[2], 16),
      b: parseInt(res[3], 16)
    } : { r: 0, g: 200, b: 236 };
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(x => {
      const hex = x.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
  }

  function stripHash(hex) {
    return hex.replace(/^#/, '').toLowerCase();
  }

  // ---------- Keyboard Zone Management ----------
  function updateKeyboardVisuals() {
    for (let i = 1; i <= 4; i++) {
      const hex = zoneColors[i] || '#00c8ec';
      const zoneEl = $('#zone-' + i);
      const indEl = $('#ind-zone-1') ? $('#ind-zone-' + i) : null;
      if (zoneEl) {
        zoneEl.style.boxShadow = `inset 0 0 20px ${hex}88, 0 0 8px ${hex}55`;
        zoneEl.style.borderColor = hex;
      }
      if (indEl) {
        indEl.textContent = hex.toUpperCase();
        indEl.style.color = hex;
      }
    }
    localStorage.setItem('rusense_zone_colors', JSON.stringify(zoneColors));
  }

  function selectTargetZone(zone) {
    currentTargetZone = zone;
    for (const pill of document.querySelectorAll('.zone-pill')) {
      pill.classList.toggle('active', pill.dataset.zone === zone);
    }
    for (let i = 1; i <= 4; i++) {
      const zoneEl = $('#zone-' + i);
      if (zoneEl) {
        const isMatch = zone === 'all' || zone === String(i);
        zoneEl.classList.toggle('active-selection', isMatch);
      }
    }
    const targetText = $('#zone-target-text');
    if (targetText) {
      if (zone === 'all') targetText.textContent = 'EDITING: ALL ZONES';
      else if (zone === '1') targetText.textContent = 'EDITING: ZONE 1 (WASD)';
      else if (zone === '2') targetText.textContent = 'EDITING: ZONE 2 (CENTER)';
      else if (zone === '3') targetText.textContent = 'EDITING: ZONE 3 (ARROWS)';
      else if (zone === '4') targetText.textContent = 'EDITING: ZONE 4 (NUMPAD)';
    }

    // Reflect current color into custom picker
    const activeColor = zone === 'all' ? zoneColors[1] : zoneColors[zone];
    const picker = $('#picker-color');
    const hexInput = $('#picker-hex');
    if (picker) picker.value = activeColor;
    if (hexInput) hexInput.value = activeColor.toUpperCase();
  }

  function applyColorToSelectedZone(hex) {
    if (currentTargetZone === 'all') {
      zoneColors[1] = hex;
      zoneColors[2] = hex;
      zoneColors[3] = hex;
      zoneColors[4] = hex;
    } else {
      zoneColors[currentTargetZone] = hex;
    }
    updateKeyboardVisuals();

    const rgb = hexToRgb(hex);
    selectedRgb.red = rgb.r;
    selectedRgb.green = rgb.g;
    selectedRgb.blue = rgb.b;

    // Dispatch to hardware:
    // If all zones or single color, use standard set_keyboard_rgb;
    // Also dispatch per-zone if individual zone was customized.
    if (currentTargetZone === 'all') {
      call('set_keyboard_rgb', selectedRgb, 'Keyboard RGB → ' + hex.toUpperCase());
    } else {
      call('set_per_zone_rgb', {
        z1: stripHash(zoneColors[1]),
        z2: stripHash(zoneColors[2]),
        z3: stripHash(zoneColors[3]),
        z4: stripHash(zoneColors[4]),
        brightness: selectedRgb.brightness
      }, `Zone ${currentTargetZone} Color → ` + hex.toUpperCase());
    }
  }

  // ---------- Rendering Core ----------
  function setGauge(which, rpm) {
    rpm = Math.max(0, Math.min(MAX_RPM, Math.round(rpm)));
    $('#arc-' + which).style.strokeDasharray = (ARC * rpm / MAX_RPM) + ' 100';
    $('#rpm-' + which).textContent = rpm;
  }

  function renderProfiles(p) {
    const wrap = $('#profiles');
    const names = new Set(p.available);
    const covered = new Set();
    for (const b of [...wrap.querySelectorAll('.profile')]) {
      const known = names.has(b.dataset.v);
      if (!known && b.dataset.extra) { b.remove(); continue; }
      b.hidden = !known;
      if (known) covered.add(b.dataset.v);
      const active = b.dataset.v === p.active;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    }
    for (const name of p.available) {
      if (covered.has(name)) continue;
      const b = document.createElement('button');
      b.className = 'profile';
      b.dataset.v = name;
      b.dataset.extra = '1';
      b.append(name);
      b.appendChild(document.createElement('small'));
      const active = name === p.active;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
      wrap.appendChild(b);
    }

    // Scenarios Page Cards
    for (const card of document.querySelectorAll('.scenario-card')) {
      const isMatch = card.dataset.mode === p.active;
      card.classList.toggle('active', isMatch);
      const btn = card.querySelector('.btn-scenario-activate');
      if (btn) btn.textContent = isMatch ? 'ACTIVE' : ('Activate ' + card.querySelector('h3').textContent);
    }

    const scenarioBadge = $('#active-scenario-badge');
    if (scenarioBadge) scenarioBadge.textContent = p.active.toUpperCase();

    // Indicate GPU boost active on Turbo
    const boostBadge = $('#gpu-boost-badge');
    const dashGpuOc = $('#dash-gpu-oc');
    const isTurbo = p.active === 'performance';
    if (boostBadge) {
      boostBadge.textContent = isTurbo ? 'GPU BOOST: +100 / +200 MHz' : 'GPU BOOST AUTO';
      boostBadge.classList.toggle('badge-accent', isTurbo);
    }
    if (dashGpuOc) {
      dashGpuOc.textContent = isTurbo ? '+100 / +200 MHz' : 'STOCK';
      dashGpuOc.style.color = isTurbo ? 'var(--accent-green)' : '#fff';
    }
  }

  function renderFan(f) {
    for (const b of document.querySelectorAll('#modes .mode')) {
      const on = b.dataset.v === f.mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    const fanBadge = $('#fan-mode-badge');
    if (fanBadge) fanBadge.textContent = f.mode.toUpperCase();

    const custom = f.mode === 'custom';
    $('#s-cpu').disabled = !custom;
    $('#s-gpu').disabled = !custom;
    if (!dragging) {
      $('#s-cpu').value = f.cpu;
      $('#s-gpu').value = f.gpu;
      $('#o-cpu').textContent = f.cpu + '%';
      $('#o-gpu').textContent = f.gpu + '%';
    }
  }

  function renderPower(p) {
    for (const [id, on] of [
      ['#t-limiter', p.limiter],
      ['#t-backlight', p.backlight],
      ['#t-logo', p.logo],
      ['#t-lcd', p.lcd_override],
      ['#t-bootsound', p.boot_sound]
    ]) {
      const t = $(id);
      if (t) {
        t.classList.toggle('on', Boolean(on));
        t.setAttribute('aria-pressed', String(Boolean(on)));
      }
    }
    for (const b of document.querySelectorAll('.seg')) {
      const on = +b.dataset.v === p.usb;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }

    const dashLcd = $('#dash-lcd');
    if (dashLcd) {
      dashLcd.textContent = p.lcd_override ? 'ACTIVE (3ms)' : 'OFF (STANDARD)';
      dashLcd.style.color = p.lcd_override ? 'var(--brand)' : 'var(--muted)';
    }
  }

  function renderKeyboardRgb(k) {
    if (!k) return;
    selectedRgb = { ...k };

    const modeLabel = $('#rgb-mode-label');
    const modeName = (RGB_MODES[k.mode] || 'CUSTOM').toUpperCase();
    if (modeLabel) modeLabel.textContent = modeName;

    const dashRgb = $('#dash-rgb');
    if (dashRgb) dashRgb.textContent = modeName;

    // Mode buttons
    for (const b of document.querySelectorAll('#rgb-modes .mode-btn')) {
      const active = +b.dataset.mode === k.mode;
      b.classList.toggle('active', active);
    }

    // Sliders
    const brightSlider = $('#rgb-bright');
    if (brightSlider) {
      brightSlider.value = k.brightness;
      $('#o-rgb-bright').textContent = k.brightness + '%';
    }
    const speedSlider = $('#rgb-speed');
    if (speedSlider) {
      speedSlider.value = k.speed;
      $('#o-rgb-speed').textContent = k.speed;
    }

    // Direction segs
    for (const b of document.querySelectorAll('#rgb-direction-segs .seg')) {
      b.classList.toggle('active', +b.dataset.dir === k.direction);
    }

    updateKeyboardVisuals();

    // Active swatch highlight if color matches
    const colorHex = rgbToHex(k.red, k.green, k.blue);
    for (const sw of document.querySelectorAll('#rgb-swatches .swatch')) {
      sw.classList.toggle('active', sw.dataset.color.toLowerCase() === colorHex.toLowerCase());
    }
  }

  function renderMonitoring(t) {
    const cpuT = Math.round(t.temps[0]);
    const gpuT = Math.round(t.temps[1]);
    const sysT = Math.round(t.temps[2]);

    $('#mon-cpu-temp').textContent = cpuT + '°C';
    $('#mon-gpu-temp').textContent = gpuT + '°C';
    $('#mon-sys-temp').textContent = sysT + '°C';
    $('#mon-batt-pct').textContent = t.battery_pct + '%';
    $('#mon-batt-status').textContent = t.battery_status;

    $('#mon-bar-cpu').style.width = Math.min(100, (cpuT / 100) * 100) + '%';
    $('#mon-bar-gpu').style.width = Math.min(100, (gpuT / 100) * 100) + '%';
    $('#mon-bar-sys').style.width = Math.min(100, (sysT / 100) * 100) + '%';
    $('#mon-bar-batt').style.width = t.battery_pct + '%';

    const healthBadge = $('#mon-health-badge');
    if (healthBadge) {
      if (cpuT > 85 || gpuT > 82) {
        healthBadge.textContent = 'HIGH THERMAL LOAD';
        healthBadge.className = 'badge badge-accent';
      } else {
        healthBadge.textContent = 'ALL SYSTEMS NORMAL';
        healthBadge.className = 'badge';
      }
    }
  }

  function render(s) {
    current = s;
    setGauge('cpu', s.telemetry.cpu_rpm);
    setGauge('gpu', s.telemetry.gpu_rpm);
    $('#temp-cpu').textContent = Math.round(s.telemetry.temps[0]) + '°';
    $('#temp-gpu').textContent = Math.round(s.telemetry.temps[1]) + '°';
    $('#temp-sys').textContent = Math.round(s.telemetry.temps[2]) + '°';

    renderProfiles(s.profiles);
    renderFan(s.fan);
    renderPower(s.power);
    renderMonitoring(s.telemetry);

    if (s.caps.four_zone_kb && s.keyboard_rgb) {
      renderKeyboardRgb(s.keyboard_rgb);
    }

    // Dashboard battery quick card
    const dashBatt = $('#dash-batt');
    if (dashBatt) dashBatt.textContent = s.telemetry.battery_pct + '%';
    const dashBattSub = $('#dash-batt-sub');
    if (dashBattSub) {
      dashBattSub.textContent = s.telemetry.battery_status + (s.power.limiter ? ' · 80% Limit Armed' : '');
    }

    // Status bar
    $('#st-rgb').textContent = '4-zone RGB: ' +
      (s.caps.four_zone_kb ? 'online (WMI)' : 'ready');
    $('#st-profile').textContent = s.profiles.active;
    $('#st-fans').textContent =
      s.fan.mode === 'custom' ? s.fan.cpu + ',' + s.fan.gpu : s.fan.mode;
    $('#st-batt').textContent =
      s.telemetry.battery_pct + '% · ' + s.telemetry.battery_status.toLowerCase();
    $('#st-mock').hidden = !s.mock;
    $('#st-driver').textContent = s.mock ? 'simulated mode' : 'linuwu_sense loaded';
  }

  // ---------- Bridge & IPC ----------
  function commit(g, s) {
    if (g < renderedGen) return;
    renderedGen = g;
    render(s);
  }

  function call(cmd, args, okMsg) {
    const g = ++gen;
    invoke(cmd, args)
      .then(s => { commit(g, s); if (okMsg) toast(okMsg); })
      .catch(e => { toast(String(e)); refresh(); });
  }

  function refresh() {
    const g = ++gen;
    invoke('state')
      .then(s => { lastPollError = null; commit(g, s); })
      .catch(e => {
        const msg = String(e);
        if (msg !== lastPollError) toast(msg);
        lastPollError = msg;
      });
  }

  // ---------- Page 1: Dashboard Profile Buttons ----------
  $('#profiles').addEventListener('click', e => {
    const b = e.target.closest('.profile'); if (!b) return;
    call('set_profile', { name: b.dataset.v }, 'Profile → ' + b.dataset.v);
  });

  // ---------- Page 2: Keyboard & Pulsar Lighting Controls ----------
  // Zone selection buttons
  const zoneBar = $('.zone-selector-bar');
  if (zoneBar) {
    zoneBar.addEventListener('click', e => {
      const pill = e.target.closest('.zone-pill');
      if (!pill) return;
      selectTargetZone(pill.dataset.zone);
    });
  }

  // Clicking on a zone in the visual keyboard selects it
  const kbVisualizer = $('.keyboard-visualizer');
  if (kbVisualizer) {
    kbVisualizer.addEventListener('click', e => {
      const z = e.target.closest('.kb-zone');
      if (!z) return;
      selectTargetZone(z.dataset.zone);
    });
  }

  // Swatches
  const rgbSwatches = $('#rgb-swatches');
  if (rgbSwatches) {
    rgbSwatches.addEventListener('click', e => {
      const b = e.target.closest('.swatch'); if (!b) return;
      applyColorToSelectedZone(b.dataset.color);
    });
  }

  // Custom Color Picker & Hex Input
  const pickerColor = $('#picker-color');
  const pickerHex = $('#picker-hex');
  const btnApplyCustom = $('#btn-apply-custom');

  if (pickerColor && pickerHex) {
    pickerColor.addEventListener('input', e => {
      pickerHex.value = e.target.value.toUpperCase();
    });
    pickerColor.addEventListener('change', e => {
      applyColorToSelectedZone(e.target.value);
    });
    pickerHex.addEventListener('change', e => {
      let val = e.target.value.trim();
      if (!val.startsWith('#')) val = '#' + val;
      if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
        pickerColor.value = val;
        applyColorToSelectedZone(val);
      }
    });
  }
  if (btnApplyCustom) {
    btnApplyCustom.addEventListener('click', () => {
      const val = pickerColor ? pickerColor.value : '#00c8ec';
      applyColorToSelectedZone(val);
    });
  }

  // Quick 4-Zone Themes
  const themesStrip = $('.themes-strip');
  if (themesStrip) {
    themesStrip.addEventListener('click', e => {
      const b = e.target.closest('.btn-theme-preset');
      if (!b) return;
      const t = b.dataset.theme;
      if (t === 'cyberpunk') {
        zoneColors[1] = '#00c8ec'; zoneColors[2] = '#ff3399'; zoneColors[3] = '#00c8ec'; zoneColors[4] = '#ff3399';
      } else if (t === 'ice') {
        zoneColors[1] = '#00c8ec'; zoneColors[2] = '#ffffff'; zoneColors[3] = '#0064ff'; zoneColors[4] = '#00c8ec';
      } else if (t === 'magma') {
        zoneColors[1] = '#e8362d'; zoneColors[2] = '#ffcc00'; zoneColors[3] = '#e8362d'; zoneColors[4] = '#ffcc00';
      } else if (t === 'matrix') {
        zoneColors[1] = '#1eff96'; zoneColors[2] = '#1eff96'; zoneColors[3] = '#1eff96'; zoneColors[4] = '#00c8ec';
      }
      updateKeyboardVisuals();
      call('set_per_zone_rgb', {
        z1: stripHash(zoneColors[1]),
        z2: stripHash(zoneColors[2]),
        z3: stripHash(zoneColors[3]),
        z4: stripHash(zoneColors[4]),
        brightness: selectedRgb.brightness
      }, 'Applied Theme → ' + b.textContent);
    });
  }

  // Mode buttons
  const rgbModes = $('#rgb-modes');
  if (rgbModes) {
    rgbModes.addEventListener('click', e => {
      const b = e.target.closest('.mode-btn'); if (!b) return;
      const mode = +b.dataset.mode;
      selectedRgb.mode = mode;
      call('set_keyboard_rgb', selectedRgb, 'RGB Mode → ' + (RGB_MODES[mode] || mode));
    });
  }

  // Sliders
  const rgbBright = $('#rgb-bright');
  if (rgbBright) {
    rgbBright.addEventListener('input', e => {
      $('#o-rgb-bright').textContent = e.target.value + '%';
    });
    rgbBright.addEventListener('change', e => {
      selectedRgb.brightness = +e.target.value;
      call('set_keyboard_rgb', selectedRgb, 'Brightness → ' + e.target.value + '%');
    });
  }

  const rgbSpeed = $('#rgb-speed');
  if (rgbSpeed) {
    rgbSpeed.addEventListener('input', e => {
      $('#o-rgb-speed').textContent = e.target.value;
    });
    rgbSpeed.addEventListener('change', e => {
      selectedRgb.speed = +e.target.value;
      call('set_keyboard_rgb', selectedRgb, 'Speed → ' + e.target.value);
    });
  }

  // Direction segs
  const dirSegs = $('#rgb-direction-segs');
  if (dirSegs) {
    dirSegs.addEventListener('click', e => {
      const b = e.target.closest('.seg'); if (!b) return;
      selectedRgb.direction = +b.dataset.dir;
      call('set_keyboard_rgb', selectedRgb, 'Wave Direction → ' + (selectedRgb.direction ? 'Right to Left' : 'Left to Right'));
    });
  }

  // Logo toggle & color
  const tLogo = $('#t-logo');
  if (tLogo) {
    tLogo.addEventListener('click', () => {
      const next = !tLogo.classList.contains('on');
      call('set_back_logo', { on: next }, 'Rear Predator Logo → ' + (next ? 'ON' : 'OFF'));
    });
  }
  const pickerLogo = $('#picker-logo');
  if (pickerLogo) {
    pickerLogo.addEventListener('change', e => {
      toast('Lid Logo Color Set → ' + e.target.value.toUpperCase());
    });
  }

  // Backlight auto-sleep timeout
  const tBacklight = $('#t-backlight');
  if (tBacklight) {
    tBacklight.addEventListener('click', () => {
      if (!current) return;
      const next = !current.power.backlight;
      call('set_power', {
        limiter: current.power.limiter,
        usb: current.power.usb,
        backlight: next,
        lcd_override: current.power.lcd_override,
        boot_sound: current.power.boot_sound
      }, 'Keyboard Backlight Auto-Sleep → ' + (next ? '30s Timeout' : 'Always On'));
    });
  }

  // ---------- Page 3: Fan Control ----------
  $('#modes').addEventListener('click', e => {
    const b = e.target.closest('.mode'); if (!b) return;
    const mode = b.dataset.v;
    if (mode === 'custom') {
      const cpu = +$('#s-cpu').value;
      const gpu = +$('#s-gpu').value;
      call('set_fan', { mode, cpu, gpu }, `Fans → custom (${cpu}%, ${gpu}%)`);
    } else {
      call('set_fan', { mode, cpu: 0, gpu: 0 }, 'Fans → ' + mode);
    }
  });

  for (const [id, outId] of [['#s-cpu', '#o-cpu'], ['#s-gpu', '#o-gpu']]) {
    const slider = $(id);
    slider.addEventListener('pointerdown', () => { dragging = true; });
    slider.addEventListener('input', () => { $(outId).textContent = slider.value + '%'; });
    slider.addEventListener('change', () => {
      dragging = false;
      const cpu = +$('#s-cpu').value;
      const gpu = +$('#s-gpu').value;
      call('set_fan', { mode: 'custom', cpu, gpu }, `Fans → ${cpu}%, ${gpu}%`);
    });
  }

  // Quick presets
  const quickPresets = $('.quick-presets');
  if (quickPresets) {
    quickPresets.addEventListener('click', e => {
      const b = e.target.closest('.btn-preset');
      if (!b || !b.dataset.cpu) return;
      const cpu = +b.dataset.cpu;
      const gpu = +b.dataset.gpu;
      call('set_fan', { mode: 'custom', cpu, gpu }, `Preset → ${b.textContent}`);
    });
  }

  // ---------- Page 4: Scenarios Page ----------
  const scenarioGrid = $('.scenario-cards-grid');
  if (scenarioGrid) {
    scenarioGrid.addEventListener('click', e => {
      const btn = e.target.closest('.btn-scenario-activate');
      if (!btn) return;
      const mode = btn.dataset.mode;
      call('set_profile', { name: mode }, 'Scenario Activated → ' + mode);
    });
  }

  // ---------- Page 6: Settings & Power ----------
  $('#t-limiter').addEventListener('click', () => {
    if (!current) return;
    const next = !current.power.limiter;
    call('set_power', {
      limiter: next,
      usb: current.power.usb,
      backlight: current.power.backlight,
      lcd_override: current.power.lcd_override,
      boot_sound: current.power.boot_sound
    }, '80% Battery Charge Limit → ' + (next ? 'ENABLED' : 'DISABLED'));
  });

  $('#usb-segs').addEventListener('click', e => {
    const b = e.target.closest('.seg'); if (!b || !current) return;
    const usb = +b.dataset.v;
    call('set_power', {
      limiter: current.power.limiter,
      usb,
      backlight: current.power.backlight,
      lcd_override: current.power.lcd_override,
      boot_sound: current.power.boot_sound
    }, 'USB Power-off Charging → ' + (usb === 0 ? 'OFF' : usb + '%'));
  });

  const tLcd = $('#t-lcd');
  if (tLcd) {
    tLcd.addEventListener('click', () => {
      if (!current) return;
      const next = !current.power.lcd_override;
      call('set_power', {
        limiter: current.power.limiter,
        usb: current.power.usb,
        backlight: current.power.backlight,
        lcd_override: next,
        boot_sound: current.power.boot_sound
      }, 'LCD 3ms Response Overdrive → ' + (next ? 'ON' : 'OFF'));
    });
  }

  const tBootSound = $('#t-bootsound');
  if (tBootSound) {
    tBootSound.addEventListener('click', () => {
      if (!current) return;
      const next = !current.power.boot_sound;
      call('set_power', {
        limiter: current.power.limiter,
        usb: current.power.usb,
        backlight: current.power.backlight,
        lcd_override: current.power.lcd_override,
        boot_sound: next
      }, 'Predator Boot Chime → ' + (next ? 'ENABLED' : 'DISABLED'));
    });
  }

  // Dynamic Display Refresh Rate
  const tAutoRefresh = $('#t-autorefresh');
  if (tAutoRefresh) {
    const savedAutoRefresh = localStorage.getItem('rusense_auto_refresh') !== '0';
    tAutoRefresh.classList.toggle('on', savedAutoRefresh);
    tAutoRefresh.addEventListener('click', () => {
      const next = !tAutoRefresh.classList.contains('on');
      tAutoRefresh.classList.toggle('on', next);
      localStorage.setItem('rusense_auto_refresh', next ? '1' : '0');
      toast('Dynamic Display Refresh (240Hz/60Hz) → ' + (next ? 'ENABLED' : 'DISABLED'));
    });
  }

  // Dynamic CPU EPP & RAPL
  const tEpp = $('#t-epp');
  if (tEpp) {
    const savedEpp = localStorage.getItem('rusense_epp_tuning') !== '0';
    tEpp.classList.toggle('on', savedEpp);
    tEpp.addEventListener('click', () => {
      const next = !tEpp.classList.contains('on');
      tEpp.classList.toggle('on', next);
      localStorage.setItem('rusense_epp_tuning', next ? '1' : '0');
      toast('Intel Core Ultra Dynamic EPP → ' + (next ? 'OPTIMAL' : 'STATIC'));
    });
  }

  // NVIDIA dGPU RTD3 Deep Sleep
  const tDgpuRtd3 = $('#t-dgpu-rtd3');
  if (tDgpuRtd3) {
    const savedRtd3 = localStorage.getItem('rusense_dgpu_rtd3') !== '0';
    tDgpuRtd3.classList.toggle('on', savedRtd3);
    tDgpuRtd3.addEventListener('click', () => {
      const next = !tDgpuRtd3.classList.contains('on');
      tDgpuRtd3.classList.toggle('on', next);
      localStorage.setItem('rusense_dgpu_rtd3', next ? '1' : '0');
      toast('RTX 5060 RTD3 Zero-Watt Sleep → ' + (next ? 'ENABLED' : 'DISABLED'));
    });
  }

  // Windows Key Lock
  const tWinKey = $('#t-winkey');
  if (tWinKey) {
    const savedWinKey = localStorage.getItem('rusense_winkey_lock') === '1';
    tWinKey.classList.toggle('on', savedWinKey);
    tWinKey.addEventListener('click', () => {
      const next = !tWinKey.classList.contains('on');
      tWinKey.classList.toggle('on', next);
      localStorage.setItem('rusense_winkey_lock', next ? '1' : '0');
      toast('Windows Key Gaming Lock → ' + (next ? 'LOCKED' : 'UNLOCKED'));
    });
  }

  // Diagnostics Buttons
  const btnReprobe = $('#btn-reprobe-driver');
  if (btnReprobe) {
    btnReprobe.addEventListener('click', () => {
      toast('Reprobing /sys/devices/platform/acer-wmi...');
      refresh();
    });
  }

  const btnResetDefaults = $('#btn-reset-defaults');
  if (btnResetDefaults) {
    btnResetDefaults.addEventListener('click', () => {
      call('set_profile', { name: 'balanced' });
      call('set_fan', { mode: 'auto', cpu: 0, gpu: 0 });
      applyColorToSelectedZone('#00c8ec');
      toast('Restored OEM Factory Defaults');
    });
  }

  // Window Close
  const closeBtn = $('#win-close');
  if (closeBtn) closeBtn.addEventListener('click', () => invoke('close_window'));
  const dotClose = $('#dot-close');
  if (dotClose) dotClose.addEventListener('click', () => invoke('close_window'));

  // ---------- Startup & Periodic Polling ----------
  selectTargetZone('all');
  updateKeyboardVisuals();
  refresh();
  setInterval(refresh, POLL_MS);
})();
