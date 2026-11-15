import SwiftUI

struct RemoteView: View {
    @EnvironmentObject var app: AppState
    @EnvironmentObject var remote: RemoteModel

    var body: some View {
        Group {
            if remote.pairing == nil {
                ConnectView()
            } else {
                ControlView()
            }
        }
        .toast($remote.toast)
    }
}

// MARK: - Pairing

struct ConnectView: View {
    @EnvironmentObject var remote: RemoteModel
    @State private var code = ""
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                GroupBox {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("On the headset or screen that’s playing Every Seat, open the program’s **Access** page and tap **Show a pairing code**. In a headset, the code is printed on the program.")
                            .foregroundStyle(.secondary)
                        TextField("ABC-123", text: $code)
                            .font(.system(size: 28, weight: .bold, design: .monospaced))
                            .multilineTextAlignment(.center)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: 220)
                            .frame(maxWidth: .infinity)
                            .focused($focused)
                            .autocorrectionDisabled()
                            #if os(iOS)
                            .textInputAutocapitalization(.characters)
                            .textContentType(.oneTimeCode)
                            #endif
                            .onChange(of: code) { code = Codes.format($0) }
                            .onSubmit { submit() }
                        Button(action: submit) {
                            Text("Connect").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(remote.busy)
                        if let e = remote.error {
                            Text(e).foregroundStyle(.red).font(.callout)
                                .accessibilityAddTraits(.isStaticText)
                        }
                    }
                    .padding(4)
                } label: {
                    Label("Connect to a viewer", systemImage: "visionpro")
                }
            }
            .padding()
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .onAppear { focused = true }
    }

    private func submit() { Task { await remote.connect(code: code) } }
}

// MARK: - Controls

struct ControlView: View {
    @EnvironmentObject var app: AppState
    @EnvironmentObject var remote: RemoteModel
    @State private var scrubbing = false
    @State private var scrubValue = 0.0

