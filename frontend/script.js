/**
 * Bus Crowd Detection — script.js  v3
 * ════════════════════════════════════════════════════════════
 * Features:
 *  1. Line chart  — passenger history, last 20s, color-coded
 *  2. Bar chart   — entry vs exit, real-time
 *  3. Trip summary — start time, duration, peak, boarded
 *  4. Confirm modal for reset
 *  5. Audio alarm  — Web Audio API beeps on BUS FULL
 *  6. Passenger view panel — seats available / bus full
 *  7. Fullscreen gauge overlay
 *  8. Dark / light mode toggle
 *  9. Professional particle canvas, spring animations
 * ════════════════════════════════════════════════════════════
 */

// ── Config ────────────────────────────────────────────────────
const WS_URL = 'ws://localhost:3000';
const MAX_FEED = 50;
const WARN_PCT = 0.70;
const GAUGE_CIRC = 596.9;   // 2π × 95
const FS_CIRC = 753.98;  // 2π × 120
const GAUGE_CX = 120;
const GAUGE_CY = 120;
const GAUGE_R = 95;
const FS_CX = 150;
const FS_CY = 150;
const FS_R = 120;
const HISTORY_MAX = 20;

// ── Shared State ──────────────────────────────────────────────
const state = {
  count: 0, capacity: 45,
  totalIn: 0, totalOut: 0,
  isFull: false, overlayShown: false,
  ws: null, wsReady: false,
  // Gauge animation
  gaugeCurrent: 0, rafId: null,
  // History for line chart
  history: [],          // [{pct, count}]
  // Trip
  tripStartTime: Date.now(),
  tripPeak: 0,
  tripBoarded: 0,
  // Audio
  audioCtx: null,
  beepTimer: null,
  isMuted: false,
  // Theme
  isDark: true,
};

// ── DOM Cache ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const dom = {
  currentCount: $('currentCount'),
  totalEntered: $('totalEntered'),
  totalExited: $('totalExited'),
  busCapacity: $('busCapacity'),
  busCapacityLabel: $('busCapacityLabel'),
  seatsAvailable: $('seatsAvailable'),
  gaugeProgress: $('gaugeProgress'),
  gaugeGlowArc: $('gaugeGlowArc'),
  gaugeTip: $('gaugeTip'),
  gaugeSvg: $('gaugeSvg'),
  gaugeCapacity: $('gaugeCapacity'),
  gaugePercent: $('gaugePercent'),
  progressFill: $('progressFill'),
  progressLabel: $('progressLabel'),
  fullAlert: $('fullAlert'),
  fullOverlay: $('fullOverlay'),
  statusBadge: $('statusBadge'),
  statusBadgeText: $('statusBadgeText'),
  loadBarFill: $('loadBarFill'),
  loadPercent: $('loadPercent'),
  eventFeed: $('eventFeed'),
  statusDot: $('statusDot'),
  statusText: $('statusText'),
  currentTime: $('currentTime'),
  countCard: $('countCard'),
  clearFeedBtn: $('clearFeedBtn'),
  setCapacityBtn: $('setCapacityBtn'),
  capacityInput: $('capacityInput'),
  resetBtn: $('resetBtn'),
  simEnterBtn: $('simEnterBtn'),
  simExitBtn: $('simExitBtn'),
  dismissOverlay: $('dismissOverlay'),
  particleCanvas: $('particleCanvas'),
  lineChartCanvas: $('lineChartCanvas'),
  barChartCanvas: $('barChartCanvas'),
  // Passenger panel
  passengerPanel: $('passengerPanel'),
  pvInner: $('pvInner'),
  pvIcon: $('pvIcon'),
  pvStatus: $('pvStatus'),
  pvDetail: $('pvDetail'),
  // Trip
  tripStart: $('tripStart'),
  tripDuration: $('tripDuration'),
  tripPeak: $('tripPeak'),
  tripBoarded: $('tripBoarded'),
  resetTripBtn: $('resetTripBtn'),
  // Confirm modal
  confirmModal: $('confirmModal'),
  confirmYes: $('confirmYes'),
  confirmNo: $('confirmNo'),
  // Fullscreen
  fsOverlay: $('fsOverlay'),
  fsBtn: $('fsBtn'),
  fsClose: $('fsClose'),
  fsCount: $('fsCount'),
  fsCap: $('fsCap'),
  fsPct: $('fsPct'),
  fsStatusBadge: $('fsStatusBadge'),
  fsFullMsg: $('fsFullMsg'),
  fsGaugeArc: $('fsGaugeArc'),
  fsGaugeGlow: $('fsGaugeGlow'),
  fsGaugeTip: $('fsGaugeTip'),
  // Header buttons
  muteBtn: $('muteBtn'),
  themeBtn: $('themeBtn'),
};

