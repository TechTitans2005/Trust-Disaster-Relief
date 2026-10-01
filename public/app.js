const navigationItems = [
  { id: "home", label: "Home", icon: "⌂" },
  { id: "dashboard", label: "Command center", icon: "▦" },
  { id: "beneficiaries", label: "Beneficiaries", icon: "♙" },
  { id: "verification", label: "Verification", icon: "✓", badge: "7" },
  { id: "distribution", label: "Aid distribution", icon: "□" },
  { id: "ledger", label: "Audit ledger", icon: "≡" },
  { id: "transparency", label: "Transparency", icon: "◉" },
  { id: "donor", label: "Donor portal", icon: "◇" },
  { id: "intelligence", label: "Relief intelligence", icon: "✦" }
];

const state = {
  route: location.hash.slice(1) || "home",
  online: navigator.onLine,
  pending: [],
  search: "",
  status: "All",
  syncStatus: "synced",
  token: sessionStorage.getItem("rahatToken") || "",
  user: null,
  profileId: "",
  intelligenceMessages: []
};

const VILLAGES = ["Village A", "Village B", "Village C", "Village D", "Kot Diji", "Gambat", "Sobhodero", "Kingri", "Faiz Ganj", "Nara"];
const OFFLINE_DB = "rahat-field-queue";
const OFFLINE_STORE = "actions";

const view = document.querySelector("#view");
const navigation = document.querySelector("#navigation");
const sidebar = document.querySelector("#sidebar");
const modal = document.querySelector("#modal");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-PK").format(value);
}

function formatDate(value, options = {}) {
  return new Intl.DateTimeFormat("en-PK", {
    dateStyle: options.dateStyle || "medium",
    ...(options.time ? { timeStyle: "short" } : {})
  }).format(new Date(value));
}

function timeAgo(value) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return formatDate(value);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function toast(message, tone = "success") {
  const item = document.createElement("div");
  item.className = `toast ${tone === "error" ? "error" : ""}`;
  item.textContent = message;
  document.querySelector("#toastRegion").append(item);
  window.setTimeout(() => item.remove(), 3500);
}

function openOfflineDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("IndexedDB is unavailable"));
    const request = indexedDB.open(OFFLINE_DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OFFLINE_STORE)) database.createObjectStore(OFFLINE_STORE, { keyPath: "clientId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readOfflineQueue() {
  try {
    const database = await openOfflineDatabase();
    return await new Promise((resolve, reject) => {
      const request = database.transaction(OFFLINE_STORE, "readonly").objectStore(OFFLINE_STORE).getAll();
      request.onsuccess = () => resolve(request.result.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
      request.onerror = () => reject(request.error);
    });
  } catch {
    return JSON.parse(localStorage.getItem("rahatPending") || "[]");
  }
}

async function queueOfflineAction(type, payload) {
  const item = { clientId: crypto.randomUUID(), type, payload, createdAt: new Date().toISOString() };
  try {
    const database = await openOfflineDatabase();
    await new Promise((resolve, reject) => {
      const request = database.transaction(OFFLINE_STORE, "readwrite").objectStore(OFFLINE_STORE).put(item);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  } catch {
    localStorage.setItem("rahatPending", JSON.stringify([...state.pending, item]));
  }
  state.pending.push(item);
  state.syncStatus = "pending";
  renderNavigation();
  return item;
}

async function removeOfflineActions(clientIds) {
  const completed = new Set(clientIds);
  try {
    const database = await openOfflineDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(OFFLINE_STORE, "readwrite");
      for (const clientId of completed) transaction.objectStore(OFFLINE_STORE).delete(clientId);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    localStorage.setItem("rahatPending", JSON.stringify(state.pending.filter((item) => !completed.has(item.clientId))));
  }
  state.pending = state.pending.filter((item) => !completed.has(item.clientId));
  state.syncStatus = state.pending.length ? "pending" : "synced";
  renderNavigation();
}

async function authenticate() {
  const cachedUser = JSON.parse(sessionStorage.getItem("rahatUser") || "null");
  if (!navigator.onLine && state.token && cachedUser) {
    state.user = cachedUser;
    return;
  }
  if (state.token) {
    try {
      const data = await api("/api/auth/me");
      state.user = data.user;
      sessionStorage.setItem("rahatUser", JSON.stringify(data.user));
      return;
    } catch {
      sessionStorage.removeItem("rahatToken");
      state.token = "";
    }
  }
  const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: "sana@rahat.demo", password: "RahatDemo!2026" }) });
  state.token = data.token;
  state.user = data.user;
  sessionStorage.setItem("rahatToken", data.token);
  sessionStorage.setItem("rahatUser", JSON.stringify(data.user));
}

function updateUserPanel() {
  if (!state.user) return;
  document.querySelector("#userName").textContent = state.user.name;
  document.querySelector("#userRole").textContent = state.user.role.replaceAll("_", " ");
}

function renderNavigation() {
  navigation.innerHTML = navigationItems.map((item) => {
    const count = item.id === "distribution" && state.pending.length ? state.pending.length : item.badge;
    const active = state.route === item.id || (state.route === "profile" && item.id === "beneficiaries");
    return `<button class="nav-link ${active ? "active" : ""}" data-route="${item.id}">
      <span class="nav-icon" aria-hidden="true">${item.icon}</span><span>${item.label}</span>
      ${count ? `<span class="nav-badge">${escapeHtml(count)}</span>` : ""}
    </button>`;
  }).join("");
}

function pageHeader(eyebrow, title, subtitle, actions = "") {
  return `<header class="page-header">
    <div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${subtitle}</p></div>
    ${actions ? `<div class="header-actions">${actions}</div>` : ""}
  </header>`;
}

function statCard(label, value, note, tone = "") {
  const numericValue = Number(String(value).replace(/[^0-9.-]/g, ""));
  const suffix = String(value).trim().endsWith("%") ? "%" : "";
  const countAttribute = Number.isFinite(numericValue) ? ` data-count="${numericValue}" data-suffix="${suffix}"` : "";
  return `<article class="stat-card"><div class="stat-label">${label}</div><div class="stat-value"${countAttribute}>${value}</div><div class="stat-note ${tone}">${note}</div></article>`;
}