    private var cams: [Cam] { app.config?.cams ?? [] }
    private var end: Double { app.config?.end ?? 150 }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                statusCard
                HStack(alignment: .top, spacing: 16) {
                    seatCard.frame(maxWidth: .infinity)
                    VStack(spacing: 16) { showCard; settingsCard }.frame(maxWidth: 420)
                }
                .frame(maxWidth: .infinity, alignment: .top)
            }
            .padding()
        }
        #if os(iOS)
        .scrollDismissesKeyboard(.interactively)
        #endif
    }

    private var camName: String {
        cams.first(where: { $0.id == remote.currentCam })?.name ?? "—"
    }

    private var statusCard: some View {
        GroupBox {
            HStack(alignment: .top, spacing: 12) {
                Circle()
                    .fill(remote.status?.viewer_online == true ? Color.green : (remote.status == nil ? .orange : .secondary))
                    .frame(width: 12, height: 12)
                    .padding(.top, 5)
                VStack(alignment: .leading, spacing: 3) {
                    if let s = remote.status, let v = s.status {
                        Text("\(v.xr == true ? "In headset" : "On screen") · \(camName) · \(formatTime(remote.time))")
                            .font(.headline)
                        Text("\(remote.isPlaying ? "Playing" : "Paused")\(v.live == true ? " · following a live director" : "") · code \(remote.pairing?.display_code ?? "")")
                            .font(.callout).foregroundStyle(.secondary)
                        if v.audio_locked == true {
                            Text(v.xr == true
                                 ? "Sound starts when the viewer pulls a trigger or pinches once."
                                 : "Sound starts after the viewer taps “Take your seat” once on their screen.")
                                .font(.callout).padding(6)
                                .background(.yellow.opacity(0.18), in: RoundedRectangle(cornerRadius: 8))
                        }
                    } else if remote.status?.viewer_online == false {
                        Text("Viewer offline").font(.headline)
                        Text("The headset or screen hasn’t checked in for a few seconds. It may be asleep or have lost Wi-Fi.")
                            .font(.callout).foregroundStyle(.secondary)
                    } else {
                        Text("Connected to \(remote.pairing?.display_code ?? "")").font(.headline)
                        Text("Waiting for the viewer…").font(.callout).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Button("Disconnect") { remote.disconnect() }
            }
        }
    }

    private var seatCard: some View {
        GroupBox {
            VStack(spacing: 12) {
                SeatingChart(cams: cams, current: remote.currentCam) { remote.pickSeat($0) }
                    .aspectRatio(28 / 36, contentMode: .fit)
                    .frame(maxWidth: 440)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
                    ForEach(cams) { cam in
                        SeatButton(cam: cam, selected: cam.id == remote.currentCam) { remote.pickSeat(cam.id) }
                    }
                }
            }
        } label: {
            Label("Seating chart · tap a seat", systemImage: "chair")
        }
    }

    private var showCard: some View {
        GroupBox {
            VStack(spacing: 12) {
                HStack(spacing: 18) {
                    Button { remote.skip(-10) } label: { Image(systemName: "gobackward.10").font(.title2) }
                        .accessibilityLabel("Back 10 seconds")
                    Button { remote.togglePlay() } label: {
                        Image(systemName: remote.isPlaying ? "pause.fill" : "play.fill")
                            .font(.title)
                            .frame(width: 64, height: 64)
                            .background(Color.accentColor, in: Circle())
                            .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(remote.isPlaying ? "Pause" : "Play")
                    .keyboardShortcut(.space, modifiers: [])
                    Button { remote.skip(10) } label: { Image(systemName: "goforward.10").font(.title2) }
                        .accessibilityLabel("Forward 10 seconds")
                }
                VStack(spacing: 2) {
                    Slider(value: Binding(
                        get: { scrubbing ? scrubValue : remote.time },
                        set: { scrubValue = $0 }
                    ), in: 0...end) { editing in
                        if editing { scrubValue = remote.time; scrubbing = true }
                        else { scrubbing = false; remote.seek(scrubValue) }
                    }
                    .accessibilityLabel("Position in the show")
                    HStack {
                        Text(formatTime(scrubbing ? scrubValue : remote.time))
                        Spacer()
                        Text(remote.viewer?.section ?? "").foregroundStyle(.secondary)
                        Spacer()
                        Text(formatTime(end))
                    }
                    .font(.caption.monospaced())
                }
                Toggle(isOn: Binding(get: { remote.isGuided }, set: { remote.setGuided($0) })) {
                    Text("Director’s cut")
                }
                .toggleStyle(.switch)
                if remote.viewer?.xr == true {
                    Toggle(isOn: Binding(get: { remote.menuOpen }, set: { remote.setMenu($0) })) {
                        Text("Program visible in headset")
                    }
                    .toggleStyle(.switch)
                }
            }
        } label: {
            Label("Show", systemImage: "play.circle")
        }
    }

    private var settingsCard: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 10) {
                toggleRow("Captions", subtitle: "Lyrics and sound cues", key: "captions")
                Picker("Caption size", selection: Binding(get: { remote.string("capsize") }, set: { remote.setString("capsize", $0) })) {
                    Text("Small").tag("small"); Text("Medium").tag("medium"); Text("Large").tag("large")
                }
                .pickerStyle(.segmented)
                toggleRow("Audio description", subtitle: "A voice describes the stage", key: "ad")
                toggleRow("Hands-free", subtitle: "Guided view, large captions", key: "hands")
                toggleRow("Reduce motion", subtitle: nil, key: "motion")
                toggleRow("Large controls", subtitle: nil, key: "large")
                Picker("Sound", selection: Binding(get: { remote.string("mix") }, set: { remote.setString("mix", $0) })) {
                    Text("Binaural 3D").tag("binaural"); Text("Board mix").tag("board")
                }
                .pickerStyle(.segmented)
                sliderRow("Vocal clarity", value: Binding(get: { Double(remote.int("vocal")) }, set: { remote.setInt("vocal", Int($0)) }),
                          range: 0...12, step: 1, label: "+\(remote.int("vocal")) dB")
                sliderRow("Crowd noise", value: Binding(get: { Double(remote.int("crowd")) }, set: { remote.setInt("crowd", Int($0)) }),
                          range: 0...100, step: 5, label: "\(remote.int("crowd"))%")
            }
        } label: {
            Label("Access & sound", systemImage: "accessibility")
        }
    }

    private func toggleRow(_ title: String, subtitle: String?, key: String) -> some View {
        Toggle(isOn: Binding(get: { remote.bool(key) }, set: { remote.setBool(key, $0) })) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                if let s = subtitle { Text(s).font(.caption).foregroundStyle(.secondary) }
            }
        }
        .toggleStyle(.switch)
    }

    private func sliderRow(_ title: String, value: Binding<Double>, range: ClosedRange<Double>, step: Double, label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack { Text(title); Spacer(); Text(label).font(.caption.monospaced()).foregroundStyle(.secondary) }
            Slider(value: value, in: range, step: step).accessibilityLabel(title)
        }
    }
}

