#!/usr/bin/env python3
"""Every Seat Feed Hub — the central piece that turns a pile of camera
recordings into a synced, channel-assigned show.

It can line the channels up several ways:
  audio       cross-correlates each file's audio waveform against the
              reference channel (the room sound is the shared clock)
  start_time  uses each file's recorded creation time (ffprobe)
  timecode    uses embedded timecode tracks (ffprobe)
  manual      offsets you give with --offset cam=seconds

and then publishes the channel map (src + offset per seat) to the Every Seat
server, which feeds it out to every viewer following the show. The operator's
automation and a live director ride on top; the patron's own seat pick
overrides everything.

Typical session:
  python3 everyseat_hub.py scan  ~/shoot/night1
  python3 everyseat_hub.py sync  ~/shoot/night1 --ref front --write show.json
  python3 everyseat_hub.py publish show.json \\
      --api https://toolkityourlife.com/EverySeat/api/ \\
      --code ABC123 --key YOUR_DIRECTOR_KEY \\
      --media-base media/night1/
  (then upload the video files to .../EverySeat/media/night1/ in cPanel)

Needs only Python 3.9+. ffmpeg/ffprobe are used when present; without them
only .wav files can be read (fine for testing the sync).
"""

import argparse
import cmath
import json
import math
import re
import shutil
import struct
import subprocess
import sys
import urllib.error
import urllib.request
import wave
from pathlib import Path

CHANNELS = ["front", "mid", "balcony", "stage", "wings", "foh"]
CHANNEL_HINTS = {
    "front":   ["front", "row-a", "rowa", "cam1", "cam-1", "cam_1", "c1"],
    "mid":     ["mid", "house", "cam2", "cam-2", "cam_2", "c2"],
    "balcony": ["balc", "cam3", "cam-3", "cam_3", "c3"],
    "stage":   ["stage", "cam4", "cam-4", "cam_4", "c4"],
    "wings":   ["wing", "cam5", "cam-5", "cam_5", "c5"],
    "foh":     ["foh", "mix", "desk", "cam6", "cam-6", "cam_6", "c6"],
}
MEDIA_EXT = {".mp4", ".mov", ".mkv", ".m4v", ".webm", ".wav", ".m4a", ".aac", ".mp3"}
SAMPLE_RATE = 8000          # audio is downmixed to mono at this rate
HOP = 80                    # envelope hop: 80 samples = 10 ms
ENV_RATE = SAMPLE_RATE / HOP

FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")


class HubError(Exception):
    pass


# ---------------------------------------------------------------- audio I/O

def read_audio(path):
    """Mono float samples at SAMPLE_RATE from any media file."""
    path = Path(path)
    if FFMPEG:
        cmd = [FFMPEG, "-v", "error", "-i", str(path), "-map", "0:a:0?",
               "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"]
        try:
            out = subprocess.run(cmd, capture_output=True, timeout=600)
        except subprocess.TimeoutExpired:
            raise HubError(f"{path.name}: audio extraction timed out")
        if out.returncode != 0 or not out.stdout:
            raise HubError(f"{path.name}: no readable audio track "
                           f"({out.stderr.decode(errors='replace').strip().splitlines()[-1] if out.stderr else 'empty output'})")
        n = len(out.stdout) // 2
        return [s / 32768.0 for s in struct.unpack(f"<{n}h", out.stdout[: n * 2])]
    if path.suffix.lower() != ".wav":
        raise HubError(f"{path.name}: ffmpeg is not installed, so only .wav files can be read")
    with wave.open(str(path), "rb") as w:
        if w.getsampwidth() != 2:
            raise HubError(f"{path.name}: only 16-bit wav without ffmpeg")
        frames = w.readframes(w.getnframes())
        ch, rate = w.getnchannels(), w.getframerate()
    raw = struct.unpack(f"<{len(frames) // 2}h", frames)
    mono = [sum(raw[i : i + ch]) / ch / 32768.0 for i in range(0, len(raw) - ch + 1, ch)]
    if rate == SAMPLE_RATE:
        return mono
    step = rate / SAMPLE_RATE  # crude resample; plenty for envelopes
    return [mono[min(len(mono) - 1, int(i * step))] for i in range(int(len(mono) / step))]


def envelope(samples):
    """RMS loudness every 10 ms, mean-removed: the waveform fingerprint."""
    env = []
    for i in range(0, len(samples) - HOP + 1, HOP):
        acc = 0.0
        for s in samples[i : i + HOP]:
            acc += s * s
        env.append(math.sqrt(acc / HOP))
    if not env:
        raise HubError("audio too short to fingerprint")
    mean = sum(env) / len(env)
    return [e - mean for e in env]


