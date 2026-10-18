# Royale Arena

A browser lane battle game with bot opponents and two-player room codes. One
Node server owns the simulation, serves the browser, and validates every card
deployment. Both players see the same battle; no Android emulator or original
game server is required.

## Run

Requires Node.js 22 or newer.

```sh
npm ci
npm start
```

Open **http://localhost:3000**. Choose **Battle a bot**, or **Create room** and
share the invitation link/code. The second player joins through the same server
address; joining starts a three-second countdown. Select one of four cards
(or use keys 1–4), then click/tap your half to deploy a troop. Spells can target
either half. Destroy the king tower or finish with more crowns. The final minute
has double elixir, followed by two minutes of sudden-death overtime and a
tower-health tiebreak. Matches start at six elixir, with a maximum of ten.

On the same Wi-Fi, the other player must open the host computer's LAN address,
such as `http://192.168.1.10:3000`, and use that address in the invitation link.
Allow the Node server through Windows Firewall if prompted. `localhost` points
to each player's own device. For internet play, deploy the **entire Node app**
to a host supporting persistent WebSockets and share its HTTPS URL. A static
GitHub Pages deployment alone cannot host rooms. The included Dockerfile runs
the same server; configure the host's `PORT` environment variable as needed.

## Development and checks

```sh
npm run dev
npm test
npm run check
npm run verify:assets
postman request http://localhost:3000/api/health --no-report-events --script-post-request @api/health-check.js
```

The game engine and HTTP/WebSocket integration tests use Node's test runner.
Run `npm run test:browser` for browser smoke checks using an installed Chrome
(`CHROME_CHANNEL=msedge` selects Edge). Screenshots go to ignored `.local/qa/`.
API source: [protocol](docs/protocol.md), [OpenAPI health endpoint](api/openapi.json).

## Reconstruction and assets

The supplied Android bundle is inspected locally with REA. Recovered portraits,
selected sounds/fonts, and decoded configuration provenance are documented in
[the investigation](docs/reverse-engineering.md). The original bundle and
extraction workspaces stay in ignored `.local/` paths or the Downloads folder.
The frontend, server, and simulation are new source code. This is a bounded
eight-card reconstruction; native client code, every card/arena, progression,
account services, and official server behavior are not ported.

Recovered game assets remain their original owners' material. This repository
does not grant a license to those assets. There is no connection to official
Clash Royale accounts or services.

## Operations

Rooms and matches live in memory and reset when the server restarts. Each room
holds exactly two players; a third player cannot join. Disconnecting forfeits an
active match. A rematch needs both human votes. There is no account identity or
reconnect/resume feature. Room codes are invitations; anyone who knows one can
take an open seat. Waiting rooms expire after ten minutes.

The server limits message size and command rate, checks browser WebSocket
origins, and never accepts client-submitted health, resource totals, or teams.
It is a single-process implementation: use a single replica, or add room routing
and authoritative room ownership before scaling to multiple processes. HTTPS,
process supervision, public-host limits, and traffic monitoring belong to the
deployment environment.
