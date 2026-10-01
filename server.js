const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const QRCode = require("qrcode");
const {
  beneficiaries: seedBeneficiaries,
  aidTotals: seedAidTotals,
  coverage,
  relocations: seedRelocations
} = require("./data/dummy-data");

const PORT = Number(process.env.RAHAT_PORT || process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const JWT_SECRET = process.env.JWT_SECRET || "rahat-demo-secret-change-in-production-2026";
const DEMO_PASSWORD = "RahatDemo!2026";

const beneficiaries = structuredClone(seedBeneficiaries);
const aidTotals = structuredClone(seedAidTotals);
const relocations = structuredClone(seedRelocations);
const distributions = [];
const decisions = [];
const ledger = [];

const ROLES = ["SUPER_ADMIN", "NGO_ADMIN", "FIELD_WORKER", "VERIFIER", "DONOR", "PUBLIC"];
const PRIVATE_ROLES = ROLES.filter((role) => role !== "PUBLIC");
const WRITE_ROLES = ["SUPER_ADMIN", "NGO_ADMIN", "FIELD_WORKER"];
const users = [
  { id: "USR-001", name: "Sana Khan", email: "sana@rahat.demo", role: "SUPER_ADMIN", organization: "RAHAT Coordination Cell" },
  { id: "USR-002", name: "Ali Raza", email: "field@rahat.demo", role: "FIELD_WORKER", organization: "Khairpur Relief Network" },
  { id: "USR-003", name: "Mariam Shah", email: "verifier@rahat.demo", role: "VERIFIER", organization: "Independent Verification Unit" },
  { id: "USR-004", name: "David Ahmed", email: "donor@rahat.demo", role: "DONOR", organization: "Sindh Recovery Fund" }
];

function passwordHash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

for (const user of users) {
  user.passwordSalt = crypto.createHash("sha256").update(`rahat:${user.id}`).digest("hex").slice(0, 32);
  user.passwordHash = passwordHash(DEMO_PASSWORD, user.passwordSalt);
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon"
};

function setCommonHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text, contentType, extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": contentType, ...extraHeaders });
  res.end(text);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw Object.assign(new Error("Request body is too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
  }
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function similarity(first, second) {
  const a = normalize(first);
  const b = normalize(second);
  if (!a && !b) return 1;
  const matrix = Array.from({ length: a.length + 1 }, (_, row) => Array(b.length + 1).fill(0).map((_, col) => row || col));
  for (let row = 1; row <= a.length; row += 1) {
    for (let col = 1; col <= b.length; col += 1) {
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + (a[row - 1] === b[col - 1] ? 0 : 1)
      );
    }
  }
  return 1 - matrix[a.length][b.length] / Math.max(a.length, b.length, 1);
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function signToken(user) {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ sub: user.id, name: user.name, email: user.email, role: user.role, exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60 }));
  const signature = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function verifyToken(token) {
  try {
    const [header, payload, signature] = String(token || "").split(".");
    if (!header || !payload || !signature) return null;
    const expected = crypto.createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
    const valid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!valid || decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return users.find((user) => user.id === decoded.sub) || null;
  } catch {
    return null;
  }
}

function authenticatedUser(req) {
  const authorization = req.headers.authorization || "";
  return verifyToken(authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
}

function requireRole(req, res, allowedRoles) {
  const user = authenticatedUser(req);
  if (!user) {
    sendJson(res, 401, { error: "Authentication is required" });
    return null;
  }
  if (!allowedRoles.includes(user.role)) {
    sendJson(res, 403, { error: `The ${user.role} role cannot perform this action` });
    return null;
  }
  return user;
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, organization: user.organization };
}

function actorName(user, fallback = "system") {
  return user ? `${user.name} (${user.role})` : fallback;
}

function canonical(entry) {
  return JSON.stringify({ id: entry.id, actor: entry.actor, action: entry.action, timestamp: entry.timestamp, previousHash: entry.previousHash });
}

function appendLedger(actor, action) {
  const previousHash = ledger.at(-1)?.hash || "GENESIS";
  const entry = {
    id: `TX-${String(1001 + ledger.length).padStart(4, "0")}`,
    actor,
    action,
    timestamp: new Date().toISOString(),
    previousHash
  };
  entry.hash = crypto.createHash("sha256").update(canonical(entry)).digest("hex");
  ledger.push(entry);
  return entry;
}