function animateCounters() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelectorAll("[data-count]").forEach((element) => {
    const target = Number(element.dataset.count);
    const duration = 760;
    const start = performance.now();
    const frame = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = `${formatNumber(Math.round(target * eased))}${element.dataset.suffix || ""}`;
      if (progress < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

function showLoading() {
  view.replaceChildren(document.querySelector("#loadingTemplate").content.cloneNode(true));
}

function showError(error) {
  view.innerHTML = `<section class="page">${pageHeader("Connection issue", "We couldn’t load this view", "The API may not be running or the connection was interrupted.")}
    <div class="panel empty-state"><strong>${escapeHtml(error.message)}</strong><span>Start the Node server and try again.</span><br><br><button class="button primary" data-action="retry">Try again</button></div></section>`;
}

function reliefMap(points, compact = false) {
  return `<div class="relief-map ${compact ? "compact" : ""}" role="group" aria-label="Interactive relief coverage map">
    <svg class="map-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path class="river" d="M8,8 C30,25 18,48 48,55 S72,83 95,70"></path>
      <path class="road" d="M10,75 L34,58 L45,31 L72,43 L90,19"></path>
      <path class="road minor" d="M17,22 L33,62 L66,72 L86,42"></path>
    </svg>
    ${points.map((item) => `<button class="map-marker" style="--x:${item.x}%;--y:${item.y}%" data-map-village="${escapeHtml(item.village)}" aria-label="View ${escapeHtml(item.village)} households"><span></span><div class="map-tooltip"><strong>${escapeHtml(item.village)}</strong><small>${item.verified}/${item.families} verified</small><small>${item.relocated} relocated · ${Math.round(item.shelter / item.families * 100)}% shelter</small></div></button>`).join("")}
    <div class="map-label north">N</div><div class="map-label region">KHAIRPUR DISTRICT · DEMO MAP</div>
  </div>`;
}

async function renderHome() {
  const data = await api("/api/transparency");
  view.innerHTML = `<section class="home-page">
    <section class="home-hero">
      <img class="home-hero-image" src="/assets/rahat-relief-hero.png" alt="Relief workers distributing food and water in a flood-affected Sindh village" fetchpriority="high">
      <div class="home-hero-overlay"></div>
      <div class="home-hero-content">
        <span class="home-kicker"><i></i> Verifiable disaster relief network</span>
        <h1>One family.<br><em>One verifiable relief record.</em><br>Every aid accountable.</h1>
        <p>RAHAT connects identity, verification, field delivery, and public accountability—so relief reaches the right household, even when networks and circumstances fail.</p>
        <div class="home-actions"><button class="button home-primary" data-route="dashboard">Enter command center <span>→</span></button><button class="button home-ghost" data-action="open-video">▶ Watch field response</button></div>
        <div class="home-trust"><span>✓ Portable Relief IDs</span><span>✓ Offline-first field work</span><span>✓ Tamper-evident audit</span></div>
      </div>
      <div class="home-scroll">SCROLL TO EXPLORE <span>↓</span></div>
    </section>

    <div class="home-metrics">
      <div><strong data-count="${data.stats.familiesAssisted}">${formatNumber(data.stats.familiesAssisted)}</strong><span>Families registered</span></div>
      <div><strong data-count="${data.stats.aidDistributed}">${formatNumber(data.stats.aidDistributed)}</strong><span>Aid units tracked</span></div>
      <div><strong data-count="${data.stats.villagesCovered}">${data.stats.villagesCovered}</strong><span>Locations covered</span></div>
      <div><strong data-count="${data.stats.verificationRate}" data-suffix="%">${data.stats.verificationRate}%</strong><span>Identity verification</span></div>
    </div>

    <section class="home-section home-story">
      <div class="home-story-image"><img src="/assets/home-registration.png" alt="A RAHAT field coordinator registering a household using a tablet" loading="lazy"><div class="home-photo-label"><span>01</span><div><strong>Identity at the point of need</strong><small>Portable · Private · Verifiable</small></div></div></div>
      <div class="home-story-copy"><p class="eyebrow">Relief identity that travels</p><h2>Records should never disappear when a family moves.</h2><p>Each household receives one permanent Relief ID that connects verification, relocation, and every aid handover without exposing sensitive information publicly.</p>
        <div class="home-feature-list"><div><span>01</span><p><strong>Register once</strong>Generate a scannable identity at the field desk.</p></div><div><span>02</span><p><strong>Verify responsibly</strong>AI flags possible duplicates; people make decisions.</p></div><div><span>03</span><p><strong>Stay accountable</strong>Every important action enters the SHA-256 audit chain.</p></div></div>
        <button class="text-link" data-route="beneficiaries">Explore beneficiary identities <span>→</span></button>
      </div>
    </section>

    <section class="home-section home-process-section">
      <div class="home-section-heading"><div><p class="eyebrow">How RAHAT works</p><h2>From first registration to public proof.</h2></div><p>A single operational flow connects field teams, verifiers, administrators, donors, and the public.</p></div>
      <div class="home-process-grid"><article><span>01</span><div class="process-symbol">⌁</div><h3>Register</h3><p>Create a portable Relief ID online or offline.</p></article><article><span>02</span><div class="process-symbol">✓</div><h3>Verify</h3><p>Review identity signals and resolve duplicate risks.</p></article><article><span>03</span><div class="process-symbol">□</div><h3>Deliver</h3><p>Record food, water, shelter, and medicine.</p></article><article><span>04</span><div class="process-symbol">◉</div><h3>Prove</h3><p>Publish safe aggregates backed by an audit chain.</p></article></div>
    </section>

    <section class="home-section home-video-section">
      <div class="home-video-poster"><img src="/assets/field-story-poster.png" alt="Relief coordinators preparing supplies at a field distribution point" loading="lazy"><button class="play-button home-play" data-action="open-video" aria-label="Play official flood response field video">▶</button><span class="media-duration">FIELD STORY · EXTERNAL VIDEO</span></div>
      <div class="home-video-copy"><p class="eyebrow">See the response</p><h2>Technology matters only when it helps people move faster.</h2><p>Watch an official UNICEF field report about coordinated water, health, and relief delivery after flooding in Pakistan.</p><button class="button primary" data-action="open-video">Watch the field story</button><small>External media loads only after you press play.</small></div>
    </section>

    <section class="home-cta"><div><p class="eyebrow">Ready for the field</p><h2>Coordinate relief with evidence—not assumptions.</h2></div><div><button class="button home-primary" data-route="dashboard">Open command center</button><button class="button home-ghost" data-route="transparency">View public transparency</button></div></section>
    <footer class="home-footer"><span>RAHAT · Verifiable Disaster Relief</span><span>Demonstration platform · Fictional data</span></footer>
  </section>`;
}

async function renderDashboard() {
  const data = await api("/api/dashboard");
  const max = Math.max(...Object.values(data.aidTotals));
  view.innerHTML = `<section class="page">
    ${pageHeader("Operations overview", "Good morning, Sana", "Here’s what is happening across the Khairpur response network.", `<span class="date-chip">${formatDate(new Date())}</span><button class="button" data-route="transparency">Public view ↗</button>`)}
    <section class="hero hero-media"><img class="hero-background" src="/assets/rahat-relief-hero.png" alt="" fetchpriority="high"><span class="hero-scrim"></span><div class="hero-content"><span class="live-pill">Response network active</span><h2>Relief that reaches people — and proves it.</h2><p>Coordinate aid across partner organizations while protecting identities and keeping every distribution accountable.</p>
      <div class="process"><span class="process-step">Families</span><span class="process-arrow">→</span><span class="process-step">Verification</span><span class="process-arrow">→</span><span class="process-step">Aid delivery</span><span class="process-arrow">→</span><span class="process-step">Audit</span></div>
      <div class="hero-actions"><button class="button hero-primary" data-route="distribution">Record aid delivery</button><button class="button hero-secondary" data-action="open-video">▶ Watch field story</button></div></div></section>
    <div class="stat-grid">
      ${statCard("Registered families", formatNumber(data.stats.registeredFamilies), "Portable Relief IDs")}
      ${statCard("Verified households", formatNumber(data.stats.verifiedFamilies), `${Math.round(data.stats.verifiedFamilies / data.stats.registeredFamilies * 100)}% verification rate`)}
      ${statCard("Aid transactions", formatNumber(data.stats.aidTransactions), "+126 this week")}
      ${statCard("Relocated families", formatNumber(data.stats.relocatedFamilies), "Relief IDs preserved")}
      ${statCard("Duplicate alerts", formatNumber(data.stats.duplicateAlerts), "Needs human review", "warning")}
      ${statCard("Audit integrity", `${data.stats.auditIntegrity}%`, data.stats.auditIntegrity === 100 ? "SHA-256 chain intact" : "Requires attention", data.stats.auditIntegrity === 100 ? "" : "warning")}
    </div>
    <article class="media-story">
      <div class="media-poster"><img src="/assets/field-story-poster.png" alt="Relief coordinators checking aid supplies at a field distribution point" loading="lazy"><button class="play-button" data-action="open-video" aria-label="Play Pakistan flood response field video">▶</button><span class="media-duration">FIELD STORY · VIDEO</span></div>
      <div class="media-copy"><p class="eyebrow" style="color:#76daa0">From the field</p><h2>See how verified aid moves from records to families.</h2><p>A short field report shows why coordinated water, health, and relief delivery matters after flooding.</p><div class="media-meta"><span>Official UNICEF report</span><span>External media</span></div><button class="button hero-primary" data-action="open-video">Watch the response story</button></div>
    </article>
    <div class="dashboard-grid">
      <article class="panel"><div class="panel-header"><div><h2>Aid distribution</h2><div class="panel-subtitle">Units delivered across all villages</div></div><span class="badge success">Live API</span></div>
        ${Object.entries(data.aidTotals).map(([name, value]) => `<div class="chart-row"><span>${escapeHtml(name)}</span><div class="chart-track"><span class="chart-fill" style="width:${value / max * 100}%"></span></div><span class="chart-value">${formatNumber(value)}</span></div>`).join("")}
      </article>
      <article class="panel"><div class="panel-header"><div><h2>Priority alerts</h2><div class="panel-subtitle">Items requiring attention</div></div></div><div class="alert-list">
        ${data.alerts.map((item) => `<div class="alert-item ${item.tone}"><span class="alert-symbol">${item.tone === "success" ? "✓" : item.tone === "warning" ? "!" : "i"}</span><span>${escapeHtml(item.text)}</span></div>`).join("")}
      </div><button class="button primary mt-18" data-route="verification">Review potential matches</button></article>
      <article class="panel"><div class="panel-header"><div><h2>Relief coverage map</h2><div class="panel-subtitle">Select a location to view registered households</div></div><span class="badge success">10 locations</span></div>${reliefMap(data.mapPoints)}</article>
      <article class="panel"><div class="panel-header"><div><h2>Movement overview</h2><div class="panel-subtitle">Relocated households retain the same Relief ID</div></div></div><div class="map-summary"><strong>${data.stats.relocatedFamilies}</strong><span>families with relocation history</span></div><button class="button mt-18" data-route="beneficiaries">Explore household records</button></article>
      <article class="panel" style="grid-column:1/-1"><div class="panel-header"><div><h2>Recent activity</h2><div class="panel-subtitle">Latest audited actions</div></div><button class="button" data-route="ledger">View ledger</button></div>
        <div class="activity-list">${data.recentActivity.length ? data.recentActivity.map((item) => `<div class="activity"><span class="activity-dot"></span><span><strong>${escapeHtml(item.actor)}</strong> · ${escapeHtml(item.action)}</span><time>${timeAgo(item.timestamp)}</time></div>`).join("") : `<div class="empty-state"><strong>No activity yet</strong>New actions will appear here.</div>`}</div>
      </article>
    </div>
  </section>`;
}

function beneficiaryRows(items) {
  if (!items.length) return `<tr><td colspan="7"><div class="empty-state"><strong>No households found</strong>Try another search or register a new family.</div></td></tr>`;
  return items.map((item) => `<tr class="clickable-row" data-beneficiary-id="${escapeHtml(item.id)}" tabindex="0">
    <td class="mono">${escapeHtml(item.id)}</td>
    <td><div class="person-cell"><span class="person-icon">${escapeHtml(item.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join(""))}</span><strong>${escapeHtml(item.name)}</strong></div></td>
    <td>${escapeHtml(item.village)}</td><td>${item.members}</td>
    <td><span class="badge ${item.status === "Verified" ? "success" : "warning"}">${escapeHtml(item.status)}</span></td>
    <td>${escapeHtml(item.lastAid || "No aid recorded")}</td><td><button class="row-arrow" data-beneficiary-id="${escapeHtml(item.id)}" aria-label="Open ${escapeHtml(item.name)} profile">→</button></td>
  </tr>`).join("");
}

async function renderBeneficiaries() {
  const params = new URLSearchParams({ q: state.search, status: state.status });
  const data = await api(`/api/beneficiaries?${params}`);
  view.innerHTML = `<section class="page">
    ${pageHeader("Household registry", "Beneficiaries", "Privacy-minimized family records shared across authorized partners.", `<button class="button primary" data-action="open-registration">＋ Register family</button>`)}
    <div class="toolbar"><label class="search-box"><span class="hide">Search beneficiaries</span><input id="beneficiarySearch" value="${escapeHtml(state.search)}" placeholder="Search by name, Relief ID, or village…"></label>
      <select class="compact" id="statusFilter" aria-label="Filter by verification status"><option>All</option><option ${state.status === "Verified" ? "selected" : ""}>Verified</option><option ${state.status === "Pending" ? "selected" : ""}>Pending</option></select>
      <span class="date-chip">${data.total} records</span></div>
    <div class="panel table-wrap" style="padding:0"><table><thead><tr><th>Relief ID</th><th>Household</th><th>Location</th><th>Members</th><th>Verification</th><th>Last aid</th><th></th></tr></thead><tbody>${beneficiaryRows(data.items)}</tbody></table></div>
  </section>`;
  const input = document.querySelector("#beneficiarySearch");
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function openRegistration() {
  document.querySelector("#modalEyebrow").textContent = "New household";
  document.querySelector("#modalTitle").textContent = "Register a family";
  document.querySelector("#modalBody").innerHTML = `<div class="modal-body"><div class="form-grid">
    <div class="field full"><label for="familyName">Household head name</label><input id="familyName" name="name" required minlength="3" autocomplete="name" placeholder="e.g. Ayesha Bibi"></div>
    <div class="field"><label for="familyVillage">Village</label><select id="familyVillage" name="village" required><option value="">Select village</option>${VILLAGES.map((item) => `<option>${escapeHtml(item)}</option>`).join("")}</select></div>
    <div class="field"><label for="familyMembers">Family members</label><input id="familyMembers" name="members" type="number" required min="1" max="30" value="5"></div>
    <div class="field"><label for="registrationSource">Registration source</label><select id="registrationSource" disabled><option>Field registration</option></select></div>
    <input type="hidden" name="confirmDuplicate" value="false">
  </div><div id="duplicateWarning"></div><div class="modal-actions"><button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit">Create Relief ID</button></div></div>`;
  document.querySelector("#modalForm").dataset.action = "register-family";
  modal.showModal();
  document.querySelector("#familyName").focus();
}

async function submitRegistration(form) {
  const body = Object.fromEntries(new FormData(form));
  body.members = Number(body.members);
  body.confirmDuplicate = body.confirmDuplicate === "true";
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = "Checking…";
  if (!state.online) {
    const queued = await queueOfflineAction("registration", body);
    modal.close();
    toast(`Registration saved offline (${queued.clientId.slice(0, 8)})`);
    return;
  }
  try {
    const data = await api("/api/beneficiaries", { method: "POST", body: JSON.stringify(body) });
    modal.close();
    toast(`Relief ID ${data.beneficiary.id} created`);
    await routeTo(`profile/${data.beneficiary.id}`);
  } catch (error) {
    if (error.status === 409) {
      form.elements.confirmDuplicate.value = "true";
      const match = error.data.matches[0];
      document.querySelector("#duplicateWarning").innerHTML = `<div class="duplicate-warning"><strong>Possible duplicate: ${escapeHtml(match.beneficiary.name)}</strong><br>${escapeHtml(match.beneficiary.id)} · ${match.score}% name match. A human must verify this record after registration.</div>`;
      submit.textContent = "Register as pending anyway";
      submit.disabled = false;
      return;
    }
    toast(error.message, "error");
    submit.textContent = "Create Relief ID";
    submit.disabled = false;
  }
}

async function renderProfile() {
  if (!state.profileId) return routeTo("beneficiaries", true);
  const data = await api(`/api/beneficiaries/${encodeURIComponent(state.profileId)}`);
  const item = data.beneficiary;
  view.innerHTML = `<section class="page profile-page">
    <button class="back-link" data-route="beneficiaries">← Back to beneficiaries</button>
    ${pageHeader("Portable relief identity", item.name, `${item.id} · Registered ${formatDate(item.registeredAt)}`, `<button class="button" data-action="print-profile">Print identity</button><button class="button primary" data-action="open-relocation">Record relocation</button>`)}
    <div class="profile-grid">
      <aside class="panel identity-card"><div class="identity-top"><span class="brand-mark">R</span><span class="badge ${item.status === "Verified" ? "success" : "warning"}">${escapeHtml(item.status)}</span></div><p class="eyebrow">RAHAT RELIEF IDENTITY</p><h2>${escapeHtml(item.name)}</h2><div class="relief-id mono">${escapeHtml(item.id)}</div><img class="qr-code" src="${data.qrDataUrl}" alt="Scannable QR code for ${escapeHtml(item.id)}"><p class="qr-note">Scan to retrieve this portable identity. The Relief ID stays unchanged after relocation.</p><div class="identity-facts"><div><span>Current location</span><strong>${escapeHtml(item.village)}</strong></div><div><span>Household size</span><strong>${item.members} members</strong></div><div><span>Last aid</span><strong>${escapeHtml(item.lastAid || "None recorded")}</strong></div></div></aside>
      <div class="profile-main">
        <div class="profile-stat-row"><div class="mini-stat"><span>Aid records</span><strong>${data.aidHistory.length}</strong></div><div class="mini-stat"><span>Relocations</span><strong>${data.relocations.length}</strong></div><div class="mini-stat"><span>Verification</span><strong class="text-${item.status === "Verified" ? "success" : "warning"}">${escapeHtml(item.status)}</strong></div></div>
        <article class="panel"><div class="panel-header"><div><h2>Household timeline</h2><div class="panel-subtitle">Registration, aid, verification, and movement history</div></div></div><div class="profile-timeline">${data.timeline.map((event) => `<div class="timeline-event"><span class="timeline-icon">${event.type === "aid" ? "□" : event.type === "relocation" ? "→" : event.type === "verification" ? "✓" : "+"}</span><div><strong>${escapeHtml(event.title)}</strong><p>${escapeHtml(event.detail)}</p></div><time>${formatDate(event.timestamp)}</time></div>`).join("")}</div></article>
        <article class="panel"><div class="panel-header"><div><h2>Relocation history</h2><div class="panel-subtitle">The same Relief ID follows this household</div></div></div>${data.relocations.length ? `<div class="relocation-list">${data.relocations.map((record) => `<div class="relocation-card"><div><span>${escapeHtml(record.previousLocation)}</span><b>→</b><strong>${escapeHtml(record.currentLocation)}</strong></div><small>${formatDate(record.date)} · ${escapeHtml(record.verificationStatus)} · ${escapeHtml(record.actor)}</small></div>`).join("")}</div>` : `<div class="empty-state"><strong>No relocation history</strong>This household is still at its original registered location.</div>`}</article>
      </div>
    </div>
  </section>`;
}

function openRelocation() {
  document.querySelector("#modalEyebrow").textContent = "Movement tracking";
  document.querySelector("#modalTitle").textContent = "Record household relocation";
  document.querySelector("#modalBody").innerHTML = `<div class="modal-body"><p class="modal-intro">The household keeps the same Relief ID. A relocation event will be added to its timeline and audit history.</p><div class="form-grid">
    <div class="field full"><label for="relocationDestination">New location</label><select id="relocationDestination" name="currentLocation" required><option value="">Select destination</option>${VILLAGES.map((item) => `<option>${escapeHtml(item)}</option>`).join("")}</select></div>
    <div class="field"><label for="relocationDate">Movement date</label><input id="relocationDate" name="date" type="date" value="${new Date().toISOString().slice(0, 10)}" required></div>
    <div class="field"><label for="relocationStatus">Verification status</label><select id="relocationStatus" name="verificationStatus"><option>Pending</option><option>Verified</option></select></div>
  </div><div class="modal-actions"><button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit">Save relocation</button></div></div>`;
  document.querySelector("#modalForm").dataset.action = "relocate-family";
  modal.showModal();
}

async function submitRelocation(form) {
  const body = Object.fromEntries(new FormData(form));
  body.reliefId = state.profileId;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  if (!state.online) {
    await queueOfflineAction("relocation", body);
    modal.close();
    toast("Relocation saved offline and queued for synchronization");
    return;
  }
  try {
    await api(`/api/beneficiaries/${encodeURIComponent(state.profileId)}/relocations`, { method: "POST", body: JSON.stringify(body) });
    modal.close();
    toast("Relocation recorded without changing the Relief ID");
    await routeTo(`profile/${state.profileId}`, true);
  } catch (error) {
    button.disabled = false;
    toast(error.message, "error");
  }
}

async function renderVerification() {
  const data = await api("/api/verification-cases");
  view.innerHTML = `<section class="page">${pageHeader("Identity intelligence", "Verification review", "Similarity signals support reviewers; only a human can make the final decision.")}
    ${data.items.length ? data.items.map((item) => `<article class="panel case-card" data-case-id="${escapeHtml(item.id)}">
      <div class="panel-header"><div class="case-score"><div class="score-ring" style="--score:${item.score}%"><strong>${item.score}%</strong></div><div><span class="badge warning">Potential match</span><div class="panel-subtitle">Confidence score from identity signals</div></div></div><span class="mono">CASE ${escapeHtml(item.id.slice(0, 18))}</span></div>
      <div class="comparison"><div class="household"><span class="mono">${escapeHtml(item.first.id)}</span><strong>${escapeHtml(item.first.name)}</strong><span class="muted">${escapeHtml(item.first.village)} · ${item.first.members} members</span></div><div class="compare-mark">↔</div><div class="household"><span class="mono">${escapeHtml(item.second.id)}</span><strong>${escapeHtml(item.second.name)}</strong><span class="muted">${escapeHtml(item.second.village)} · ${item.second.members} members</span></div></div>
      <div class="evidence"><div class="evidence-item"><span class="check">✓</span>${item.nameSimilarity}% household name similarity</div><div class="evidence-item"><span class="check">✓</span>${item.first.members === item.second.members ? "Same household size" : "Household size differs"}</div><div class="evidence-item"><span class="check">✓</span>Records originated from separate field registrations</div></div>
      ${item.decision ? `<div class="decision-banner">Decision recorded: ${escapeHtml(item.decision.value)} · ${timeAgo(item.decision.timestamp)}</div>` : `<div class="header-actions"><button class="button warning" data-decision="review">Keep under review</button><button class="button primary" data-decision="same">Confirm same household</button><button class="button" data-decision="different">Mark as different</button></div>`}
    </article>`).join("") : `<div class="panel empty-state"><strong>No potential duplicates</strong>All households have been reviewed.</div>`}
  </section>`;
}

async function submitDecision(button) {
  const card = button.closest("[data-case-id]");
  button.disabled = true;
  const payload = { caseId: card.dataset.caseId, decision: button.dataset.decision };
  if (!state.online) {
    await queueOfflineAction("verification", payload);
    toast("Verification decision saved offline");
    card.querySelector(".header-actions")?.replaceWith(Object.assign(document.createElement("div"), { className: "decision-banner", textContent: "Decision queued offline — pending synchronization" }));
    return;
  }
  try {
    await api(`/api/verification-cases/${encodeURIComponent(card.dataset.caseId)}/decision`, { method: "POST", body: JSON.stringify(payload) });
    toast("Verification decision added to the audit ledger");
    await routeTo("verification", true);
  } catch (error) {
    button.disabled = false;
    toast(error.message, "error");
  }
}

function pendingQueueMarkup() {
  return state.pending.length ? state.pending.map((item) => {
    const payload = item.payload || item;
    const title = item.type === "registration" ? `Register ${payload.name}` : item.type === "relocation" ? `Relocate ${payload.reliefId}` : item.type === "verification" ? "Verify duplicate case" : `${payload.aidType} ×${payload.quantity}`;
    const meta = item.type === "registration" ? payload.village : item.type === "relocation" ? `To ${payload.currentLocation}` : item.type === "verification" ? payload.decision : payload.reliefId;
    return `<div class="queue-item"><div><span class="queue-type">${escapeHtml(item.type || "distribution")}</span><strong>${escapeHtml(title)}</strong><div class="queue-meta mono">${escapeHtml(meta)}</div></div><span class="queue-meta">${timeAgo(item.createdAt)}</span></div>`;
  }).join("") : `<div class="empty-state"><strong>Everything is synchronized</strong>No records are waiting on this device.</div>`;
}

function refreshPendingQueueView() {
  const list = document.querySelector("#pendingQueueList");
  const count = document.querySelector("#pendingQueueCount");
  if (list) list.innerHTML = pendingQueueMarkup();
  if (count) { count.textContent = `${state.pending.length} pending`; count.className = `badge ${state.pending.length ? "warning" : "success"}`; }
}

async function renderDistribution() {
  const [beneficiaryData, distributionData] = await Promise.all([api("/api/beneficiaries?status=All"), api("/api/distributions")]);
  const statusText = state.syncStatus === "syncing" ? "Synchronizing queued field actions…" : state.online ? "Connected to the RAHAT API" : "Offline mode — field actions are stored in IndexedDB";
  view.innerHTML = `<section class="page">
    ${pageHeader("Field operations", "Aid distribution", "Record each handover against a verified Relief ID.", `<button class="button ${state.online ? "" : "primary"}" data-action="toggle-online">${state.online ? "Go offline" : "Reconnect"}</button>`)}
    ${!state.online ? `<div class="offline-banner"><strong>Offline mode.</strong> Records are held locally on this device until you reconnect to this demo server.</div>` : ""}
    <div class="dashboard-grid"><article class="panel"><div class="panel-header"><div><h2>Record a distribution</h2><div class="panel-subtitle">${statusText}</div></div><span class="badge ${state.online ? "success" : "warning"}">${state.online ? "Online" : "Offline"}</span></div>
      <form id="distributionForm"><div class="form-grid"><div class="field full"><label for="reliefId">Beneficiary Relief ID</label><select id="reliefId" name="reliefId" required><option value="">Select a family</option>${beneficiaryData.items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.id)} — ${escapeHtml(item.name)} (${escapeHtml(item.village)})</option>`).join("")}</select></div>
      <div class="field"><label for="aidType">Aid type</label><select id="aidType" name="aidType" required>${distributionData.aidTypes.map((item) => `<option>${escapeHtml(item)}</option>`).join("")}</select></div><div class="field"><label for="aidQuantity">Quantity</label><input id="aidQuantity" name="quantity" type="number" min="1" max="100" value="1" required></div><div class="field" style="align-self:end"><button class="button primary" type="submit">Record handover</button></div></div></form>
    </article>
    <article class="panel"><div class="panel-header"><div><h2>Pending synchronization</h2><div class="panel-subtitle">Locally stored field records</div></div><span id="pendingQueueCount" class="badge ${state.pending.length ? "warning" : "success"}">${state.pending.length} pending</span></div>
      <div class="queue-list" id="pendingQueueList">${pendingQueueMarkup()}</div>
      ${state.pending.length && state.online ? `<button class="button primary mt-18" data-action="sync-queue">Synchronize now</button>` : ""}
    </article></div>
    <article class="panel mt-18"><div class="panel-header"><div><h2>Recent distributions</h2><div class="panel-subtitle">Recorded during this server session</div></div></div>
      ${distributionData.items.length ? `<div class="table-wrap"><table><thead><tr><th>Transaction</th><th>Beneficiary</th><th>Aid</th><th>Recorded by</th><th>Time</th></tr></thead><tbody>${distributionData.items.map((item) => `<tr><td class="mono">${escapeHtml(item.id)}</td><td>${escapeHtml(item.beneficiaryName)}<br><span class="mono muted">${escapeHtml(item.reliefId)}</span></td><td>${escapeHtml(item.aidType)} ×${item.quantity}</td><td>${escapeHtml(item.actor)}</td><td>${timeAgo(item.timestamp)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><strong>No live distributions yet</strong>Submit the form to create the first one.</div>`}
    </article>
  </section>`;
}

async function submitDistribution(form) {
  const body = Object.fromEntries(new FormData(form));
  body.quantity = Number(body.quantity);
  if (!body.reliefId) return toast("Select a beneficiary first", "error");
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  if (!state.online) {
    await queueOfflineAction("distribution", body);
    toast("Saved securely in IndexedDB for later synchronization");
    refreshPendingQueueView();
    return;
  }
  try {
    const data = await api("/api/distributions", { method: "POST", body: JSON.stringify(body) });
    toast(`${data.ledgerEntry.id} recorded and added to the audit ledger`);
    await routeTo("distribution", true);
  } catch (error) {
    submit.disabled = false;
    toast(error.message, "error");
  }
}

async function syncQueue() {
  const returnRoute = location.hash.slice(1) || state.route;
  const button = document.querySelector('[data-action="sync-queue"]');
  if (button) { button.disabled = true; button.textContent = "Synchronizing…"; }
  state.syncStatus = "syncing";
  try {
    const data = await api("/api/sync", { method: "POST", body: JSON.stringify({ items: state.pending }) });
    const failedIds = new Set(data.results.filter((item) => !item.ok).map((item) => item.clientId));
    const completedIds = data.results.filter((item) => item.ok).map((item) => item.clientId);
    const succeeded = data.results.filter((item) => item.ok).length;
    await removeOfflineActions(completedIds);
    state.syncStatus = failedIds.size ? "pending" : "synced";
    toast(`${succeeded} offline record${succeeded === 1 ? "" : "s"} synchronized${state.pending.length ? `; ${state.pending.length} failed` : ""}`, state.pending.length ? "error" : "success");
    await routeTo(returnRoute, true);
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = "Synchronize now"; }
    toast(error.message, "error");
  }
}

async function renderLedger() {
  const data = await api("/api/ledger");
  view.innerHTML = `<section class="page">
    ${pageHeader("Accountability", "Tamper-evident audit ledger", "Every operational action is linked in an append-only SHA-256 hash chain.", `<button class="button" data-action="refresh-ledger">↻ Verify integrity</button><button class="button danger" data-action="tamper-ledger">Simulate tampering</button>`)}
    <div class="integrity-banner ${data.integrity.valid ? "success" : "danger"}"><strong>${data.integrity.valid ? "✓ Ledger integrity verified" : "⚠ Ledger integrity warning"}</strong> — ${data.integrity.valid ? `${data.integrity.checked} records checked; the chain is intact.` : `A changed record was detected at ${escapeHtml(data.integrity.brokenAt)}.`}</div>
    <article class="panel"><div class="panel-header"><div><h2>Cryptographic record chain</h2><div class="panel-subtitle">Newest action first · not a public blockchain</div></div><span class="badge ${data.integrity.valid ? "success" : "danger"}">${data.integrity.valid ? "Verified" : "Compromised"}</span></div>
      <div class="ledger-list">${data.items.map((item) => `<div class="ledger-entry ${item.id === data.integrity.brokenAt ? "broken" : ""}"><span class="ledger-node">${item.id === data.integrity.brokenAt ? "!" : "✓"}</span><div class="ledger-content"><div class="ledger-title"><strong>${escapeHtml(item.id)} · ${escapeHtml(item.actor)}</strong><span class="muted">${formatDate(item.timestamp, { time: true })}</span></div><p>${escapeHtml(item.action)}</p><div class="hash mono">previous ${escapeHtml(item.previousHash)}<br>hash&nbsp;&nbsp;&nbsp;&nbsp; ${escapeHtml(item.hash)}</div></div></div>`).join("")}</div>
    </article>
  </section>`;
}

async function tamperLedger() {
  if (!confirm("Modify a historical demo record without updating its hash? This intentionally demonstrates tamper detection.")) return;
  try {
    await api("/api/ledger/tamper", { method: "POST", body: "{}" });
    toast("Historical record changed; the broken chain is now visible", "error");
    await routeTo("ledger", true);
  } catch (error) { toast(error.message, "error"); }
}

function openVideo() {
  modal.classList.add("video-modal");
  document.querySelector("#modalEyebrow").textContent = "Field story";
  document.querySelector("#modalTitle").textContent = "Pakistan flood response";
  document.querySelector("#modalBody").innerHTML = `<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/FwEORIXdKA0?autoplay=1&rel=0" title="UNICEF Pakistan flood response field report" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div><div class="video-note">This official UNICEF video is loaded only after you choose to play it and requires an internet connection.</div>`;
  document.querySelector("#modalForm").dataset.action = "video";
  modal.showModal();
}

async function renderTransparency() {
  const data = await api("/api/transparency");
  view.innerHTML = `<section class="page">
    ${pageHeader("Public accountability", "Khairpur relief transparency", "Aggregated data only — no names, identity numbers, or household-level information.", `<span class="date-chip">Updated ${timeAgo(data.updatedAt)}</span>`)}
    <section class="hero"><div class="hero-content"><p class="eyebrow" style="color:#76daa0">Open relief data</p><h2>Aid progress the public can understand.</h2><p>These demonstration figures are aggregated from the same operational records used by field teams.</p></div></section>
    <div class="stat-grid">${statCard("Families assisted", formatNumber(data.stats.familiesAssisted), "Demo household records")}${statCard("Aid units delivered", formatNumber(data.stats.aidDistributed), "All relief categories")}${statCard("Villages covered", data.stats.villagesCovered, "Active field coverage")}${statCard("Relocated families", data.stats.relocatedFamilies, "Portable Relief IDs")}${statCard("Verification rate", `${data.stats.verificationRate}%`, "Human-reviewed identities")}${statCard("Transactions audited", formatNumber(data.stats.transactionsAudited), "Cryptographically linked")}</div>
    <div class="dashboard-grid"><article class="panel"><div class="panel-header"><div><h2>Public coverage map</h2><div class="panel-subtitle">Aggregated location data only</div></div><span class="badge success">Privacy safe</span></div>${reliefMap(data.coverage, true)}</article><article class="panel"><div class="panel-header"><div><h2>Aid composition</h2><div class="panel-subtitle">Units recorded by category</div></div></div>${Object.entries(data.aidTotals).map(([label, value]) => `<div class="aid-total"><span>${escapeHtml(label)}</span><strong>${formatNumber(value)}</strong></div>`).join("")}</article></div>
    <article class="panel mt-18"><div class="panel-header"><div><h2>Verified household coverage</h2><div class="panel-subtitle">Village-level progress without exposing personal records</div></div></div>
      <div class="coverage-grid">${data.coverage.map((item) => { const percentage = Math.round(item.verified / item.families * 100); return `<div class="coverage-card"><div class="coverage-head"><strong>${escapeHtml(item.village)}</strong><span>${item.verified} of ${item.families} verified · ${percentage}%</span></div><div class="chart-track"><span class="chart-fill" style="width:${percentage}%"></span></div></div>`; }).join("")}</div>
      <p class="panel-subtitle mt-18">Source: RAHAT demonstration audit ledger. Figures are fictional and must not be treated as official relief statistics.</p>
    </article>
  </section>`;
}

async function renderDonor() {
  const data = await api("/api/donor");
  const campaign = data.campaigns[0];
  view.innerHTML = `<section class="page donor-page">
    ${pageHeader("Partner accountability", "Donor impact portal", "Campaign-level outcomes and audit coverage without private beneficiary information.", `<button class="button primary" data-action="download-report">↓ Generate impact report</button>`)}
    <article class="campaign-banner"><div><span class="badge success">${escapeHtml(campaign.status)}</span><h2>${escapeHtml(campaign.name)}</h2><p class="muted">Campaign ${escapeHtml(campaign.id)} · ${campaign.partners} verified partner organizations</p></div><div class="funding-ring" style="--funding:${campaign.fundingUtilization * 3.6}deg"><span><strong>${campaign.fundingUtilization}%</strong><small>utilized</small></span></div></article>
    <div class="stat-grid">${statCard("Families assisted", formatNumber(data.stats.familiesAssisted), "Aggregated only")}${statCard("Aid delivered", formatNumber(data.stats.aidDistributed), "Verified units")}${statCard("Geographic reach", `${data.stats.villagesCovered}`, "Covered locations")}${statCard("Relocations tracked", `${data.stats.relocatedFamilies}`, "Continuity protected")}${statCard("Verification rate", `${data.stats.verificationRate}%`, "Human-reviewed")}${statCard("Audit integrity", data.auditIntegrity.valid ? "100%" : "0%", data.auditIntegrity.valid ? "Chain intact" : "Attention required", data.auditIntegrity.valid ? "" : "warning")}</div>
    <div class="dashboard-grid"><article class="panel"><div class="panel-header"><div><h2>Geographical coverage</h2><div class="panel-subtitle">Verified reach by response location</div></div></div>${reliefMap(data.coverage)}</article><article class="panel"><div class="panel-header"><div><h2>Accountability summary</h2><div class="panel-subtitle">Generated from live operational data</div></div></div><div class="accountability-list"><div><span>Audit records checked</span><strong>${data.auditIntegrity.checked}</strong></div><div><span>Ledger state</span><strong class="text-${data.auditIntegrity.valid ? "success" : "warning"}">${data.auditIntegrity.valid ? "Verified" : "Warning"}</strong></div><div><span>Personal data exposed</span><strong class="text-success">None</strong></div><div><span>Data classification</span><strong>Demo</strong></div></div><button class="button primary mt-18" data-action="download-report">Download CSV report</button></article></div>
  </section>`;
}

async function downloadDonorReport() {
  try {
    const response = await fetch("/api/donor/report.csv", { headers: { Authorization: `Bearer ${state.token}` } });
    if (!response.ok) throw new Error("Unable to generate the donor report");
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "rahat-donor-impact-report.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    toast("Donor impact report generated from live data");
  } catch (error) { toast(error.message, "error"); }
}

function intelligenceFacts(facts) {
  if (!facts || (Array.isArray(facts) && !facts.length)) return "";
  const entries = Array.isArray(facts) ? facts : Object.entries(facts).map(([label, value]) => ({ label, value }));
  return `<div class="intelligence-facts">${entries.slice(0, 6).map((fact) => `<span>${escapeHtml(fact.village || fact.label || fact.reliefId || fact.first || "Record")} <strong>${escapeHtml(fact.coverage !== undefined ? `${fact.coverage}%` : fact.value !== undefined ? fact.value : fact.score !== undefined ? `${fact.score}%` : fact.to || "")}</strong></span>`).join("")}</div>`;
}

async function renderIntelligence() {
  const suggestions = ["Which villages have low shelter coverage?", "Find possible duplicate households.", "How many families relocated from Village A?", "Is the audit ledger intact?"];
  view.innerHTML = `<section class="page intelligence-page">
    ${pageHeader("Data-grounded assistant", "Relief intelligence", "Ask operational questions. Answers are calculated from the current backend records, never invented.", `<span class="badge success">Live data only</span>`)}
    <div class="intelligence-layout"><aside class="panel intelligence-about"><div class="intelligence-orb">✦</div><h2>Ask RAHAT</h2><p class="muted">Use natural language to explore verified coverage, identity, movement, aid, and audit information.</p><div class="suggestion-list">${suggestions.map((item) => `<button class="suggestion" data-question="${escapeHtml(item)}">${escapeHtml(item)}</button>`).join("")}</div><div class="grounding-note"><strong>No hallucinated figures</strong><span>Every numerical answer includes its live RAHAT source.</span></div></aside>
      <section class="panel intelligence-chat"><div class="chat-thread" id="chatThread">${state.intelligenceMessages.length ? state.intelligenceMessages.map((message) => `<div class="chat-message user">${escapeHtml(message.question)}</div><div class="chat-message assistant"><span class="assistant-mark">✦</span><div><p>${escapeHtml(message.answer)}</p>${intelligenceFacts(message.facts)}<small>Source: ${escapeHtml(message.source)}</small></div></div>`).join("") : `<div class="chat-empty"><span>✦</span><strong>What would you like to know?</strong><p>Try one of the grounded questions or write your own.</p></div>`}</div><form id="intelligenceForm" class="chat-form"><input name="question" aria-label="Ask relief intelligence" placeholder="Ask about coverage, duplicates, relocation, aid…" required autocomplete="off"><button class="button primary" type="submit">Ask RAHAT</button></form></section>
    </div>
  </section>`;
  document.querySelector("#chatThread").scrollTop = document.querySelector("#chatThread").scrollHeight;
}

async function askIntelligence(question, form) {
  const cleanQuestion = String(question || "").trim();
  if (!cleanQuestion) return;
  const button = form?.querySelector("button");
  if (button) { button.disabled = true; button.textContent = "Analyzing…"; }
  try {
    const response = await api("/api/intelligence/query", { method: "POST", body: JSON.stringify({ question: cleanQuestion }) });
    state.intelligenceMessages.push({ question: cleanQuestion, ...response });
    await routeTo("intelligence", true);
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = "Ask RAHAT"; }
    toast(error.message, "error");
  }
}

const renderers = {
  home: renderHome,
  dashboard: renderDashboard,
  beneficiaries: renderBeneficiaries,
  profile: renderProfile,
  verification: renderVerification,
  distribution: renderDistribution,
  ledger: renderLedger,
  transparency: renderTransparency,
  donor: renderDonor,
  intelligence: renderIntelligence
};

async function routeTo(route, replace = false) {
  let target = route;
  let hashRoute = route;
  if (route.startsWith("profile/")) {
    target = "profile";
    state.profileId = decodeURIComponent(route.slice("profile/".length));
    hashRoute = `profile/${encodeURIComponent(state.profileId)}`;
  }
  if (!renderers[target] || (target === "profile" && !state.profileId)) {
    target = "home";
    hashRoute = "home";
  }
  if (!replace && location.hash !== `#${hashRoute}`) {
    location.hash = hashRoute;
    return;
  }
  state.route = target;
  if (replace) history.replaceState(null, "", `#${hashRoute}`);
  renderNavigation();
  sidebar.classList.remove("open");
  document.querySelector("#menuButton").setAttribute("aria-expanded", "false");
  showLoading();
  try {
    await renderers[target]();
    animateCounters();
    view.focus({ preventScroll: true });
    scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) {
    console.error(error);
    showError(error);
  }
}

let searchTimer;
document.addEventListener("input", (event) => {
  if (event.target.id !== "beneficiarySearch") return;
  state.search = event.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => routeTo("beneficiaries", true), 250);
});

document.addEventListener("change", (event) => {
  if (event.target.id === "statusFilter") {
    state.status = event.target.value;
    routeTo("beneficiaries", true);
  }
});

document.addEventListener("click", (event) => {
  const profileTarget = event.target.closest("[data-beneficiary-id]");
  if (profileTarget) return routeTo(`profile/${profileTarget.dataset.beneficiaryId}`);
  const routeButton = event.target.closest("[data-route]");
  if (routeButton) return routeTo(routeButton.dataset.route);
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "retry") routeTo(state.route, true);
  if (action === "close-modal") modal.close();
  if (action === "open-video") openVideo();
  if (action === "open-registration") openRegistration();
  if (action === "toggle-online") { state.online = !state.online; routeTo("distribution", true); }
  if (action === "sync-queue") syncQueue();
  if (action === "refresh-ledger") routeTo("ledger", true);
  if (action === "tamper-ledger") tamperLedger();
  if (action === "open-relocation") openRelocation();
  if (action === "print-profile") window.print();
  if (action === "download-report") downloadDonorReport();
  const decision = event.target.closest("[data-decision]");
  if (decision) submitDecision(decision);
  const mapMarker = event.target.closest("[data-map-village]");
  if (mapMarker) {
    state.search = mapMarker.dataset.mapVillage;
    routeTo("beneficiaries");
  }
  const suggestion = event.target.closest("[data-question]");
  if (suggestion) askIntelligence(suggestion.dataset.question);
});

