import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CARDS,
  createGame,
  deploy,
  step,
  viewFor,
  forfeit,
} from "../shared/game.js";

function battle(seed = 42) {
  const game = createGame({ seed });
  step(game, 3);
  assert.equal(game.phase, "playing");
  return game;
}

function giveCard(game, team, id) {
  // Preserve the eight-card cycle while making the desired scenario explicit.
  const deck = CARDS.map((card) => card.id).filter((card) => card !== id);
  game.players[team].hand = [id, ...deck.slice(0, 3)];
  game.players[team].queue = deck.slice(3);
  game.players[team].elixir = 10;
}

test("countdown blocks deployment and identical seeds reproduce decks and battle", () => {
  const waiting = createGame();
  assert.equal(waiting.players[0].elixir, 6);
  assert.equal(deploy(waiting, 0, 0, 4, 20).ok, false);
  const a = battle(99);
  const b = battle(99);
  for (const game of [a, b]) {
    giveCard(game, 0, "giant");
    giveCard(game, 1, "archers");
    deploy(game, 0, 0, 4, 18);
    deploy(game, 1, 0, 4, 14);
    step(game, 20);
  }
  assert.deepEqual(viewFor(a, 0), viewFor(b, 0));
});

test("invalid commands never spend elixir or rotate the hand", () => {
  const game = battle();
  giveCard(game, 0, "knight");
  const before = JSON.stringify(game.players);
  for (const args of [
    [0, 0, NaN, 20],
    [0, 4, 4, 20],
    [0, 0, 4, 10],
    [0, 0, 9, 28.5],
    [2, 0, 4, 20],
    [0, 0, 99, 20],
  ]) {
    assert.equal(deploy(game, ...args).ok, false);
    assert.equal(JSON.stringify(game.players), before);
  }
  game.players[0].elixir = 0;
  assert.equal(deploy(game, 0, 0, 4, 20).ok, false);
  assert.equal(game.players[0].elixir, 0);
});

test("deployment spends the correct cost and cycles the used card behind the queue", () => {
  const game = battle();
  giveCard(game, 0, "archers");
  const next = game.players[0].queue[0];
  assert.deepEqual(deploy(game, 0, 0, 5, 20), { ok: true });
  assert.equal(game.players[0].elixir, 7);
  assert.equal(game.players[0].hand[0], next);
  assert.equal(game.players[0].queue.at(-1), "archers");
  assert.equal(game.units.length, 2);
  assert.equal(
    new Set([...game.players[0].hand, ...game.players[0].queue]).size,
    8,
  );
});

test("ground units cross the river at a bridge; air units can cross directly", () => {
  const game = battle();
  giveCard(game, 0, "giant");
  deploy(game, 0, 0, 9, 19);
  const giant = game.units[0];
  // Keep this pathfinding assertion independent of enemy tower damage.
  for (const tower of game.towers) tower.active = false;
  let crossed = false;
  for (let i = 0; i < 900 && giant.hp > 0; i++) {
    step(game, 1 / 30);
    if (giant.y < 17 && giant.y > 15) {
      assert.ok(Math.abs(giant.x - 14) < 0.12, `crossed water at x=${giant.x}`);
      crossed = true;
    }
  }
  assert.equal(crossed, true);
  const flyingGame = battle();
  giveCard(flyingGame, 0, "minions");
  deploy(flyingGame, 0, 0, 9, 18);
  for (const tower of flyingGame.towers) tower.active = false;
  step(flyingGame, 2);
  assert.ok(
    flyingGame.units.some(
      (unit) => unit.y > 15 && unit.y < 17 && unit.x > 6 && unit.x < 12,
    ),
  );
});

test("melee ground troops cannot hit flying units and giant ignores troops", () => {
  const game = battle();
  giveCard(game, 0, "knight");
  giveCard(game, 1, "minions");
  deploy(game, 0, 0, 5, 20);
  deploy(game, 1, 0, 5, 12);
  const knight = game.units[0];
  for (const minion of game.units.slice(1)) {
    minion.x = 5;
    minion.y = 20;
    minion.speed = 0;
  }
  for (const tower of game.towers) tower.active = false;
  step(game, 2);
  assert.ok(knight.hp < knight.maxHp);
  assert.ok(
    game.units
      .filter((unit) => unit.flying)
      .every((unit) => unit.hp === unit.maxHp),
  );
  const giantGame = battle();
  giveCard(giantGame, 0, "giant");
  giveCard(giantGame, 1, "knight");
  deploy(giantGame, 0, 0, 4, 18);
  deploy(giantGame, 1, 0, 4, 13);
  const enemy = giantGame.units.find((unit) => unit.team === 1);
  enemy.y = 18.5;
  step(giantGame, 1.1);
  const giant = giantGame.units.find((unit) => unit.card === "giant");
  assert.ok(giant.targetId.startsWith("tower-"));
});