function verifyLedger() {
  let previousHash = "GENESIS";
  for (const [index, entry] of ledger.entries()) {
    const expectedHash = crypto.createHash("sha256").update(canonical(entry)).digest("hex");
    if (entry.previousHash !== previousHash || entry.hash !== expectedHash) return { valid: false, checked: index, brokenAt: entry.id };
    previousHash = entry.hash;
  }
  return { valid: true, checked: ledger.length, brokenAt: null };
}

function buildDuplicateCases() {
  const cases = [];
  for (let i = 0; i < beneficiaries.length; i += 1) {
    for (let j = i + 1; j < beneficiaries.length; j += 1) {
      const first = beneficiaries[i];
      const second = beneficiaries[j];
      const nameSimilarity = similarity(first.name, second.name);
      if (nameSimilarity >= 0.78) {
        const score = Math.min(99, Math.round(nameSimilarity * 80 + (first.members === second.members ? 10 : 0) + (first.village === second.village ? 5 : 0)));
        const id = [first.id, second.id].sort().join("__");
        cases.push({ id, score, first, second, nameSimilarity: Math.round(nameSimilarity * 100), decision: decisions.find((item) => item.caseId === id) || null });
      }
    }
  }
  return cases.sort((a, b) => b.score - a.score);
}

function buildDashboard() {
  const verified = beneficiaries.filter((item) => item.status === "Verified").length;
  const duplicateCases = buildDuplicateCases().filter((item) => !item.decision);
  return {
    stats: {
      registeredFamilies: beneficiaries.length,
      verifiedFamilies: verified,
      aidTransactions: distributions.length + 31204,
      relocatedFamilies: new Set(relocations.map((item) => item.reliefId)).size,
      duplicateAlerts: duplicateCases.length,
      auditIntegrity: verifyLedger().valid ? 100 : 0
    },
    aidTotals,
    mapPoints: coverage,
    alerts: [
      { tone: duplicateCases.length ? "warning" : "success", text: `${duplicateCases.length} duplicate clusters need verification` },
      { tone: "warning", text: "13 transactions are awaiting review" },
      { tone: verifyLedger().valid ? "success" : "warning", text: verifyLedger().valid ? "Audit chain integrity verified" : "Audit chain integrity requires attention" },
      { tone: "info", text: `${relocations.length} relocation records are being tracked` }
    ],
    recentActivity: ledger.slice(-5).reverse()
  };
}

