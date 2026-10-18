import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { WebSocket } from "ws";
import { createArenaServer } from "../server/index.js";
import { CARDS, step } from "../shared/game.js";

async function setup(t) {
  const arena = createArenaServer();
  arena.server.listen(0, "127.0.0.1");
  await once(arena.server, "listening");
  const base = `http://127.0.0.1:${arena.server.address().port}`;
  t.after(() => arena.close());
  async function client() {
    const ws = new WebSocket(base.replace("http", "ws") + "/ws");
    const queue = [];
    const listeners = new Set();
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw);
      queue.push(msg);
      for (const fn of listeners) fn();
    });
    await once(ws, "open");
    function next(predicate) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(check);
          reject(new Error("Timed out waiting for server message"));
        }, 3000);
        function check() {
          const index = queue.findIndex(predicate);
          if (index < 0) return;
          clearTimeout(timer);
          listeners.delete(check);
          resolve(queue.splice(index, 1)[0]);
        }
        listeners.add(check);
        check();
      });
    }
    return { ws, next, send: (data) => ws.send(JSON.stringify(data)) };
  }
  return { ...arena, base, client };
}

test("health and static server restrict filesystem exposure", async (t) => {
  const { base } = await setup(t);
  const health = await fetch(base + "/api/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, rooms: 0 });
  for (const url of [
    "/package.json",
    "/.git/config",
    "/server/index.js",
    "/%2e%2e%2fpackage.json",
    "/%00",
  ]) {
    const res = await fetch(base + url);
    assert.ok([403, 404].includes(res.status), `${url}: ${res.status}`);
  }
  const script = await fetch(base + "/shared/game.js");
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /javascript/);
  assert.equal(
    (await fetch(base + "/api/health", { method: "POST" })).status,
    405,
  );
});

test("two clients join a room, receive private views, reject a third, forfeit on disconnect", async (t) => {
  const arena = await setup(t);
  const a = await arena.client(),
    b = await arena.client(),
    c = await arena.client();
  a.send({ type: "create", name: "Alice" });
  const joinedA = await a.next((m) => m.type === "joined");
  assert.match(joinedA.room, /^[A-Z2-9]{6}$/);
  assert.equal((await a.next((m) => m.type === "state")).game, null);
  b.send({ type: "join", room: joinedA.room.toLowerCase(), name: "Bob" });
  const joinedB = await b.next((m) => m.type === "joined");
  assert.equal(joinedB.team, 1);
  const stateA = await a.next((m) => m.type === "state" && m.game);
  const stateB = await b.next((m) => m.type === "state" && m.game);
  assert.equal(stateA.game.phase, "countdown");
  assert.equal(stateA.game.hand.length, 4);
  assert.equal(typeof stateA.game.elixir, "number");
  assert.equal(
    stateA.game.players,
    undefined,
    "opponent hand and resources stay private",
  );
  assert.deepEqual(
    stateB.players.map((p) => p.name),
    ["Alice", "Bob"],
  );
  c.send({ type: "join", room: joinedA.room, name: "Mallory" });
  assert.equal((await c.next((m) => m.type === "error")).code, "ROOM_FULL");
  a.send({ type: "deploy", slot: 0, x: 4, y: 20, team: 1 });
  assert.equal(
    (await a.next((m) => m.type === "error")).code,
    "INVALID_DEPLOY",
  );
  b.ws.close();
  const end = await a.next(
    (m) => m.type === "state" && m.game?.phase === "finished",
  );
  assert.equal(end.game.winner, 0);
  a.send({ type: "rematch" });
  assert.equal((await a.next((m) => m.type === "error")).code, "OPPONENT_LEFT");
  a.send({ type: "leave" });
  await a.next((m) => m.type === "left");
  assert.equal(arena.rooms.size, 0);
});