// ════════════════════════════════════════════════════════════
//  PARTICLE CANVAS BACKGROUND
// ════════════════════════════════════════════════════════════
const canvas = dom.particleCanvas;
const ctx = canvas.getContext('2d');
let particles = [];

function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }

function spawnParticles(n = 80) {
  for (let i = 0; i < n; i++) {
    particles.push({
      x: Math.random() * canvas.width, y: Math.random() * canvas.height,
      r: Math.random() * 1.1 + 0.3,
      vx: (Math.random() - 0.5) * 0.28, vy: (Math.random() - 0.5) * 0.28,
      alpha: Math.random() * 0.45 + 0.08,
    });
  }
}

function burstAt(x, y, color = '#00f5a0', n = 20) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const s = Math.random() * 3 + 0.8;
    particles.push({ x, y, r: Math.random() * 2.5 + 0.8, vx: Math.cos(a) * s, vy: Math.sin(a) * s, alpha: 0.9, color, burst: true, life: 1 });
  }
}

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function animateParticles() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles = particles.filter(p => !p.burst || p.life > 0);
  particles.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = p.burst ? hexToRgba(p.color, p.alpha * p.life) : `rgba(160,185,255,${p.alpha})`;
    ctx.fill();
    p.x += p.vx; p.y += p.vy;
    if (p.burst) { p.life -= 0.04; p.vx *= 0.94; p.vy *= 0.94; }
    else {
      if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0;
      if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;
    }
  });
  requestAnimationFrame(animateParticles);
}

resizeCanvas(); spawnParticles(80); animateParticles();
window.addEventListener('resize', resizeCanvas);

// ════════════════════════════════════════════════════════════
//  GAUGE TICK MARKS
// ════════════════════════════════════════════════════════════
function buildGaugeTicks() {
  const g = $('gaugeTicks');
  if (!g) return;
  for (let i = 0; i <= 40; i++) {
    const angle = ((i / 40) * 360 - 90) * (Math.PI / 180);
    const isMaj = i % 5 === 0;
    const r1 = GAUGE_R + 5, r2 = r1 + (isMaj ? 9 : 5);
    const x1 = GAUGE_CX + r1 * Math.cos(angle), y1 = GAUGE_CY + r1 * Math.sin(angle);
    const x2 = GAUGE_CX + r2 * Math.cos(angle), y2 = GAUGE_CY + r2 * Math.sin(angle);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('stroke', isMaj ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)');
    line.setAttribute('stroke-width', isMaj ? '2' : '1');
    line.setAttribute('stroke-linecap', 'round');
    g.appendChild(line);
  }
}

// ════════════════════════════════════════════════════════════
//  SMOOTH GAUGE ANIMATION (rAF + easeOutElastic)
// ════════════════════════════════════════════════════════════
function animateGaugeTo(targetPct) {
  if (state.rafId) cancelAnimationFrame(state.rafId);
  const start = state.gaugeCurrent, diff = targetPct - start;
  const dur = 900, t0 = performance.now();

  function easeOutElastic(t) {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  }

  (function step(now) {
    const el = Math.min((now - t0) / dur, 1);
    const cur = start + diff * easeOutElastic(el);
    applyGaugePct(cur, GAUGE_CX, GAUGE_CY, GAUGE_R, GAUGE_CIRC,
      dom.gaugeProgress, dom.gaugeGlowArc, dom.gaugeTip,
      'gradSafe', 'gradWarn', 'gradDanger');
    if (el < 1) state.rafId = requestAnimationFrame(step);
    else { state.gaugeCurrent = targetPct; state.rafId = null; }
  })(t0);
}

