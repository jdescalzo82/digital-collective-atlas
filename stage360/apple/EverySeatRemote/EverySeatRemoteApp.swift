import SwiftUI

@main
struct EverySeatRemoteApp: App {
    @StateObject private var app = AppState()
    @StateObject private var remote = RemoteModel()
    @StateObject private var director = DirectorModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(app)
                .environmentObject(remote)
                .environmentObject(director)
                .task {
                    remote.attach(app)
                    director.attach(app)
                    await app.loadConfig()
                }
        }
        #if os(macOS)
        .defaultSize(width: 980, height: 760)
        #endif
    }
}

struct RootView: View {
    @EnvironmentObject var app: AppState
    @AppStorage("mode") private var mode = "remote"
    @State private var showServerSheet = false

    var body: some View {
        NavigationStack {
            Group {
                if app.config == nil {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text(app.configError ?? "Connecting to the server…")
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                        Button("Change server…") { showServerSheet = true }
                    }
                    .padding()
                } else if mode == "director" {
                    DirectorView()
                } else {
                    RemoteView()
                }
            }
            .navigationTitle(mode == "director" ? "Director" : "Remote")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.large)
            #endif
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Picker("Mode", selection: $mode) {
                        Text("Remote").tag("remote")
                        Text("Director").tag("director")
                    }
                    .pickerStyle(.segmented)
                    .frame(maxWidth: 260)
                }
                ToolbarItem(placement: .automatic) {
                    Button { showServerSheet = true } label: { Image(systemName: "server.rack") }
                        .accessibilityLabel("Server address")
                }
            }
            .sheet(isPresented: $showServerSheet) { ServerSheet() }
        }
    }
}

struct ServerSheet: View {
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("toolkityourlife.com/EverySeat", text: $text)
                        .textFieldStyle(.roundedBorder)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        #endif
                } header: {
                    Text("Every Seat server")
                } footer: {
                    Text("Where Every Seat is hosted. Leave as is unless you run your own copy.")
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle("Server")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        if app.setServer(text) { dismiss() } else { error = "That doesn’t look like a web address." }
                    }
                }
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
            .onAppear { text = app.serverText }
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 220)
        .padding()
        #endif
    }
}

/// Small transient message at the foot of the screen.
struct ToastView: ViewModifier {
    @Binding var message: String?

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let m = message {
                Text(m)
                    .font(.callout)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                    .padding()
                    .transition(.opacity)
                    .task {
                        try? await Task.sleep(nanoseconds: 2_600_000_000)
                        withAnimation { message = nil }
                    }
            }
        }
    }
}

extension View {
    func toast(_ message: Binding<String?>) -> some View { modifier(ToastView(message: message)) }
}
