"""Tests for the Every Seat feed hub (stage360/hub/everyseat_hub.py).

Synthesizes recordings of the same 'performance' started at different moments,
then checks the audio-waveform sync recovers the known offsets, and that
publish pushes a correct channel map to a real PHP API instance.
"""

import json
import math
import os
import random
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "stage360" / "hub"))

import everyseat_hub as hub  # noqa: E402

SR = 8000


def performance(seconds=24, seed=7):
    """The 'room sound': band-limited noise with strong amplitude bursts."""
    rng = random.Random(seed)
    n = seconds * SR
    samples = [0.0] * n
    level, out = 0.0, 0.0
    for i in range(n):
        if i % (SR // 4) == 0:                      # new burst level every 250 ms
            level = rng.random() ** 2
        out = 0.95 * out + 0.05 * ((rng.random() * 2 - 1) * level)
        samples[i] = out * 6
    return samples


def write_wav(path, samples):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(struct.pack(f"<{len(samples)}h",
                                  *(max(-32767, min(32767, int(s * 20000))) for s in samples)))


class WaveformSync(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        perf = performance()
        # Reference file: recording starts at performance t=2.0s
        write_wav(d / "front.wav", perf[2 * SR: 20 * SR])
        # Started 1.5s EARLIER than the reference → its file is 1.5s ahead → offset +1.5
        write_wav(d / "balcony.wav", perf[SR // 2: 20 * SR])
        # Started 1.2s LATER than the reference → offset −1.2
        write_wav(d / "stage.wav", perf[int(3.2 * SR): 20 * SR])
        cls.dir = d

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_known_offsets_recovered(self):
        off, conf = hub.audio_offset(self.dir / "front.wav", self.dir / "balcony.wav")
        self.assertAlmostEqual(off, 1.5, delta=0.03)
        self.assertGreater(conf, 8)
        off, conf = hub.audio_offset(self.dir / "front.wav", self.dir / "stage.wav")
        self.assertAlmostEqual(off, -1.2, delta=0.03)
        self.assertGreater(conf, 8)

    def test_reference_against_itself(self):
        off, _ = hub.audio_offset(self.dir / "front.wav", self.dir / "front.wav")
        self.assertAlmostEqual(off, 0.0, delta=0.011)

    def test_unrelated_audio_has_low_confidence(self):
        with tempfile.TemporaryDirectory() as other:
            noise = Path(other) / "noise.wav"
            write_wav(noise, performance(seconds=18, seed=99))
            _, conf = hub.audio_offset(self.dir / "front.wav", noise)
            self.assertLess(conf, 8)

    @unittest.skipUnless(hub.FFMPEG, "ffmpeg not installed")
    def test_compressed_audio_roundtrip(self):
        # The same sync must survive AAC compression in an mp4 container.
        with tempfile.TemporaryDirectory() as other:
            m4a = Path(other) / "balcony.m4a"
            subprocess.run([hub.FFMPEG, "-v", "error", "-y", "-i", str(self.dir / "balcony.wav"),
                            "-c:a", "aac", "-b:a", "96k", str(m4a)], check=True)
            off, conf = hub.audio_offset(self.dir / "front.wav", m4a)
            self.assertAlmostEqual(off, 1.5, delta=0.06)
            self.assertGreater(conf, 8)

    def test_scan_and_compute(self):
        assigned = hub.scan_files(self.dir)
        self.assertEqual(assigned["front"].name, "front.wav")
        self.assertEqual(assigned["balcony"].name, "balcony.wav")
        offsets, notes = hub.compute_offsets(
            {k: assigned[k] for k in ("front", "balcony", "stage")}, "front", "audio", {"stage": -9.9})
        self.assertEqual(offsets["front"], 0.0)
        self.assertAlmostEqual(offsets["balcony"], 1.5, delta=0.03)
        self.assertEqual(offsets["stage"], -9.9)       # manual override wins
        self.assertEqual(notes["stage"], "manual")

    def test_channel_guessing(self):
        self.assertEqual(hub.guess_channel("Night1_CAM3_balcony.mp4"), "balcony")
        self.assertEqual(hub.guess_channel("foh-desk.mov"), "foh")
        self.assertIsNone(hub.guess_channel("B-roll.mov"))

    def test_timecode_parsing(self):
        self.assertAlmostEqual(hub.parse_timecode("01:00:10:12", 24), 3610.5)
        self.assertAlmostEqual(
            hub.start_time_offset({"timecode": "01:00:00:00", "fps": 24},
                                  {"timecode": "00:59:58:00", "fps": 24}, "timecode"), 2.0)
        with self.assertRaises(hub.HubError):
            hub.parse_timecode("junk", 24)


@unittest.skipUnless(shutil.which("php"), "php not installed")
class PublishToServer(unittest.TestCase):
    def test_publish(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            perf = performance(seconds=12)
            write_wav(d / "front.wav", perf[2 * SR: 10 * SR])
            write_wav(d / "mid.wav", perf[SR: 10 * SR])
            manifest = d / "show.json"
            rc = hub.main(["sync", str(d), "--ref", "front", "--write", str(manifest)])
            self.assertEqual(rc, 0)

            def free_port():
                with socket.socket() as s:
                    s.bind(("127.0.0.1", 0))
                    return s.getsockname()[1]

            port = free_port()
            env = dict(os.environ, ES_DB_PATH=str(d / "db.sqlite"), ES_DIRECTOR_KEY="hub-test-key")
            proc = subprocess.Popen(["php", "-S", f"127.0.0.1:{port}", "-t", str(ROOT / "stage360")],
                                    env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                time.sleep(0.6)
                api = f"http://127.0.0.1:{port}/api/"
                show = hub.api_call(api, "/shows", "POST", {"key": "hub-test-key", "title": "Hub Night"})
                rc = hub.main(["publish", str(manifest), "--api", api, "--code", show["display_code"],
                               "--key", "hub-test-key", "--media-base", "media/night1/"])
                self.assertEqual(rc, 0)
                got = hub.api_call(api, f"/shows/{show['code']}/channels")
                self.assertEqual(got["version"], 1)
                self.assertEqual(got["channels"]["front"]["src"], "media/night1/front.wav")
                self.assertEqual(got["channels"]["front"]["offset"], 0)
                self.assertAlmostEqual(got["channels"]["mid"]["offset"], 1.0, delta=0.03)
                self.assertEqual(got["channels"]["mid"]["sync"], "audio")
                showd = hub.api_call(api, f"/shows/{show['code']}")
                self.assertEqual(showd["channels_version"], 1)
                self.assertEqual(showd["feeds"]["front"]["status"], "ok")
            finally:
                proc.terminate()
                proc.wait(5)


if __name__ == "__main__":
    unittest.main()
