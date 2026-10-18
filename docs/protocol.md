# Royale Arena protocol

The Node process serves browser files and a same-origin WebSocket at `/ws`.
`GET /api/health` returns `{ "ok": true, "rooms": <number> }`.
Rooms are ephemeral, hold exactly two players, and disappear when empty. A room
code is an invitation, not account authentication. No external game servers or
Android processes are contacted. Each WebSocket is bound to its own team;
clients cannot choose a team for deployment or submit health/elixir/state.

## Client messages

Every message is a JSON object with `type`.

| Type | Additional fields | Behavior |
| --- | --- | --- |
| `create` | `name` (1–20 chars) | Creates a private room; waits for one guest |
| `join` | `room` (6 uppercase chars), `name` | Joins a waiting room; starts countdown |
| `bot` | `name`, `difficulty` (`easy`, `normal`, `hard`) | Creates a match against the bot |
| `deploy` | `slot` (integer 0–3), `x`, `y` (finite arena coordinates) | Attempts a card from the sender's hand |
| `rematch` | none | Votes for another match; bot accepts automatically |
| `leave` | none | Leaves the room; an active opponent wins by forfeit |
| `ping` | none | Requests `pong` |

Coordinates always use the authoritative world, even for the north player:
18 wide × 32 high. Team 0 is south, team 1 is north. Troops deploy on your
half, outside the river, and spells may target the arena. The UI rotates the
view for team 1. The engine validates hand, phase, elixir, and placement before
changing state. A rejected command returns an error without spending elixir.

## Server messages

- `joined`: `{type, room, team, mode}` (`bot` or `room`).
- `state`: `{type, room, team, players:[{name,connected}], game, rematch:[boolean,boolean]}`.
  `game` is null while waiting for a guest. Otherwise it is the caller-specific
  view described below. Snapshots are sent 15 times per second; simulation runs
  at a fixed 30 ticks per second. Only your hand/queue and elixir are exposed.
- `error`: `{type, code, message}`. Codes include `INVALID_MESSAGE`,
  `ROOM_NOT_FOUND`, `ROOM_FULL`, `NOT_IN_ROOM`, `INVALID_DEPLOY`, `RATE_LIMIT`.
- `left`: `{type}` after leaving a room.
- `pong`: `{type}`.

Game view: `{phase, countdown, remaining, overtime, winner, reason, crowns,
elixir, hand, next, towers, units, effects, tick}`. Phase is `countdown`,
`playing`, or `finished`. `winner` is null until decided, 0 or 1 for a winner,
or -1 for a draw. Cards are described by `GET /shared/game.js`'s exported
`CARDS` array. Towers have `{id,team,type,x,y,hp,maxHp,range,hitAt}`; units have
`{id,team,card,x,y,hp,maxHp,radius,hitAt}`; effects have
`{id,type,team,x,y,...}`. Additional rendering fields are allowed.

Disconnecting during a match forfeits immediately. Reconnection starts a new
session; there is no hidden reconnect identity. The remaining player can return
to the lobby or create a new room. Rematches require both human votes. A room
expires after ten minutes without a live participant. Process restart clears
all rooms. This is a single-process server; horizontal scaling needs room
affinity or shared authoritative room hosting.
