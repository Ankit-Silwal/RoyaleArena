# Validation

The completed implementation was checked locally on Windows with Node.js 24
and installed Google Chrome. No official game service or APK code was executed.

- `npm test`: **21 passing tests**, covering deterministic combat, recovered
  card values, spawn timing, bridge and air movement, targeting, card cycling,
  spell waves, elixir phases, match outcomes, private snapshots, two-player
  rooms, team-bound commands, disconnects, both rematch votes, and origin checks.
- `npm run check`: server, engine, controller and renderer syntax checks pass.
- `npm run verify:assets`: **40 output hashes** match the extraction manifest.
- `npm run test:browser`: independent browser sessions create/join a room,
  preserve digit-containing invitations, deploy from both perspectives, display
  the correct opponent, fit the battlefield and hand on desktop and mobile,
  award a disconnect victory, start a bot battle, cast both spells with sound,
  and rematch. **No browser exceptions, console errors or failed HTTP responses**
  were observed. Spell UI checks use an explicit server-side test deck fixture;
  normal room checks use the actual shuffled starting deck.
- Postman local health request: HTTP 200 and **three passing assertions**
  for readiness and non-negative room count.
- Desktop, north-player and mobile screenshots were inspected visually. The
  repeatable browser script writes them to ignored `.local/qa/`.

Internet hosting, separate physical devices, network latency/loss, production
load, reconnect/resume, and Docker image execution remain unverified. The app
is not deployed to a public URL. Rooms require a running Node server and are
ephemeral. Original native animations and exact movement/pathfinding are not
reconstructed; see [artifact findings](reverse-engineering.md).
