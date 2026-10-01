# RAHAT — Verifiable Disaster Relief

A full-stack demonstration dashboard for coordinating disaster-relief beneficiaries, identity review, aid distribution, and public accountability.

## Run locally

Requirements: Node.js 20 or newer.

```powershell
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). For automatic restarts while editing, use `npm run dev`.

## Verify the project

```powershell
npm test
```

## Project structure

- `server.js` — dependency-free HTTP server and REST API
- `data/dummy-data.js` — clearly separated demonstration records
- `public/index.html` — application shell and accessible dialog markup
- `public/styles.css` — responsive visual system
- `public/app.js` — API client, routing, offline queue, and user interactions
- `test/server.test.js` — API and validation smoke tests

## Available workflows

- Search and filter beneficiary records.
- Register a family, with potential-duplicate warnings and explicit confirmation.
- Review AI-assisted duplicate signals and record a human decision.
- Record aid online or queue it locally while offline, then synchronize in a batch.
- Open a household profile with a real QR identity, complete timeline, aid history, and relocation history.
- Register, verify, relocate, and distribute aid offline using IndexedDB, then synchronize all actions.
- Inspect and verify the SHA-256 audit chain or deliberately demonstrate tamper detection.
- View a privacy-safe public transparency dashboard.
- Explore the coverage map, use the grounded relief-intelligence assistant, and export a donor report.
- Authenticate using signed JWTs with backend-enforced role permissions.

The data is fictional and stored in memory. Restarting the server restores the original dummy dataset. Browser-side pending offline records remain in IndexedDB until synchronized.

The seed contains 56 fictional households across 10 locations. Offline field actions are stored in IndexedDB, with `localStorage` used only as a compatibility fallback.
