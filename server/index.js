import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomInt } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
  CARDS,
  createGame,
  deploy,
  step,
  viewFor,
  forfeit,
} from "../shared/game.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ogg": "audio/ogg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
};

export function createArenaServer({ heartbeatMs = 30000 } = {}) {
  const rooms = new Map();
  const peers = new Set();
  let stopped = false;
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      return res.end();
    }
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
    } catch {
      res.writeHead(400);
      return res.end("Bad URL");
    }
    if (pathname === "/api/health") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      return res.end(
        req.method === "HEAD"
          ? undefined
          : JSON.stringify({ ok: true, rooms: rooms.size }),
      );
    }
    const base = path.join(root, "public");
    let target = path.resolve(
      base,
      `.${pathname === "/" ? "/index.html" : pathname}`,
    );
    if (pathname === "/shared/game.js")
      target = path.join(root, "shared/game.js");
    else if (!target.startsWith(base + path.sep)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    try {
      if (!(await stat(target)).isFile()) throw new Error("not file");
      const content = await readFile(target);
      res.writeHead(200, {
        "Content-Type":
          mime[path.extname(target)] || "application/octet-stream",
        "Cache-Control": pathname.startsWith("/assets/")
          ? "public, max-age=3600"
          : "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 2048,
    perMessageDeflate: false,
  });
  server.on("upgrade", (req, socket, head) => {
    let allowed = req.url === "/ws";
    if (req.headers.origin) {
      try {
        allowed &&= new URL(req.headers.origin).host === req.headers.host;
      } catch {
        allowed = false;
      }
    }
    if (!allowed || peers.size >= 2048) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });

  const send = (ws, data) => {
    if (ws?.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > 256 * 1024) {
        ws.close(1013, "Connection too slow");
        return;
      }
      ws.send(JSON.stringify(data));
    }
  };
  const error = (ws, code, message) =>
    send(ws, { type: "error", code, message });
  const snapshot = (room) => {
    room.seats.forEach((seat, team) => {
      if (seat?.ws)
        send(seat.ws, {
          type: "state",
          room: room.code,
          team,
          players: room.seats.map((p) => ({
            name: p?.name || "Waiting for opponent",
            connected: Boolean(p?.bot || p?.ws?.readyState === WebSocket.OPEN),
          })),
          game: room.game ? viewFor(room.game, team) : null,
          rematch: room.votes,
        });
    });
  };
  const begin = (room) => {
    room.game = createGame({ seed: randomInt(0x100000000) });
    room.votes = [false, false];
    room.botDelay = 2.5;
    room.updatedAt = Date.now();
    snapshot(room);
  };
  const leave = (ws) => {
    const room = rooms.get(ws.room);
    if (!room) {
      ws.room = null;
      return;
    }
    const team = room.seats.findIndex((p) => p?.ws === ws);
    if (team < 0) return;
    room.seats[team] = null;
    if (room.game && room.game.phase !== "finished") forfeit(room.game, team);
    room.updatedAt = Date.now();
    ws.room = null;
    ws.team = null;
    if (!room.seats.some((p) => p?.ws)) rooms.delete(room.code);
    else snapshot(room);
  };
  const joinSeat = (ws, room, team, name) => {
    leave(ws);
    room.seats[team] = { ws, name };
    ws.room = room.code;
    ws.team = team;
    room.updatedAt = Date.now();
    send(ws, { type: "joined", room: room.code, team, mode: room.mode });
    if (room.seats.every(Boolean)) begin(room);
    else snapshot(room);
  };
  const nameOf = (value) =>
    typeof value === "string"
      ? Array.from(value.replace(/[\p{Cc}\p{Cf}]/gu, "").trim())
          .slice(0, 20)
          .join("") || "Challenger"
      : "Challenger";
  wss.on("connection", (ws) => {
    peers.add(ws);
    ws.alive = true;
    ws.rate = { start: Date.now(), count: 0 };
    ws.on("pong", () => {
      ws.alive = true;
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      leave(ws);
      peers.delete(ws);
    });
    ws.on("message", (data, binary) => {
      const now = Date.now();
      if (now - ws.rate.start >= 1000) ws.rate = { start: now, count: 0 };
      if (++ws.rate.count > 30) {
        error(ws, "RATE_LIMIT", "Too many commands. Try again in a moment.");
        return;
      }
      let message;
      try {
        if (binary) throw new Error();
        message = JSON.parse(data.toString());
        if (!message || Array.isArray(message) || typeof message !== "object")
          throw new Error();
      } catch {
        return error(ws, "INVALID_MESSAGE", "Send a JSON command.");
      }
      const room = rooms.get(ws.room);
      switch (message.type) {
        case "create":
        case "bot": {
          if (rooms.size >= 1024)
            return error(
              ws,
              "SERVER_FULL",
              "The arena is full. Please try later.",
            );
          let code;
          do {
            code = Array.from(
              { length: 6 },
              () => alphabet[randomInt(alphabet.length)],
            ).join("");
          } while (rooms.has(code));
          const bot = message.type === "bot";
          const difficulty = ["easy", "normal", "hard"].includes(
            message.difficulty,
          )
            ? message.difficulty
            : "normal";
          const newRoom = {
            code,
            seats: [
              null,
              bot
                ? {
                    bot: true,
                    name: `${difficulty[0].toUpperCase() + difficulty.slice(1)} Bot`,
                  }
                : null,
            ],
            mode: bot ? "bot" : "room",
            difficulty,
            game: null,
            votes: [false, false],
            updatedAt: now,
          };
          rooms.set(code, newRoom);
          joinSeat(ws, newRoom, 0, nameOf(message.name));
          break;
        }
        case "join": {
          const code =
            typeof message.room === "string"
              ? message.room.trim().toUpperCase()
              : "";
          const target = rooms.get(code);
          if (!target)
            return error(
              ws,
              "ROOM_NOT_FOUND",
              "Room not found. Check the six-character code.",
            );
          if (target === room)
            return error(
              ws,
              "ALREADY_IN_ROOM",
              "You are already in this room. Share its code with your opponent.",
            );
          if (
            target.mode !== "room" ||
            target.game ||
            target.seats.every(Boolean)
          )
            return error(
              ws,
              "ROOM_FULL",
              "That room has already started. Create a new room to play.",
            );
          joinSeat(ws, target, target.seats[0] ? 1 : 0, nameOf(message.name));
          break;
        }
        case "deploy": {
          if (!room?.game)
            return error(ws, "NOT_IN_ROOM", "Join a match first.");
          const result = deploy(
            room.game,
            ws.team,
            message.slot,
            message.x,
            message.y,
          );
          if (!result.ok) error(ws, "INVALID_DEPLOY", result.error);
          break;
        }
        case "rematch": {
          if (!room?.game || room.game.phase !== "finished")
            return error(
              ws,
              "INVALID_MESSAGE",
              "Finish the current match first.",
            );
          if (!room.seats.every(Boolean))
            return error(
              ws,
              "OPPONENT_LEFT",
              "Your opponent left. Create a new room.",
            );
          room.votes[ws.team] = true;
          if (room.mode === "bot") room.votes[1] = true;
          if (room.votes.every(Boolean)) begin(room);
          else snapshot(room);
          break;
        }
        case "leave":
          leave(ws);
          send(ws, { type: "left" });
          break;
        case "ping":
          send(ws, { type: "pong" });
          break;
        default:
          error(ws, "INVALID_MESSAGE", "Unknown arena command.");
      }
    });
  });

  function playBot(room, dt) {
    const game = room.game;
    if (game.phase !== "playing") return;
    room.botDelay -= dt;
    if (room.botDelay > 0) return;
    const level = room.difficulty;
    room.botDelay = level === "easy" ? 3.5 : level === "hard" ? 0.9 : 1.8;
    const state = viewFor(game, 1);
    const cards = state.hand
      .map((id, slot) => ({ card: CARDS.find((c) => c.id === id), slot }))
      .filter(({ card }) => card && card.cost <= state.elixir);
    if (!cards.length) return;
    const threats = game.units.filter((u) => u.team === 0 && u.y < 15);
    let choice = cards.find(
      ({ card }) =>
        card.kind === "spell" &&
        threats.filter(
          (u) =>
            Math.hypot(u.x - (threats[0]?.x || 0), u.y - (threats[0]?.y || 0)) <
            3,
        ).length >= 2,
    );
    const threatened = threats.sort((a, b) => a.y - b.y)[0];
    if (!choice) {
      const troops = cards.filter(({ card }) => card.kind === "troop");
      if (!troops.length) return;
      // Save for a push, but react to attackers approaching a tower.
      if (!threatened && state.elixir < (level === "easy" ? 5 : 7)) return;
      choice =
        threatened && level !== "easy"
          ? troops.find(
              ({ card }) =>
                !threatened.flying || card.targetsAir || card.flying,
            )
          : null;
      choice ||= troops[Math.floor(Math.random() * troops.length)];
    }
    let x = threatened?.x || (Math.random() > 0.5 ? 4 : 14);
    let y = threatened ? Math.min(13.5, Math.max(4, threatened.y - 2)) : 10.5;
    if (choice.card.kind === "spell") {
      x = threats[0].x;
      y = threats[0].y;
    }
    deploy(game, 1, choice.slot, x, y);
  }
  let frame = 0;
  const simulation = setInterval(() => {
    frame++;
    for (const room of rooms.values()) {
      if (room.game && room.game.phase !== "finished") {
        playBot(room, 1 / 30);
        step(room.game, 1 / 30);
      }
      if (frame % 2 === 0) snapshot(room);
      if (Date.now() - room.updatedAt > 10 * 60 * 1000 && !room.game) {
        for (const seat of room.seats)
          if (seat?.ws) {
            seat.ws.room = null;
            send(seat.ws, { type: "left" });
          }
        rooms.delete(room.code);
      }
    }
  }, 1000 / 30);
  const heartbeat = setInterval(() => {
    for (const ws of peers) {
      if (!ws.alive) ws.terminate();
      else {
        ws.alive = false;
        ws.ping();
      }
    }
  }, heartbeatMs);
  simulation.unref();
  heartbeat.unref();
  async function close() {
    if (stopped) return;
    stopped = true;
    clearInterval(simulation);
    clearInterval(heartbeat);
    for (const ws of peers) ws.terminate();
    await new Promise((resolve) => wss.close(resolve));
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
  return { server, wss, rooms, close };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const arena = createArenaServer();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "0.0.0.0";
  arena.server.listen(port, host, () =>
    console.log(`Royale Arena ready at http://localhost:${port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await arena.close();
      process.exit(0);
    });
}