function applyGaugePct(pct, cx, cy, r, circ, arcEl, glowEl, tipEl, gSafe, gWarn, gDanger) {
  const off = circ - pct * circ;
  arcEl.style.strokeDashoffset = off;
  glowEl.style.strokeDashoffset = off;

  const angle = (pct * 360 - 90) * (Math.PI / 180);
  tipEl.setAttribute('cx', cx + r * Math.cos(angle));
  tipEl.setAttribute('cy', cy + r * Math.sin(angle));
  tipEl.style.opacity = pct < 0.01 ? '0' : '1';

  const isFull = pct >= 1, isWarn = !isFull && pct >= WARN_PCT;
  arcEl.setAttribute('stroke', isFull ? `url(#${gDanger})` : isWarn ? `url(#${gWarn})` : `url(#${gSafe})`);
  glowEl.style.stroke = tipEl.style.fill = isFull ? '#ff4d6d' : isWarn ? '#fbbf24' : '#00f5a0';
}

// Fullscreen gauge sync
function syncFsGauge(pct) {
  applyGaugePct(pct, FS_CX, FS_CY, FS_R, FS_CIRC,
    dom.fsGaugeArc, dom.fsGaugeGlow, dom.fsGaugeTip,
    'fsGradSafe', 'fsGradWarn', 'fsGradDanger');
}

// ════════════════════════════════════════════════════════════
//  NUMBER ANIMATION
// ════════════════════════════════════════════════════════════
function animateNumber(el, target) {
  const from = parseInt(el.textContent, 10) || 0;
  if (from === target) return;
  const diff = target - from, dur = 550, t0 = performance.now();
  const ease = t => 1 - Math.pow(1 - t, 4);
  (function tick(now) {
    const t = Math.min((now - t0) / dur, 1);
    el.textContent = Math.round(from + diff * ease(t));
    if (t < 1) requestAnimationFrame(tick);
    else { el.textContent = target; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  })(t0);
}

// ════════════════════════════════════════════════════════════
//  LINE CHART
// ════════════════════════════════════════════════════════════
function drawLineChart() {
  const canvas = dom.lineChartCanvas;
  if (!canvas) return;
  const W = canvas.offsetWidth || 400;
  const H = 88;
  canvas.width = W * (window.devicePixelRatio || 1);
  canvas.height = H * (window.devicePixelRatio || 1);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const c = canvas.getContext('2d');
  c.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  c.clearRect(0, 0, W, H);

  const data = state.history;
  if (data.length < 2) {
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.font = '11px Outfit, sans-serif';
    c.textAlign = 'center';
    c.fillText('Collecting data…', W / 2, H / 2 + 4);
    return;
  }

  const padL = 30, padR = 8, padT = 8, padB = 18;
  const chartW = W - padL - padR, chartH = H - padT - padB;

  // Grid lines
  c.strokeStyle = 'rgba(255,255,255,0.05)';
  c.lineWidth = 1;
  [0, 0.25, 0.5, 0.75, 1].forEach(frac => {
    const y = padT + chartH * (1 - frac);
    c.beginPath(); c.moveTo(padL, y); c.lineTo(padL + chartW, y); c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.25)';
    c.font = '9px JetBrains Mono, monospace';
    c.textAlign = 'right';
    c.fillText(Math.round(frac * state.capacity), padL - 4, y + 3);
  });

  // Build points
  const pts = data.map((d, i) => ({
    x: padL + (i / (HISTORY_MAX - 1)) * chartW,
    y: padT + chartH * (1 - Math.min(d.pct, 1)),
    pct: d.pct,
  }));

  // Area fill (gradient)
  const lastPct = data[data.length - 1].pct;
  const fillColor = lastPct >= 1 ? '#ff4d6d' : lastPct >= WARN_PCT ? '#fbbf24' : '#00f5a0';
  const grad = c.createLinearGradient(0, padT, 0, padT + chartH);
  grad.addColorStop(0, hexToRgba(fillColor, 0.25));
  grad.addColorStop(1, hexToRgba(fillColor, 0.02));

  c.beginPath();
  c.moveTo(pts[0].x, padT + chartH);
  pts.forEach(p => c.lineTo(p.x, p.y));
  c.lineTo(pts[pts.length - 1].x, padT + chartH);
  c.closePath();
  c.fillStyle = grad;
  c.fill();

  // Line segments (color per segment)
  c.lineWidth = 2;
  c.lineJoin = 'round';
  for (let i = 1; i < pts.length; i++) {
    const segPct = pts[i].pct;
    c.strokeStyle = segPct >= 1 ? '#ff4d6d' : segPct >= WARN_PCT ? '#fbbf24' : '#00f5a0';
    c.beginPath();
    c.moveTo(pts[i - 1].x, pts[i - 1].y);
    c.lineTo(pts[i].x, pts[i].y);
    c.stroke();
  }

  // Data dots (last point only)
  const last = pts[pts.length - 1];
  c.beginPath();
  c.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
  c.fillStyle = fillColor;
  c.fill();

  // X-axis label
  c.fillStyle = 'rgba(255,255,255,0.25)';
  c.font = '9px Outfit, sans-serif';
  c.textAlign = 'left';
  c.fillText('20s ago', padL, H - 3);
  c.textAlign = 'right';
  c.fillText('now', W - padR, H - 3);
}

