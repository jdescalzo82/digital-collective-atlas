# Building a Survival Library hotspot

## 1. Pick the hardware

| Device | Power draw | Notes |
|---|---|---|
| **Raspberry Pi Zero 2 W** | ~0.6–1.5 W | Cheapest and most frugal; runs days on a power bank. ~10 phones at once. |
| **Raspberry Pi 4 / 5** | 3–7 W | More users, faster; add a USB WiFi adapter with an external antenna for range. |
| Old laptop (Linux) | 10–30 W | Run `setup-pi.sh` if it uses NetworkManager, or `serve.py` + its own hotspot. |
| Old Android phone | 1–3 W | Install Termux, `pkg install python`, copy this folder, run `python device/serve.py`, turn on the phone's hotspot. Address is usually `http://192.168.43.1:8080/` (shown when the server starts). |

Also: a **32 GB+ microSD card** (A1/A2 class, a second one as a spare), a case, and a power source.

## 2. Install (Raspberry Pi)

1. Flash **Raspberry Pi OS Lite (Bookworm or newer)** with Raspberry Pi Imager. In the Imager settings, enable SSH and set a user — but leave WiFi set up only if you'll connect by ethernet/keyboard later.
2. Boot it with internet (ethernet is easiest), then:
   ```bash
   sudo apt install -y git
   git clone <this repository> library && cd library/survival-library
   sudo ./device/setup-pi.sh --country US          # your 2-letter country code
   ```
   Options: `--ssid "Name"`, `--password "8+ chars"` (default is an open network so anyone can join), `--channel 1|6|11`.
3. While you still have internet, add **detailed maps** of your area (below).
4. Reboot and test with a phone: join the WiFi → the library should pop up (or open `http://10.42.0.1/`).

What the script does: installs nginx, copies the library to `/opt/survival-library`, generates a self-signed
HTTPS certificate, makes NetworkManager run a WiFi access point at `10.42.0.1` with DHCP, and makes its DNS
answer every name with the library (a "captive portal"), so phones open it automatically. Everything starts on boot.

### HTTPS (optional, for compass and GPS)

Phone browsers only allow the compass sensor, GPS and offline caching on secure pages. `https://10.42.0.1/`
works after accepting the browser's certificate warning once. Everything else — including the **sun compass**,
which needs no sensors — works on plain http.

## 3. Add maps

```bash
sudo /opt/survival-library/device/fetch-map.sh "Springfield Area" -89.9,39.6,-89.4,40.0        # zoom 14 (streets, paths)
sudo /opt/survival-library/device/fetch-map.sh "Whole State" -91.5,36.9,-87.5,42.5 11          # lower zoom, smaller file
```

The bounding box is `minLon,minLat,maxLon,maxLat` (tap the corners on the library's Maps page to read them).
At zoom 14 a county is roughly 20–150 MB; a small country 0.5–2 GB. Load a wide low-zoom area plus a
detailed local one. Scanned paper maps (JPG/PNG/PDF) go in `web/maps/images/`; then run
`python3 tools/build.py --no-render`.

## 4. Power

| Source | Runs a Pi Zero 2 W (~1 W) for | Runs a Pi 4 (~4 W) for |
|---|---|---|
| 10,000 mAh power bank (~37 Wh) | ~1.5 days | ~8 hours |
| 12 V 7 Ah sealed lead-acid + 12→5 V USB adapter | ~2 days | ~10 hours |
| 12 V 100 Ah battery | weeks | ~1 week |
| 10 W USB solar panel + power bank | indefinitely in decent sun | daytime only |
| 20–30 W panel + charge controller + 12 V battery | indefinitely | indefinitely in decent sun |

Use a good 5 V supply (Pi 4: 3 A, Pi 5: 5 A); undervoltage causes crashes. A small "UPS HAT" bridges solar dips.

## 5. Placement and range

- **Height is range.** Mount it high (upstairs window, pole, roof) in a weatherproof box away from metal.
- The Pi's built-in antenna reaches ~20–40 m indoors, ~50–100 m outdoors line-of-sight. A USB WiFi adapter
  with a 5–9 dBi external antenna (and `--iface wlan1`) can reach several hundred metres.
- Several devices along a street/valley each hold a full copy — every copy is a complete library.

## 6. Sign for people nearby

> **FREE OFFLINE SURVIVAL LIBRARY** — no internet needed.
> 1. Join WiFi **SURVIVAL-LIBRARY**  2. Open **http://10.42.0.1**
> If your phone says "no internet", choose **stay connected / use this network anyway**.
> Save the offline copy to your phone (Take It With You). Please share it.

## 7. Make it last

- **Protect the SD card** from power cuts: `sudo raspi-config` → Performance Options → Overlay File System → enable.
  (Disable it again temporarily when adding maps or content.)
- Keep a **spare SD card** with the library on it (clone with Raspberry Pi Imager or `dd`) and a spare device in a
  sealed metal box (also protects against EMP/lightning surges).
- Clock: the Pi has no clock battery. The sun compass uses the *phone's* clock, so this doesn't matter for users.
- Update the library on the device: `cd /opt/survival-library && sudo python3 tools/build.py --no-render`.

## Troubleshooting

| Problem | Fix |
|---|---|
| No WiFi network appears | `nmcli con show` / `sudo nmcli con up survival-hotspot`; check `--country` was set; `rfkill list` |
| Phone joins but page doesn't pop up | Open `http://10.42.0.1/` manually; turn off mobile data; disable "Private DNS" (Android) |
| Phone keeps dropping off | Android: tap the network → "Stay connected" / disable "Switch to mobile data" |
| Maps page shows only outlines | No `.pmtiles` installed yet — see step 3 |
| `setup-pi.sh` says no nmcli | Use Raspberry Pi OS Bookworm or newer (or `sudo apt install network-manager`) |
| Check the web server | `sudo nginx -t`, `sudo systemctl status nginx`, `curl -I http://10.42.0.1/` |
