"""Recover the small browser asset set from the operator-supplied APKS.

Python 3.14+ and Pillow are required. No APK code is executed. Originals are
read in memory; only selected images, audio, fonts and compact data are written.
Usage: python scripts/extract-assets.py PATH_TO_APKS
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import lzma
import struct
import zipfile
from collections import deque
from compression import zstd
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "assets"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def csv_rows(data: bytes) -> list[dict]:
    # Supercell uses a 4-byte uncompressed length where LZMA-alone uses 8.
    plain = lzma.decompress(data[:9] + bytes(4) + data[9:])
    return list(csv.DictReader(io.StringIO(plain.decode("utf-8-sig"))))[1:]


def texture_images(data: bytes) -> list[Image.Image]:
    if data[:2] != b"SC" or data[2:6] != bytes.fromhex("00000004"):
        raise ValueError("Unsupported SC container version")
    # Version 4 wrapper: compression ID, digest length, MD5, Zstandard frame.
    start = 14 + int.from_bytes(data[10:14], "big")
    decoder = zstd.ZstdDecompressor()
    plain = decoder.decompress(data[start:])
    if not decoder.eof:
        raise ValueError("Truncated SC compression frame")
    expected_digest = data[14:start]
    if len(expected_digest) == 16 and hashlib.md5(plain).digest() != expected_digest:
        raise ValueError("SC uncompressed MD5 does not match")
    images, pos = [], 0
    while pos + 5 <= len(plain):
        tag, size = struct.unpack_from("<BI", plain, pos)
        if tag == 0:
            break
        if tag not in (1, 27, 28, 29):
            raise ValueError(f"Unsupported SC texture tag: {tag}")
        fmt, width, height = struct.unpack_from("<BHH", plain, pos + 5)
        pixels = plain[pos + 10:pos + 5 + size]
        bpp = 4 if fmt in (0, 1) else 2
        if len(pixels) != width * height * bpp:
            raise ValueError("Texture size mismatch")
        raw = bytearray(width * height * 4)
        coords = (
            ((y, x) for by in range(0, height, 32) for bx in range(0, width, 32)
             for y in range(by, min(height, by + 32))
             for x in range(bx, min(width, bx + 32)))
            if tag in (27, 28, 29)
            else ((y, x) for y in range(height) for x in range(width))
        )
        p = 0
        for y, x in coords:
            dest = (y * width + x) * 4
            if fmt in (0, 1):
                rgba = pixels[p:p + 4]
            else:
                v = int.from_bytes(pixels[p:p + 2], "little")
                if fmt == 2:  # RGBA4444
                    rgba = bytes((v >> 12) * 17 if i == 0 else
                                 ((v >> (12 - i * 4)) & 15) * 17 for i in range(4))
                elif fmt == 4:  # RGB565
                    rgba = bytes((((v >> 11) & 31) * 255 // 31,
                                  ((v >> 5) & 63) * 255 // 63,
                                  (v & 31) * 255 // 31, 255))
                else:
                    raise ValueError(f"Unsupported pixel type: {fmt}")
            raw[dest:dest + 4] = rgba
            p += bpp
        images.append(Image.frombytes("RGBA", (width, height), raw))
        pos += size + 5
    return images


def isolated_sprite(image: Image.Image, seed: tuple[int, int]) -> Image.Image:
    """Retain the connected opaque sprite at a measured atlas point.

    Packed sprites rotate and sit beside unrelated frames. Isolating alpha
    connectivity avoids leaking those neighbors into a rectangular crop.
    """
    width, height = image.size
    alpha = image.getchannel("A").tobytes()
    sx, sy = seed
    if alpha[sy * width + sx] <= 50:
        raise ValueError(f"Sprite seed {seed} is transparent")
    seen = {sy * width + sx}
    todo = deque(seen)
    while todo:
        p = todo.popleft()
        x, y = p % width, p // width
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            q = ny * width + nx
            if 0 <= nx < width and 0 <= ny < height and q not in seen and alpha[q] > 50:
                seen.add(q)
                todo.append(q)
    mask = bytearray(width * height)
    for p in seen:
        mask[p] = alpha[p]
        x, y = p % width, p // width
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height:
                q = ny * width + nx
                mask[q] = alpha[q]
    result = image.copy()
    result.putalpha(Image.frombytes("L", image.size, mask))
    return result.crop(result.getbbox())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apks", type=Path)
    args = parser.parse_args()
    source = args.apks.read_bytes()
    manifest = {"sourceSha256": sha(source), "files": [], "notes": [
        "Selected local research assets; upstream copyright is retained.",
        "Arena is assembled from decoded atlas crops, not a recovered renderer.",
        "No native program code was executed; this is static asset/data recovery.",
    ]}
    with zipfile.ZipFile(io.BytesIO(source)) as bundle:
        base_bytes = bundle.read("base.apk")
        pack_bytes = bundle.read("split_googleplay_asset_pack.apk")
    manifest["baseSha256"] = sha(base_bytes)
    manifest["assetPackSha256"] = sha(pack_bytes)
    base = zipfile.ZipFile(io.BytesIO(base_bytes))
    pack = zipfile.ZipFile(io.BytesIO(pack_bytes))

    def read(member):
        archive = base if member in base.namelist() else pack
        return archive.read(member)

    def save(relative, data, member, transform="byte copy"):
        path = OUT / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        manifest["files"].append({"path": relative, "sha256": sha(data),
                                  "sourceMember": member, "transform": transform})

    def image_save(relative, image, member, transform):
        buf = io.BytesIO()
        image.save(buf, format="PNG", optimize=True)
        save(relative, buf.getvalue(), member, transform)

    portraits = {"knight": "knight", "archers": "archers", "giant": "giant",
                 "minipekka": "mini_pekka", "minions": "minions",
                 "musketeer": "musketeer_dl", "arrows": "arrows", "goblins": "goblins"}
    for target, original in portraits.items():
        member = f"assets/image/chr/{original}.png"
        save(f"cards/{target}.png", read(member), member)

    ui_member = "assets/sc/ui_spells_tex.sc"
    ui = texture_images(read(ui_member))[0]
    image_save("cards/fireball.png", ui.crop((600, 1524, 798, 1777)), ui_member,
               "Zstandard decode; untile 32x32 RGB565; crop [600,1524,798,1777]")
    image_save("king.png", ui.crop((1200, 508, 1396, 758)), ui_member,
               "Zstandard decode; untile 32x32 RGB565; crop [1200,508,1396,758]")

    training_member = "assets/sc/arena_training_tex.sc"
    decor, ground = texture_images(read(training_member))
    field = ground.crop((0, 0, 802, 1018))
    river = ground.crop((806, 0, 850, 940)).rotate(90, expand=True)
    field.paste(river.resize((802, 76), Image.Resampling.LANCZOS), (0, 471))
    bridge = decor.crop((668, 930, 750, 1016)).resize((64, 94), Image.Resampling.LANCZOS)
    field.alpha_composite(bridge, (113, 462))
    field.alpha_composite(bridge, (587, 462))
    image_save("arena/training.png", field, training_member,
               "Decode RGBA8888/RGB565 tiled atlases; assemble field, rotated river and two bridge crops")
    image_save("arena/grass.png", ground.crop((220, 270, 410, 460)), training_member,
               "Decode tiled RGB565; crop [220,270,410,460]")
    image_save("arena/bridge.png", bridge, training_member, "Decode atlas; crop and resize bridge")

    tower_member = "assets/sc/building_tower_tex.sc"
    towers = texture_images(read(tower_member))[0]
    for name, bounds in {"blue-princess": (563, 406, 752, 654),
                         "red-princess": (787, 190, 989, 442),
                         "blue-king": (987, 420, 1177, 674),
                         "red-king": (360, 414, 554, 655)}.items():
        image_save(f"towers/{name}.png", towers.crop(bounds), tower_member,
                   f"Decode RGBA4444 tiled atlas; crop {bounds}; constituent art only")

    for name, original, seed in (
        ("knight", "knight", (51, 80)), ("archers", "archer", (230, 60)),
        ("giant", "giant", (80, 60)), ("minipekka", "mini_pekka", (320, 45)),
        ("minions", "minion", (470, 50)), ("musketeer", "musketeer", (40, 60)),
    ):
        member = f"assets/sc/chr_{original}_tex.sc"
        atlas = texture_images(read(member))[0]
        sprite = isolated_sprite(atlas, seed)
        image_save(f"units/{name}.png", sprite, member,
                   f"Decode SC texture; retain connected alpha component at {seed}; one static blue frame, no recovered animation timeline")

    sounds = {"battle": "assets/music/2min_loop_battle_01.ogg",
              "victory": "assets/music/scroll_win_02.ogg", "defeat": "assets/music/scroll_lose_01.ogg",
              "click": "assets/sfx/button_click_02.ogg", "deploy": "assets/sfx/deploy_timer_ding_03.ogg",
              "knight": "assets/sfx/knight_deploy_31111.ogg", "archers": "assets/sfx/clash_archer_deploy_01.ogg",
              "giant": "assets/sfx/giant_deploy_01.ogg", "minipekka": "assets/sfx/minipekka_deploy_01.ogg",
              "musketeer": "assets/sfx/musketeer_deploy_01.ogg", "minions": "assets/sfx/minion_deploy_01.ogg",
              "fireball": "assets/sfx/fireball_hit_01.ogg",
              "arrows": "assets/sfx/arrow_norm_impact_06.ogg"}
    for name, member in sounds.items():
        save(f"audio/{name}.ogg", read(member), member)
    for target, member in {"supercell-magic.ttf": "assets/font/supercell-magic_0.ttf",
                           "supercell-text.ttf": "res/font/supercell_text_android_a_rg.ttf",
                           "supercell-headline.ttf": "res/font/supercellheadline_heavy.ttf"}.items():
        save(f"fonts/{target}", read(member), member)

    tables = {}
    for name in ("characters", "spells_characters", "spells_other", "projectiles", "globals", "buildings", "battle_timelines"):
        member = f"assets/csv_logic/{name}.csv"
        if member in base.namelist():
            tables[name] = csv_rows(read(member))
    chars = {r["Name"]: r for r in tables["characters"] if r.get("Name")}
    projectiles = {r["Name"]: r for r in tables["projectiles"] if r.get("Name")}
    spells = {r["Name"]: r for key in ("spells_characters", "spells_other") for r in tables[key] if r.get("Name")}
    recovered = {"sourceSha256": sha(source), "units": "Raw packaged base-level values; range in 1000ths of a tile; timing in milliseconds. Speed-to-world conversion is an implementation inference.", "cards": {}}
    for cid, name in {"knight": "Knight", "archers": "Archer", "giant": "Giant", "minipekka": "MiniPekka",
                      "minions": "Minions", "musketeer": "Musketeer", "fireball": "Fireball", "arrows": "Arrows", "goblins": "Goblins"}.items():
        spell = spells[name]
        char = chars.get(spell.get("SummonCharacter"), {})
        projectile = projectiles.get(char.get("Projectile") or spell.get("Projectile"), {})
        selected = ("Name", "Hitpoints", "Damage", "HitSpeed", "Speed", "Range", "SightRange", "DeployTime", "AttacksGround", "AttacksAir", "FlyingHeight", "TargetOnlyBuildings", "CollisionRadius", "LoadTime")
        recovered["cards"][cid] = {
            "spell": {k: v for k, v in spell.items() if v and k in ("Name", "ManaCost", "SummonCharacter", "SummonNumber", "ProjectileWaves", "ProjectileWaveInterval", "Radius", "Projectile", "CanDeployOnEnemySide")},
            "character": {k: char[k] for k in selected if char.get(k)},
            "projectile": {k: v for k, v in projectile.items() if v and k in ("Name", "Damage", "Speed", "Radius", "CrownTowerDamagePercent", "AoeToAir", "AoeToGround")},
        }
    recovered["globals"] = [{k: v for k, v in r.items() if v} for r in tables["globals"] if r["Name"] in ("MAX_MANA",)]
    timeline_rows = tables.get("battle_timelines", [])
    default_end = next((i for i, r in enumerate(timeline_rows[1:], 1) if r.get("Name")), len(timeline_rows))
    recovered["defaultBattleTimeline"] = [{k: v for k, v in r.items() if v} for r in timeline_rows[:default_end]]
    recovered["buildings"] = [{k: v for k, v in r.items() if v} for r in tables.get("buildings", []) if "tower" in r["Name"].lower()][:10]
    recovered["towerProjectiles"] = [{k: v for k, v in projectiles[name].items() if v} for name in ("KingProjectile", "TowerPrincessProjectile")]
    save("recovered-config.json", json.dumps(recovered, indent=2).encode(), "assets/csv_logic/*.csv", "LZMA header repair; CSV projection and projectile join")
    (OUT / "asset-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(OUT), "files": len(manifest["files"]), "sourceSha256": manifest["sourceSha256"]}))


if __name__ == "__main__":
    main()