// ════════════════════════════════════════════════════════════
//  BAR CHART
// ════════════════════════════════════════════════════════════
function drawBarChart() {
  const canvas = dom.barChartCanvas;
  if (!canvas) return;
  const W = canvas.offsetWidth || 340;
  const H = 105;
  canvas.width = W * (window.devicePixelRatio || 1);
  canvas.height = H * (window.devicePixelRatio || 1);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const c = canvas.getContext('2d');
  c.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  c.clearRect(0, 0, W, H);

  const { totalIn, totalOut } = state;
  const maxVal = Math.max(totalIn, totalOut, 1);
  const padB = 22, padT = 10, chartH = H - padB - padT;
  const barW = W * 0.22, gap = W * 0.06;
  const startX = (W - 2 * barW - gap) / 2;

  function drawBar(x, val, color, label, value) {
    const barH = (val / maxVal) * chartH;
    const y = padT + chartH - barH;

    // Shadow glow
    c.shadowColor = color; c.shadowBlur = 12;
    // Bar body
    const grd = c.createLinearGradient(x, y, x, y + barH);
    grd.addColorStop(0, color);
    grd.addColorStop(1, hexToRgba(color, 0.4));
    roundRect(c, x, y, barW, barH, 6);
    c.fillStyle = grd; c.fill();
    c.shadowBlur = 0;

    // Value label
    c.fillStyle = color;
    c.font = 'bold 13px Outfit, sans-serif';
    c.textAlign = 'center';
    c.fillText(value, x + barW / 2, y - 5);

    // X label
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.font = '10px Outfit, sans-serif';
    c.fillText(label, x + barW / 2, H - 5);
  }

  // Background bars
  c.fillStyle = 'rgba(255,255,255,0.04)';
  roundRect(c, startX, padT, barW, chartH, 6); c.fill();
  roundRect(c, startX + barW + gap, padT, barW, chartH, 6); c.fill();

  drawBar(startX, totalIn, '#00f5a0', 'Entries', totalIn);
  drawBar(startX + barW + gap, totalOut, '#ff4d6d', 'Exits', totalOut);
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h); c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r);
  c.closePath();
}

// ════════════════════════════════════════════════════════════
//  HISTORY SAMPLER
// ════════════════════════════════════════════════════════════
function sampleHistory() {
  const pct = state.capacity > 0 ? state.count / state.capacity : 0;
  state.history.push({ pct, count: state.count });
  if (state.history.length > HISTORY_MAX) state.history.shift();
  drawLineChart();
}
setInterval(sampleHistory, 1000);

// ════════════════════════════════════════════════════════════
//  TRIP SUMMARY
// ════════════════════════════════════════════════════════════
function startTrip() {
  state.tripStartTime = Date.now();
  state.tripPeak = 0;
  state.tripBoarded = 0;
  dom.tripStart.textContent = new Date().toLocaleTimeString('en-IN', { hour12: false });
}

