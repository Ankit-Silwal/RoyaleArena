// Browser reimplementation using recovered base card data, not native game code.
// HP/damage/cost/count and combat times are backed by recovered-config.json.
// Native ranges are divided by 1000; movement is an explicit approximation:
// native Speed / 50 world tiles per second. Pathing and combat are original.
export const WIDTH = 18;
export const HEIGHT = 32;
export const FIXED_DT = 1 / 30;
export const CARDS = [
  {
    id: "knight",
    name: "Knight",
    cost: 3,
    kind: "troop",
    hp: 690,
    damage: 79,
    speed: 1.2,
    range: 1.2,
    sightRange: 5.5,
    attackSpeed: 1.2,
    loadTime: 0.7,
    deployTime: 1,
    radius: 0.5,
    count: 1,
    flying: false,
    targetsAir: false,
  },
  {
    id: "archers",
    name: "Archers",
    cost: 3,
    kind: "troop",
    hp: 119,
    damage: 42,
    speed: 1.2,
    range: 5,
    sightRange: 5.5,
    attackSpeed: 0.9,
    loadTime: 0.4,
    deployTime: 1,
    projectileSpeed: 12,
    radius: 0.5,
    count: 2,
    flying: false,
    targetsAir: true,
  },
  {
    id: "giant",
    name: "Giant",
    cost: 5,
    kind: "troop",
    hp: 1930,
    damage: 120,
    speed: 0.9,
    range: 1.2,
    sightRange: 7.5,
    attackSpeed: 1.5,
    loadTime: 1,
    deployTime: 1,
    radius: 0.75,
    count: 1,
    flying: false,
    targetsAir: false,
    buildingOnly: true,
  },
  {
    id: "minions",
    name: "Minions",
    cost: 3,
    kind: "troop",
    hp: 90,
    damage: 46,
    speed: 1.8,
    range: 1.6,
    sightRange: 5.5,
    attackSpeed: 1,
    loadTime: 0.5,
    deployTime: 1,
    projectileSpeed: 20,
    radius: 0.5,
    count: 3,
    flying: true,
    targetsAir: true,
  },
  {
    id: "musketeer",
    name: "Musketeer",
    cost: 4,
    kind: "troop",
    hp: 340,
    damage: 103,
    speed: 1.2,
    range: 6,
    sightRange: 6,
    attackSpeed: 1,
    loadTime: 0.2,
    deployTime: 1,
    projectileSpeed: 20,
    radius: 0.5,
    count: 1,
    flying: false,
    targetsAir: true,
  },
  {
    id: "minipekka",
    name: "Mini P.E.K.K.A",
    cost: 4,
    kind: "troop",
    hp: 642,
    damage: 340,
    speed: 1.8,
    range: 0.8,
    sightRange: 5.5,
    attackSpeed: 1.6,
    loadTime: 1.1,
    deployTime: 1,
    radius: 0.45,
    count: 1,
    flying: false,
    targetsAir: false,
  },
  {
    id: "fireball",
    name: "Fireball",
    cost: 4,
    kind: "spell",
    damage: 325,
    towerDamage: 97.5,
    radius: 2.5,
    waves: 1,
  },
  {
    id: "arrows",
    name: "Arrows",
    cost: 3,
    kind: "spell",
    damage: 48,
    towerDamage: 14.4,
    radius: 4,
    waves: 3,
    waveInterval: 0.2,
  },
];
const BY_ID = Object.fromEntries(CARDS.map((card) => [card.id, card]));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const alive = (entity) => entity.hp > 0;

function random(game) {
  let n = (game.seed += 0x6d2b79f5);
  n = Math.imul(n ^ (n >>> 15), n | 1);
  n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
  return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
}

