const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { server, similarity } = require("../server");

let baseUrl;
let token;

function authorizedFetch(path, options = {}) {
  return fetch(`${baseUrl}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
}

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "sana@rahat.demo", password: "RahatDemo!2026" })
  });
  const session = await login.json();
  token = session.token;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("name similarity identifies the seeded potential duplicate", () => {
  assert.ok(similarity("Fatima Bibi", "Fatema Bibi") > 0.8);
});

test("health and dashboard endpoints return API data", async () => {
  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
  assert.equal(health.status, "ok");

  const dashboard = await authorizedFetch("/api/dashboard").then((response) => response.json());
  assert.ok(dashboard.stats.registeredFamilies >= 50);
  assert.equal(Object.keys(dashboard.aidTotals).length, 4);
  assert.equal(dashboard.mapPoints.length, 10);
});

test("beneficiary search filters dummy data", async () => {
  const response = await authorizedFetch("/api/beneficiaries?q=Ghulam").then((result) => result.json());
  assert.equal(response.total, 1);
  assert.equal(response.items[0].id, "RH-KHP-3C10D4");
});

test("registration requires explicit confirmation for a possible duplicate", async () => {
  const household = { name: "Fatima Bibi", village: "Village C", members: 6 };
  const warning = await authorizedFetch("/api/beneficiaries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(household)
  });
  assert.equal(warning.status, 409);
  const warningBody = await warning.json();
  assert.ok(warningBody.matches.length >= 1);

  const confirmed = await authorizedFetch("/api/beneficiaries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...household, confirmDuplicate: true })
  });
  assert.equal(confirmed.status, 201);
  const result = await confirmed.json();
  assert.equal(result.beneficiary.status, "Pending");
});

test("distribution creation validates and records a transaction", async () => {
  const response = await authorizedFetch("/api/distributions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reliefId: "RH-KHP-3C10D4", aidType: "Water", quantity: 2 })
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.distribution.quantity, 2);
  assert.match(result.ledgerEntry.id, /^TX-/);
});

test("offline sync accepts valid records and reports invalid ones", async () => {
  const response = await authorizedFetch("/api/distributions/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [
      { clientId: "local-1", reliefId: "RH-KHP-7F92A1", aidType: "Medicine", quantity: 1 },
      { clientId: "local-2", reliefId: "missing", aidType: "Water", quantity: 1 }
    ] })
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.results[0].ok, true);
  assert.equal(result.results[1].ok, false);
});

test("household profile returns a scannable QR identity and timeline", async () => {
  const response = await authorizedFetch("/api/beneficiaries/RH-KHP-7F92A1");
  assert.equal(response.status, 200);
  const profile = await response.json();
  assert.match(profile.qrDataUrl, /^data:image\/png;base64,/);
  assert.ok(profile.timeline.length >= 2);
});

test("relocation preserves the Relief ID and updates history", async () => {
  const response = await authorizedFetch("/api/beneficiaries/RH-KHP-3C10D4/relocations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentLocation: "Gambat", verificationStatus: "Verified", date: "2026-10-01" })
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.relocation.reliefId, "RH-KHP-3C10D4");
  const profile = await authorizedFetch("/api/beneficiaries/RH-KHP-3C10D4").then((item) => item.json());
  assert.equal(profile.beneficiary.village, "Gambat");
});

test("relief intelligence answers from live backend data", async () => {
  const response = await authorizedFetch("/api/intelligence/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "Which villages have low shelter coverage?" })
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.match(result.source, /Live/);
  assert.ok(result.facts.length >= 1);
});

test("backend RBAC prevents a donor from registering households", async () => {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "donor@rahat.demo", password: "RahatDemo!2026" })
  }).then((response) => response.json());
  const response = await fetch(`${baseUrl}/api/beneficiaries`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({ name: "Restricted User", village: "Gambat", members: 4 })
  });
  assert.equal(response.status, 403);
});

test("path traversal outside public is rejected", async () => {
  const response = await fetch(`${baseUrl}/..%2Fserver.js`);
  assert.ok([403, 404].includes(response.status));
});