struct SeatButton: View {
    let cam: Cam
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 1) {
                Text("CAM \(cam.key) · \(cam.bts ? "BACKSTAGE" : "AUDIENCE")")
                    .font(.caption2.monospaced().bold())
                    .foregroundStyle(selected ? AnyShapeStyle(.white.opacity(0.8)) : AnyShapeStyle(cam.bts ? Color.teal : Color.red))
                Text(cam.name).font(.headline)
                Text(cam.sub).font(.caption).foregroundStyle(selected ? AnyShapeStyle(.white.opacity(0.8)) : AnyShapeStyle(.secondary))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(selected ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.quaternary.opacity(0.4)),
                        in: RoundedRectangle(cornerRadius: 12))
            .foregroundStyle(selected ? .white : .primary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(cam.name), \(cam.sub)")
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

// MARK: - The overhead seating chart

struct SeatingChart: View {
    let cams: [Cam]
    let current: String?
    let pick: (String) -> Void

    // Venue space: x in [-14, 14], z in [-12.6, 23.4] (same as the web chart).
    private func point(_ x: Double, _ z: Double, in size: CGSize) -> CGPoint {
        CGPoint(x: (x + 14) / 28 * size.width, y: (z + 12.6) / 36 * size.height)
    }

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let s = size.width / 28   // metres → points

            ZStack {
                // stage + wings
                let wing = point(-13.6, -12.2, in: size)
                RoundedRectangle(cornerRadius: 3)
                    .fill(Color(red: 0.11, green: 0.08, blue: 0.1))
                    .frame(width: 27.2 * s, height: 11.2 * s)
                    .position(x: wing.x + 13.6 * s, y: wing.y + 5.6 * s)
                Rectangle()
                    .fill(Color(red: 0.18, green: 0.14, blue: 0.16))
                    .frame(width: 19.2 * s, height: 11.2 * s)
                    .position(x: size.width / 2, y: wing.y + 5.6 * s)
                Text("STAGE").font(.system(size: 9, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.85))
                    .position(point(0, -10.4, in: size))

                // seat rows
                Path { p in
                    for i in 0..<13 {
                        let z = Double(2 + i)
                        p.move(to: point(-9.3, z, in: size)); p.addLine(to: point(-1, z, in: size))
                        p.move(to: point(1, z, in: size)); p.addLine(to: point(9.3, z, in: size))
                    }
                    for i in 0..<5 {
                        let z = 17 + Double(i) * 1.05
                        p.move(to: point(-12, z, in: size)); p.addLine(to: point(-1, z, in: size))
                        p.move(to: point(1, z, in: size)); p.addLine(to: point(12, z, in: size))
                    }
                }
                .stroke(Color.secondary.opacity(0.45), style: StrokeStyle(lineWidth: 1.4, dash: [4, 3]))
                Path { p in
                    p.move(to: point(-12.8, 15.7, in: size)); p.addLine(to: point(12.8, 15.7, in: size))
                }
                .stroke(Color.secondary.opacity(0.7), style: StrokeStyle(lineWidth: 1.6, dash: [7, 4]))
                Text("BALCONY · UPPER LEVEL").font(.system(size: 8, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .position(point(0, 22.8, in: size))

                // cameras
                ForEach(cams) { cam in
                    let c = point(cam.x, cam.z, in: size)
                    let selected = cam.id == current
                    let tint = cam.bts ? Color.teal : Color.red
                    Button { pick(cam.id) } label: {
                        Text("\(cam.key)")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(selected ? .white : tint)
                            .frame(width: 30, height: 30)
                            .background(selected ? AnyShapeStyle(tint) : AnyShapeStyle(.background), in: Circle())
                            .overlay(Circle().stroke(tint, lineWidth: 2.5))
                    }
                    .buttonStyle(.plain)
                    .position(c)
                    .accessibilityLabel("\(cam.name), \(cam.sub)")
                    .accessibilityAddTraits(selected ? [.isSelected] : [])

                    Text(cam.name)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(cam.z < -1 ? AnyShapeStyle(.white.opacity(0.9)) : AnyShapeStyle(.primary))
                        .position(x: c.x + (cam.x < 6 ? 1 : -1) * (CGFloat(cam.name.count) * 2.6 + 26), y: c.y)
                        .allowsHitTesting(false)
                }
            }
        }
    }
}
