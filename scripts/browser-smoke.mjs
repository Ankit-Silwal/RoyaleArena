// Run separately: npm run test:browser. Uses installed Chrome (CHROME_CHANNEL to override).
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createArenaServer } from "../server/index.js";
import { CARDS, forfeit } from "../shared/game.js";

const arena = createArenaServer();
const errors = [];
let browser;
const output = new URL("../.local/qa/", import.meta.url);
await mkdir(output, { recursive: true });
const until = async (condition, message) => {
  const deadline = Date.now() + 10000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
try {
  arena.server.listen(0, "127.0.0.1");
  await once(arena.server, "listening");
  const url = `http://127.0.0.1:${arena.server.address().port}`;
  browser = await chromium.launch({
    channel: process.env.CHROME_CHANNEL || "chrome",
    headless: true,
  });
  const southContext = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const northContext = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
  });
  const south = await southContext.newPage(),
    north = await northContext.newPage();
  for (const page of [south, north]) {
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("response", (res) => {
      if (res.status() >= 400) errors.push(`${res.status()} ${res.url()}`);
    });
  }
  await south.goto(url);
  await south.locator("#connection.online").waitFor();
  await south.screenshot({
    path: fileURLToPath(new URL("desktop-lobby.png", output)),
    fullPage: true,
  });
  await south.locator("#player-name").fill("South Knight");
  await south.locator("#create-room").click();
  await south.locator("#room-controls").waitFor({ state: "visible" });
  const code = (await south.locator("#room-display").textContent()).trim();
  assert.match(code, /^[A-Z2-9]{6}$/);
  await north.goto(`${url}/?room=AB2C9D`);
  assert.equal(await north.locator("#room-code").inputValue(), "AB2C9D");
  await north.locator("#room-code").fill("ab2c9d");
  assert.equal(await north.locator("#room-code").inputValue(), "AB2C9D");
  await north.goto(`${url}/?room=${code}`);
  await north.locator("#connection.online").waitFor();
  assert.equal(await north.locator("#room-code").inputValue(), code);
  await north.locator("#player-name").fill("North Archer");
  await north.locator("#join-room").click();
  const room = arena.rooms.get(code);
  await until(
    () => room.game?.phase === "playing",
    "Match countdown did not complete",
  );
  for (const [team, page] of [
    [0, south],
    [1, north],
  ]) {
    const slot = room.game.players[team].hand.findIndex((id) => {
      const card = CARDS.find((c) => c.id === id);
      return (
        card.kind === "troop" && card.cost <= room.game.players[team].elixir
      );
    });
    assert.ok(slot >= 0, "A playable troop exists in starting hand");
    await page.locator("#hand .card").nth(slot).click();
    const canvas = page.locator("#arena");
    const bounds = await canvas.boundingBox();
    await canvas.click({
      position: {
        x: bounds.width * (team === 0 ? 4 / 18 : 14 / 18),
        y: (bounds.height * 21) / 32,
      },
    });
    await until(
      () => room.game.units.some((u) => u.team === team),
      `Team ${team} UI deployment did not reach server`,
    );
  }
  assert.equal(
    await south.locator("#opponent-name").textContent(),
    "North Archer",
  );
  assert.equal(
    await north.locator("#opponent-name").textContent(),
    "South Knight",
  );
  await south.waitForTimeout(1300); // Let the recovered deployment animation finish before visual QA.
  assert.ok(
    await south
      .locator(".deck-panel")
      .evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight),
    "Desktop battlefield and hand fit in the viewport",
  );
  await south.screenshot({
    path: fileURLToPath(new URL("desktop-battle.png", output)),
    fullPage: true,
  });
  await north.screenshot({
    path: fileURLToPath(new URL("north-battle.png", output)),
    fullPage: true,
  });
  await south.setViewportSize({ width: 390, height: 844 });
  await south.evaluate(() => scrollTo(0, 0));
  assert.ok(
    await south
      .locator(".deck-panel")
      .evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight),
    "Mobile battlefield and hand fit in the viewport",
  );
  assert.ok(
    await south.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile has no horizontal overflow",
  );
  await south.screenshot({
    path: fileURLToPath(new URL("mobile-battle.png", output)),
    fullPage: true,
  });
  await north.close();
  await south.locator("#result-dialog[open]").waitFor();
  assert.equal(room.game.winner, 0);
  await south.locator("#result-leave").click();
  await south.locator("#lobby-controls").waitFor({ state: "visible" });
  await south.locator("#play-bot").click();
  await until(
    () =>
      [...arena.rooms.values()].some(
        (r) => r.mode === "bot" && r.game?.phase === "playing",
      ),
    "Bot match did not start",
  );
  const botRoom = [...arena.rooms.values()].find((r) => r.mode === "bot");
  await until(
    () => botRoom.game.units.some((u) => u.team === 1),
    "Bot did not deploy units",
  );
  // Controlled fixture exercises both spell controls, real server damage,
  // canvas effects and audio requests without waiting for a shuffled deck cycle.
  botRoom.game.players[0].hand = ["fireball", "arrows", "knight", "giant"];
  botRoom.game.players[0].elixir = 10;
  await south
    .locator("#hand .card")
    .first()
    .filter({ hasText: "Fireball" })
    .waitFor();
  await south.locator("#sound-button").click();
  const target = botRoom.game.towers.find(
    (t) => t.team === 1 && t.type === "princess",
  );
  for (const [slot, id] of [
    [0, "fireball"],
    [1, "arrows"],
  ]) {
    const hp = target.hp;
    await south.locator("#hand .card").nth(slot).click();
    const box = await south.locator("#arena").boundingBox();
    await south
      .locator("#arena")
      .click({
        position: {
          x: (box.width * target.x) / 18,
          y: (box.height * target.y) / 32,
        },
      });
    await until(
      () => target.hp < hp,
      `${id} UI cast did not damage enemy tower`,
    );
  }
  await south.waitForTimeout(400);
  forfeit(botRoom.game, 1);
  await south.locator("#result-dialog[open]").waitFor();
  await south.locator("#rematch").click();
  await until(
    () => botRoom.game.phase === "countdown",
    "Bot rematch did not reset match",
  );
  await south.locator("#result-dialog").waitFor({ state: "hidden" });
  assert.deepEqual(errors, [], `Browser errors: ${errors.join("; ")}`);
  console.log(
    "PASS: desktop lobby, invite join, both team deployments, opponent views, mobile layout, disconnect victory, bot deployment, spells with sound and rematch; zero browser errors. Screenshots: .local/qa/",
  );
} finally {
  await browser?.close();
  await arena.close();
}