export function createGame({ seed = 1 } = {}) {
  const game = {
    phase: "countdown",
    countdown: 3,
    remaining: 180,
    overtime: false,
    winner: null,
    reason: null,
    crowns: [0, 0],
    tick: 0,
    time: 0,
    seed: Number(seed) >>> 0,
    nextId: 1,
    units: [],
    effects: [],
    events: [],
    towers: [],
    players: [0, 1].map(() => ({ elixir: 6, hand: [], queue: [] })),
  };
  for (const player of game.players) {
    const deck = CARDS.map((card) => card.id);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(random(game) * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    player.hand = deck.slice(0, 4);
    player.queue = deck.slice(4);
  }
  for (let team = 0; team < 2; team++) {
    for (const [type, x, y] of [
      ["king", 9, team === 0 ? 28.5 : 3.5],
      ["princess", 3.5, team === 0 ? 24 : 8],
      ["princess", 14.5, team === 0 ? 24 : 8],
    ]) {
      const king = type === "king";
      game.towers.push({
        id: `tower-${team}-${type}-${x}`,
        team,
        type,
        x,
        y,
        hp: king ? 2400 : 1400,
        maxHp: king ? 2400 : 1400,
        radius: king ? 1.4 : 1,
        range: king ? 7 : 7.5,
        damage: 50,
        attackSpeed: king ? 1 : 0.8,
        cooldown: 0,
        active: !king,
        hitAt: -100,
      });
    }
  }
  return game;
}

function effect(game, data) {
  game.effects.push({
    id: `effect-${game.nextId++}`,
    ...data,
    duration: data.ttl,
  });
}

function finish(game, winner, reason) {
  game.phase = "finished";
  game.winner = winner;
  game.reason = reason;
}

function hurt(game, target, amount) {
  if (!target || !alive(target) || game.phase !== "playing") return;
  target.hp = Math.max(0, target.hp - amount);
  target.hitAt = game.time;
  if (!target.type) return;
  if (target.type === "king") target.active = true;
  if (target.hp > 0) return;
  const attacker = 1 - target.team;
  if (target.type === "king") {
    game.crowns[attacker] = 3;
    finish(game, attacker, "king");
  } else {
    game.crowns[attacker]++;
    game.towers.find(
      (tower) => tower.team === target.team && tower.type === "king",
    ).active = true;
    if (game.overtime) finish(game, attacker, "sudden-death");
  }
}

function spellDamage(game, card, team, x, y) {
  for (const target of [...game.units, ...game.towers]) {
    if (
      target.team !== team &&
      alive(target) &&
      distance({ x, y }, target) <= card.radius + target.radius
    ) {
      hurt(game, target, target.type ? card.towerDamage : card.damage);
    }
  }
}

export function deploy(game, team, slot, x, y) {
  const fail = (error) => ({ ok: false, error });
  if (team !== 0 && team !== 1) return fail("Invalid team.");
  if (game.phase !== "playing") return fail("Wait for the battle to start.");
  if (!Number.isInteger(slot) || slot < 0 || slot > 3)
    return fail("Choose a card in your hand.");
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0.5 ||
    x > 17.5 ||
    y < 0.5 ||
    y > 31.5
  )
    return fail("Choose a position inside the arena.");
  const player = game.players[team];
  const card = BY_ID[player.hand[slot]];
  if (!card) return fail("That card is unavailable.");
  if (player.elixir + 1e-9 < card.cost) return fail("Not enough elixir.");
  if (card.kind === "troop") {
    if (team === 0 ? y < 17.4 : y > 14.6)
      return fail("Deploy troops on your side of the river.");
    if (
      game.towers.some(
        (tower) =>
          alive(tower) &&
          distance({ x, y }, tower) < tower.radius + card.radius + 0.2,
      )
    )
      return fail("Choose a position clear of the towers.");
    if (game.units.filter(alive).length + card.count > 180)
      return fail("Arena is full.");
  }
  player.elixir = Math.max(0, player.elixir - card.cost);
  player.hand[slot] = player.queue.shift();
  player.queue.push(card.id);
  if (card.kind === "spell") {
    effect(game, {
      type: "spell",
      card: card.id,
      team,
      x,
      y,
      radius: card.radius,
      ttl: 0.7,
    });
    spellDamage(game, card, team, x, y);
    for (let wave = 1; wave < (card.waves || 1); wave++) {
      game.events.push({
        at: game.time + wave * card.waveInterval,
        card: card.id,
        team,
        x,
        y,
      });
    }
  } else {
    for (let i = 0; i < card.count; i++) {
      const offset = (i - (card.count - 1) / 2) * 0.65;
      game.units.push({
        id: `unit-${game.nextId++}`,
        team,
        card: card.id,
        x: clamp(x + offset, 0.5, 17.5),
        y: clamp(y + (random(game) - 0.5) * 0.2, 0.5, 31.5),
        hp: card.hp,
        maxHp: card.hp,
        radius: card.radius,
        flying: card.flying,
        damage: card.damage,
        speed: card.speed,
        range: card.range,
        attackSpeed: card.attackSpeed,
        targetsAir: card.targetsAir,
        sightRange: card.sightRange,
        projectileSpeed: card.projectileSpeed,
        buildingOnly: !!card.buildingOnly,
        cooldown: card.loadTime,
        deployUntil: game.time + card.deployTime,
        targetId: null,
        hitAt: -100,
        attackAt: -100,
        bridge: x < 9 ? 4 : 14,
      });
    }
  }
  return { ok: true };
}

