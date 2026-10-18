import { CARDS } from "/shared/game.js";
import { Arena, SYMBOLS } from "./arena.js";

const $ = (id) => document.getElementById(id),
  cards = new Map(CARDS.map((c) => [c.id, c]));
const dom = {
  name: $("player-name"),
  code: $("room-code"),
  status: $("status-message"),
  connection: $("connection"),
  dialog: $("result-dialog"),
};
let socket,
  room = null,
  team = 0,
  mode = null,
  state = null,
  selected = -1,
  pending = false,
  handSignature = "",
  lastPhase = null,
  finishedKey = null,
  retryTimer = null,
  audioEnabled = false;
try {
  dom.name.value = localStorage.getItem("royale-name") || "Challenger";
  audioEnabled = localStorage.getItem("royale-audio") === "on";
} catch {}
const invited = new URL(location.href).searchParams.get("room");
if (invited)
  dom.code.value = invited
    .replace(/[^a-z2-9]/gi, "")
    .slice(0, 6)
    .toUpperCase();
const audioCache = new Map();
function playSound(name) {
  if (!audioEnabled) return;
  try {
    let audio = audioCache.get(name);
    if (!audio) {
      audio = new Audio(`/assets/audio/${name}.ogg`);
      audio.volume = name === "victory" || name === "defeat" ? 0.32 : 0.18;
      audioCache.set(name, audio);
    }
    audio.currentTime = 0;
    audio.play().catch(() => {});
  } catch {}
}
function audioUI() {
  $("sound-status").textContent = audioEnabled ? "ON" : "OFF";
  $("sound-button").setAttribute(
    "aria-label",
    audioEnabled ? "Disable battle sound" : "Enable battle sound",
  );
}
audioUI();
$("sound-button").addEventListener("click", () => {
  audioEnabled = !audioEnabled;
  try {
    localStorage.setItem("royale-audio", audioEnabled ? "on" : "off");
  } catch {}
  audioUI();
  playSound("click");
});
function status(text, error = false) {
  dom.status.textContent = text;
  dom.status.classList.toggle("error", error);
}
function name() {
  const n = dom.name.value.trim().slice(0, 20) || "Challenger";
  dom.name.value = n;
  try {
    localStorage.setItem("royale-name", n);
  } catch {}
  return n;
}
dom.name.addEventListener("change", () => {
  $("self-name").textContent = name();
});
dom.code.addEventListener("input", () => {
  dom.code.value = dom.code.value.replace(/[^a-z2-9]/gi, "").toUpperCase();
});
function send(message) {
  if (socket?.readyState !== WebSocket.OPEN) {
    status("Connection unavailable. Reconnecting to the arena…", true);
    return false;
  }
  socket.send(JSON.stringify(message));
  return true;
}
function entry(type, extra = {}) {
  if (pending || room) return;
  pending = true;
  updateControls();
  playSound("click");
  status(
    type === "bot"
      ? "Finding your training partner…"
      : type === "create"
        ? "Opening your private arena…"
        : "Joining your friend’s arena…",
  );
  if (!send({ type, name: name(), ...extra })) {
    pending = false;
    updateControls();
  }
}
$("create-room").addEventListener("click", () => entry("create"));
$("play-bot").addEventListener("click", () =>
  entry("bot", { difficulty: $("difficulty").value }),
);
$("join-room").addEventListener("click", () => {
  if (!/^[A-Z2-9]{6}$/.test(dom.code.value)) {
    status("Enter the six-character code your friend shared.", true);
    dom.code.focus();
    return;
  }
  entry("join", { room: dom.code.value });
});
dom.code.addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("join-room").click();
});
function leave() {
  send({ type: "leave" });
  if (dom.dialog.open) dom.dialog.close();
  playSound("click");
}
$("leave-room").addEventListener("click", leave);
$("result-leave").addEventListener("click", leave);
$("rematch").addEventListener("click", () => {
  if (send({ type: "rematch" })) {
    $("rematch").disabled = true;
    $("rematch-status").textContent =
      "Waiting for your opponent’s rematch vote…";
    playSound("click");
  }
});
$("copy-invite").addEventListener("click", async () => {
  if (!room) return;
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("room", room);
  try {
    await navigator.clipboard.writeText(url.href);
    $("copy-invite").textContent = "Copied ✓";
    setTimeout(() => ($("copy-invite").textContent = "Copy link ↗"), 2200);
  } catch {
    status(`Share room code ${room} with your friend.`);
  }
});
function updateControls() {
  const available = socket?.readyState === WebSocket.OPEN && !pending;
  for (const id of ["create-room", "join-room", "play-bot"])
    $(id).disabled = !available;
  $("lobby-controls").hidden = !!room;
  $("room-controls").hidden = !room;
  dom.name.disabled = !!room;
  document.querySelector(".layout").classList.toggle("in-match", !!room);
  $("copy-invite").hidden = mode === "bot";
  $("room-display").textContent =
    mode === "bot" ? "PRACTICE" : room || "------";
  $("room-hint").textContent =
    mode === "bot"
      ? "Practice your timing. Your opponent is ready for another round."
      : state?.game
        ? "Both sides are here. The battlefield is yours."
        : "Share your link. Your battle starts when a friend joins.";
  $("match-label").textContent = room
    ? mode === "bot"
      ? "SOLO TRAINING"
      : `PRIVATE ROOM · ${room}`
    : "PRACTICE & FRIENDLY BATTLES";
}
function clearRoom() {
  room = null;
  state = null;
  pending = false;
  selected = -1;
  lastPhase = null;
  finishedKey = null;
  mode = null;
  handSignature = "";
  arena.setState(null, 0);
  arena.select(null);
  if (dom.dialog.open) dom.dialog.close();
  updateControls();
  render();
}
function connect() {
  clearTimeout(retryTimer);
  socket = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
  );
  socket.addEventListener("open", () => {
    dom.connection.className = "connection online";
    dom.connection.querySelector("span").textContent = "Arena online";
    pending = false;
    updateControls();
    status(
      invited && !room
        ? "Invitation ready. Enter your name and join your friend."
        : "The arena is ready. Choose your next challenge.",
    );
  });
  socket.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "joined") {
      room = msg.room;
      team = msg.team;
      mode = msg.mode;
      pending = false;
      state = null;
      selected = -1;
      finishedKey = null;
      lastPhase = null;
      updateControls();
      status(
        mode === "bot"
          ? "Your training battle is about to begin."
          : team === 0
            ? "Room created. Send your invitation to a friend."
            : "You’re in. Prepare for battle!",
      );
      render();
    } else if (msg.type === "state") {
      state = msg;
      room = msg.room;
      team = msg.team;
      arena.setState(msg.game, team);
      updateControls();
      render();
    } else if (msg.type === "error") {
      pending = false;
      updateControls();
      status(msg.message || "That move could not be completed.", true);
      if (dom.dialog.open) {
        $("rematch").disabled = false;
        $("rematch-status").textContent =
          msg.message || "Rematch unavailable. Return to the lobby.";
      }
      if (msg.code === "INVALID_DEPLOY") {
        $("arena-frame").classList.remove("battle-flash");
        requestAnimationFrame(() =>
          $("arena-frame").classList.add("battle-flash"),
        );
      }
    } else if (msg.type === "left") {
      clearRoom();
      status("Back at the gates. Your next battle is waiting.");
    }
  });
  socket.addEventListener("close", () => {
    dom.connection.className = "connection offline";
    dom.connection.querySelector("span").textContent = "Reconnecting";
    clearRoom();
    updateControls();
    status(
      "Connection lost. The match ended; reconnecting for a new session…",
      true,
    );
    retryTimer = setTimeout(connect, 2000);
  });
  socket.addEventListener("error", () => {
    status("The arena connection could not be established. Retrying…", true);
  });
}
const arena = new Arena($("arena"), (point) => {
  const game = state?.game;
  if (game?.phase !== "playing" || selected < 0) return;
  const card = cards.get(game.hand[selected]);
  if (!card) return;
  if (game.elixir < card.cost) {
    status(`You need ${card.cost} elixir to play ${card.name}.`, true);
    return;
  }
  if (send({ type: "deploy", slot: selected, x: point.x, y: point.y })) {
    playSound(card.kind === "spell" ? card.id : "deploy");
    selectSlot(-1);
  }
});
function selectSlot(slot) {
  const g = state?.game;
  if (slot >= 0 && g?.phase !== "playing") return;
  selected = selected === slot ? -1 : slot;
  arena.select(selected >= 0 ? cards.get(g.hand[selected]) : null);
  handSignature = "";
  renderHand();
  if (selected >= 0) playSound("click");
}
window.addEventListener("keydown", (event) => {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement ||
    dom.dialog.open
  )
    return;
  if (/^[1-4]$/.test(event.key)) {
    event.preventDefault();
    selectSlot(Number(event.key) - 1);
  } else if (event.key === "Escape") {
    selectSlot(-1);
  }
});
function portrait(container, id, className = "") {
  const card = cards.get(id),
    fallback = document.createElement("span");
  fallback.className = className || "card-symbol";
  fallback.textContent = SYMBOLS[id] || "⚔";
  const img = new Image();
  img.src = `/assets/cards/${id}.png`;
  img.alt = "";
  img.draggable = false;
  img.addEventListener("error", () => img.replaceWith(fallback), {
    once: true,
  });
  container.append(img);
  if (card) container.title = `${card.name} · ${card.cost} elixir`;
}
for (const card of CARDS) {
  const item = document.createElement("div");
  item.className = "roster-icon";
  portrait(item, card.id);
  $("roster").append(item);
}
for (let i = 0; i < 10; i++) {
  const cell = document.createElement("span");
  cell.className = "elixir-cell";
  cell.append(document.createElement("i"));
  $("elixir-bar").append(cell);
}
function renderHand() {
  const game = state?.game,
    hand = game?.hand || ["knight", "archers", "giant", "fireball"],
    playing = game?.phase === "playing";
  const signature = [
    ...hand,
    selected,
    playing,
    ...hand.map((id) => game?.elixir >= cards.get(id)?.cost),
  ].join("|");
  if (signature !== handSignature) {
    handSignature = signature;
    $("hand").replaceChildren();
    hand.forEach((id, slot) => {
      const card = cards.get(id);
      if (!card) return;
      const button = document.createElement("button");
      button.className = `card${slot === selected ? " selected" : ""}`;
      button.disabled = !playing;
      button.setAttribute("aria-pressed", String(slot === selected));
      button.setAttribute(
        "aria-label",
        `${slot + 1}. ${card.name}, ${card.cost} elixir${playing && game.elixir < card.cost ? ", not enough elixir" : ""}`,
      );
      if (playing && game.elixir < card.cost)
        button.style.filter = "saturate(.45) brightness(.7)";
      const image = document.createElement("div");
      image.className = "card-portrait";
      portrait(image, id);
      const cost = document.createElement("span");
      cost.className = "card-cost";
      cost.textContent = card.cost;
      const label = document.createElement("span");
      label.className = "card-name";
      label.textContent = card.name;
      const key = document.createElement("span");
      key.className = "card-key";
      key.textContent = slot + 1;
      button.append(image, cost, label, key);
      button.addEventListener("click", () => selectSlot(slot));
      $("hand").append(button);
    });
    const next = game?.next || "minions";
    $("next-card").replaceChildren();
    portrait($("next-card"), next);
  }
  const elixir = game?.elixir || 0;
  $("elixir-number").textContent = Math.floor(elixir);
  $("elixir-bar").setAttribute("aria-valuenow", elixir.toFixed(1));
  [...$("elixir-bar").children].forEach((cell, i) => {
    cell.firstChild.style.width = `${Math.max(0, Math.min(1, elixir - i)) * 100}%`;
  });
  const card = selected >= 0 ? cards.get(hand[selected]) : null;
  $("deck-instruction").textContent = card
    ? `${card.name.toUpperCase()} · ${card.kind === "spell" ? "TARGET ANYWHERE" : "TAP YOUR SIDE"}`
    : playing
      ? "CHOOSE A CARD · TAP TO DEPLOY"
      : "YOUR BATTLE DECK";
  $("placement-tip").hidden = !playing;
  $("placement-tip").textContent = card
    ? card.kind === "spell"
      ? "TAP ANYWHERE TO CAST"
      : "TAP YOUR HALF TO DEPLOY"
    : "CHOOSE A CARD TO DEPLOY";
}
function render() {
  const game = state?.game,
    own = state?.players?.[team],
    other = state?.players?.[1 - team];
  $("self-name").textContent = own?.name || dom.name.value;
  $("opponent-name").textContent =
    other?.name || (room ? "Waiting for a rival…" : "Your next rival");
  $("opponent-label").textContent =
    mode === "bot"
      ? "TRAINING OPPONENT"
      : other
        ? "YOUR CHALLENGER"
        : "THE NORTH SIDE";
  $("self-crowns").textContent = game?.crowns?.[team] || 0;
  $("opponent-crowns").textContent = game?.crowns?.[1 - team] || 0;
  const sec = Math.max(0, Math.ceil(game?.remaining ?? 180));
  $("timer").textContent =
    `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  $("timer-label").textContent = game?.overtime
    ? game.remaining <= 60
      ? "3? ELIXIR"
      : "2? ? SUDDEN DEATH"
    : game?.phase === "playing" && game.remaining <= 60
      ? "2? ELIXIR"
      : "BATTLE TIME";
  $("arena-timer").classList.toggle("overtime", !!game?.overtime);
  const overlay = $("arena-overlay");
  overlay.hidden = game?.phase === "playing" || game?.phase === "finished";
  overlay.classList.toggle("countdown", game?.phase === "countdown");
  if (!game) {
    $("overlay-title").textContent = room ? "Rival wanted." : "Glory awaits.";
    $("overlay-description").textContent = room
      ? "Share your room link. The battle begins when your friend arrives."
      : "Challenge a friend or take on the bot.";
  } else if (game.phase === "countdown") {
    $("overlay-title").textContent = Math.max(1, Math.ceil(game.countdown));
    $("overlay-description").textContent =
      "Ready your cards. Protect your King.";
    selected = -1;
    arena.select(null);
    if (dom.dialog.open) dom.dialog.close();
    finishedKey = null;
    if (lastPhase !== "countdown")
      status("The challengers are ready. Battle starts in three…");
  }
  if (game?.phase === "playing" && lastPhase !== "playing")
    status("Battle! Choose a card, then tap the arena to deploy.");
  if (game?.phase === "finished") {
    selected = -1;
    arena.select(null);
    const key = `${room}:${game.tick}`;
    if (!finishedKey) {
      finishedKey = key;
      showResult(game);
    }
    if (state.rematch?.[team]) {
      $("rematch").disabled = true;
      $("rematch-status").textContent =
        "Your rematch vote is in. Waiting for your opponent…";
    } else if (state.rematch?.[1 - team]) {
      $("rematch-status").textContent =
        "Your rival wants a rematch. Ready for another?";
    }
  }
  lastPhase = game?.phase || null;
  renderHand();
}
function showResult(game) {
  const draw = game.winner === -1,
    won = game.winner === team;
  $("result-crest").textContent = draw ? "⚔" : won ? "♛" : "♜";
  $("result-eyebrow").textContent = draw
    ? "AN EVENLY MATCHED RIVALRY"
    : won
      ? "THE CROWN IS YOURS"
      : "A WORTHY CHALLENGE";
  $("result-title").textContent = draw
    ? "A royal draw."
    : won
      ? "Victory!"
      : "Defeat";
  const reasons = {
    health: "The final tower health decided the crown.",
    crowns: "The final bell sounded. Most crowns wins.",
    "sudden-death": "The deciding tower has fallen.",
    draw: "Neither rival could break the tie.",
    king: "The King Tower has fallen.",
    time: "The final bell has sounded.",
    overtime: "The deciding tower has fallen.",
    disconnect: "Your opponent disconnected.",
    forfeit: "The opponent left the arena.",
    tiebreak: "The remaining tower health decided the battle.",
  };
  $("result-detail").textContent =
    reasons[game.reason] ||
    "The battle is over. There’s always another crown to win.";
  $("result-score").textContent =
    `${game.crowns[team]} ♛ ${game.crowns[1 - team]}`;
  $("rematch").disabled = false;
  $("rematch-status").textContent = "";
  dom.dialog.showModal();
  playSound(won ? "victory" : "defeat");
  status(
    draw
      ? "A draw. Settle the rivalry with a rematch."
      : won
        ? "Victory! Your strategy earned the crown."
        : "A good battle. Try a new push in the next round.",
  );
}
dom.dialog.addEventListener("cancel", (e) => e.preventDefault());
render();
connect();
