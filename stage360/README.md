# Every Seat: 360° live performance player

**Every Seat** plays back live or recorded stage shows filmed with 360° cameras and paired with the production's own audio feeds. The viewer gets binaural sound that turns as they turn their head. They can follow a director's **guided cut** or switch it off and pick their own seat. Bonus **behind-the-scenes** cameras show the wings and the mix desk.

It is built for people who can't easily get to a venue: patrons with mobility issues, people in hospital or hospice care, and fans who live far away. They should get something closer to *being in the room* than a flat stream can give.

> `index.html` in this folder is a working prototype. It runs in desktop and phone browsers, **Meta Quest Browser**, and **Safari on Apple Vision Pro** (WebXR).

---

## Try the prototype

The prototype is one HTML file with no build step. A five-piece band plays a 2½-minute original song, "Every Angle", in a virtual theatre. This stands in for real 360 camera feeds until footage exists. You can also load your own equirectangular 360 clip onto any camera (Settings → *Your own 360 footage*).

| Platform | How |
|---|---|
| Desktop / phone | Open `index.html` from any web server (e.g. `python3 -m http.server`, then `http://localhost:8000`). |
| **Meta Quest** (2, 3, 3S, Pro) | Host it over **HTTPS** (WebXR requires a secure context), open the URL in Quest Browser, then tap **Watch in headset**. To test locally, run `adb reverse tcp:8000 tcp:8000` and open `http://localhost:8000` in the headset. |
| **Apple Vision Pro** | visionOS 2 or later: host over HTTPS, open in Safari, then tap **Watch in headset**. Look at a button and pinch to press it. |

The cheapest HTTPS host is GitHub Pages: copy the file into a Pages-enabled folder, or put it in its own repo.

### What's in it

- **6 cameras:** Front Row, Mid-House, Balcony, On Stage, plus backstage cameras in the Stage-Left Wings and at the Mix Position (front-of-house desk). The backstage feeds show the stage manager's headset calls ("Standby lighting cue 12… GO").
- **Guided view:** a director's cut written like a calling script (`CUES` in the code). It cuts between cameras and keeps the subject framed as performers move. Dragging, a keyboard key or picking a camera hands control to the viewer, and *Return to guided view* gives it back. In a headset the app never rotates the viewer's view on its own. It only re-aims the scene at a cut, so the subject lands wherever they are already looking. That avoids motion sickness.
- **Binaural audio:** each musician is a separate source placed where they stand on stage (Web Audio HRTF panners). The listener sits at the selected camera and turns with your head (headset) or view (2D). Each seat also changes the room reverb and level. *Board mix* switches to a plain stereo desk mix for speakers.
- **Accessibility:** captions (lyrics plus sound cues) at three sizes, also shown in the scene in VR; spoken **audio description**; a **vocal clarity** boost; crowd noise level; **hands-free mode** (guided view, large captions, controls that hide when idle); reduce-motion; large controls; full keyboard control; a tap-to-pick-a-seat house map.
- **VR menu:** a floating panel below eye level for cameras, guided on/off and play/pause. On Quest, use controllers (trigger) or hand pinch. On Vision Pro, look and pinch. It drifts to follow you only when you turn well away.
- The viewer is placed at **seated eye height** for each camera, whatever their real height or posture. This suits someone in a wheelchair or lying in bed.

---

## Production architecture

```
 VENUE                                   CLOUD                                  VIEWERS
 ─────                                   ─────                                  ───────
 360 cams (×4–8, 8K)  ─┐                                                   ┌─ Quest / Vision Pro (WebXR, then native)
 BTS 360 cams (×2)    ─┤  stitch + encode ─► ingest ─► packager ─► CDN ────┼─ Phone / tablet (web, iOS, Android)
 Ambisonic mics (room)─┤  (on-camera or       (SRT)    (LL-HLS /           └─ TV / browser (2D "pick a seat")
 Desk stems via Dante ─┤   edge box)                    CMAF, tiled)
 Timecode / genlock   ─┘                     ▲
 Director's cue track ───────────────────────┘ (timed metadata: cam, yaw, pitch, fov, subject)
```

**Capture**
- 360 cameras with genlock/timecode (e.g. Insta360 Titan/Pro 2, Kandao Obsidian, or a Z CAM rig), 8K mono or 6K-per-eye stereo. Position them at seats people would actually pay for, plus 1–2 BTS rigs.
- Audio from the production: multitrack **stems off the FOH console** over Dante/MADI (vocals, band groups, playback, audience mics) and an **ambisonic mic** (e.g. Sennheiser AMBEO, Zoom H3-VR) at each camera for room tone and crowd.
- **Timecode** on everything (LTC or PTP) so cameras, stems and cues line up.

