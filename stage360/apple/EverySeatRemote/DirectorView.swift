import SwiftUI

struct DirectorView: View {
    @EnvironmentObject var app: AppState
    @EnvironmentObject var director: DirectorModel

    var body: some View {
        Group {
            if director.session == nil {
                DirectorConnectView()
            } else {
                DirectorLiveView()
            }
        }
        .toast($director.toast)
    }
}

// MARK: - Start or take over a show

struct DirectorConnectView: View {
    @EnvironmentObject var app: AppState
    @EnvironmentObject var director: DirectorModel
    @State private var title = ""
    @State private var key = ""
    @State private var code = ""
    @State private var remember = false

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                GroupBox {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Viewers who enter your show code follow your camera cuts in their guided view.")
                            .foregroundStyle(.secondary)
                        TextField("Show title", text: $title, prompt: Text(app.config?.title ?? "Every Angle"))
                            .textFieldStyle(.roundedBorder)
                        SecureField("Director key", text: $key)
                            .textFieldStyle(.roundedBorder)
                        Toggle("Remember the key on this device", isOn: $remember)
                        Button {
                            Task { await director.startShow(title: title, key: key, remember: remember) }
                        } label: {
                            Text("Start show").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(key.isEmpty || director.busy)
                    }
                    .padding(4)
                } label: {
                    Label("Start a live show", systemImage: "record.circle")
                }

                GroupBox {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Continue calling a show from this device.")
                            .foregroundStyle(.secondary)
                        TextField("ABC-123", text: $code)
                            .font(.system(.title3, design: .monospaced).bold())
                            .textFieldStyle(.roundedBorder)
                            .autocorrectionDisabled()
                            #if os(iOS)
                            .textInputAutocapitalization(.characters)
                            #endif
                            .onChange(of: code) { code = Codes.format($0) }
                        Button {
                            Task { await director.takeOver(code: code, key: key, remember: remember) }
                        } label: {
                            Text("Take over").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .disabled(key.isEmpty || director.busy)
                    }
                    .padding(4)
                } label: {
                    Label("Take over a show", systemImage: "arrow.triangle.2.circlepath")
                }

                if let e = director.error {
                    Text(e).foregroundStyle(.red).font(.callout).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding()
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .onAppear {
            key = director.savedKey
            remember = !key.isEmpty
        }
    }
}

// MARK: - Calling the show

struct DirectorLiveView: View {
    @EnvironmentObject var app: AppState
    @EnvironmentObject var director: DirectorModel
    @State private var confirmEnd = false

    private var cams: [Cam] { app.config?.cams ?? [] }
    private var subjects: [Subject] { app.config?.subjects ?? [] }
    private var isLive: Bool { director.show?.live ?? false }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                GroupBox {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(director.session?.title ?? "Show")
                                .font(.caption.monospaced()).textCase(.uppercase)
                                .foregroundStyle(Color.accentColor)
                            Text(director.session?.display_code ?? "—")
                                .font(.system(size: 34, weight: .bold, design: .monospaced))
                                .textSelection(.enabled)
                            Text("Viewers enter this code on the program’s Access page.")
                                .font(.callout).foregroundStyle(.secondary)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 6) {
                            Text(isLive ? "ON AIR" : "OFF AIR")
                                .font(.caption.monospaced().bold())
                                .padding(.horizontal, 10).padding(.vertical, 5)
                                .background(isLive ? Color.red : Color.clear, in: Capsule())
                                .overlay(Capsule().stroke(isLive ? Color.red : Color.secondary, lineWidth: 1.5))
                                .foregroundStyle(isLive ? .white : .secondary)
                            Text("\(director.show?.viewers ?? 0) viewer\((director.show?.viewers ?? 0) == 1 ? "" : "s") following")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }

                GroupBox {
                    VStack(alignment: .leading, spacing: 12) {
                        Picker("Frame", selection: $director.subject) {
                            ForEach(subjects) { s in Text(s.name).tag(s.id) }
                        }
                        .pickerStyle(.segmented)
                        .accessibilityLabel("What to frame")
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                            ForEach(cams) { cam in
                                TakeButton(cam: cam, onAir: cam.id == director.onAirCam) { director.take(cam.id) }
                            }
                        }
                        Text("Keys 1–6 take a camera.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                } label: {
                    Label("Frame · then tap a camera to take it", systemImage: "camera")
                }

                HStack(spacing: 10) {
                    Button(isLive ? "Pause live cut" : "Go live") { director.setLive(!isLive) }
                        .buttonStyle(.borderedProminent)
                    if let link = director.viewerLink() {
                        ShareLink(item: link) { Text("Share viewer link") }
                            .buttonStyle(.bordered)
                    }
                    Button("End show", role: .destructive) { confirmEnd = true }
                        .buttonStyle(.bordered)
                    Button("Leave") { director.leave("You left the show. Take it over again with the code and key.") }
                        .buttonStyle(.bordered)
                }
            }
            .padding()
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .confirmationDialog("End the show?", isPresented: $confirmEnd) {
            Button("End show", role: .destructive) { director.endShow() }
        } message: {
            Text("Viewers go back to the built-in director’s cut.")
        }
        .background(KeyTakeCatcher { n in
            if n >= 1 && n <= cams.count { director.take(cams[n - 1].id) }
        })
    }
}

struct TakeButton: View {
    let cam: Cam
    let onAir: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 2) {
                Text("CAM \(cam.key)\(onAir ? " · ON AIR" : "")")
                    .font(.caption2.monospaced().bold())
                    .foregroundStyle(onAir ? Color.red : (cam.bts ? Color.teal : Color.red))
                Text(cam.name).font(.title3)
                Text(cam.sub).font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 84, alignment: .topLeading)
            .padding(12)
            .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(onAir ? Color.red : Color.secondary.opacity(0.3), lineWidth: onAir ? 3 : 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Take \(cam.name)")
        .accessibilityAddTraits(onAir ? [.isSelected] : [])
    }
}

/// Number keys 1–6 take cameras (hardware keyboard on iPad, any keyboard on Mac).
struct KeyTakeCatcher: View {
    let onNumber: (Int) -> Void

    var body: some View {
        ZStack {
            ForEach(1..<7) { n in
                Button("") { onNumber(n) }
                    .keyboardShortcut(KeyEquivalent(Character("\(n)")), modifiers: [])
            }
        }
        .frame(width: 0, height: 0)
        .opacity(0)
        .accessibilityHidden(true)
    }
}