# ----------------------------------------------------------- FFT cross-corr

def _fft(a, invert=False):
    """Iterative radix-2 FFT over a list of complex numbers (len = 2^k)."""
    n = len(a)
    j = 0
    a = a[:]
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j |= bit
        if i < j:
            a[i], a[j] = a[j], a[i]
    length = 2
    while length <= n:
        ang = (2j if invert else -2j) * cmath.pi / length
        wl = cmath.exp(ang)
        for i in range(0, n, length):
            w = 1 + 0j
            half = length >> 1
            for k in range(i, i + half):
                u, v = a[k], a[k + half] * w
                a[k], a[k + half] = u + v, u - v
                w *= wl
        length <<= 1
    if invert:
        a = [x / n for x in a]
    return a


def best_lag(ref_env, x_env, max_lag_s=180.0):
    """The lag (in envelope samples) at which x_env best matches ref_env.

    corr[lag] = sum ref[i + lag] * x[i], so when x holds the same content as
    the reference but with Delta seconds of extra material at its head (x
    started recording Delta earlier), the peak lands at lag = -Delta * rate.
    """
    la, lb = len(ref_env), len(x_env)
    n = 1
    while n < la + lb:
        n <<= 1
    fa = _fft([complex(v, 0) for v in ref_env] + [0j] * (n - la))
    fb = _fft([complex(v, 0) for v in x_env] + [0j] * (n - lb))
    corr = _fft([x * y.conjugate() for x, y in zip(fa, fb)], invert=True)
    # corr[k] = sum ref[i + k] * x[i]  (k negative wraps to corr[n + k])
    max_lag = min(int(max_lag_s * ENV_RATE), la - 1, lb - 1)
    best_k, best_v = 0, -1e30
    for lag in range(-max_lag, max_lag + 1):
        v = corr[lag % n].real
        if v > best_v:
            best_v, best_k = v, lag
    # parabolic refinement between neighbouring hops
    y0 = corr[(best_k - 1) % n].real
    y1 = best_v
    y2 = corr[(best_k + 1) % n].real
    denom = y0 - 2 * y1 + y2
    frac = 0.5 * (y0 - y2) / denom if abs(denom) > 1e-12 else 0.0
    frac = max(-0.5, min(0.5, frac))
    # confidence: peak vs the rms of the correlation floor
    floor = [corr[lag % n].real for lag in range(-max_lag, max_lag + 1, max(1, (2 * max_lag) // 400))]
    rms = math.sqrt(sum(v * v for v in floor) / len(floor)) or 1e-12
    return best_k + frac, y1 / rms


def audio_offset(ref_path, x_path):
    """Returns (offset_seconds, confidence) for channel x against the reference.

    offset is what the player adds to the show clock for this file:
    video.currentTime = showTime + offset. The reference channel is offset 0.
    """
    lag, conf = best_lag(envelope(read_audio(ref_path)), envelope(read_audio(x_path)))
    # Peak at lag = -Delta*rate when x started Delta earlier; such a file holds
    # the show's t=0 Delta seconds in, so the player must add +Delta: offset = -lag.
    return -lag / ENV_RATE, conf


# ------------------------------------------------------------ other methods

def probe(path):
    """Container info via ffprobe: duration, resolution, fps, creation, timecode."""
    if not FFPROBE:
        return {}
    cmd = [FFPROBE, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)]
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=60)
        data = json.loads(out.stdout or b"{}")
    except Exception:
        return {}
    info = {}
    fmt = data.get("format", {})
    if fmt.get("duration"):
        info["duration"] = float(fmt["duration"])
    tags = {k.lower(): v for k, v in (fmt.get("tags") or {}).items()}
    if "creation_time" in tags:
        info["creation_time"] = tags["creation_time"]
    for s in data.get("streams", []):
        stags = {k.lower(): v for k, v in (s.get("tags") or {}).items()}
        if s.get("codec_type") == "video" and "width" in s:
            info.setdefault("width", s["width"])
            info.setdefault("height", s["height"])
            if s.get("avg_frame_rate") and s["avg_frame_rate"] != "0/0":
                num, den = s["avg_frame_rate"].split("/")
                if float(den):
                    info.setdefault("fps", round(float(num) / float(den), 3))
        if "timecode" in stags:
            info.setdefault("timecode", stags["timecode"])
        if s.get("codec_type") == "audio":
            info["has_audio"] = True
    return info


def parse_creation(ts):
    import datetime
    ts = ts.strip().replace("Z", "+00:00")
    try:
        return datetime.datetime.fromisoformat(ts).timestamp()
    except ValueError:
        raise HubError(f"unparseable creation_time {ts!r}")


def parse_timecode(tc, fps):
    m = re.match(r"^(\d\d):(\d\d):(\d\d)[:;.](\d+)$", tc.strip())
    if not m or not fps:
        raise HubError(f"unparseable timecode {tc!r}")
    h, mi, s, f = (int(g) for g in m.groups())
    return h * 3600 + mi * 60 + s + f / fps


def start_time_offset(ref_info, x_info, key):
    """Offset from absolute start stamps: a file that started Δ earlier than
    the reference holds the show's t=0 at Δ seconds in → offset +Δ."""
    if key == "creation":
        a, b = parse_creation(ref_info["creation_time"]), parse_creation(x_info["creation_time"])
    else:
        a = parse_timecode(ref_info["timecode"], ref_info.get("fps"))
        b = parse_timecode(x_info["timecode"], x_info.get("fps"))
    return a - b


# ----------------------------------------------------------------- scanning

def guess_channel(name):
    low = name.lower()
    for cam, hints in CHANNEL_HINTS.items():
        if any(h in low for h in hints):
            return cam
    return None


def scan_files(target):
    target = Path(target)
    files = sorted(p for p in ([target] if target.is_file() else target.iterdir())
                   if p.suffix.lower() in MEDIA_EXT and p.is_file())
    if not files:
        raise HubError(f"no media files in {target}")
    assigned, unassigned = {}, []
    for f in files:
        cam = guess_channel(f.name)
        if cam and cam not in assigned:
            assigned[cam] = f
        else:
            unassigned.append(f)
    # remaining files fill remaining channels in order
    for cam in CHANNELS:
        if cam not in assigned and unassigned:
            assigned[cam] = unassigned.pop(0)
    return assigned


# ---------------------------------------------------------------- commands

def cmd_scan(args):
    assigned = scan_files(args.path)
    print(f"{'CHANNEL':9} {'FILE':32} {'INFO'}")
    for cam in CHANNELS:
        f = assigned.get(cam)
        if not f:
            print(f"{cam:9} {'—':32}")
            continue
        info = probe(f)
        bits = []
        if "width" in info:
            bits.append(f"{info['width']}x{info['height']}")
            if abs(info["width"] / max(1, info["height"]) - 2.0) < 0.06:
                bits.append("360°?")
        if "fps" in info:
            bits.append(f"{info['fps']}fps")
        if "duration" in info:
            bits.append(f"{info['duration']:.1f}s")
        bits.append("audio" if info.get("has_audio") else "NO AUDIO")
        if "timecode" in info:
            bits.append(f"tc {info['timecode']}")
        print(f"{cam:9} {f.name:32} {' · '.join(bits)}")
    return 0


def compute_offsets(assigned, ref, method, manual):
    if ref not in assigned:
        raise HubError(f"reference channel '{ref}' has no file (have: {', '.join(sorted(assigned))})")
    offsets, notes = {ref: 0.0}, {ref: "reference"}
    infos = {cam: probe(f) for cam, f in assigned.items()} if method in ("start_time", "timecode") else {}
    for cam, f in assigned.items():
        if cam == ref:
            continue
        if cam in manual:
            offsets[cam] = manual[cam]
            notes[cam] = "manual"
        elif method == "audio":
            off, conf = audio_offset(assigned[ref], f)
            offsets[cam] = round(off, 3)
            notes[cam] = f"audio xcorr, confidence {conf:.0f}x"
            if conf < 8:
                notes[cam] += "  ⚠ weak match — check this one by eye"
        elif method == "start_time":
            key = "creation"
            if "creation_time" not in infos[cam] or "creation_time" not in infos[ref]:
                raise HubError(f"{f.name}: no creation_time; try --method audio")
            offsets[cam] = round(start_time_offset(infos[ref], infos[cam], key), 3)
            notes[cam] = "file start times"
        elif method == "timecode":
            if "timecode" not in infos.get(cam, {}) or "timecode" not in infos.get(ref, {}):
                raise HubError(f"{f.name}: no embedded timecode; try --method audio")
            offsets[cam] = round(start_time_offset(infos[ref], infos[cam], "timecode"), 3)
            notes[cam] = "embedded timecode"
        elif method == "manual":
            offsets[cam] = manual.get(cam, 0.0)
            notes[cam] = "manual" if cam in manual else "no offset given — 0"
        else:
            raise HubError(f"unknown method {method}")
    return offsets, notes


def cmd_sync(args):
    assigned = scan_files(args.path)
    manual = {}
    for spec in args.offset or []:
        cam, _, val = spec.partition("=")
        if cam not in CHANNELS:
            raise HubError(f"--offset {spec}: unknown channel '{cam}'")
        manual[cam] = float(val)
    offsets, notes = compute_offsets(assigned, args.ref, args.method, manual)
    print(f"Sync by {args.method}, reference: {args.ref}\n")
    manifest = {"show": args.title, "ref": args.ref, "method": args.method, "channels": {}}
    for cam in CHANNELS:
        if cam not in assigned:
            continue
        f = assigned[cam]
        off = offsets[cam]
        manifest["channels"][cam] = {
            "file": str(f),
            "src": f.name,
            "offset": off,
            "sync": "manual" if notes[cam].startswith("manual") else
                    ("audio" if args.method == "audio" else
                     "start_time" if args.method == "start_time" else
                     "timecode" if args.method == "timecode" else "manual"),
        }
        print(f"  {cam:9} {off:+9.3f}s  {f.name}   ({notes[cam]})")
    if args.write:
        Path(args.write).write_text(json.dumps(manifest, indent=2))
        print(f"\nWrote {args.write}. Publish it with:\n"
              f"  python3 everyseat_hub.py publish {args.write} --api <server>/api/ --code <SHOW> --key <KEY> --media-base media/")
    return 0


def api_call(base, route, method="GET", body=None, token=None):
    base = base.rstrip("/") + "/"
    req = urllib.request.Request(
        base + "?r=" + route, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **({"X-ES-Token": token} if token else {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read())["error"]
            raise HubError(f"server said: {err['message']} ({err['code']})")
        except (ValueError, KeyError):
            raise HubError(f"server error {e.code}")
    except urllib.error.URLError as e:
        raise HubError(f"can't reach {base}: {e.reason}")


def cmd_publish(args):
    manifest = json.loads(Path(args.manifest).read_text())
    code = re.sub(r"[\s-]", "", args.code.upper())
    token = args.token
    if not token:
        if not args.key:
            raise HubError("need --key (director key) or --token")
        token = api_call(args.api, f"/shows/{code}/director", "POST", {"key": args.key})["token"]
    base = args.media_base or ""
    channels, feeds = {}, {}
    for cam, ch in manifest["channels"].items():
        src = ch["src"] if "://" in ch["src"] or not base else base.rstrip("/") + "/" + Path(ch["src"]).name
        channels[cam] = {"src": src, "offset": ch["offset"], "sync": ch.get("sync", "manual")}
        info = probe(ch.get("file", "")) if ch.get("file") and Path(ch["file"]).exists() else {}
        feed = {"device": Path(ch.get("file", ch["src"])).name[:60], "status": "ok"}
        if "width" in info:
            feed.update(width=info["width"], height=info["height"],
                        three_sixty=abs(info["width"] / max(1, info["height"]) - 2.0) < 0.06)
        if "fps" in info:
            feed["fps"] = info["fps"]
        feeds[cam] = feed
    out = api_call(args.api, f"/shows/{code}/channels", "PUT", {"channels": channels}, token)
    api_call(args.api, f"/shows/{code}/feeds", "POST", {"feeds": feeds}, token)
    print(f"Published {out['count']} channels to show {code} (version {out['version']}).")
    print("Now upload the files so the src paths resolve:")
    for cam, ch in channels.items():
        print(f"  {cam:9} → {ch['src']}  (offset {ch['offset']:+.3f}s)")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="everyseat-hub", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("scan", help="list media files and the channel each would get")
    s.add_argument("path")
    s.set_defaults(fn=cmd_scan)

    s = sub.add_parser("sync", help="compute per-channel sync offsets")
    s.add_argument("path")
    s.add_argument("--ref", default="front", choices=CHANNELS, help="channel that defines the show clock")
    s.add_argument("--method", default="audio", choices=["audio", "start_time", "timecode", "manual"])
    s.add_argument("--offset", action="append", metavar="CAM=SECONDS",
                   help="manual override for one channel (repeatable)")
    s.add_argument("--title", default="Every Angle")
    s.add_argument("--write", metavar="MANIFEST.json", help="write the show manifest here")
    s.set_defaults(fn=cmd_sync)

    s = sub.add_parser("publish", help="push a manifest's channel map to the server")
    s.add_argument("manifest")
    s.add_argument("--api", required=True, help="e.g. https://toolkityourlife.com/EverySeat/api/")
    s.add_argument("--code", required=True, help="the show code")
    s.add_argument("--key", help="director key (or use --token)")
    s.add_argument("--token", help="an existing director token")
    s.add_argument("--media-base", help="URL or site-relative folder the videos will be uploaded to")
    s.set_defaults(fn=cmd_publish)

    args = ap.parse_args(argv)
    try:
        return args.fn(args)
    except HubError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