test("invalid commands, missing rooms, bot match and rematch are handled", async (t) => {
  const arena = await setup(t),
    a = await arena.client();
  a.ws.send("{invalid");
  assert.equal(
    (await a.next((m) => m.type === "error")).code,
    "INVALID_MESSAGE",
  );
  a.send({ type: "join", room: "NOPE00" });
  assert.equal(
    (await a.next((m) => m.type === "error")).code,
    "ROOM_NOT_FOUND",
  );
  a.send({ type: "bot", name: "Player", difficulty: "hard" });
  const joined = await a.next((m) => m.type === "joined");
  const room = arena.rooms.get(joined.room);
  const state = await a.next((m) => m.type === "state" && m.game);
  assert.equal(state.players[1].name, "Hard Bot");
  room.game.phase = "finished";
  room.game.winner = 0;
  a.send({ type: "rematch" });
  const restarted = await a.next(
    (m) =>
      m.type === "state" &&
      m.game?.phase === "countdown" &&
      m.rematch.every((v) => !v),
  );
  assert.equal(restarted.game.winner, null);
  a.send({ type: "leave" });
  await a.next((m) => m.type === "left");
  assert.equal(arena.rooms.size, 0);
});

test("deployment binds the authenticated socket team and protects server resources", async (t) => {
  const arena = await setup(t),
    a = await arena.client(),
    b = await arena.client();
  a.send({ type: "create", name: "South" });
  const joined = await a.next((m) => m.type === "joined");
  b.send({ type: "join", room: joined.room, name: "North" });
  await b.next((m) => m.type === "joined");
  const game = arena.rooms.get(joined.room).game;
  step(game, 3);
  for (const [team, client] of [
    [0, a],
    [1, b],
  ]) {
    const slot = game.players[team].hand.findIndex(
      (id) => CARDS.find((c) => c.id === id).kind === "troop",
    );
    const card = CARDS.find((c) => c.id === game.players[team].hand[slot]);
    const before = game.players[team].elixir;
    client.send({
      type: "deploy",
      slot,
      x: 4,
      y: team === 0 ? 8 : 24,
      elixir: 999,
      team: 1 - team,
    });
    assert.equal(
      (await client.next((m) => m.type === "error")).code,
      "INVALID_DEPLOY",
    );
    assert.ok(
      game.players[team].elixir >= before,
      "invalid placement did not spend elixir",
    );
    client.send({
      type: "deploy",
      slot,
      x: 4,
      y: team === 0 ? 21 : 11,
      team: 1 - team,
    });
    await client.next(
      (m) => m.type === "state" && m.game?.units.some((u) => u.team === team),
    );
    assert.equal(game.units.filter((u) => u.team === team).length, card.count);
    assert.ok(game.players[team].elixir < before);
  }
});

test("cross-origin browser websocket attempts are rejected", async (t) => {
  const { base } = await setup(t);
  const ws = new WebSocket(base.replace("http", "ws") + "/ws", {
    origin: "https://unrelated.example",
  });
  ws.on("error", () => {});
  const [, response] = await once(ws, "unexpected-response");
  assert.equal(response.statusCode, 403);
  ws.terminate();
});

test("human rematch requires both votes and a host cannot join their own room", async (t) => {
  const arena = await setup(t),
    a = await arena.client(),
    b = await arena.client();
  a.send({ type: "create", name: "Host" });
  const joined = await a.next((m) => m.type === "joined");
  a.send({ type: "join", room: joined.room, name: "Host" });
  assert.equal(
    (await a.next((m) => m.type === "error")).code,
    "ALREADY_IN_ROOM",
  );
  assert.ok(arena.rooms.has(joined.room));
  b.send({ type: "join", room: joined.room, name: "Guest" });
  await b.next((m) => m.type === "joined");
  const room = arena.rooms.get(joined.room),
    original = room.game;
  original.phase = "finished";
  original.winner = 0;
  a.send({ type: "rematch" });
  await a.next((m) => m.type === "state" && m.rematch[0]);
  assert.equal(room.game, original, "one vote does not restart the match");
  assert.equal(room.game.phase, "finished");
  b.send({ type: "rematch" });
  await b.next((m) => m.type === "state" && m.game?.phase === "countdown" && room.game !== original);
  assert.notEqual(room.game, original);
  assert.deepEqual(room.votes, [false, false]);
  assert.deepEqual(
    room.seats.map((p) => p.name),
    ["Host", "Guest"],
  );
});
