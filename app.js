'use strict';

/* ── Constants ── */
const PING_TTL       = 60;   // seconds before verified → pending
const GHOSTING_TTL   = 300;  // seconds before pending → ghosting (shown as >5 min)
const HOVER_DELAY_MS = 2000; // ms hover before live-ping fires
const PING_LATENCY   = { min: 120, max: 480 }; // simulated API round-trip

/* ── Mock flight data factory ── */
const AIRLINES = [
  { name: 'Delta Air Lines',    code: 'DL', logo: '🔵', color: '#e8f0fe' },
  { name: 'United Airlines',    code: 'UA', logo: '🟤', color: '#fef3e8' },
  { name: 'American Airlines',  code: 'AA', logo: '🔴', color: '#fde8e8' },
  { name: 'Southwest Airlines', code: 'WN', logo: '🟡', color: '#fefbe8' },
  { name: 'JetBlue Airways',    code: 'B6', logo: '🔷', color: '#e8f4fe' },
  { name: 'Alaska Airlines',    code: 'AS', logo: '🟢', color: '#e8fef0' },
  { name: 'Spirit Airlines',    code: 'NK', logo: '📛', color: '#fffde8' },
  { name: 'Frontier Airlines',  code: 'F9', logo: '🟩', color: '#eafee8' },
];

const DEPARTURE_TIMES = ['06:00','07:30','08:15','10:00','11:45','13:20','15:00','17:30','19:00','21:15'];
const DURATIONS       = ['5h 10m','5h 28m','5h 45m','6h 00m','6h 30m','7h 10m'];
const STOPS           = ['Nonstop','1 stop (DEN)','1 stop (ORD)'];
const STOP_EXTRA_MIN  = [0, 90, 120];

const FEES = { carryon: 35, checked: 35, seat: 25, priority: 15 };

function pad(n) { return String(n).padStart(2,'0'); }