function createBeneficiary(body, actor = "ngo.worker") {
  const name = String(body.name || "").trim();
  const village = String(body.village || "").trim();
  const members = Number(body.members);
  const knownVillages = new Set(coverage.map((item) => item.village));
  if (name.length < 3) throw Object.assign(new Error("Enter a valid household head name"), { status: 400 });
  if (!knownVillages.has(village)) throw Object.assign(new Error("Select a valid village"), { status: 400 });
  if (!Number.isInteger(members) || members < 1 || members > 30) throw Object.assign(new Error("Household members must be between 1 and 30"), { status: 400 });
  const potentialMatches = beneficiaries
    .map((item) => ({ beneficiary: item, score: Math.round(similarity(item.name, name) * 100) }))
    .filter((item) => item.score >= 80)
    .sort((a, b) => b.score - a.score);
  if (potentialMatches.length && !body.confirmDuplicate) throw Object.assign(new Error("A possible duplicate household was found"), { status: 409, matches: potentialMatches.slice(0, 4) });

  let id;
  do id = `RH-KHP-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  while (beneficiaries.some((item) => item.id === id));
  const beneficiary = { id, name, village, members, status: "Pending", lastAid: null, registeredAt: new Date().toISOString() };
  beneficiaries.unshift(beneficiary);
  appendLedger(actor, `Household registered ${id}`);
  return beneficiary;
}

function recordDistribution(body, actor = "ngo.worker") {
  const reliefId = String(body.reliefId || "");
  const aidType = String(body.aidType || "");
  const quantity = Number(body.quantity);
  const beneficiary = beneficiaries.find((item) => item.id === reliefId);
  if (!beneficiary) throw Object.assign(new Error("Beneficiary was not found"), { status: 404 });
  if (!Object.hasOwn(aidTotals, aidType)) throw Object.assign(new Error("Select a valid aid type"), { status: 400 });
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw Object.assign(new Error("Quantity must be between 1 and 100"), { status: 400 });
  const distribution = {
    id: `DIST-${String(4001 + distributions.length).padStart(5, "0")}`,
    reliefId,
    beneficiaryName: beneficiary.name,
    aidType,
    quantity,
    actor,
    timestamp: new Date().toISOString()
  };
  distributions.unshift(distribution);
  aidTotals[aidType] += quantity;
  beneficiary.lastAid = aidType;
  return { distribution, ledgerEntry: appendLedger(actor, `${aidType} ×${quantity} → ${reliefId}`) };
}

function recordRelocation(reliefId, body, actor = "field.worker") {
  const beneficiary = beneficiaries.find((item) => item.id === reliefId);
  if (!beneficiary) throw Object.assign(new Error("Beneficiary was not found"), { status: 404 });
  const currentLocation = String(body.currentLocation || "").trim();
  const knownVillages = new Set(coverage.map((item) => item.village));
  if (!knownVillages.has(currentLocation)) throw Object.assign(new Error("Select a valid destination"), { status: 400 });
  if (currentLocation === beneficiary.village) throw Object.assign(new Error("The destination must differ from the current location"), { status: 400 });
  const relocationDate = body.date ? new Date(body.date) : new Date();
  if (Number.isNaN(relocationDate.getTime())) throw Object.assign(new Error("Enter a valid relocation date"), { status: 400 });
  const relocation = {
    id: `REL-${String(2001 + relocations.length).padStart(4, "0")}`,
    reliefId,
    previousLocation: beneficiary.village,
    currentLocation,
    date: relocationDate.toISOString(),
    verificationStatus: body.verificationStatus === "Verified" ? "Verified" : "Pending",
    actor
  };
  relocations.unshift(relocation);
  beneficiary.village = currentLocation;
  appendLedger(actor, `Household relocated ${reliefId}: ${relocation.previousLocation} → ${currentLocation}`);
  return relocation;
}

function recordDecision(caseId, body, actor) {
  if (!["same", "different", "review"].includes(body.decision)) throw Object.assign(new Error("Invalid verification decision"), { status: 400 });
  if (!buildDuplicateCases().some((item) => item.id === caseId)) throw Object.assign(new Error("Verification case was not found"), { status: 404 });
  const existing = decisions.find((item) => item.caseId === caseId);
  const decision = existing || { caseId };
  Object.assign(decision, { value: body.decision, note: String(body.note || "").slice(0, 240), actor, timestamp: new Date().toISOString() });
  if (!existing) decisions.push(decision);
  appendLedger(actor, `Duplicate review: ${body.decision} (${caseId.replace("__", " / ")})`);
  return decision;
}

async function beneficiaryProfile(reliefId) {
  const beneficiary = beneficiaries.find((item) => item.id === reliefId);
  if (!beneficiary) return null;
  const householdRelocations = relocations.filter((item) => item.reliefId === reliefId).sort((a, b) => new Date(b.date) - new Date(a.date));
  const householdAid = distributions.filter((item) => item.reliefId === reliefId);
  if (!householdAid.length && beneficiary.lastAid) {
    householdAid.push({ id: `DIST-SEED-${reliefId.slice(-4)}`, reliefId, beneficiaryName: beneficiary.name, aidType: beneficiary.lastAid, quantity: 1, actor: "seed.demo", timestamp: beneficiary.registeredAt });
  }
  const timeline = [
    { type: "registration", title: "Household registered", detail: beneficiary.village, timestamp: beneficiary.registeredAt },
    ...(beneficiary.status === "Verified" ? [{ type: "verification", title: "Identity verified", detail: "Human verification completed", timestamp: beneficiary.registeredAt }] : []),
    ...householdAid.map((item) => ({ type: "aid", title: `${item.aidType} ×${item.quantity} distributed`, detail: item.id, timestamp: item.timestamp })),
    ...householdRelocations.map((item) => ({ type: "relocation", title: `Relocated to ${item.currentLocation}`, detail: `From ${item.previousLocation} · ${item.verificationStatus}`, timestamp: item.date }))
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const qrDataUrl = await QRCode.toDataURL(`https://rahat.demo/relief/${beneficiary.id}`, { errorCorrectionLevel: "H", margin: 1, width: 220, color: { dark: "#123f33", light: "#ffffff" } });
  return { beneficiary, relocations: householdRelocations, aidHistory: householdAid, timeline, qrDataUrl };
}