function updateTripUI() {
  const elapsed = Math.floor((Date.now() - state.tripStartTime) / 1000);
  const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  dom.tripDuration.textContent = `${h}:${m}:${s}`;

  if (state.count > state.tripPeak) state.tripPeak = state.count;
  dom.tripPeak.textContent = state.tripPeak;
  dom.tripBoarded.textContent = state.totalIn;
}
setInterval(updateTripUI, 1000);

// ════════════════════════════════════════════════════════════
//  AUDIO — Web Audio API beep alarm
// ════════════════════════════════════════════════════════════
function ensureAudioCtx() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
}

function playBeep() {
  if (state.isMuted) return;
  ensureAudioCtx();
  const ctx = state.audioCtx;

  const frequencies = [880, 1100, 880, 0, 1100]; // pattern
  let offset = 0;
  frequencies.forEach((freq) => {
    if (freq === 0) { offset += 0.12; return; }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ctx.currentTime + offset);
    gain.gain.linearRampToValueAtTime(0.28, ctx.currentTime + offset + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.22);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(ctx.currentTime + offset);
    osc.stop(ctx.currentTime + offset + 0.25);
    offset += 0.26;
  });
}

function startAlarm() {
  if (state.beepTimer) return;
  playBeep();
  state.beepTimer = setInterval(playBeep, 2500);
}

function stopAlarm() {
  clearInterval(state.beepTimer);
  state.beepTimer = null;
}

function toggleMute() {
  state.isMuted = !state.isMuted;
  dom.muteBtn.textContent = state.isMuted ? '🔕' : '🔔';
  dom.muteBtn.classList.toggle('muted', state.isMuted);
  if (state.isMuted) stopAlarm();
  else if (state.isFull) startAlarm();
}

// SVG icons for passenger panel — professional stroke style
const PV_ICON_AVAILABLE = `<svg class="pv-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="24" cy="24" r="22" stroke="currentColor" stroke-width="2.5"/>
  <polyline points="14,24 21,31 34,16" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const PV_ICON_FULL = `<svg class="pv-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="24" cy="24" r="22" stroke="currentColor" stroke-width="2.5"/>
  <line x1="15" y1="15" x2="33" y2="33" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
  <line x1="33" y1="15" x2="15" y2="33" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
