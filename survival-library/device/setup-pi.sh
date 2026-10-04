#!/usr/bin/env bash
# Survival Library - turn a Raspberry Pi (or any Debian/Ubuntu machine with NetworkManager and a
# WiFi adapter that supports access-point mode) into a WiFi hotspot that serves the library.
#
#   sudo ./device/setup-pi.sh                          # open network "SURVIVAL-LIBRARY"
#   sudo ./device/setup-pi.sh --ssid "Town Library" --password "longpassword" --country GB
#
# Needs internet ONCE (to install nginx). After that it runs fully offline and starts on boot.
# Tested target: Raspberry Pi OS Bookworm (or newer) on Pi Zero 2 W / 3 / 4 / 5.
set -euo pipefail

SSID="SURVIVAL-LIBRARY"
PASSWORD=""
COUNTRY="US"
IFACE="wlan0"
IP="10.42.0.1"
CHANNEL="6"
INSTALL_DIR="/opt/survival-library"
ASSUME_YES=0

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
  cat <<USAGE
Options:
  --ssid NAME         WiFi network name (default: $SSID)
  --password PASS     WPA2 password, 8+ characters (default: open network - easiest for strangers to join)
  --country CC        2-letter WiFi regulatory country code (default: $COUNTRY)
  --iface IFACE       WiFi interface (default: $IFACE)
  --channel N         2.4 GHz channel 1-11 (default: $CHANNEL)
  --ip ADDRESS        Hotspot address (default: $IP)
  --dir PATH          Install location (default: $INSTALL_DIR)
  -y, --yes           Don't ask for confirmation
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ssid) SSID="$2"; shift 2 ;;
    --password) PASSWORD="$2"; shift 2 ;;
    --country) COUNTRY="${2^^}"; shift 2 ;;
    --iface) IFACE="$2"; shift 2 ;;
    --channel) CHANNEL="$2"; shift 2 ;;
    --ip) IP="$2"; shift 2 ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "Run as root: sudo $0 $*"; exit 1; }
[[ -z "$PASSWORD" || ${#PASSWORD} -ge 8 ]] || { echo "Password must be at least 8 characters."; exit 1; }
command -v nmcli >/dev/null || { echo "NetworkManager (nmcli) not found. Use Raspberry Pi OS Bookworm or newer, or install network-manager."; exit 1; }

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUBNET_PREFIX="${IP%.*}"

echo "== Survival Library hotspot setup =="
echo "   WiFi name : $SSID ($([[ -n $PASSWORD ]] && echo "password protected" || echo "open network"))"
echo "   Address   : http://$IP/   (also http://survival.lan/)"
echo "   Interface : $IFACE, channel $CHANNEL, country $COUNTRY"
echo "   Library   : $INSTALL_DIR"
echo
echo "WARNING: $IFACE will stop being a normal WiFi client. If you are connected over WiFi/SSH"
echo "you will be disconnected - use a keyboard+screen or an ethernet cable."
if [[ $ASSUME_YES -eq 0 ]]; then
  read -r -p "Continue? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || exit 1
fi

echo "-- Installing packages (needs internet this one time)"
export DEBIAN_FRONTEND=noninteractive
if ! command -v nginx >/dev/null; then
  apt-get update
  apt-get install -y nginx openssl python3
fi

echo "-- Copying library to $INSTALL_DIR"
if [[ "$SRC_DIR" != "$INSTALL_DIR" ]]; then
  mkdir -p "$INSTALL_DIR"
  # keep any map files already installed
  cp -a "$SRC_DIR/." "$INSTALL_DIR/"
fi
python3 "$INSTALL_DIR/tools/build.py" --no-render

echo "-- Configuring web server"
CERTDIR=/etc/survival-library
mkdir -p "$CERTDIR"
if [[ ! -f "$CERTDIR/survival-library.crt" ]]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 7300 \
    -keyout "$CERTDIR/survival-library.key" -out "$CERTDIR/survival-library.crt" \
    -subj "/CN=survival.lan" -addext "subjectAltName=IP:$IP,DNS:survival.lan,DNS:library.lan" 2>/dev/null
fi
sed -e "s#@WEBROOT@#$INSTALL_DIR/web#g" -e "s#@IP@#$IP#g" -e "s#@CERTDIR@#$CERTDIR#g" \
  "$INSTALL_DIR/device/nginx-survival-library.conf" > /etc/nginx/sites-available/survival-library
cp "$INSTALL_DIR/device/nginx-common.conf" /etc/nginx/snippets/survival-library-common.conf
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/survival-library /etc/nginx/sites-enabled/survival-library
chmod -R a+rX "$INSTALL_DIR/web"
nginx -t
systemctl enable nginx
systemctl restart nginx

echo "-- Captive portal DNS (every name resolves to this device)"
mkdir -p /etc/NetworkManager/dnsmasq-shared.d
cat > /etc/NetworkManager/dnsmasq-shared.d/survival-library.conf <<CONF
# Answer every DNS query with the library's address so phones open it automatically.
address=/#/$IP
# lease time long enough that phones don't drop off
dhcp-lease-max=200
CONF

echo "-- WiFi country and radio"
if command -v raspi-config >/dev/null; then raspi-config nonint do_wifi_country "$COUNTRY" || true; fi
iw reg set "$COUNTRY" 2>/dev/null || true
rfkill unblock wifi 2>/dev/null || true

echo "-- Creating hotspot connection"
nmcli connection delete survival-hotspot >/dev/null 2>&1 || true
nmcli connection add type wifi ifname "$IFACE" con-name survival-hotspot autoconnect yes ssid "$SSID" \
  802-11-wireless.mode ap 802-11-wireless.band bg 802-11-wireless.channel "$CHANNEL" \
  802-11-wireless.powersave 2 \
  ipv4.method shared ipv4.addresses "$IP/24" ipv6.method disabled \
  connection.autoconnect-priority 100
if [[ -n "$PASSWORD" ]]; then
  nmcli connection modify survival-hotspot wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$PASSWORD"
fi
nmcli connection up survival-hotspot

cat <<DONE

== Done ==
WiFi network : $SSID $([[ -n $PASSWORD ]] && echo "(password: $PASSWORD)")
Open         : http://$IP/   (most phones pop it up automatically after joining)
Secure       : https://$IP/  (accept the warning once; enables phone compass + GPS)

It starts automatically on every boot. Put up a sign:
  "Free offline survival library - join WiFi '$SSID' and open http://$IP/"
Phones may say "no internet" - tell people to choose "stay connected" / "use without internet".

Recommended next steps (see device/README.md):
  * Add detailed maps of your area:   sudo $INSTALL_DIR/device/fetch-map.sh "Region Name" minLon,minLat,maxLon,maxLat
  * Protect the SD card from power cuts:  sudo raspi-config  -> Performance -> Overlay File System
DONE