document.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && event.target.matches("tr[data-beneficiary-id]")) {
    event.preventDefault();
    routeTo(`profile/${event.target.dataset.beneficiaryId}`);
  }
});

document.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.id === "distributionForm") submitDistribution(event.target);
  if (event.target.id === "modalForm" && event.target.dataset.action === "register-family") submitRegistration(event.target);
  if (event.target.id === "modalForm" && event.target.dataset.action === "relocate-family") submitRelocation(event.target);
  if (event.target.id === "intelligenceForm") askIntelligence(new FormData(event.target).get("question"), event.target);
});

document.querySelector("#menuButton").addEventListener("click", (event) => {
  const open = sidebar.classList.toggle("open");
  event.currentTarget.setAttribute("aria-expanded", String(open));
});

modal.addEventListener("close", () => {
  document.querySelector("#modalBody").replaceChildren();
  document.querySelector("#modalForm").dataset.action = "";
  modal.classList.remove("video-modal");
});

window.addEventListener("hashchange", () => routeTo(location.hash.slice(1) || "home", true));
window.addEventListener("online", async () => { state.online = true; toast("Connection restored"); if (state.pending.length) await syncQueue(); else if (state.route === "distribution") routeTo("distribution", true); });
window.addEventListener("offline", () => { state.online = false; toast("You are offline; field actions will be queued", "error"); if (state.route === "distribution") refreshPendingQueueView(); });

async function initialize() {
  try {
    await authenticate();
    updateUserPanel();
    state.pending = await readOfflineQueue();
    state.syncStatus = state.pending.length ? "pending" : "synced";
    renderNavigation();
    await routeTo(state.route, true);
    if (state.online && state.pending.length) syncQueue();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  } catch (error) {
    showError(error);
  }
}

initialize();