function buildTransparency() {
  const totalAid = Object.values(aidTotals).reduce((sum, value) => sum + value, 0);
  const verified = beneficiaries.filter((item) => item.status === "Verified").length;
  return {
    stats: {
      familiesAssisted: beneficiaries.length,
      aidDistributed: totalAid,
      villagesCovered: coverage.length,
      transactionsAudited: ledger.length,
      relocatedFamilies: new Set(relocations.map((item) => item.reliefId)).size,
      verificationRate: Math.round(verified / beneficiaries.length * 100)
    },
    coverage,
    aidTotals,
    updatedAt: new Date().toISOString(),
    demoData: true
  };
}

function answerIntelligence(question) {
  const query = normalize(question);
  if (!query) throw Object.assign(new Error("Enter a relief intelligence question"), { status: 400 });
  if (query.includes("low shelter") || (query.includes("shelter") && query.includes("coverage"))) {
    const villages = coverage.map((item) => ({ village: item.village, coverage: Math.round(item.shelter / item.families * 100), families: item.families, shelter: item.shelter })).sort((a, b) => a.coverage - b.coverage);
    const low = villages.filter((item) => item.coverage < 50);
    return { answer: `${low.map((item) => item.village).join(", ")} ${low.length === 1 ? "has" : "have"} shelter coverage below 50%.`, facts: low, source: "Live village coverage records" };
  }
  if (query.includes("duplicate")) {
    const cases = buildDuplicateCases().filter((item) => !item.decision);
    return { answer: `There are ${cases.length} unresolved potential duplicate ${cases.length === 1 ? "case" : "cases"}. Human verification is required before linking records.`, facts: cases.slice(0, 5).map((item) => ({ score: item.score, first: item.first.id, second: item.second.id })), source: "Live duplicate-detection results" };
  }
  if (query.includes("relocat")) {
    const village = coverage.find((item) => query.includes(normalize(item.village)))?.village;
    const matches = village ? relocations.filter((item) => normalize(item.previousLocation) === normalize(village)) : relocations;
    return { answer: village ? `${matches.length} ${matches.length === 1 ? "family has" : "families have"} relocated from ${village}.` : `${new Set(relocations.map((item) => item.reliefId)).size} families have a recorded relocation.`, facts: matches.map((item) => ({ reliefId: item.reliefId, from: item.previousLocation, to: item.currentLocation, status: item.verificationStatus })), source: "Live relocation records" };
  }
  if (query.includes("verified") || query.includes("verification")) {
    const verified = beneficiaries.filter((item) => item.status === "Verified").length;
    return { answer: `${verified} of ${beneficiaries.length} households are verified (${Math.round(verified / beneficiaries.length * 100)}%).`, facts: [{ verified, total: beneficiaries.length }], source: "Live household registry" };
  }
  if (query.includes("aid") || query.includes("food") || query.includes("water") || query.includes("medicine")) {
    const total = Object.values(aidTotals).reduce((sum, value) => sum + value, 0);
    return { answer: `${total.toLocaleString("en-PK")} aid units are recorded across ${Object.keys(aidTotals).length} categories.`, facts: aidTotals, source: "Live aid transaction totals" };
  }
  if (query.includes("audit") || query.includes("integrity")) {
    const integrity = verifyLedger();
    return { answer: integrity.valid ? `The audit chain is intact. ${integrity.checked} records were verified.` : `The audit chain is compromised at ${integrity.brokenAt}.`, facts: [integrity], source: "SHA-256 audit chain verification" };
  }
  return { answer: "I can answer questions about shelter coverage, duplicates, relocations, verification, aid totals, and audit integrity. I will not estimate statistics that are not present in the RAHAT data.", facts: [], source: "RAHAT supported-query policy" };
}

function donorCsv() {
  const transparency = buildTransparency();
  const rows = [
    ["RAHAT DONOR IMPACT REPORT", "DEMO DATA"],
    ["Generated", new Date().toISOString()],
    [],
    ["Metric", "Value"],
    ["Families assisted", transparency.stats.familiesAssisted],
    ["Aid units distributed", transparency.stats.aidDistributed],
    ["Villages covered", transparency.stats.villagesCovered],
    ["Relocated families", transparency.stats.relocatedFamilies],
    ["Verification rate", `${transparency.stats.verificationRate}%`],
    ["Audit records", transparency.stats.transactionsAudited],
    [],
    ["Village", "Families", "Verified", "Shelter coverage", "Relocated"],
    ...coverage.map((item) => [item.village, item.families, item.verified, `${Math.round(item.shelter / item.families * 100)}%`, item.relocated])
  ];
  return rows.map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
}