function canTarget(unit, target) {
  return (
    alive(target) &&
    target.team !== unit.team &&
    (!unit.buildingOnly || !!target.type) &&
    (!target.flying || unit.targetsAir)
  );
}

function chooseTarget(game, unit) {
  // Nearby troops can distract ordinary troops; buildings retain lane preference.
  const troops = unit.buildingOnly
    ? []
    : game.units.filter(
        (target) =>
          canTarget(unit, target) && distance(unit, target) <= unit.sightRange,
      );
  if (troops.length)
    return troops.sort((a, b) => distance(unit, a) - distance(unit, b))[0];
  return game.towers
    .filter((target) => canTarget(unit, target))
    .sort((a, b) => distance(unit, a) - distance(unit, b))[0];
}

function move(unit, target, dt) {
  let point = target;
  if (!unit.flying) {
    const bridge = unit.bridge;
    if (unit.y >= 17 && target.y < 17) {
      point =
        Math.abs(unit.x - bridge) > 0.08 || unit.y > 17.08
          ? { x: bridge, y: 17 }
          : { x: bridge, y: 14.9 };
    } else if (unit.y <= 15 && target.y > 15) {
      point =
        Math.abs(unit.x - bridge) > 0.08 || unit.y < 14.92
          ? { x: bridge, y: 15 }
          : { x: bridge, y: 17.1 };
    } else if (unit.y > 15 && unit.y < 17) {
      point = { x: bridge, y: target.y < unit.y ? 14.9 : 17.1 };
    }
  }
  const d = distance(unit, point);
  if (d <= 0.00001) return;
  const stride = Math.min(unit.speed * dt, d);
  unit.x = clamp(unit.x + ((point.x - unit.x) / d) * stride, 0.3, 17.7);
  unit.y = clamp(unit.y + ((point.y - unit.y) / d) * stride, 0.3, 31.7);
}

function attack(game, source, target) {
  source.attackAt = game.time;
  const ranged = !!source.type || !!source.projectileSpeed;
  if (ranged) {
    effect(game, {
      type: "projectile",
      card: source.card || source.type,
      team: source.team,
      x: source.x,
      y: source.y,
      toX: target.x,
      toY: target.y,
      targetId: target.id,
      damage: source.damage,
      ttl: Math.max(
        0.08,
        distance(source, target) / (source.projectileSpeed || 16),
      ),
    });
  } else {
    hurt(game, target, source.damage);
    effect(game, {
      type: "hit",
      team: source.team,
      x: target.x,
      y: target.y,
      ttl: 0.18,
    });
  }
}

function decideByHealth(game) {
  const hp = [0, 1].map((team) =>
    game.towers
      .filter((t) => t.team === team)
      .reduce((sum, t) => sum + t.hp, 0),
  );
  finish(
    game,
    hp[0] === hp[1] ? -1 : hp[0] > hp[1] ? 0 : 1,
    hp[0] === hp[1] ? "draw" : "health",
  );
}

