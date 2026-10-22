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

## Toolkit Your Life login and saving

Pigment Lens uses the site's shared sign-in script, `/tyl-auth.js` (Firebase Auth, project `toolkityourlife`). People sign in once anywhere on toolkityourlife.com and are signed in here too. The header button opens the same sign-in window the rest of the site uses.

Palettes are saved to Cloud Firestore, laid out the same way as StreamSaver: one document per person at `pigmentlens/<user id>` holding `{ data, version, updated }`. Palettes someone saved as a guest move into their account the first time they sign in.

Away from toolkityourlife.com, for example when testing locally, `/tyl-auth.js` isn't available. The app then runs in guest mode and saves palettes in the browser.

### Deploying
1. Upload the contents of this folder (everything except `test/`) to `/PigmentLens/` on toolkityourlife.com, so the app is at `https://www.toolkityourlife.com/PigmentLens/`.
2. In the Firebase console, go to Firestore Database → Rules and add this inside `match /databases/{database}/documents { … }`, next to the StreamSaver rule:
   ```
   match /pigmentlens/{userId} {
     allow read, write: if request.auth != null && request.auth.uid == userId;
   }
   ```
3. Add Pigment Lens to the app list on the homepage:
   ```js
   { name: "Pigment Lens", desc: "Photograph a color and get the paint recipe to mix it", href: "/PigmentLens/" }
   ```

Settings live in `config.js`. All sign-in and storage code is in `account.js`.