async function handleSyncItem(item, actor) {
  const payload = item.payload || item;
  if (item.type === "registration") return { beneficiary: createBeneficiary({ ...payload, confirmDuplicate: true }, actor) };
  if (item.type === "relocation") return { relocation: recordRelocation(payload.reliefId, payload, actor) };
  if (item.type === "verification") return { decision: recordDecision(payload.caseId, payload, actor) };
  if (item.type === "distribution" || !item.type) return recordDistribution(payload, actor);
  throw Object.assign(new Error("Unsupported offline action"), { status: 400 });
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") return sendJson(res, 200, { status: "ok", service: "RAHAT API", version: "1.1.0" });
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readJson(req);
    const user = users.find((item) => normalize(item.email) === normalize(body.email));
    if (!user || passwordHash(String(body.password || ""), user.passwordSalt) !== user.passwordHash) return sendJson(res, 401, { error: "Invalid email or password" });
    return sendJson(res, 200, { token: signToken(user), user: publicUser(user), expiresIn: 28800 });
  }
  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const user = requireRole(req, res, PRIVATE_ROLES);
    return user && sendJson(res, 200, { user: publicUser(user) });
  }
  if (req.method === "GET" && url.pathname === "/api/transparency") return sendJson(res, 200, buildTransparency());

  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    const user = requireRole(req, res, PRIVATE_ROLES);
    return user && sendJson(res, 200, buildDashboard());
  }
  if (req.method === "GET" && url.pathname === "/api/beneficiaries") {
    const user = requireRole(req, res, PRIVATE_ROLES);
    if (!user) return;
    const query = normalize(url.searchParams.get("q"));
    const status = url.searchParams.get("status");
    const items = beneficiaries.filter((item) => {
      const searchable = normalize(`${item.id} ${item.name} ${item.village}`);
      return (!query || searchable.includes(query)) && (!status || status === "All" || item.status === status);
    });
    return sendJson(res, 200, { items, total: items.length });
  }
  if (req.method === "POST" && url.pathname === "/api/beneficiaries") {
    const user = requireRole(req, res, WRITE_ROLES);
    if (!user) return;
    try {
      return sendJson(res, 201, { beneficiary: createBeneficiary(await readJson(req), actorName(user)) });
    } catch (error) {
      return sendJson(res, error.status || 500, { error: error.message, matches: error.matches });
    }
  }

  const relocationMatch = url.pathname.match(/^\/api\/beneficiaries\/([^/]+)\/relocations$/);
  if (req.method === "POST" && relocationMatch) {
    const user = requireRole(req, res, ["SUPER_ADMIN", "NGO_ADMIN", "FIELD_WORKER", "VERIFIER"]);
    if (!user) return;
    try {
      const relocation = recordRelocation(decodeURIComponent(relocationMatch[1]), await readJson(req), actorName(user));
      return sendJson(res, 201, { relocation });
    } catch (error) {
      return sendJson(res, error.status || 500, { error: error.message });
    }
  }

  const beneficiaryMatch = url.pathname.match(/^\/api\/beneficiaries\/([^/]+)$/);
  if (req.method === "GET" && beneficiaryMatch) {
    const user = requireRole(req, res, PRIVATE_ROLES);
    if (!user) return;
    const profile = await beneficiaryProfile(decodeURIComponent(beneficiaryMatch[1]));
    return profile ? sendJson(res, 200, profile) : sendJson(res, 404, { error: "Beneficiary was not found" });
  }

  if (req.method === "GET" && url.pathname === "/api/verification-cases") {
    const user = requireRole(req, res, ["SUPER_ADMIN", "NGO_ADMIN", "VERIFIER"]);
    return user && sendJson(res, 200, { items: buildDuplicateCases().slice(0, 25) });
  }
  const decisionMatch = url.pathname.match(/^\/api\/verification-cases\/(.+)\/decision$/);
  if (req.method === "POST" && decisionMatch) {
    const user = requireRole(req, res, ["SUPER_ADMIN", "VERIFIER"]);
    if (!user) return;
    try {
      const decision = recordDecision(decodeURIComponent(decisionMatch[1]), await readJson(req), actorName(user));
      return sendJson(res, 200, { decision });
    } catch (error) {
      return sendJson(res, error.status || 500, { error: error.message });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/distributions") {
    const user = requireRole(req, res, PRIVATE_ROLES);
    return user && sendJson(res, 200, { aidTypes: Object.keys(aidTotals), items: distributions.slice(0, 20) });
  }
  if (req.method === "POST" && url.pathname === "/api/distributions") {
    const user = requireRole(req, res, WRITE_ROLES);
    if (!user) return;
    try {
      return sendJson(res, 201, recordDistribution(await readJson(req), actorName(user)));
    } catch (error) {
      return sendJson(res, error.status || 500, { error: error.message });
    }
  }
  if (req.method === "POST" && ["/api/distributions/sync", "/api/sync"].includes(url.pathname)) {
    const user = requireRole(req, res, WRITE_ROLES);
    if (!user) return;
    const body = await readJson(req);
    if (!Array.isArray(body.items) || body.items.length > 100) return sendJson(res, 400, { error: "Provide a queue of up to 100 records" });
    const results = [];
    for (const item of body.items) {
      try {
        results.push({ clientId: item.clientId, ok: true, ...(await handleSyncItem(item, actorName(user))) });
      } catch (error) {
        results.push({ clientId: item.clientId, ok: false, error: error.message });
      }
    }
    return sendJson(res, 200, { results });
  }

  if (req.method === "GET" && url.pathname === "/api/ledger") {
    const user = requireRole(req, res, PRIVATE_ROLES);
    return user && sendJson(res, 200, { integrity: verifyLedger(), items: ledger.slice().reverse() });
  }
  if (req.method === "POST" && url.pathname === "/api/ledger/tamper") {
    const user = requireRole(req, res, ["SUPER_ADMIN"]);
    if (!user) return;
    if (ledger.length < 2) return sendJson(res, 400, { error: "Create at least two ledger entries first" });
    ledger[1].action += " [EDITED: quantity 5 → 500]";
    return sendJson(res, 200, { integrity: verifyLedger() });
  }

  if (req.method === "GET" && url.pathname === "/api/donor") {
    const user = requireRole(req, res, ["SUPER_ADMIN", "NGO_ADMIN", "DONOR"]);
    return user && sendJson(res, 200, { ...buildTransparency(), auditIntegrity: verifyLedger(), campaigns: [{ id: "CMP-KHP-2026", name: "Khairpur Flood Response", status: "Active", partners: 6, fundingUtilization: 72 }] });
  }
  if (req.method === "GET" && url.pathname === "/api/donor/report.csv") {
    const user = requireRole(req, res, ["SUPER_ADMIN", "NGO_ADMIN", "DONOR"]);
    if (!user) return;
    appendLedger(actorName(user), "Generated donor impact report");
    return sendText(res, 200, donorCsv(), "text/csv; charset=utf-8", { "Content-Disposition": "attachment; filename=rahat-donor-impact-report.csv" });
  }
  if (req.method === "POST" && url.pathname === "/api/intelligence/query") {
    const user = requireRole(req, res, PRIVATE_ROLES);
    if (!user) return;
    try {
      const body = await readJson(req);
      return sendJson(res, 200, answerIntelligence(body.question));
    } catch (error) {
      return sendJson(res, error.status || 500, { error: error.message });
    }
  }
  return sendJson(res, 404, { error: "API route not found" });
}

function serveStatic(res, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(PUBLIC_DIR, `.${decodeURIComponent(requestedPath)}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) return sendJson(res, 403, { error: "Forbidden" });
  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") return sendJson(res, 404, { error: "File not found" });
      return sendJson(res, 500, { error: "Unable to read file" });
    }
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}

appendLedger("system", "Genesis: Khairpur Flood Relief campaign opened (demo)");
appendLedger("Mariam Shah (VERIFIER)", "Household verified RH-KHP-7F92A1");
appendLedger("Ali Raza (FIELD_WORKER)", "Food package ×1 → RH-KHP-7F92A1");
for (const relocation of relocations) appendLedger(relocation.actor, `Relocation recorded ${relocation.reliefId}: ${relocation.previousLocation} → ${relocation.currentLocation}`);

const server = http.createServer(async (req, res) => {
  setCommonHeaders(res);
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else if (req.method === "GET") serveStatic(res, url.pathname);
    else sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, error.status || 500, { error: error.status ? error.message : "Unexpected server error" });
  }
});

if (require.main === module) server.listen(PORT, () => console.log(`RAHAT is running at http://localhost:${PORT}`));

module.exports = { server, similarity, verifyLedger, signToken };
