# Survival Library — offline knowledge hotspot

A self-contained web app that runs on a small computer (Raspberry Pi, old laptop, old Android phone),
broadcasts **its own WiFi network**, and serves a survival library to every phone that connects — with
**no internet, no cell network and no app install**. People join the WiFi, a page pops up, and they can read,
navigate, signal for help, and download 3D-printable tools to rebuild with.

## What's inside

| Section | Contents |
|---|---|
| **Library** | 39 practical guides: first 72 hours, water finding & disinfection (exact bleach doses), fire (site, tinder, ignition, bow drill, wet weather, CO safety), shelter & warmth, first aid (CPR, bleeding control, wounds, burns, fractures, hypothermia/heatstroke, ORS), food (rationing, foraging safety, fishing, preservation), navigation (map & compass, sun & stars, improvised compass), signalling, radio, Morse, knots, cordage, sanitation, 3D printing in austerity, tool care, bicycle repair, carts & simple machines, power & light, nuclear/chemical, natural disasters, weather, community organising. Full-text search, cross-links, printable. |
| **Compass** | Phone sensor compass where the browser allows it, plus a **sun compass that needs no sensors** (clock + rough location → sun direction), sunrise/sunset, solar noon, daylight left, local solar time for sundials. |
| **Maps** | Built-in offline world map; detailed regional OpenStreetMap maps (PMTiles) you can add; scanned paper maps; tap for coordinates (decimal + DMS), measure distances, save waypoints, export GPX. |
| **3D Prints** | 27 parametric OpenSCAD designs → 60 ready STL files with an in-browser 3D preview, print settings, material advice and usage notes. |
| **Toolkit** | SOS screen flasher & beeper, Morse translator, screen flashlight, bleach dose calculator, CPR metronome, pace counter, thunderstorm distance. Red night-vision display mode. |
| **Take It With You** | One-file offline copy of every guide for phones, and a zip of the whole project to set up another hotspot node. |

### 3D-printable designs

- **Hand tools:** garden trowel, hoe head, rake head (all take a 25 mm wooden handle), double open-end wrenches (8–19 mm), knife sharpening angle guides
- **Fire:** bow-drill bearing block (uses a scavenged 608 skateboard bearing), ferro rod handle
- **Water:** funnel with air-vent groove, bucket gravity-filter cartridge, hose-barb couplers and tees
- **Navigation:** latitude-specific sundial / sun compass (15°N–55°N, 25°S, 35°S), floating needle compass, clinometer
- **Food, textiles, shelter:** fishing handline spool, net-making needle + mesh gauge, drop-spindle whorls, guyline tensioners, door/lid hinge
- **Mechanical:** pulley sheave + block plates (608 bearings), involute spur gears (15/30/45 T, module 2), ratcheting hand winch (drum, pawl, crank)
- **Transport:** cart/wheelbarrow wheel (180 & 125 mm, 608 bearings, hose tyre), axle spacer kit, tube-frame connectors for PVC/conduit (tee, elbow, cross, 3-way corner, side-outlet tee), bicycle tyre levers, bike trailer hitch, bucket pannier hooks

Each `.scad` file in `web/prints/src/` starts with a block of `// @title`, `// @material`, `// @print`, `// @use`
notes and editable parameters. Printed plastic is not steel — every load-bearing design states its limits.

## Quick start

**Raspberry Pi hotspot (recommended)** — Pi Zero 2 W, 3, 4 or 5 with Raspberry Pi OS Bookworm:

```bash
git clone <this repo> && cd <repo>/survival-library
sudo ./device/setup-pi.sh                       # open WiFi "SURVIVAL-LIBRARY", http://10.42.0.1/
sudo ./device/fetch-map.sh "My County" -89.9,39.6,-89.4,40.0   # optional: detailed local map
```

**Any laptop / Android phone (Termux)** — no install, just Python 3:

```bash
python3 device/serve.py            # then turn on the device's own hotspot and share the printed address
```

Full hardware, power, signage and maintenance guide: **[device/README.md](device/README.md)**.

## Project layout

```
survival-library/
├── web/                     # everything the hotspot serves (static files)
│   ├── index.html, css/, js/          app (no frameworks; Leaflet + protomaps-leaflet vendored)
│   ├── content/articles/*.md          the guides (Markdown with a small front-matter header)
│   ├── prints/src/*.scad              3D designs (OpenSCAD source)
│   ├── prints/stl/*.stl               rendered models
│   └── maps/                          world outline, regions/*.pmtiles, images/*
├── device/                  # hotspot setup: setup-pi.sh, nginx config, serve.py, fetch-map.sh
└── tools/build.py           # rebuilds indexes, renders STLs, makes offline copy + node zip
```

## Adding or editing content

- **Articles:** add `web/content/articles/your-topic.md`:
  ```
  ---
  title: Your Topic
  category: Water
  order: 5
  summary: One line shown in lists and search.
  priority: false
  ---
  Markdown body…
  ```
  Mention another guide in *italics* (or a 3D print in **bold**) using its title and it becomes a link automatically.
- **3D models:** add `web/prints/src/thing.scad` with the `// @title … @variant` header (see existing files).
- Then run `python3 tools/build.py` (renders new/changed STLs if OpenSCAD is installed; `--no-render` skips that).

## Licences and sources

Guides are written for this project and may be freely copied. Leaflet (BSD-2), protomaps-leaflet (BSD-3) are
vendored in `web/vendor/` with their licences. World borders: Natural Earth (public domain). Regional maps: ©
OpenStreetMap contributors (ODbL) via Protomaps builds.

**Safety:** this library is for when professional help is unavailable. When doctors, rescuers or local experts
are reachable, use them. Medical content follows mainstream first-aid guidance (Red Cross / resuscitation
councils / WHO / Stop the Bleed / CDC water guidance) but is not a substitute for training.