</svg>`;

// ════════════════════════════════════════════════════════════
//  PASSENGER VIEW PANEL
// ════════════════════════════════════════════════════════════
function updatePassengerView() {
  const avail = Math.max(state.capacity - state.count, 0);
  const isFull = state.count >= state.capacity;

  dom.passengerPanel.classList.toggle('pv-full', isFull);
  dom.passengerPanel.classList.toggle('pv-available', !isFull);
  dom.pvIcon.innerHTML = isFull ? PV_ICON_FULL : PV_ICON_AVAILABLE;
  dom.pvStatus.style.color = isFull ? 'var(--danger)' : 'var(--safe)';
  dom.pvStatus.style.textShadow = isFull
    ? '0 0 20px rgba(255,77,109,0.6)' : '0 0 20px rgba(0,245,160,0.5)';

  if (isFull) {
    dom.pvStatus.textContent = 'BUS FULL';
    dom.pvDetail.textContent = 'Please wait for the next bus';
  } else {
    dom.pvStatus.textContent = 'SEATS AVAILABLE';
    dom.pvDetail.textContent = `${avail} seat${avail !== 1 ? 's' : ''} remaining — Boarding open`;
  }
}

// ════════════════════════════════════════════════════════════
//  FULLSCREEN OVERLAY
// ════════════════════════════════════════════════════════════
function openFullscreen() {
  dom.fsOverlay.classList.add('visible');
  syncFsOverlay();
  if (dom.fsOverlay.requestFullscreen) dom.fsOverlay.requestFullscreen().catch(() => { });
}

function closeFullscreen() {
  dom.fsOverlay.classList.remove('visible');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
}

function syncFsOverlay() {
  const pct = state.capacity > 0 ? Math.min(state.count / state.capacity, 1) : 0;
  const isFull = state.count >= state.capacity;
  const isWarn = !isFull && pct >= WARN_PCT;

  dom.fsCount.textContent = state.count;
  dom.fsCap.textContent = state.capacity;
  dom.fsPct.textContent = Math.round(pct * 100) + '%';

  dom.fsStatusBadge.className = 'fs-status-badge' + (isFull ? ' full' : isWarn ? ' warning' : '');
  dom.fsStatusBadge.textContent = isFull ? 'BUS FULL' : isWarn ? 'ALMOST FULL' : 'NORMAL';

  dom.fsFullMsg.classList.toggle('visible', isFull);
  syncFsGauge(pct);
}

// ════════════════════════════════════════════════════════════
//  THEME TOGGLE (dark / light)
// ════════════════════════════════════════════════════════════
function initTheme() {
  const saved = localStorage.getItem('bcd-theme') || 'dark';
  setTheme(saved);
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.isDark = theme === 'dark';
  dom.themeBtn.textContent = state.isDark ? '🌙' : '☀️';
  localStorage.setItem('bcd-theme', theme);
}

function toggleTheme() {
  setTheme(state.isDark ? 'light' : 'dark');
}

// ════════════════════════════════════════════════════════════
//  CORE UI RENDER
// ════════════════════════════════════════════════════════════
function updateUI() {
  const { count, capacity, totalIn, totalOut } = state;
  const pct = capacity > 0 ? Math.min(count / capacity, 1) : 0;
  const pctStr = Math.round(pct * 100) + '%';
  const avail = Math.max(capacity - count, 0);
  const isFull = count >= capacity;
  const isWarn = !isFull && pct >= WARN_PCT;

  // Numbers
  animateNumber(dom.currentCount, count);
  animateNumber(dom.totalEntered, totalIn);
  animateNumber(dom.totalExited, totalOut);
  animateNumber(dom.seatsAvailable, avail);
  dom.busCapacity.textContent = capacity;
  dom.busCapacityLabel.textContent = capacity;
  dom.gaugeCapacity.textContent = capacity;
  dom.gaugePercent.textContent = pctStr;
  dom.progressLabel.textContent = `${count} / ${capacity} passengers`;

  // Gauge
  animateGaugeTo(pct);
  dom.gaugeSvg.classList.toggle('gauge-full', isFull);
  dom.gaugeSvg.classList.toggle('gauge-warn', isWarn);

  // Progress bar
  dom.progressFill.style.width = pctStr;
  dom.progressFill.classList.toggle('warn-state', isWarn);
  dom.progressFill.classList.toggle('full-state', isFull);

  // Load bar
  dom.loadBarFill.style.width = pctStr;
  dom.loadBarFill.classList.toggle('warn-state', isWarn);
  dom.loadBarFill.classList.toggle('full-state', isFull);
  dom.loadPercent.textContent = pctStr;
  dom.loadPercent.style.color = isFull ? 'var(--danger)' : isWarn ? 'var(--warn)' : 'var(--safe)';

  // Status badge
  dom.statusBadge.className = 'bus-status-badge' + (isFull ? ' full' : isWarn ? ' warning' : '');
  dom.statusBadgeText.textContent = isFull ? 'BUS FULL' : isWarn ? 'ALMOST FULL' : 'NORMAL';
  dom.countCard.classList.toggle('state-warning', isWarn);
  dom.countCard.classList.toggle('state-full', isFull);

  // In-card alert
  dom.fullAlert.classList.toggle('visible', isFull);

  // BUS FULL popup overlay (once)
  if (isFull && !state.overlayShown) {
    state.overlayShown = true;
    dom.fullOverlay.classList.add('visible');
    startAlarm();
  }
  if (!isFull) {
    state.overlayShown = false;
    dom.fullOverlay.classList.remove('visible');
    stopAlarm();
  }
  state.isFull = isFull;

  // Passenger view
  updatePassengerView();

  // Fullscreen sync (if open)
  if (dom.fsOverlay.classList.contains('visible')) syncFsOverlay();

  // Charts
  drawBarChart();
}

// ════════════════════════════════════════════════════════════
//  ACTIONS
// ════════════════════════════════════════════════════════════
function doEnter() {
  if (state.count >= state.capacity) { addFeedItem('⛔ Entry blocked — Bus full!', '', 'full'); return; }
  state.count++; state.totalIn++;
  addFeedItem('👤 Passenger entered', `Count: ${state.count}`, 'enter');
  triggerBurst('enter'); updateUI();
}

function doExit() {
  if (state.count <= 0) { addFeedItem('ℹ️ No passengers to exit', '', 'exit'); return; }
  state.count--; state.totalOut++;
  addFeedItem('🚶 Passenger exited', `Count: ${state.count}`, 'exit');
  triggerBurst('exit'); updateUI();
}

function doReset() {
  state.count = 0; state.totalIn = 0; state.totalOut = 0;
  state.isFull = false; state.overlayShown = false;
  stopAlarm();
  addFeedItem('🔄 Count reset', 'Route ended', 'reset');
  updateUI();
}

function triggerBurst(type) {
  const rect = dom.gaugeSvg.getBoundingClientRect();
  burstAt(rect.left + rect.width / 2, rect.top + rect.height / 2,
    type === 'enter' ? '#00f5a0' : '#ff4d6d', 22);
}

// ════════════════════════════════════════════════════════════
//  EVENT FEED
// ════════════════════════════════════════════════════════════
function addFeedItem(msg, detail, type = 'enter') {
  const empty = dom.eventFeed.querySelector('.feed-empty');
  if (empty) empty.remove();
  const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const el = document.createElement('div');
  el.className = `feed-item ${type}`;
  el.innerHTML = `<div class="feed-dot"></div><span class="feed-msg">${msg}${detail ? ` <span style="opacity:.4;font-size:.68rem">${detail}</span>` : ''}</span><span class="feed-time">${time}</span>`;
  dom.eventFeed.prepend(el);
  const items = dom.eventFeed.querySelectorAll('.feed-item');
  if (items.length > MAX_FEED) items[items.length - 1].remove();
}

// ════════════════════════════════════════════════════════════
//  WEBSOCKET
// ════════════════════════════════════════════════════════════
function connectWebSocket() {
  setWsStatus('connecting');
  try { state.ws = new WebSocket(WS_URL); } catch { setWsStatus('disconnected'); return; }

  state.ws.onopen = () => { state.wsReady = true; setWsStatus('connected'); addFeedItem('✅ Connected to backend', '', 'reset'); };
  state.ws.onclose = () => { state.wsReady = false; setWsStatus('disconnected'); addFeedItem('⚠ Connection lost. Reconnecting…', '', 'full'); setTimeout(connectWebSocket, 4000); };
  state.ws.onerror = () => setWsStatus('disconnected');
  state.ws.onmessage = ({ data }) => {
    try { handleServerMsg(JSON.parse(data)); } catch { }
  };
}

function handleServerMsg(msg) {
  const sync = d => {
    if (d.count != null) state.count = d.count;
    if (d.capacity != null) state.capacity = d.capacity;
    if (d.totalIn != null) state.totalIn = d.totalIn;
    if (d.totalOut != null) state.totalOut = d.totalOut;
  };
  switch (msg.type) {
    case 'enter': sync(msg); addFeedItem('👤 Entered', `Count: ${msg.count}`, 'enter'); triggerBurst('enter'); updateUI(); break;
    case 'exit': sync(msg); addFeedItem('🚶 Exited', `Count: ${msg.count}`, 'exit'); triggerBurst('exit'); updateUI(); break;
    case 'full': addFeedItem('🚫 BUS FULL (hardware)', '', 'full'); updateUI(); break;
    case 'reset': state.count = 0; state.totalIn = 0; state.totalOut = 0; addFeedItem('🔄 Reset by hardware', '', 'reset'); updateUI(); break;
    case 'status': sync(msg); updateUI(); break;
  }
}

function setWsStatus(s) {
  dom.statusDot.className = 'status-dot';
  if (s === 'connected') { dom.statusDot.classList.add('connected'); dom.statusText.textContent = 'Hardware Connected'; }
  else if (s === 'disconnected') { dom.statusDot.classList.add('disconnected'); dom.statusText.textContent = 'Disconnected'; }
  else { dom.statusText.textContent = 'Connecting…'; }
}

// ════════════════════════════════════════════════════════════
//  BUTTON RIPPLE
// ════════════════════════════════════════════════════════════
function addRipple(btn, e) {
  const r = btn.getBoundingClientRect(), size = Math.max(r.width, r.height);
  const x = e.clientX - r.left - size / 2, y = e.clientY - r.top - size / 2;
  const rEl = document.createElement('span');
  rEl.className = 'ripple';
  rEl.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px`;
  btn.appendChild(rEl);
  rEl.addEventListener('animationend', () => rEl.remove());
}