test("spells damage enemies in radius, spare friendly units, and activate the king", () => {
  const game = battle();
  giveCard(game, 0, "archers");
  deploy(game, 0, 0, 8, 20);
  const friendly = game.units[0];
  friendly.x = 9;
  friendly.y = 3.5;
  const king = game.towers.find(
    (tower) => tower.team === 1 && tower.type === "king",
  );
  assert.equal(king.active, false);
  giveCard(game, 0, "fireball");
  deploy(game, 0, 0, king.x, king.y);
  assert.equal(
    king.hp,
    king.maxHp - CARDS.find((card) => card.id === "fireball").towerDamage,
  );
  assert.equal(king.active, true);
  assert.equal(friendly.hp, friendly.maxHp);
  assert.ok(
    game.effects.some((effect) => effect.type === "spell" && effect.ttl > 0),
  );
});

test("destroying princess earns a crown and activates king; king destruction ends match", () => {
  const game = battle();
  const princess = game.towers.find(
    (tower) => tower.team === 1 && tower.type === "princess",
  );
  princess.hp = 1;
  giveCard(game, 0, "arrows");
  deploy(game, 0, 0, princess.x, princess.y);
  assert.deepEqual(game.crowns, [1, 0]);
  const king = game.towers.find(
    (tower) => tower.team === 1 && tower.type === "king",
  );
  assert.equal(king.active, true);
  king.hp = 1;
  giveCard(game, 0, "fireball");
  deploy(game, 0, 0, king.x, king.y);
  assert.equal(game.phase, "finished");
  assert.equal(game.winner, 0);
  assert.deepEqual(game.crowns, [3, 0]);
});

test("elixir regenerates normally, doubles in final minute and never exceeds ten", () => {
  const game = battle();
  game.players[0].elixir = 0;
  step(game, 2.8);
  assert.ok(Math.abs(game.players[0].elixir - 1) < 1e-8);
  game.remaining = 59;
  game.players[0].elixir = 0;
  step(game, 2.8);
  assert.ok(Math.abs(game.players[0].elixir - 2) < 1e-8);
  step(game, 40);
  assert.equal(game.players[0].elixir, 10);
  game.overtime = true;
  game.remaining = 59;
  game.players[0].elixir = 0;
  step(game, 2.79);
  assert.ok(Math.abs(game.players[0].elixir - 3) < 1e-8);
});

test("regulation crowns, overtime sudden death, health tiebreak and draw resolve correctly", () => {
  const crowns = battle();
  crowns.crowns = [1, 0];
  crowns.remaining = 0.01;
  step(crowns, 0.1);
  assert.equal(crowns.winner, 0);
  assert.equal(crowns.reason, "crowns");
  const sudden = battle();
  sudden.remaining = 0.01;
  step(sudden, 0.1);
  assert.equal(sudden.overtime, true);
  const princess = sudden.towers.find(
    (tower) => tower.team === 0 && tower.type === "princess",
  );
  princess.hp = 1;
  giveCard(sudden, 1, "arrows");
  deploy(sudden, 1, 0, princess.x, princess.y);
  assert.equal(sudden.winner, 1);
  assert.equal(sudden.reason, "sudden-death");
  const hp = battle();
  hp.overtime = true;
  hp.remaining = 0.01;
  hp.towers[0].hp -= 20;
  step(hp, 0.1);
  assert.equal(hp.winner, 1);
  assert.equal(hp.reason, "health");
  const draw = battle();
  step(draw, 300);
  assert.equal(draw.winner, -1);
  assert.equal(draw.reason, "draw");
});

test("snapshots expose only the viewer hand and are detached from authoritative state", () => {
  const game = battle();
  const view = viewFor(game, 0);
  assert.deepEqual(view.hand, game.players[0].hand);
  assert.equal("players" in view, false);
  assert.equal("queue" in view, false);
  view.hand[0] = "invalid";
  view.towers[0].hp = 0;
  view.crowns[0] = 3;
  assert.notEqual(game.players[0].hand[0], "invalid");
  assert.ok(game.towers[0].hp > 0);
  assert.deepEqual(game.crowns, [0, 0]);
});

