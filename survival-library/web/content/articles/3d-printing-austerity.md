---
title: 3D Printing When Supplies Are Short
category: Tools & Fabrication
order: 1
summary: Which plastic to use, settings for strong parts, running a printer on solar, and recycling plastic.
---
A 3D printer can make tools, spare parts, connectors and instruments from a spool of plastic — but plastic is not steel. Know the limits.

## Choosing a material

| Material | Good for | Avoid for |
|---|---|---|
| **PLA** | Easy to print. Instruments, guides, gauges, indoor parts | Heat (softens at ~55 °C — a car in the sun), outdoor UV long-term, impact in cold (brittle) |
| **PETG** | **Best all-rounder**: tougher, UV and water resistant, mostly food-safe resin. Tools, water gear, outdoor parts | Very high heat |
| **ABS / ASA** | Heat resistant to ~95 °C, ASA is UV-stable for outdoors | Needs an enclosure; fumes — ventilate |
| **Nylon / PC** | Toughest: gears, hitches, wrenches, bushings | Must be dried before printing; harder to print |
| **TPU** (flexible) | Gaskets, tyres, seals, grips, shoe soles | Rigid parts |

## Settings for strong parts

- **Walls (perimeters) matter more than infill**: 4–6 walls for tools; 3 for light parts.
- Infill 30–50% for tools, 100% for small high-stress parts (wrenches, hitches, pins).
- Layer height 0.2–0.28 mm. Slightly hotter nozzle temperature (+5–10 °C) improves layer bonding.
- **Orientation**: parts are weakest **between layers**. Lay parts so the force runs **along** the layers, not across them. The 3D Prints page lists the right orientation for each design.
- Brim for tall or narrow parts.

## Food and water safety

FDM prints have tiny crevices where bacteria grow. For water and food contact: PETG or "food-safe" PLA, sanitise with diluted bleach before use, replace parts often, don't use with hot food. Brass nozzles can contain lead — use stainless for food parts if you can.

## Running on solar / battery power

- A typical printer uses **50–150 W** while printing (the heated bed is most of it). Disable or lower the bed heater (PLA can print on a cold bed with glue stick or painter's tape) to halve power use.
- A 4-hour print at 80 W ≈ 320 Wh: a 200 W solar panel and a 100 Ah 12 V battery can support a few prints a day in good sun.
- Power cuts ruin prints. Print small parts, enable "power loss recovery" if your printer supports it, and use a UPS/battery between.

## Keeping a printer alive

- **Spares**: nozzles (0.4 mm), PTFE tube, a hot end thermistor and heater cartridge, belts, a spare mainboard fuse, a spare power supply. Print spare printed parts (fan ducts, brackets) now.
- **Filament storage**: sealed bags or boxes with desiccant (silica gel, dry rice, or oven-dried cat litter). Wet filament prints weak, stringy and bubbly. Dry it at 45–55 °C for 4–6 hours.
- Lubricate rods with light machine oil or grease; keep dust off.

## Recycling plastic

- Failed prints and supports: grind them and melt into sheets or blocks in a sandwich press or oven (PLA ~180 °C, HDPE ~150–180 °C) for knife handles, cutting boards, tiles. **Ventilate well; never burn plastic.**
- HDPE (milk jugs, ♲2) and PP (♲5) can be shredded and pressed into sheets for panels and tool handles.
- PET bottles can be cut into tape and drawn into filament with a "bottle-to-filament" puller (designs exist) — slow, but works with any printer that handles PETG.

## Design and modify

All 3D models here are **OpenSCAD** source files: plain text you can edit. Change the numbers at the top (size, diameter, latitude) and re-render. OpenSCAD is free and runs offline on Windows, Mac and Linux — keep a copy of the installer with your files.