// ════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ════════════════════════════════════════════════════════════

// Ripple on all control buttons
[dom.setCapacityBtn, dom.resetBtn, dom.simEnterBtn, dom.simExitBtn,
dom.dismissOverlay, dom.confirmYes, dom.confirmNo, dom.resetTripBtn]
  .forEach(btn => btn?.addEventListener('click', e => addRipple(btn, e)));

// Clear feed
dom.clearFeedBtn.addEventListener('click', () => {
  dom.eventFeed.innerHTML = '<div class="feed-empty">Feed cleared.</div>';
});

// Set capacity
dom.setCapacityBtn.addEventListener('click', () => {
  const v = parseInt(dom.capacityInput.value, 10);
  if (isNaN(v) || v < 1) { alert('Enter a valid capacity (min 1).'); return; }
  state.capacity = v;
  addFeedItem(`⚙ Capacity set to ${v}`, '', 'reset');
  if (state.wsReady) state.ws.send(JSON.stringify({ type: 'setCapacity', value: v }));
  updateUI();
});
dom.capacityInput.addEventListener('keydown', e => { if (e.key === 'Enter') dom.setCapacityBtn.click(); });

// Reset count — shows confirm modal
dom.resetBtn.addEventListener('click', () => {
  dom.confirmModal.classList.add('visible');
});
dom.confirmYes.addEventListener('click', () => {
  dom.confirmModal.classList.remove('visible');
  if (state.wsReady) state.ws.send(JSON.stringify({ type: 'reset' }));
  else doReset();
});
dom.confirmNo.addEventListener('click', () => dom.confirmModal.classList.remove('visible'));
dom.confirmModal.addEventListener('click', e => { if (e.target === dom.confirmModal) dom.confirmModal.classList.remove('visible'); });