function update(game, dt) {
  if (game.phase === "finished") return;
  game.time += dt;
  game.tick++;
  if (game.phase === "countdown") {
    game.countdown = Math.max(0, game.countdown - dt);
    if (game.countdown < 1e-8) {
      game.countdown = 0;
      game.phase = "playing";
    }
    return;
  }
  game.remaining = Math.max(0, game.remaining - dt);
  // Default timeline: 120s normal, 120s double (crosses into overtime),
  // then 60s triple. Full-bar durations are 28000 / 14000 / 9300 ms.
  const elixirInterval =
    game.overtime && game.remaining <= 60
      ? 0.93
      : game.overtime || game.remaining <= 60
        ? 1.4
        : 2.8;
  for (const player of game.players)
    player.elixir = Math.min(10, player.elixir + dt / elixirInterval);
  const ready = game.events.filter((event) => event.at <= game.time + 1e-9);
  game.events = game.events.filter((event) => event.at > game.time + 1e-9);
  for (const event of ready)
    spellDamage(game, BY_ID[event.card], event.team, event.x, event.y);
  for (const fx of game.effects) {
    fx.ttl -= dt;
    if (fx.type === "projectile") {
      const target = [...game.units, ...game.towers].find(
        (entity) => entity.id === fx.targetId && alive(entity),
      );
      if (target) {
        fx.toX = target.x;
        fx.toY = target.y;
      }
      if (fx.ttl <= 0 && target) hurt(game, target, fx.damage);
    }
  }
  game.effects = game.effects.filter((fx) => fx.ttl > 0);
  if (game.phase === "finished") return;
  for (const tower of game.towers) {
    tower.cooldown = Math.max(0, tower.cooldown - dt);
    if (!alive(tower) || !tower.active || tower.cooldown > 0) continue;
    const target = game.units
      .filter(
        (unit) =>
          alive(unit) &&
          unit.team !== tower.team &&
          distance(tower, unit) <= tower.range + unit.radius,
      )
      .sort((a, b) => distance(tower, a) - distance(tower, b))[0];
    if (target) {
      attack(game, tower, target);
      tower.cooldown = tower.attackSpeed;
    }
  }
  for (const unit of game.units) {
    if (
      !alive(unit) ||
      game.phase === "finished" ||
      game.time + 1e-9 < unit.deployUntil
    )
      continue;
    unit.cooldown = Math.max(0, unit.cooldown - dt);
    let target = [...game.units, ...game.towers].find(
      (entity) => entity.id === unit.targetId,
    );
    if (
      !target ||
      !canTarget(unit, target) ||
      (!target.type && distance(unit, target) > 8) ||
      (target.type && !unit.buildingOnly)
    )
      target = chooseTarget(game, unit);
    unit.targetId = target?.id || null;
    if (!target) continue;
    if (distance(unit, target) <= unit.range + target.radius) {
      if (unit.cooldown <= 0) {
        attack(game, unit, target);
        unit.cooldown = unit.attackSpeed;
      }
    } else move(unit, target, dt);
  }
  game.units = game.units.filter(alive);
  if (game.phase === "finished") return;
  if (game.remaining < 1e-8) {
    if (game.crowns[0] !== game.crowns[1]) {
      finish(game, game.crowns[0] > game.crowns[1] ? 0 : 1, "crowns");
    } else if (!game.overtime) {
      game.overtime = true;
      game.remaining = 120;
    } else decideByHealth(game);
  }
}

export function step(game, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  // Bound each integration interval so callers cannot skip combat or timers.
  let remaining = Math.min(dt, 3600);
  while (remaining > 1e-9 && game.phase !== "finished") {
    const delta = Math.min(FIXED_DT, remaining);
    update(game, delta);
    remaining -= delta;
  }
}

export function forfeit(game, team) {
  if ((team === 0 || team === 1) && game.phase !== "finished")
    finish(game, 1 - team, "forfeit");
}

export function viewFor(game, team) {
  const player = game.players[team];
  return {
    phase: game.phase,
    countdown: game.countdown,
    remaining: game.remaining,
    overtime: game.overtime,
    winner: game.winner,
    reason: game.reason,
    crowns: [...game.crowns],
    elixir: player?.elixir ?? 0,
    hand: player ? [...player.hand] : [],
    next: player?.queue[0] ?? null,
    towers: game.towers.map((t) => ({ ...t })),
    units: game.units.filter(alive).map((u) => ({ ...u })),
    effects: game.effects.map(({ damage, targetId, ...fx }) => ({ ...fx })),
    tick: game.tick,
    time: game.time,
  };
}
