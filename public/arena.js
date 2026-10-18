export const SYMBOLS = {
  knight: "🗡️",
  archers: "🏹",
  giant: "👊",
  minions: "🦇",
  musketeer: "🎯",
  minipekka: "🤖",
  fireball: "🔥",
  arrows: "➶",
};
const BLUE = "#539de8",
  RED = "#e4655d";
const previewTowers = [0, 1].flatMap((team) => [
  {
    id: `${team}k`,
    team,
    type: "king",
    x: 9,
    y: team ? 3.5 : 28.5,
    hp: 2400,
    maxHp: 2400,
  },
  {
    id: `${team}l`,
    team,
    type: "princess",
    x: 3.5,
    y: team ? 8 : 24,
    hp: 1400,
    maxHp: 1400,
  },
  {
    id: `${team}r`,
    team,
    type: "princess",
    x: 14.5,
    y: team ? 8 : 24,
    hp: 1400,
    maxHp: 1400,
  },
]);

export class Arena {
  constructor(canvas, onDeploy) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onDeploy = onDeploy;
    this.game = null;
    this.team = 0;
    this.selected = null;
    this.pointer = null;
    this.previous = new Map();
    this.current = new Map();
    this.updateAt = 0;
    this.assetImages = new Map();
    this.motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    canvas.addEventListener(
      "pointermove",
      (e) => (this.pointer = this.worldPoint(e)),
    );
    canvas.addEventListener("pointerleave", () => (this.pointer = null));
    canvas.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.pointer = this.worldPoint(e);
      this.onDeploy(this.pointer);
    });
    requestAnimationFrame((t) => this.draw(t));
  }
  worldPoint(e) {
    const r = this.canvas.getBoundingClientRect();
    let x = ((e.clientX - r.left) / r.width) * 18,
      y = ((e.clientY - r.top) / r.height) * 32;
    return this.team === 1 ? { x: 18 - x, y: 32 - y } : { x, y };
  }
  setState(game, team) {
    this.previous = this.current;
    this.current = new Map((game?.units || []).map((u) => [u.id, u]));
    this.updateAt = performance.now();
    this.game = game;
    this.team = team;
  }
  select(card) {
    this.selected = card;
  }
  rounded(x, y, w, h, r = 4) {
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, w, h, r);
  }
  shadow(x, y, w, h) {
    const c = this.ctx;
    c.fillStyle = "#17311c55";
    c.beginPath();
    c.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
    c.fill();
  }
  image(path) {
    if (!this.assetImages.has(path)) {
      const im = new Image();
      im.src = path;
      this.assetImages.set(path, im);
    }
    const im = this.assetImages.get(path);
    return im.complete && im.naturalWidth ? im : null;
  }
  draw(time) {
    const c = this.ctx;
    c.clearRect(0, 0, 540, 960);
    c.save();
    c.scale(30, 30);
    this.terrain(time);
    c.restore();
    c.save();
    if (this.team === 1) {
      c.translate(540, 960);
      c.rotate(Math.PI);
    }
    c.scale(30, 30);
    const towers = this.game?.towers || previewTowers;
    for (const t of towers) this.tower(t, time);
    const lerp = Math.min(1, (time - this.updateAt) / 67);
    const units = [...(this.game?.units || [])].sort((a, b) => a.y - b.y);
    for (const u of units) {
      const old = this.previous.get(u.id);
      const v =
        old && this.motion
          ? {
              ...u,
              x: old.x + (u.x - old.x) * lerp,
              y: old.y + (u.y - old.y) * lerp,
            }
          : u;
      this.unit(v, time);
    }
    for (const fx of this.game?.effects || []) this.effect(fx, time);
    this.ghost();
    c.restore();
    c.fillStyle = "#071c1721";
    c.fillRect(0, 0, 540, 60);
    c.fillRect(0, 900, 540, 60);
    requestAnimationFrame((t) => this.draw(t));
  }
  terrain(time) {
    const c = this.ctx;
    c.fillStyle = "#5d8850";
    c.fillRect(0, 0, 18, 32);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 18; x++) {
        c.fillStyle = (x + y) % 2 ? "#719b58" : "#6b9552";
        c.fillRect(x, y, 1, 1);
        const n = (x * 97 + y * 43) % 17;
        if (n < 3) {
          c.fillStyle = "#8bb16b30";
          c.fillRect(x + 0.2, y + 0.3, 0.13, 0.05);
          c.fillRect(x + 0.3, y + 0.23, 0.04, 0.14);
        }
      }
    // The opposing territories meet along the river and its two stone bridges.
    c.fillStyle = "#4e783d";
    c.fillRect(0, 14.4, 18, 0.28);
    c.fillRect(0, 17.3, 18, 0.3);
    c.fillStyle = "#4b909c";
    c.fillRect(0, 14.65, 18, 2.7);
    c.fillStyle = "#68adb2";
    c.fillRect(0, 14.9, 18, 2.2);
    c.fillStyle = "#8cc3bf55";
    for (let i = 0; i < 28; i++) {
      const x = (i * 1.73 + (this.motion ? time * 0.0003 : 0)) % 18,
        y = 15 + (i % 5) * 0.43;
      c.fillRect(x, y, 0.5 + (i % 3) * 0.15, 0.04);
    }
    for (const x of [3.5, 14.5]) {
      c.fillStyle = "#2c5a5266";
      c.fillRect(x - 1.15, 14.42, 2.5, 3.3);
      c.fillStyle = "#aba583";
      c.fillRect(x - 1.1, 14.25, 2.2, 3.5);
      c.fillStyle = "#c9bf93";
      c.fillRect(x - 0.85, 14.25, 1.7, 3.5);
      for (let y = 14.3; y < 17.7; y += 0.52) {
        c.strokeStyle = "#938b6c";
        c.lineWidth = 0.035;
        c.beginPath();
        c.moveTo(x - 0.85, y);
        c.lineTo(x + 0.85, y);
        c.stroke();
      }
      c.fillStyle = "#dbd4ab";
      for (const xx of [x - 1.12, x + 0.92]) {
        c.fillRect(xx, 14.1, 0.22, 3.8);
        for (const yy of [14.1, 15.8, 17.5])
          c.fillRect(xx - 0.05, yy, 0.32, 0.26);
      }
    }
    for (const y of [10.8, 21.2]) {
      c.strokeStyle = "#90aa6450";
      c.lineWidth = 0.045;
      c.setLineDash([0.12, 0.23]);
      c.beginPath();
      c.moveTo(0.9, y);
      c.lineTo(17.1, y);
      c.stroke();
      c.setLineDash([]);
    }
    // Paved approaches and planted garden borders frame the playable area.
    for (const y of [3, 29]) {
      c.fillStyle = "#b0b68b40";
      this.rounded(6.9, y - 1.2, 4.2, 2.4, 0.2);
      c.fill();
    }
    for (let y = 0; y < 32; y += 1.15) {
      for (const x of [0.18, 17.82]) {
        c.fillStyle = "#365b33";
        c.beginPath();
        c.arc(x, y, 0.43, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#47743d";
        c.beginPath();
        c.arc(x - 0.04, y - 0.1, 0.32, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#688747";
        c.beginPath();
        c.arc(x - 0.1, y - 0.18, 0.17, 0, Math.PI * 2);
        c.fill();
      }
    }
    for (const [x, y] of [
      [1.2, 4.2],
      [16.7, 10.7],
      [1.2, 27.4],
      [16.6, 21.2],
      [1.1, 12.4],
      [16.8, 2.1],
    ]) {
      c.fillStyle = "#d3bb65";
      for (let n = 0; n < 3; n++) {
        c.beginPath();
        c.arc(x + n * 0.13, y + (n % 2) * 0.13, 0.06, 0, Math.PI * 2);
        c.fill();
      }
    }
    const recovered = this.image("/assets/arena/training.png");
    if (recovered) {
      c.drawImage(recovered, 0, 0, 18, 32);
      c.fillStyle = "#1c362713";
      c.fillRect(0, 0, 18, 32);
    }
    // Banners and decorative crown medallions.
    for (const [y, col] of [
      [1.7, RED],
      [30.3, BLUE],
    ]) {
      c.fillStyle = "#172c2638";
      c.beginPath();
      c.arc(9, y, 0.62, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = col;
      c.globalAlpha = 0.5;
      c.font = ".65px serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("♛", 9, y);
      c.globalAlpha = 1;
    }
    const v = c.createLinearGradient(0, 0, 18, 0);
    v.addColorStop(0, "#15321d66");
    v.addColorStop(0.12, "#15321d00");
    v.addColorStop(0.88, "#15321d00");
    v.addColorStop(1, "#15321d66");
    c.fillStyle = v;
    c.fillRect(0, 0, 18, 32);
  }
  tower(t, time) {
    const c = this.ctx;
    if (t.hp <= 0) {
      this.shadow(t.x, t.y + 0.4, 1.2, 0.4);
      c.fillStyle = "#8f8e72";
      for (let i = 0; i < 6; i++) {
        this.rounded(
          t.x - 0.8 + (i % 3) * 0.5,
          t.y - 0.3 + Math.floor(i / 3) * 0.5,
          0.43,
          0.3,
          0.05,
        );
        c.fill();
      }
      return;
    }
    const king = t.type === "king";
    const w = king ? 2.15 : 1.65,
      h = king ? 2.25 : 1.85;
    const col = t.team === this.team ? BLUE : RED;
    this.shadow(t.x + 0.16, t.y + 0.65, w * 0.75, 0.42);
    c.save();
    c.translate(t.x, t.y);
    if (this.team === 1) c.rotate(Math.PI);
    if (this.game && this.game.time - t.hitAt < 0.1) c.globalAlpha = 0.75;
    const art = this.image(
      `/assets/towers/${t.team === this.team ? "blue" : "red"}-${king ? "king" : "princess"}.png`,
    );
    if (art) {
      const aw = king ? 2.8 : 2.4,
        ah = (aw * art.height) / art.width;
      c.drawImage(art, -aw / 2, -ah + 0.65, aw, ah);
      c.restore();
      this.health(
        t.x,
        t.y + (this.team === 1 ? 2.7 : -2.7),
        t.hp,
        t.maxHp,
        king ? 1.9 : 1.6,
        col,
        true,
      );
      return;
    }
    c.fillStyle = "#616e66";
    this.rounded(-w * 0.64, 0.1, w * 1.28, 0.8, 0.12);
    c.fill();
    c.fillStyle = "#aeb3a0";
    this.rounded(-w / 2, -h * 0.65, w, h, 0.12);
    c.fill();
    c.fillStyle = "#cbd0b8";
    c.fillRect(-w / 2, -h * 0.65, w, 0.2);
    c.fillStyle = "#899784";
    c.fillRect(w * 0.23, -h * 0.43, w * 0.27, h * 0.8);
    c.fillStyle = "#708777";
    for (let y = -h * 0.3; y < h * 0.3; y += 0.3) {
      c.fillRect(-w * 0.45, y, w * 0.8, 0.025);
      c.fillRect((Math.round(y * 10) % 2) * 0.2, y, 0.025, 0.3);
    }
    c.fillStyle = "#41595d";
    this.rounded(-0.28, -0.06, 0.56, 0.75, 0.22);
    c.fill();
    c.fillStyle = "#192d3b";
    this.rounded(-0.18, 0.02, 0.36, 0.58, 0.15);
    c.fill();
    c.fillStyle = col;
    this.rounded(-w * 0.56, -h * 0.64, w * 1.12, 0.45, 0.06);
    c.fill();
    c.fillStyle = "#edcc89";
    c.fillRect(-w * 0.58, -h * 0.64, w * 1.16, 0.08);
    for (const x of [-w * 0.5, -0.13, w * 0.35]) {
      c.fillStyle = "#c8cdb6";
      c.fillRect(x, -h * 0.9, 0.29, 0.5);
      c.fillStyle = "#e2dfbe";
      c.fillRect(x, -h * 0.9, 0.29, 0.09);
    }
    if (king) {
      c.fillStyle = "#dfb77b";
      c.beginPath();
      c.arc(0, -h * 0.64, 0.3, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#4b3025";
      c.fillRect(-0.23, -h * 0.62, 0.46, 0.15);
      c.fillStyle = "#f0c65f";
      c.beginPath();
      c.moveTo(-0.33, -h * 0.93);
      c.lineTo(-0.22, -h * 0.72);
      c.lineTo(0.25, -h * 0.72);
      c.lineTo(0.33, -h * 0.93);
      c.lineTo(0.1, -h * 0.84);
      c.lineTo(0, -h * 1.04);
      c.lineTo(-0.1, -h * 0.84);
      c.closePath();
      c.fill();
    } else {
      c.strokeStyle = "#c1bc9e";
      c.lineWidth = 0.065;
      c.beginPath();
      c.moveTo(w * 0.3, -h * 0.9);
      c.lineTo(w * 0.3, -h * 1.43);
      c.stroke();
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(w * 0.3, -h * 1.43);
      c.lineTo(w * 0.8, -h * 1.29);
      c.lineTo(w * 0.3, -h * 1.12);
      c.fill();
    }
    c.restore();
    this.health(
      t.x,
      t.y + (this.team === 1 ? 1.7 : -2.1),
      t.hp,
      t.maxHp,
      king ? 1.9 : 1.6,
      col,
      true,
    );
  }
  health(x, y, hp, max, w, col, text = false) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    if (this.team === 1) c.rotate(Math.PI);
    c.fillStyle = "#152823cc";
    this.rounded(-w / 2 - 0.04, -0.04, w + 0.08, 0.24, 0.07);
    c.fill();
    c.fillStyle = col;
    this.rounded(-w / 2, 0, w * Math.max(0, hp / max), 0.16, 0.04);
    c.fill();
    if (text) {
      c.font = "bold .26px Arial";
      c.textAlign = "center";
      c.textBaseline = "bottom";
      c.fillStyle = "#ffffff";
      c.shadowColor = "#15271d";
      c.shadowBlur = 2;
      c.fillText(`${Math.ceil(hp)}`, 0, -0.08);
    }
    c.restore();
  }
  unit(u, time) {
    const c = this.ctx,
      col = u.team === this.team ? BLUE : RED;
    const flying = u.card === "minions";
    const bob = this.motion
      ? Math.sin(
          time * 0.012 +
            String(u.id)
              .split("")
              .reduce((a, b) => a + b.charCodeAt(0), 0),
        ) * 0.035
      : 0;
    this.shadow(u.x + 0.04, u.y + 0.22, 0.4, 0.16);
    c.save();
    if (this.game.time < u.deployUntil) {
      c.globalAlpha = 0.6;
      c.strokeStyle = "#f8e8b5";
      c.lineWidth = 0.05;
      c.beginPath();
      c.arc(
        u.x,
        u.y,
        0.5,
        -Math.PI / 2,
        Math.PI * 2 * (1 - (u.deployUntil - this.game.time)) - Math.PI / 2,
      );
      c.stroke();
    }
    c.translate(u.x, u.y + (flying ? -0.2 : bob));
    if (this.team === 1) c.rotate(Math.PI);
    const scale = u.card === "giant" ? 1.55 : u.card === "minipekka" ? 1.15 : 1;
    c.scale(scale, scale);
    c.strokeStyle = col;
    c.lineWidth = 0.065;
    c.beginPath();
    c.ellipse(0, 0.18, 0.37, 0.2, 0, 0, Math.PI * 2);
    c.stroke();
    const sprite = this.image(`/assets/units/${u.card}.png`);
    if (sprite) {
      const ah = flying ? 1.05 : 1.4,
        aw = (ah * sprite.width) / sprite.height;
      c.save();
      c.shadowColor = col;
      c.shadowBlur = 2;
      if (this.game.time - u.attackAt < 0.13)
        c.rotate(u.team === 0 ? -0.14 : 0.14);
      if (this.game.time - u.hitAt < 0.1) c.globalAlpha = 0.65;
      c.drawImage(sprite, -aw / 2, -ah + 0.28, aw, ah);
      c.restore();
      c.restore();
      if (u.hp < u.maxHp)
        this.health(
          u.x,
          u.y + (this.team === 1 ? 1.15 : -1.25),
          u.hp,
          u.maxHp,
          0.72,
          col,
        );
      return;
    }
    const hit = this.game && this.game.time - u.hitAt < 0.1;
    c.fillStyle = hit ? "#fff4cd" : col;
    c.strokeStyle = "#253b47";
    c.lineWidth = 0.07;
    c.lineJoin = "round";
    if (flying) {
      c.fillStyle = "#6f72b5";
      c.beginPath();
      const flap = Math.sin(time * 0.025 + String(u.id).length) * 0.13;
      c.moveTo(-0.1, -0.12);
      c.lineTo(-0.7, -0.45 + flap);
      c.lineTo(-0.58, 0.05);
      c.lineTo(-0.25, 0.12);
      c.lineTo(0.25, 0.12);
      c.lineTo(0.58, 0.05);
      c.lineTo(0.7, -0.45 + flap);
      c.lineTo(0.1, -0.12);
      c.closePath();
      c.fill();
      c.stroke();
      c.fillStyle = "#94a0dc";
      c.beginPath();
      c.ellipse(0, -0.06, 0.19, 0.3, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#eaf3fd";
      c.fillRect(-0.12, -0.18, 0.08, 0.06);
      c.fillRect(0.04, -0.18, 0.08, 0.06);
    } else {
      c.fillStyle = "#283847";
      c.fillRect(-0.23, 0.08, 0.16, 0.25);
      c.fillRect(0.07, 0.08, 0.16, 0.25);
      c.fillStyle = u.card === "giant" ? "#a47b49" : hit ? "#fff4cd" : col;
      this.rounded(-0.29, -0.32, 0.58, 0.55, 0.13);
      c.fill();
      c.stroke();
      c.fillStyle = "#e1b888";
      c.beginPath();
      c.arc(0, -0.4, 0.24, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#302f29";
      c.fillRect(-0.14, -0.45, 0.06, 0.04);
      c.fillRect(0.08, -0.45, 0.06, 0.04);
      if (u.card === "knight") {
        c.fillStyle = "#c9d1cc";
        c.beginPath();
        c.arc(0, -0.48, 0.25, Math.PI, Math.PI * 2);
        c.fill();
        c.fillRect(-0.26, -0.49, 0.08, 0.25);
        c.fillRect(0.18, -0.49, 0.08, 0.25);
        c.fillStyle = "#5e402c";
        c.fillRect(-0.1, -0.31, 0.2, 0.08);
        this.sword(0.36, -0.15, time, u);
      } else if (u.card === "giant") {
        c.fillStyle = "#b66d36";
        c.beginPath();
        c.arc(0, -0.47, 0.25, Math.PI, Math.PI * 2);
        c.fill();
        c.fillStyle = "#c89868";
        c.beginPath();
        c.arc(-0.36, -0.1, 0.15, 0, Math.PI * 2);
        c.arc(0.36, -0.1, 0.15, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#633e2a";
        c.fillRect(-0.29, -0.04, 0.58, 0.1);
      } else if (u.card === "minipekka") {
        c.fillStyle = "#7696ad";
        this.rounded(-0.3, -0.7, 0.6, 0.53, 0.08);
        c.fill();
        c.stroke();
        c.fillStyle = "#1b3043";
        c.fillRect(-0.22, -0.49, 0.44, 0.13);
        c.fillStyle = "#73ddf9";
        c.fillRect(-0.16, -0.47, 0.11, 0.06);
        c.fillRect(0.05, -0.47, 0.11, 0.06);
        c.strokeStyle = "#c2c5ac";
        c.lineWidth = 0.1;
        for (const s of [-1, 1]) {
          c.beginPath();
          c.moveTo(s * 0.2, -0.63);
          c.lineTo(s * 0.4, -0.83);
          c.lineTo(s * 0.39, -0.96);
          c.stroke();
        }
        this.sword(0.4, -0.1, time, u);
      } else if (u.card === "archers") {
        c.fillStyle = "#dc77aa";
        c.beginPath();
        c.arc(0, -0.43, 0.28, Math.PI, Math.PI * 2);
        c.fill();
        c.fillRect(-0.28, -0.43, 0.1, 0.32);
        c.strokeStyle = "#d4ac73";
        c.lineWidth = 0.065;
        c.beginPath();
        c.arc(0.27, -0.1, 0.34, -Math.PI / 2, Math.PI / 2);
        c.stroke();
        c.strokeStyle = "#e4e0c2";
        c.lineWidth = 0.025;
        c.beginPath();
        c.moveTo(0.27, -0.44);
        c.lineTo(0.27, 0.24);
        c.stroke();
      } else if (u.card === "musketeer") {
        c.fillStyle = "#8c6eaf";
        c.beginPath();
        c.arc(0, -0.49, 0.26, Math.PI, Math.PI * 2);
        c.fill();
        c.fillRect(-0.3, -0.47, 0.6, 0.07);
        c.fillStyle = "#a8bfca";
        c.fillRect(0.2, -0.31, 0.12, 0.65);
        c.fillStyle = "#604837";
        c.fillRect(0.18, -0.12, 0.16, 0.43);
        c.fillStyle = "#d3d6d5";
        c.fillRect(0.21, -0.42, 0.1, 0.22);
      }
    }
    c.restore();
    if (u.hp < u.maxHp)
      this.health(
        u.x,
        u.y + (this.team === 1 ? 0.8 : -0.9),
        u.hp,
        u.maxHp,
        0.72,
        col,
      );
  }
  sword(x, y, time, u) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    c.rotate(
      -0.3 + (this.game && this.game.time - u.attackAt < 0.17 ? 0.8 : 0),
    );
    c.fillStyle = "#d6e5e1";
    c.beginPath();
    c.moveTo(-0.065, 0.07);
    c.lineTo(-0.065, -0.6);
    c.lineTo(0, -0.77);
    c.lineTo(0.065, -0.6);
    c.lineTo(0.065, 0.07);
    c.fill();
    c.fillStyle = "#e8c47d";
    c.fillRect(-0.15, 0.01, 0.3, 0.07);
    c.fillStyle = "#604b3c";
    c.fillRect(-0.04, 0.08, 0.08, 0.18);
    c.restore();
  }
  effect(f, time) {
    const c = this.ctx;
    let life = f.duration ?? f.life ?? 0.6;
    let age = Math.max(0, life - (f.ttl ?? life));
    if (age > life * 2) return;
    const alpha = Math.max(0.08, 1 - age / Math.max(0.3, life));
    c.save();
    c.globalAlpha = Math.min(0.9, alpha);
    const type = f.type === "spell" ? f.card : f.type || "";
    if (type.includes("fire") || type === "explosion") {
      const r = f.radius || 2;
      const g = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
      g.addColorStop(0, "#fff7b3");
      g.addColorStop(0.32, "#ffbb47");
      g.addColorStop(0.7, "#ec622acc");
      g.addColorStop(1, "#da421000");
      c.fillStyle = g;
      c.beginPath();
      c.arc(f.x, f.y, r, 0, Math.PI * 2);
      c.fill();
    } else if (type.includes("arrow")) {
      c.strokeStyle = "#efe4ac";
      c.lineWidth = 0.045;
      for (let i = 0; i < 12; i++) {
        const a = i * 2.4,
          r = Math.sqrt(i / 12) * (f.radius || 2),
          x = f.x + Math.cos(a) * r,
          y = f.y + Math.sin(a) * r;
        c.beginPath();
        c.moveTo(x - 0.15, y - 0.5);
        c.lineTo(x + 0.08, y + 0.2);
        c.stroke();
      }
    } else if (type === "projectile") {
      c.fillStyle = f.team === this.team ? "#e9d3a0" : "#ffc38e";
      c.beginPath();
      c.arc(
        f.x + (f.toX - f.x) * Math.min(1, age / life),
        f.y + (f.toY - f.y) * Math.min(1, age / life),
        0.11,
        0,
        Math.PI * 2,
      );
      c.fill();
    } else {
      c.strokeStyle = f.team === this.team ? "#d7eeff" : "#ffd9aa";
      c.lineWidth = 0.07;
      c.beginPath();
      c.arc(f.x, f.y, 0.25 + age * 0.8, 0, Math.PI * 2);
      c.stroke();
    }
    c.restore();
  }
  ghost() {
    if (!this.selected || !this.pointer || this.game?.phase !== "playing")
      return;
    const c = this.ctx,
      p = this.pointer;
    const spell = this.selected.kind === "spell";
    const valid = spell || (this.team === 0 ? p.y > 17.3 : p.y < 14.7);
    c.save();
    c.globalAlpha = 0.35;
    c.fillStyle = valid ? "#8fe5f4" : "#ff746c";
    if (!spell) {
      if (this.team === 0) c.fillRect(0.6, 17.6, 16.8, 13.8);
      else c.fillRect(0.6, 0.6, 16.8, 13.8);
    }
    c.globalAlpha = 0.7;
    c.strokeStyle = valid ? "#dbf7ff" : "#ffd0c9";
    c.lineWidth = 0.055;
    c.setLineDash([0.14, 0.13]);
    c.beginPath();
    c.arc(p.x, p.y, spell ? this.selected.radius || 2 : 0.65, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    c.translate(p.x, p.y);
    if (this.team === 1) c.rotate(Math.PI);
    c.font = ".7px serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillStyle = "white";
    c.fillText(SYMBOLS[this.selected.id] || "⚔", 0, 0);
    c.restore();
  }
}