// Simulate
dom.simEnterBtn.addEventListener('click', () => {
  if (state.wsReady) state.ws.send(JSON.stringify({ type: 'simulateEnter' }));
  else doEnter();
});
dom.simExitBtn.addEventListener('click', () => {
  if (state.wsReady) state.ws.send(JSON.stringify({ type: 'simulateExit' }));
  else doExit();
});

// Reset trip (new trip)
dom.resetTripBtn.addEventListener('click', () => {
  startTrip();
  addFeedItem('🔁 New trip started', '', 'reset');
});

// Dismiss full overlay
dom.dismissOverlay.addEventListener('click', () => dom.fullOverlay.classList.remove('visible'));
dom.fullOverlay.addEventListener('click', e => { if (e.target === dom.fullOverlay) dom.fullOverlay.classList.remove('visible'); });

// Mute
dom.muteBtn.addEventListener('click', toggleMute);

// Fullscreen
dom.fsBtn.addEventListener('click', openFullscreen);
dom.fsClose.addEventListener('click', closeFullscreen);
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) dom.fsOverlay.classList.remove('visible'); });

// Theme toggle
dom.themeBtn.addEventListener('click', toggleTheme);

// ── Clock ─────────────────────────────────────────────────────
; (function clock() {
  dom.currentTime.textContent = new Date().toLocaleTimeString('en-IN', { hour12: false });
  setTimeout(clock, 1000);
})();

// ════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════
function init() {
  initTheme();
  buildGaugeTicks();
  startTrip();
  dom.tripStart.textContent = new Date().toLocaleTimeString('en-IN', { hour12: false });
  updateUI();
  connectWebSocket();
  addFeedItem('🚌 System started', 'Waiting for hardware…', 'reset');
}

init();