function addMinutes(timeStr, minutes) {
  const [h,m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${pad(Math.floor(total/60) % 24)}:${pad(total % 60)}`;
}

function generateFlights(origin, dest) {
  return AIRLINES.map((airline, i) => {
    const base       = 80 + Math.floor(Math.random() * 320);
    const tax        = Math.round(base * 0.12 + 18);
    const depTime    = DEPARTURE_TIMES[i % DEPARTURE_TIMES.length];
    const durIdx     = Math.floor(Math.random() * DURATIONS.length);
    const stopIdx    = Math.floor(Math.random() * STOPS.length);
    const durStr     = DURATIONS[durIdx];
    const durHours   = parseInt(durStr);
    const durMins    = parseInt(durStr.split('h ')[1]) + durHours * 60 + STOP_EXTRA_MIN[stopIdx];
    const arrTime    = addMinutes(depTime, durMins);
    const seats      = Math.floor(Math.random() * 9) + 1;
    const flightNum  = `${airline.code}${100 + Math.floor(Math.random()*900)}`;
    const prediction = Math.random() > 0.5 ? 'floor' : 'may_drop';
    return {
      id:         i,
      airline,
      flightNum,
      origin,
      dest,
      depTime,
      arrTime,
      duration:   durStr,
      stops:      STOPS[stopIdx],
      base,
      tax,
      seats,
      prediction,
      verifiedAt: null,
      pinging:    false,
    };
  });
}

/* ── State ── */
let flights      = [];
let selectedId   = null;
let feeState     = { carryon: true, checked: false, seat: false, priority: false };
let countdownMap = {};

/* ── Computed helpers ── */
function allInPrice(f) {
  let p = f.base + f.tax;
  if (feeState.carryon)  p += FEES.carryon;
  if (feeState.checked)  p += FEES.checked;
  if (feeState.seat)     p += FEES.seat;
  if (feeState.priority) p += FEES.priority;
  return p;
}

function verifyState(f) {
  if (!f.verifiedAt) return 'pending';
  const ageSeconds = (Date.now() - f.verifiedAt) / 1000;
  if (ageSeconds <= PING_TTL)     return 'verified';
  if (ageSeconds <= GHOSTING_TTL) return 'pending';
  return 'ghosting';
}

function ageLabel(f) {
  if (!f.verifiedAt) return 'Not yet pinged';
  const sec = Math.round((Date.now() - f.verifiedAt) / 1000);
  if (sec < 60)   return `Pinged ${sec}s ago`;
  return `Pinged ${Math.round(sec/60)}m ago`;
}

function scarcityClass(seats) {
  if (seats <= 2) return 'high';
  if (seats <= 5) return 'medium';
  return 'ok';
}
function scarcityLabel(seats) {
  if (seats <= 2) return `🔥 Only ${seats} seat${seats>1?'s':''} left at this price`;
  if (seats <= 5) return `⚡ ${seats} seats left at this price`;
  return `✓ ${seats}+ seats available`;
}
function predictionLabel(p) {
  return p === 'floor'
    ? '📉 Likely at price floor — book now'
    : '🕐 May drop slightly — monitor this fare';
}

/* ── DOM helpers ── */
function $(id) { return document.getElementById(id); }

function showToast(msg) {
  const t = $('priceToast');
  $('toastMsg').textContent = msg;
  t.hidden = false;
  t.classList.add('show');
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => { t.hidden = true; }, 300); }, 3000);
}

/* ── Live-Ping ── */
function triggerPing(id) {
  const f = flights.find(x => x.id === id);
  if (!f || f.pinging) return;

  f.pinging = true;
  const card = document.querySelector(`.flight-card[data-id="${id}"]`);
  if (card) card.classList.add('pinging');

  const latency = PING_LATENCY.min + Math.random() * (PING_LATENCY.max - PING_LATENCY.min);

  setTimeout(() => {
    f.pinging = false;
    const card = document.querySelector(`.flight-card[data-id="${id}"]`);
    if (card) card.classList.remove('pinging');

    const priceChanged = Math.random() < 0.10;
    if (priceChanged) {
      const delta = Math.random() < 0.5 ? -Math.ceil(Math.random()*15) : Math.ceil(Math.random()*20);
      f.base += delta;
      if (card) {
        card.classList.add('price-flash');
        card.addEventListener('animationend', () => card.classList.remove('price-flash'), { once: true });
        const lbl = card.querySelector('.price-updated-label');
        if (lbl) { lbl.classList.add('show'); setTimeout(() => lbl.classList.remove('show'), 4000); }
      }
      showToast(`⚡ ${f.airline.name} price just updated → $${allInPrice(f)} all-in`);
    }

    f.verifiedAt = Date.now();
    updateCardBadge(id);
    if (id === selectedId) updateSidebar(id);
    startCountdown(id);
  }, latency);
}

/* ── Countdown per card ── */
function startCountdown(id) {
  if (countdownMap[id]) clearInterval(countdownMap[id].intervalId);
  countdownMap[id] = {
    seconds: PING_TTL,
    intervalId: setInterval(() => tickCountdown(id), 1000),
  };
}

function tickCountdown(id) {
  const entry = countdownMap[id];
  if (!entry) return;
  entry.seconds -= 1;

  const card = document.querySelector(`.flight-card[data-id="${id}"]`);
  if (!card) return;

  const fill = card.querySelector('.countdown-bar-fill');
  const text = card.querySelector('.countdown-text');
  const pct  = Math.max(0, entry.seconds / PING_TTL * 100);

  if (fill) {
    fill.style.width = `${pct}%`;
    fill.style.background = pct > 50 ? 'var(--green)' : pct > 20 ? 'var(--amber)' : 'var(--red)';
  }
  if (text && entry.seconds > 0) {
    text.textContent = `Refresh in ${entry.seconds}s`;
  }

  if (entry.seconds <= 0) {
    clearInterval(entry.intervalId);
    delete countdownMap[id];
    updateCardBadge(id);
    if (id === selectedId) updateSidebar(id);
    if (text) text.textContent = 'Stale – hover to refresh';
  }
}

/* ── Card badge refresh ── */
function updateCardBadge(id) {
  const f    = flights.find(x => x.id === id);
  const card = document.querySelector(`.flight-card[data-id="${id}"]`);
  if (!f || !card) return;

  const state = verifyState(f);
  const badge = card.querySelector('.verify-badge');
  if (badge) {
    badge.className = `verify-badge ${state}`;
    badge.innerHTML = `<span class="badge-icon">${badgeIcon(state)}</span> ${badgeText(state)}`;
  }

  const priceEl = card.querySelector('.price-allin');
  if (priceEl) priceEl.textContent = `$${allInPrice(f)}`;
}

function badgeIcon(state) {
  return state === 'verified' ? '🛡' : state === 'pending' ? '⏳' : '⚠️';
}
function badgeText(state) {
  return state === 'verified' ? 'Verified' : state === 'pending' ? 'Pending Verification' : 'Price Ghosting Risk';
}

/* ── Render ── */
function renderCard(f) {
  const state      = verifyState(f);
  const totalPrice = allInPrice(f);

  const div = document.createElement('div');
  div.className  = 'flight-card';
  div.dataset.id = f.id;
  div.innerHTML = `
    <div class="ping-shimmer"></div>
    <div class="card-row-top">
      <div class="airline-info">
        <div class="airline-logo" style="background:${f.airline.color}">${f.airline.logo}</div>
        <div>
          <div class="airline-name">${f.airline.name}</div>
          <div class="airline-code">${f.flightNum}</div>
        </div>
      </div>

      <div class="itinerary">
        <div>
          <div class="itin-time">${f.depTime}</div>
          <div class="itin-port">${f.origin}</div>
        </div>
        <div class="itin-line">
          <div class="itin-bar"></div>
          <div class="itin-duration">${f.duration}</div>
          <div class="itin-stops">${f.stops === 'Nonstop' ? '' : f.stops}</div>
        </div>
        <div>
          <div class="itin-time">${f.arrTime}</div>
          <div class="itin-port">${f.dest}</div>
        </div>
      </div>

      <div class="price-block">
        <div class="price-allin">$${totalPrice}</div>
        <div class="price-label">All-in price</div>
        <div class="price-base">Base $${f.base}</div>
        <div class="verify-badge ${state}">
          <span class="badge-icon">${badgeIcon(state)}</span> ${badgeText(state)}
        </div>
        <div class="price-updated-label">⚡ Price just updated</div>
      </div>
    </div>

    <div class="countdown-wrap">
      <div class="countdown-bar-bg">
        <div class="countdown-bar-fill" style="width:0%"></div>
      </div>
      <div class="countdown-text">Hover to verify →</div>
    </div>

    <div class="card-row-bottom">
      <div class="scarcity ${scarcityClass(f.seats)}">${scarcityLabel(f.seats)}</div>
      <div class="prediction">${predictionLabel(f.prediction)}</div>
    </div>
  `;

  let hoverT = null;
  div.addEventListener('mouseenter', () => {
    hoverT = setTimeout(() => triggerPing(f.id), HOVER_DELAY_MS);
    selectFlight(f.id);
  });
  div.addEventListener('mouseleave', () => clearTimeout(hoverT));
  div.addEventListener('click', () => selectFlight(f.id));

  return div;
}

function renderAll() {
  const list = $('flightResults');
  list.innerHTML = '';
  flights.sort((a,b) => allInPrice(a) - allInPrice(b));
  flights.forEach(f => list.appendChild(renderCard(f)));
}

/* ── Sidebar ── */
function selectFlight(id) {
  selectedId = id;
  document.querySelectorAll('.flight-card').forEach(c => {
    c.classList.toggle('selected', Number(c.dataset.id) === id);
  });
  updateSidebar(id);
}

function updateSidebar(id) {
  const f = flights.find(x => x.id === id);
  if (!f) return;

  $('sidebarEmpty').hidden   = true;
  $('sidebarContent').hidden = false;

  $('sbLogo').textContent       = f.airline.logo;
  $('sbFlightName').textContent = `${f.airline.name} · ${f.flightNum}`;
  $('sbRoute').textContent      = `${f.origin} → ${f.dest} · ${f.depTime}–${f.arrTime}`;
  $('sbBase').textContent       = `$${f.base}`;
  $('sbTax').textContent        = `$${f.tax}`;

  const show = (rowId, valId, amount, active) => {
    $(rowId).hidden = !active;
    if (active) $(valId).textContent = `+$${amount}`;
  };
  show('sbCarryonRow',  'sbCarryon',  FEES.carryon,  feeState.carryon);
  show('sbCheckedRow',  'sbChecked',  FEES.checked,  feeState.checked);
  show('sbSeatRow',     'sbSeat',     FEES.seat,     feeState.seat);
  show('sbPriorityRow', 'sbPriority', FEES.priority, feeState.priority);

  $('sbTotal').textContent = `$${allInPrice(f)}`;

  const state  = verifyState(f);
  const shield = $('sbShield');
  shield.className = `sb-shield ${state}`;
  $('sbVerifyText').textContent = state === 'verified' ? 'Price Verified'
    : state === 'pending' ? 'Pending Verification' : '⚠ Ghosting Risk';
  shield.querySelector('.shield-icon').textContent = badgeIcon(state);
  $('sbAge').textContent = ageLabel(f);
}

/* ── Search ── */
function runSearch() {
  const origin = $('origin').value.trim().toUpperCase() || 'JFK';
  const dest   = $('destination').value.trim().toUpperCase() || 'LAX';

  Object.values(countdownMap).forEach(e => clearInterval(e.intervalId));
  countdownMap = {};
  selectedId   = null;

  const overlay = $('loadingOverlay');
  overlay.hidden = false;

  const delay = 500 + Math.random() * 900;
  setTimeout(() => {
    flights = generateFlights(origin, dest);

    $('resultsCount').textContent = `${flights.length} flights found`;
    $('routeLabel').textContent   = `${origin} → ${dest}`;

    renderAll();

    $('mainContent').hidden = false;
    overlay.hidden = true;

    flights
      .slice()
      .sort((a,b) => allInPrice(a) - allInPrice(b))
      .slice(0, 5)
      .forEach((f, i) => setTimeout(() => triggerPing(f.id), i * 150));

    $('sidebarEmpty').hidden   = false;
    $('sidebarContent').hidden = true;
  }, delay);
}

/* ── Fee toggles ── */
function bindFeeToggles() {
  const pairs = [
    ['feeCarryon', 'carryon'],
    ['feeChecked', 'checked'],
    ['feeSeat',    'seat'],
    ['feePriority','priority'],
  ];
  pairs.forEach(([elId, key]) => {
    $(elId).addEventListener('change', e => {
      feeState[key] = e.target.checked;
      document.querySelectorAll('.flight-card').forEach(card => {
        updateCardBadge(Number(card.dataset.id));
      });
      if (selectedId !== null) updateSidebar(selectedId);
    });
  });
}

/* ── Swap airports ── */
function bindSwap() {
  $('swapBtn').addEventListener('click', () => {
    const a = $('origin').value;
    const b = $('destination').value;
    $('origin').value      = b;
    $('destination').value = a;
  });
}

/* ── Init ── */
function init() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  $('travelDate').value = tomorrow.toISOString().slice(0, 10);

  bindFeeToggles();
  bindSwap();

  $('searchBtn').addEventListener('click', runSearch);
  ['origin','destination','travelDate'].forEach(id => {
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
  });

  runSearch();
}

document.addEventListener('DOMContentLoaded', init);
