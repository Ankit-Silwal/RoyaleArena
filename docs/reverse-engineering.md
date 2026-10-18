# Artifact recovery and reconstruction evidence

This browser game is a new implementation informed by static inspection of the supplied Android package. Selected portraits, troop frames, field textures, tower art, sounds and fonts come from the package. The Android native engine, original source, original matchmaking and official servers were not recovered or executed.

## Target and REA evidence

- Operator-supplied input: `clash-royale-331867-armeabi-v7a-downzen.com.apks` from the local Downloads directory.
- APKS SHA-256: `4617b68b4e6d75dcb6f680033e518321c81744899d2e62faa2abcd18da007ebc`.
- REA `open_binary` classified the input from its bytes as a ZIP archive.
- REA inspection: `ev_a35819cb3147d9c9d403e2069e9e709ec901c9f7ff33a859e248feebf2375dd2`.
- REA summary: `ev_9500cea3a2e61894be2a5ca527778228d12f9b4c86d331b9684e42a79b10089a`.
- REA safe extraction: `ev_9827801da01b02d086ef2a330d628bdf3af8079cf10d07be4101a781d5637d73`. Containment was verified and no integrity contradictions were reported.
- Graph manifest: `agm_8bd79b390c0a2e2225c36b541845bb8d0f873dba6bc5cbe684fdc45518a0548b`.

The outer archive contains six APK files: the base, ARMv7 native split, English and Spanish language splits, density split, and Google Play asset pack. REA inventories the outer archive only; nested APK ZIP inspection and asset decoding were performed by the project extraction script and standard Python tooling.

The base APK is 47,345,651 bytes, SHA-256 `bf3d60f74f1a81ac2560bc1ed9e602d8cacfcf637641f70a85da91763e04083d`. Its 3,129 ZIP entries include 1,134 OGG files and 203 CSV files. The asset pack is 377,370,034 bytes, SHA-256 `c0835176116202e863ce06386b39507e2d7661023b5af9bd443ea5a7b9a3f608`; its 982 entries include 889 SC containers and 88 PNG files. Counts describe this exact package, not a current server content set.

## Reproducible extraction

With Python 3.14+ (standard `compression.zstd`) and Pillow:

```powershell
python scripts/extract-assets.py "$env:USERPROFILE/Downloads/clash-royale-331867-armeabi-v7a-downzen.com.apks"
```

The script reads the APKs in memory, executes no packaged code, and writes a selected browser asset set under `public/assets`. It does not retain the APKs in the repository. `public/assets/asset-manifest.json` records each output SHA-256, source archive member and transformation. This manifest establishes byte provenance, not redistribution rights; upstream ownership of the assets remains unchanged.

CSV files use LZMA with a four-byte uncompressed size. Inserting four zero bytes after the properties and size yields the LZMA-alone header accepted by Python. The script parses the decoded table, skips its type declaration row, and joins ranged characters to `projectiles.csv` to recover their damage.

The inspected SC files use version 4 wrappers around Zstandard data. The decoder verifies the embedded MD5 of the uncompressed frame. Texture records contain RGBA8888, RGBA4444 or RGB565 pixels. Tags 27–29 use 32-by-32 tile order; decoded rows are untiled before PNG export. Only those observed format variants are supported. SC animation shape, movie-clip and timeline reconstruction remains outside this decoder.

The training field is a composition of recovered ground, river and bridge atlas pixels. Tower images are constituent art cropped from the original atlas. Troop images isolate one connected alpha component from each texture atlas: these are static original frames, not a reconstruction of the original directional animation system. Blue source artwork is reused with the browser renderer's team indicators.

## Recovered base card data

These are the packaged raw base values, before any level scaling. They are not claims about current official balance. Range is expressed here in tiles using the table's apparent 1,000 units per tile; attack intervals are milliseconds.

| Card           | Cost | Count | HP each | Damage each |          Range |    Attack interval |
| -------------- | ---: | ----: | ------: | ----------: | -------------: | -----------------: |
| Knight         |    3 |     1 |     690 |          79 |            1.2 |               1200 |
| Archers        |    3 |     2 |     119 |          42 |              5 |                900 |
| Giant          |    5 |     1 |    1930 |         120 |            1.2 |               1500 |
| Mini P.E.K.K.A |    4 |     1 |     642 |         340 |            0.8 |               1600 |
| Minions        |    3 |     3 |      90 |          46 |            1.6 |               1000 |
| Musketeer      |    4 |     1 |     340 |         103 |              6 |               1000 |
| Fireball       |    4 |     — |       — |         325 |     Radius 2.5 |                  — |
| Arrows         |    3 |     — |       — | 48 per wave | Spell radius 4 | 3 waves, 200 apart |

All six selected troops have `DeployTime=1000`. Knight, Archers and Musketeer have raw speed 60; Giant 45; Mini P.E.K.K.A and Minions 90. Converting those speed fields into browser world units requires an implementation choice because native movement code was not analyzed. Giant targets only buildings. Archers, Minions and Musketeer attack air and ground. Minions have `FlyingHeight=1500`. Both spell projectiles have `CrownTowerDamagePercent=-70`; interpreting this as 30% of normal damage is a reconstruction choice consistent with the field name.

`buildings.csv` gives Princess Tower HP 1400, range 7500 and attack interval 800; King Tower HP 2400, range 7000 and attack interval 1000. Their joined projectiles each have base damage 50. The default battle timeline starts with six elixir, a 180-second normal section and 120-second overtime. It contains elixir full-bar times 28000, 14000 and 9300 milliseconds. `globals.csv` confirms `MAX_MANA=10`. The compact machine-readable values and source row projections are in `public/assets/recovered-config.json`.

## Scope and uncertainty

Confirmed observations are archive bytes, decoded images/audio/fonts and the table values above. The browser simulation's pathfinding, collision separation, targeting priority, damage scheduling, level policy, bot decisions, authoritative room protocol and rendering are new project code. Those behaviors cannot be described as a byte-for-byte port of the original native game. Static recovery does not establish original runtime behavior, full balance equivalence, original networking compatibility, or animation fidelity. The project makes no connection to official game services.

Validation performed: original archive identity hashed; REA outer archive inventory and safe extraction completed; selected SC uncompressed checksums verified during extraction; extracted PNGs visually inspected for card, field, tower and troop content; selected CSV character/projectile joins checked directly. The extraction command is repeatable and output hashes are retained in its manifest.
