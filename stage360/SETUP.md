# Every Seat — Setup & Operation Guide

Step-by-step, from install to operation, for every interface. Written for
**toolkityourlife.com/EverySeat/** — substitute your own domain if you host it
elsewhere.

**The pieces, and who wins when they disagree** (most personal first):

```
 FEED HUB ──publishes──► SERVER (cPanel PHP+SQLite) ◄──records── OPERATOR
 (syncs the videos)         │  feeds out accordingly              (automation)
                            ▼
                         VIEWERS  ◄── live DIRECTOR takes override automation
                            │
                 patron's own seat pick overrides everything
```

1. The **patron** picking a seat — always wins. *Return to guided view* hands back.
2. A **live director** calling shots in real time.
3. The **operator's recorded automation**.
4. The built-in scripted cut that ships with the prototype.

---

## 1 · The server (one-time, ~10 minutes)

Everything else talks to this. It is plain PHP + SQLite — any cPanel plan
runs it with nothing to install.

1. **Get the files.** Download the repository ZIP from GitHub (branch
   `claude/admiring-sagan-d5rmv9`) and open the `stage360/` folder.
2. **Upload** these to `public_html/EverySeat/` with cPanel File Manager
   (overwrite what's there):
   - `index.html`, `link.js`, `sw.js`, `manifest.webmanifest`, `.htaccess`
   - the whole `icons/` folder
   - the whole `remote/` folder (`index.html`, `manifest.webmanifest`)
   - the whole `api/` folder — **including both hidden `.htaccess` files**
     (`api/.htaccess` and `api/data/.htaccess`; in File Manager, Settings →
     *Show hidden files*). They stop the web server from ever serving your
     config or database.
3. **Make a director key.** On any computer:
   ```bash
   openssl rand -base64 24
   ```
   (or just type 30+ random characters).
4. **Create `api/config.local.php`** on the server: in File Manager, copy
   `api/config.local.sample.php` to `config.local.php` (same folder), edit it,
   and paste your key:
   ```php
   $ES_CONFIG['director_key'] = 'PASTE-YOUR-LONG-RANDOM-KEY';
   ```
   This file never goes in Git and is blocked from the web.
5. **Check it's alive.** Open:
   `https://toolkityourlife.com/EverySeat/api/?r=/health`
   → you should see `{"status":"ok", ...}`. Also
   `.../api/?r=/config` → the camera list, with `"director_enabled": true`.
6. *(Optional, for show videos later)* create a `media/` folder under
   `EverySeat/` — the hub's channel maps point there.

**Local test instead of cPanel:** from the repo root,
`php -S localhost:8000 -t stage360`, then use `http://localhost:8000/` in
place of the site URL (set `ES_DIRECTOR_KEY=yourkey` in the environment).

There is nothing to operate day-to-day: codes, rooms, shows and tracks expire
by themselves inside the SQLite file at `api/data/`.

---

## 2 · The viewer (patron side)

### In any browser (phone / tablet / desktop)
1. Open `https://toolkityourlife.com/EverySeat/`.
2. Tap **Take your seat** — this click also unlocks the sound.
3. Drag to look around, pinch or scroll to zoom. The **program** on the right
   is the controls: **Seats** (tap a dot on the chart, or keys 1–6),
   **Sound**, **Access**, **Notes**. `G` toggles the director's cut,
   `Space` play/pause, `[` `]` turn program pages.

### On a Meta Quest 2 (or 3/3S/Pro)
1. In the headset, open **Quest Browser** and go to
   `toolkityourlife.com/EverySeat/`.
2. Enter VR any of three ways: the page's **Watch in headset** button, the
   browser's own Enter-VR icon in the address bar, or — once installed as an
   app — straight in when you tap the icon. **Sound starts on your first
   trigger pull or pinch.**
3. Controls in the headset:
   - **Stick left/right** — snap-turn 30° · **stick forward/back** — change seat
   - **A/X** — play/pause · **B/Y** — hide the program behind a "Program ▴" tab
   - **Stick press** — director's cut on/off · hands work too: point and pinch
   - With the program open, the other seats **glow in the theatre** — point
     and pull the trigger to move there.
4. A pairing code is printed on the program automatically (see §3).

### Install it as an app
- **Quest:** Quest Browser menu (⋮) → *Install app* (or package for the
  Horizon Store with Bubblewrap — see README).
- **iPhone/iPad:** Safari → Share → *Add to Home Screen*.
- **Mac/PC:** Chrome/Edge → address-bar install icon.

### Useful links to send someone
- `.../EverySeat/?seat=balcony` — opens in a given seat
- `.../EverySeat/?hands=1` — hands-free mode (carer/hospice setting)
- `.../EverySeat/?guided=0` — free look from the start
- `.../EverySeat/?show=ABC123` — follows your live/recorded show (§4–5)

**Operation:** patrons just watch. Anything they pick overrides every
director and automation; **Return to guided view** rejoins the cut.

---

## 3 · The patron remote (phone/Mac controls a viewer)

For a carer, friend or front-of-house helper running the show for someone
in the headset.

1. **On the viewer** (headset or screen): open the program's **Access** page →
   **Show a pairing code**. In a headset the code is already printed on the
   program (e.g. `K7Q-4MZ`). Codes expire after ~2 idle hours.
2. **On the phone/Mac:** open `https://toolkityourlife.com/EverySeat/remote/`
   (install it from the browser menu like any app if you'll use it often),
   stay on the **Remote** tab, type the code, **Connect**.
3. You now see live status ("In headset · Balcony · 01:04 · Playing") and can:
   - tap a seat on the chart or the seat cards,
   - play/pause, ±10 s, scrub,
   - toggle the director's cut, hide/show the program in the headset,
   - set captions + size, audio description, hands-free, reduce motion,
     large controls, binaural/board mix, vocal clarity, crowd noise.
4. The status line tells you when sound is still locked ("starts when the
   viewer pulls a trigger once") or the viewer went offline.
5. **Done?** *Disconnect* on the remote, or *Stop sharing* on the viewer
   (which kicks every paired remote).

---

## 4 · The director console (live camera cuts)

1. Open `https://toolkityourlife.com/EverySeat/remote/` → **Director** tab.
2. Enter a show title + your **director key** → **Start show**. You get a
   show code (e.g. `D7Z-MX6`).
3. Get viewers following: they type the code on the player's **Access** page
   ("Follow a live director"), or you **Copy viewer link**
   (`...?show=D7ZMX6`) and send it.
4. Pick what to **frame** (Wide, Singer, Guitar…), then **tap a camera to
   take it** — keys 1–6 work. **Go live** / **Pause live cut** controls
   whether your takes override the automation; the red **ON AIR** ring shows
   the current shot, and the viewer count updates live.
5. Under each camera you'll see the hub's **feed health** once it has
   published (`FEED OK · 2160p · 360°`, `NO SIGNAL`…) — check it before you
   cut to a channel.
6. **End show** when done (viewers fall back to automation/script);
   **Take over a show** from any other device with the code + key.

---

## 5 · The operator (record the automation track)

The operator performs the cut once; the server then plays it to every viewer.

1. Have a show code (start one on the Director tab if needed).
2. Open `https://toolkityourlife.com/EverySeat/remote/` → **Operator** tab →
   enter the show code + director key → **Open show**.
3. *(Recommended)* open the player in another window with
   `?show=YOURCODE` so you can watch while you cue.
4. Arm **REC** (or press `R`). Press **play** — the transport bar is the show
   clock, and every take is stamped with it.
5. **Take cameras** as the show plays: tap a camera card or press 1–6, with
   the Frame row choosing who to follow. A take within half a second of an
   existing cue replaces it (that's how you fix a late take: seek back,
   re-take).
6. **Edit the track** below: click a time to jump there, **↻ now** to move a
   cue to the current clock, **✕** to delete, **Reload from server** /
   **Clear track**. Everything **autosaves** — watch for "Saved to server ·
   v3 · 12 cues".
7. That's it: viewers' guided view now follows your recording (unless a live
   director or the patron overrides). **Close** whenever; the track stays on
   the server.

---

## 6 · The feed hub (sync real recordings to the seats)

Runs on your own computer (the production machine). Needs **Python 3.9+**;
**ffmpeg** recommended (`brew install ffmpeg` on a Mac) — without it only
.wav files can be read.

1. **Get the tool:** copy `stage360/hub/everyseat_hub.py` from the repo to
   the machine with the footage.
2. **Name the files helpfully** (optional): filenames containing `front`,
   `mid/house`, `balc`, `stage`, `wing`, `foh/mix/desk` or `cam1`–`cam6`
   auto-assign to those seats; anything else fills remaining seats in order.
3. **Scan** — see what it found (resolution, fps, duration, audio, 360°?):
   ```bash
   python3 everyseat_hub.py scan ~/shoot/night1
   ```
4. **Sync** — line the channels up against a reference seat:
   ```bash
   python3 everyseat_hub.py sync ~/shoot/night1 --ref front --write show.json
   ```
   - Default method is **audio waveform**: the room sound is the shared
     clock. A `⚠ weak match` note means check that channel by eye.
   - Other ways: `--method start_time` (file creation stamps),
     `--method timecode` (embedded TC), `--method manual`, and
     `--offset balcony=1.52` overrides any single channel.
5. **Publish** the channel map to the server:
   ```bash
   python3 everyseat_hub.py publish show.json \
     --api https://toolkityourlife.com/EverySeat/api/ \
     --code D7ZMX6 --key YOUR-DIRECTOR-KEY \
     --media-base media/night1/
   ```
   It prints exactly which file belongs at which path.
6. **Upload the videos** to `EverySeat/media/night1/` in cPanel so those
   paths resolve (360° equirectangular MP4s; big files upload fine through
   File Manager or FTP).
7. Every viewer following that show code now gets each seat's video, started
   at `showTime + offset` — and the Director tab shows each channel's health.

Re-running `sync`/`publish` bumps the version; players pick it up within a
second or two.

---

## 7 · The native Apple app (optional)

A SwiftUI iPhone/iPad/Mac app with the same Remote and Director modes
(`stage360/apple/`). The web remote installs as an app without any of this —
build the native one when you want the App Store / Keychain polish.

1. On a Mac with Xcode 15+:
   ```bash
   brew install xcodegen
   ```
2. ```bash
   cd stage360/apple && xcodegen && open EverySeatRemote.xcodeproj
   ```
3. In Xcode: select the target → *Signing & Capabilities* → pick your team,
   then run on your iPhone or Mac.
4. In the app, the server icon (top right) sets the address — defaults to
   `toolkityourlife.com/EverySeat`. "Remember the key" stores the director
   key in the device Keychain.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/api/?r=/health` is 404 | The `api/` folder or its `.htaccess` didn't upload; check hidden files are shown |
| `director_enabled: false` | `api/config.local.php` missing or key left empty |
| "Director mode is switched off" | Same as above — set the key on the **server**, not in the app |
| Pairing code rejected | Codes skip 0/O/1/I; it expires after ~2 idle hours — show a fresh one |
| "No live show with that code" | Show expired (12 h idle) or ended — start/take over again with the key |
| Seat video doesn't play | File not uploaded at the exact `src` path the hub printed; must be served over HTTPS |
| Hub says "no readable audio track" | That file has no audio — sync it with `--offset cam=seconds` instead |
| No sound in headset | By design until the first trigger pull / pinch (browser autoplay rules) |
| Everything gone after edits | The player still works with no API at all — check the server, the show pieces return |