test("forfeit during countdown ends immediately and cannot overwrite a finished result", () => {
  const game = createGame();
  forfeit(game, 0);
  assert.equal(game.winner, 1);
  assert.equal(game.reason, "forfeit");
  forfeit(game, 1);
  step(game, 20);
  assert.equal(game.winner, 1);
  assert.equal(deploy(game, 1, 0, 4, 12).ok, false);
});

test("a complete two-sided battle preserves arena, health and resource invariants", () => {
  const game = battle(2026);
  let deployed = 0;
  for (let frame = 0; frame < 9100 && game.phase === "playing"; frame++) {
    if (frame % 24 === 0) {
      for (const team of [0, 1]) {
        const player = game.players[team];
        const slot = player.hand.findIndex(
          (id) => CARDS.find((card) => card.id === id).cost <= player.elixir,
        );
        if (slot < 0) continue;
        const card = CARDS.find((card) => card.id === player.hand[slot]);
        const x = Math.floor(frame / 24) % 2 ? 4 : 14;
        const y =
          card.kind === "spell"
            ? team === 0
              ? 8
              : 24
            : team === 0
              ? 18.5
              : 13.5;
        if (deploy(game, team, slot, x, y).ok) deployed++;
      }
    }
    step(game, 1 / 30);
    for (const player of game.players) {
      assert.ok(
        Number.isFinite(player.elixir) &&
          player.elixir >= 0 &&
          player.elixir <= 10,
      );
      assert.equal(new Set([...player.hand, ...player.queue]).size, 8);
    }
    for (const unit of game.units) {
      assert.ok(Number.isFinite(unit.x) && Number.isFinite(unit.y));
      assert.ok(unit.x >= 0 && unit.x <= 18 && unit.y >= 0 && unit.y <= 32);
      assert.ok(unit.hp > 0 && unit.hp <= unit.maxHp);
    }
    for (const tower of game.towers)
      assert.ok(tower.hp >= 0 && tower.hp <= tower.maxHp);
  }
  assert.ok(deployed > 20);
  assert.equal(game.phase, "finished");
  assert.ok([-1, 0, 1].includes(game.winner));
});

test("deployed troops wait one second before moving or attacking", () => {
  const game = battle();
  giveCard(game, 0, "giant");
  deploy(game, 0, 0, 4, 20);
  const unit = game.units[0];
  const origin = { x: unit.x, y: unit.y };
  step(game, 0.9);
  assert.deepEqual({ x: unit.x, y: unit.y }, origin);
  assert.equal(unit.targetId, null);
  step(game, 0.2);
  assert.ok(unit.y < origin.y);
});

test("arrows apply three distinct waves at recovered 200ms spacing", () => {
  const game = battle();
  giveCard(game, 1, "archers");
  deploy(game, 1, 0, 7, 12);
  for (const unit of game.units) unit.deployUntil = game.time + 10;
  for (const tower of game.towers) tower.active = false;
  const archer = game.units[0];
  giveCard(game, 0, "arrows");
  deploy(game, 0, 0, 7, 12);
  assert.equal(archer.hp, 119 - 48);
  step(game, 0.19);
  assert.equal(archer.hp, 119 - 48);
  step(game, 0.02);
  assert.equal(archer.hp, 119 - 96);
  step(game, 0.2);
  assert.equal(archer.hp, 0);
  assert.equal(game.units.length, 0);
});

test("browser card stats match independently recovered artifact data", () => {
  const recovered = JSON.parse(
    readFileSync(
      new URL("../public/assets/recovered-config.json", import.meta.url),
      "utf8",
    ),
  );
  for (const card of CARDS) {
    const source = recovered.cards[card.id];
    assert.equal(card.cost, Number(source.spell.ManaCost), card.id);
    if (card.kind !== "troop") continue;
    assert.equal(card.hp, Number(source.character.Hitpoints), card.id);
    assert.equal(
      card.damage,
      Number(source.character.Damage || source.projectile.Damage),
      card.id,
    );
    assert.equal(
      card.attackSpeed,
      Number(source.character.HitSpeed) / 1000,
      card.id,
    );
    assert.equal(card.range, Number(source.character.Range) / 1000, card.id);
    assert.equal(
      card.deployTime,
      Number(source.character.DeployTime) / 1000,
      card.id,
    );
    assert.equal(card.count, Number(source.spell.SummonNumber || 1), card.id);
  }
});
