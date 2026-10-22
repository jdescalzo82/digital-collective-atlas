# Pigment Lens

A color-mixing app for artists, part of the Toolkit Your Life suite.

1. **Photograph or upload** a reference. Tap anywhere to sample a color, or pick from the main colors detected in the photo.
2. **Set the white point** by tapping paper or a grey card. This removes the color cast from your lighting so samples are accurate.
3. **Choose your medium** (oil, acrylic, gouache, watercolor), paint grade and final finish, and tick the paints you own.
4. **Get a recipe**: parts of each paint, a match score (CIEDE2000 ΔE), alternatives, and paints that would get you closer.

Each recipe also covers:
- **Drying shift.** Acrylic dries darker, watercolor dries lighter, and gouache shifts toward middle values. Each comes with an estimate in value steps and a "wet on palette" preview.
- **Finish.** Gloss reads darker and richer, matte reads lighter and softer. You see a preview of each, and the recipe compensates for the finish you choose.

## How it works

| File | Purpose |
|---|---|
| `color.js` | sRGB ↔ linear ↔ XYZ ↔ CIELAB, CIEDE2000, plain-language color names |
| `pigments.js` | Paint library (25 common pigments, average dried tube colors, tinting strength) |
| `mixer.js` | Two-constant Kubelka–Munk model (opaque media) and Beer–Lambert over paper (watercolor), with a Nelder–Mead solver over paint combinations |
| `media.js` | Drying behavior and gloss/satin/matte surface-reflection model |
| `account.js`, `config.js` | Login and storage bridge (see below) |
| `app.js` | UI |

Run the tests with `node docs/color-mixer/test/mixer.test.mjs`.

Accuracy limits: the model uses typical tube colors, and brands vary. Users can correct each swatch or add their own paint by photographing a swatch card. Phone cameras and screens add their own error, so the app always recommends a dried test swatch.

## Connecting to Toolkit Your Life login

The app runs standalone in guest mode, with palettes saved in the browser. To share Toolkit Your Life's accounts:

- **Shared session cookie and JSON API:** in `config.js` set `provider: 'toolkit'`, then fill in `loginUrl` and `apiBase`. The app expects `GET /me`, plus `GET/POST /color-mixer/palettes` and `DELETE /color-mixer/palettes/:id`.
- **Auth SDK (Firebase, Supabase, Clerk…):** replace `toolkitProvider` in `account.js` with calls to the same SDK Toolkit Your Life uses. Nothing else in the app needs to change.