**Spatial audio pipeline**
- Mix the stems as **objects** placed at performer positions (tracked by stage position or tagged per scene), and add each camera's ambisonic bed.
- Deliver as Higher-Order Ambisonics, or as objects plus a bed (e.g. MPEG-H or IAMF, or a custom object stream). The player renders it binaurally against head pose with personalised HRTFs where the platform provides them (Apple's Spatial Audio, Meta's Audio SDK).
- Keep a **board mix** (stereo) and a **dialogue/vocal-enhanced mix** as accessibility options.

**Video delivery**
- 8K 360 is too heavy to send whole. Use **viewport-dependent tiled streaming**: a low-res full sphere plus high-res tiles where the viewer is looking (HEVC tiles in CMAF, MPEG-OMAF style).
- **Live**: SRT contribution → cloud transcoder → LL-HLS/CMAF, roughly 3–6 s glass-to-glass. All cameras share one clock, so switching camera is a segment-aligned switch with no resync.
- **VOD**: the same manifests, plus downloadable offline packages for hospice and hospital settings with poor Wi-Fi.

**Guided cut**
- A director or vision mixer calls the show live from a web console showing every 360 feed. Each "take" emits a timed-metadata cue: `{camera, yaw, pitch, fov, subject?}`.
- With performer tracking (UWB tags or vision), a cue can name a *subject* rather than an angle, and the player keeps them framed. The prototype does this.
- The same cue track drives the 2D/TV version: a normal flat programme feed rendered from the 360 sources.

**Players**
| Target | Phase 1 | Phase 2 (native) |
|---|---|---|
| Meta Quest | WebXR in Quest Browser (this prototype) | Unity or Meta Spatial SDK app with tiled-stream decoder and Meta Audio SDK |
| Apple Vision Pro | WebXR in Safari (this prototype) | visionOS app (RealityKit + AVPlayer). Stereo 180/360 using Apple's projected-media formats, and Apple Spatial Audio with head tracking. |
| iOS / Android | Web (2D drag + gyro) | Native apps; Chromecast/AirPlay to TV for the guided cut |
| TV / desktop | Web | Guided cut as a normal stream, "pick a seat" with the remote |

---

## Hospice, care and accessibility

- **One-tap start** for a carer: send a link or QR code that opens straight into the guided view, hands-free mode and large captions.
- **Comfort**: seated/lying posture works; no artificial motion; cuts fade through black; session length shown; a "pause and remove headset" reminder after 20 minutes is planned.
- **Lightweight options**: many patients can't wear a headset. The tablet "pick a seat" view, and a TV showing the guided cut with spatial audio over headphones, are first-class products, not fallbacks.
- **Hearing and sight**: captions, audio description, a vocal-clarity mix, and, as a stretch goal, an ASL/BSL interpreter as a picture-in-picture "camera".
- **Shared viewing**: family members on different devices watch the same live moment together, each in their own seat, with optional voice chat.

## Rights and production (talk to these people early)

- **Unions and guilds**: recording live theatre or concerts triggers capture agreements, e.g. Actors' Equity (AEA) and SAG-AFTRA for performers, AFM for musicians, IATSE for crew, SDC for directors and choreographers, plus their equivalents outside the US.
- **Music**: sync and performance licensing for every song, and grand rights for musicals.
- **Venue and producer**: camera positions take seats off sale. Budget for seat kills, and agree BTS access with the stage manager.
- **Audience consent**: signage and ticket terms for being filmed in 360°.
- A **non-profit or care-sector licence tier** (hospices, hospitals, care homes) could unlock rights holders who would otherwise say no.

## Roadmap

1. **Prototype (this):** interaction model, guided cut, binaural, VR on Quest and Vision Pro.
2. **Pilot shoot:** one local band or a school musical, with 3 cameras, desk stems and one ambisonic mic. VOD only.
   - Add stereo top/bottom 360 playback and a real cue track to the player.
3. **Live beta:** SRT ingest, LL-HLS, a director console, and multi-camera sync.
4. **Native apps** for Quest and Vision Pro, tiled streaming, and a care-home partner programme.

## Files

- `index.html`: the prototype player (three.js r160 from jsDelivr, Web Audio, WebXR). The show data at the top of the script (`SECTIONS`, `CAMS`, `CUES`, `CAPTIONS`, `AD`) has the shape a real show manifest would have.
