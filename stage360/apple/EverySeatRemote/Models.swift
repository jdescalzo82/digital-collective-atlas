import Foundation
import Security
import SwiftUI

// MARK: - Shared app state (server address + show config)

@MainActor
final class AppState: ObservableObject {
    @Published var config: ShowConfig?
    @Published var configError: String?
    @Published private(set) var client: APIClient

    @AppStorage("apiBase") private var apiBase: String = APIClient.defaultBase

    init() {
        let stored = UserDefaults.standard.string(forKey: "apiBase") ?? APIClient.defaultBase
        client = APIClient(base: APIClient.baseURL(from: stored) ?? URL(string: APIClient.defaultBase)!)
    }

    var serverText: String { apiBase }

    /// Returns false if the address can't be understood.
    func setServer(_ text: String) -> Bool {
        guard let url = APIClient.baseURL(from: text) else { return false }
        apiBase = url.absoluteString
        client = APIClient(base: url)
        config = nil
        Task { await loadConfig() }
        return true
    }

    func loadConfig() async {
        var attempt = 0
        while config == nil && !Task.isCancelled {
            do {
                config = try await client.call("GET", "/config", as: ShowConfig.self)
                configError = nil
            } catch {
                configError = (error as? LocalizedError)?.errorDescription ?? "Can’t reach the server."
                attempt += 1
                try? await Task.sleep(nanoseconds: UInt64(min(10, 2 * attempt)) * 1_000_000_000)
            }
        }
    }
}

// MARK: - Remote (control one viewer)

@MainActor
final class RemoteModel: ObservableObject {
    @Published var pairing: Pairing?
    @Published var status: StatusResponse?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false
    @Published var failures = 0

    /// Values the user just set, shown until the viewer reports them back (avoids controls flicking back).
    @Published private var pending: [String: (value: Any, at: Date)] = [:]
    private let holdSeconds: TimeInterval = 3.5
    private var pollTask: Task<Void, Never>?
    private weak var app: AppState?

    init() {
        if let data = UserDefaults.standard.data(forKey: "es_remote"),
           let p = try? JSONDecoder().decode(Pairing.self, from: data) {
            pairing = p
        }
    }

    func attach(_ app: AppState) {
        self.app = app
        if pairing != nil { startPolling() }
    }

    private var client: APIClient? { app?.client }

    func connect(code: String) async {
        error = nil
        guard Codes.isValid(code) else { error = "Codes are 6 letters and numbers, like K7Q-4MZ."; return }
        guard let client = client else { return }
        busy = true
        defer { busy = false }
        struct Join: Encodable { let code: String }
        do {
            let p = try await client.call("POST", "/rooms/join", body: Join(code: Codes.clean(code)), as: Pairing.self)
            pairing = p
            status = nil
            pending = [:]
            if let data = try? JSONEncoder().encode(p) { UserDefaults.standard.set(data, forKey: "es_remote") }
            startPolling()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Couldn’t connect."
        }
    }

    func disconnect(message: String? = nil, notifyServer: Bool = true) {
        let old = pairing
        pollTask?.cancel(); pollTask = nil
        pairing = nil; status = nil; pending = [:]
        UserDefaults.standard.removeObject(forKey: "es_remote")
        error = message
        if notifyServer, let old = old, let client = client {
            Task { try? await client.callNoContent("DELETE", "/rooms/\(old.room)", token: old.token) }
        }
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self = self, let p = self.pairing, let client = self.client else { return }
                do {
                    let s = try await client.call("GET", "/rooms/\(p.room)/status", token: p.token, as: StatusResponse.self)
                    if self.pairing == p { self.status = s; self.failures = 0 }
                } catch let e as APIError where e.endsSession {
                    self.disconnect(message: "The viewer ended this pairing. Ask for a new code.", notifyServer: false)
                    return
                } catch is CancellationError {
                    return
                } catch {
                    self.failures += 1
                }
                let base = Double(self.app?.config?.poll_ms ?? 1000) / 1000
                let wait = min(15, base * Double(1 + min(self.failures, 6)))
                try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            }
        }
    }

    // MARK: sending

    func send(_ cmd: Command, hold key: String? = nil, value: Any? = nil) {
        guard let p = pairing, let client = client else { return }
        if let key = key, let value = value { pending[key] = (value, Date()) }
        Task {
            do {
                let r = try await client.call("POST", "/rooms/\(p.room)/commands", body: cmd, token: p.token, as: CommandResponse.self)
                if !r.viewer_online { toast = "Sent. The viewer seems to be offline right now." }
            } catch let e as APIError where e.endsSession {
                disconnect(message: "The viewer ended this pairing. Ask for a new code.", notifyServer: false)
            } catch {
                if let key = key { pending[key] = nil }
                toast = (error as? LocalizedError)?.errorDescription ?? "Couldn’t send."
            }
        }
    }

    private func held<T>(_ key: String, as: T.Type) -> T? {
        guard let h = pending[key], Date().timeIntervalSince(h.at) < holdSeconds else { return nil }
        return h.value as? T
    }

    // MARK: derived state for the UI

    var viewer: ViewerStatus? { status?.status }
    var currentCam: String? { held("cam", as: String.self) ?? viewer?.cam }
    var isPlaying: Bool { held("playing", as: Bool.self) ?? viewer?.playing ?? false }
    var isGuided: Bool { held("guided", as: Bool.self) ?? viewer?.guided ?? true }
    var menuOpen: Bool { held("menu", as: Bool.self) ?? (viewer?.menu_open ?? true) }
    var time: Double {
        if let t = held("t", as: Double.self) { return t }
        guard let v = viewer else { return 0 }
        let drift = v.playing ? Double(min(status?.age ?? 0, 3)) : 0
        return min(app?.config?.end ?? 150, v.t + drift)
    }

    func bool(_ key: String) -> Bool {
        if let v = held("s:" + key, as: Bool.self) { return v }
        let s = viewer?.settings
        switch key {
        case "captions": return s?.captions ?? true
        case "ad": return s?.ad ?? false
        case "hands": return s?.hands ?? false
        case "motion": return s?.motion ?? false
        case "large": return s?.large ?? false
        default: return false
        }
    }

    func string(_ key: String) -> String {
        if let v = held("s:" + key, as: String.self) { return v }
        switch key {
        case "capsize": return viewer?.settings?.capsize ?? "medium"
        case "mix": return viewer?.settings?.mix ?? "binaural"
        default: return ""
        }
    }

    func int(_ key: String) -> Int {
        if let v = held("s:" + key, as: Int.self) { return v }
        switch key {
        case "vocal": return viewer?.settings?.vocal ?? 0
        case "crowd": return viewer?.settings?.crowd ?? 60
        default: return 0
        }
    }

    // MARK: actions

    func pickSeat(_ id: String) {
        pending["guided"] = (false, Date())
        send(.seat(id), hold: "cam", value: id)
    }
    func togglePlay() { let p = isPlaying; send(p ? .pause : .play, hold: "playing", value: !p) }
    func skip(_ by: Double) { send(.skip(by), hold: "t", value: max(0, time + by)) }
    func seek(_ t: Double) { send(.seek(t), hold: "t", value: t) }
    func setGuided(_ on: Bool) { send(.guided(on), hold: "guided", value: on) }
    func setMenu(_ open: Bool) { send(.menu(open), hold: "menu", value: open) }
    func setBool(_ key: String, _ v: Bool) { send(.setting(key, .bool(v)), hold: "s:" + key, value: v) }
    func setString(_ key: String, _ v: String) { send(.setting(key, .string(v)), hold: "s:" + key, value: v) }
    func setInt(_ key: String, _ v: Int) { send(.setting(key, .int(v)), hold: "s:" + key, value: v) }
}

// MARK: - Director (call a live cut)

@MainActor
final class DirectorModel: ObservableObject {
    @Published var session: DirectorSession?
    @Published var show: ShowState?
    @Published var subject = "wide"
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false

    private var pollTask: Task<Void, Never>?
    private weak var app: AppState?

    init() {
        if let data = UserDefaults.standard.data(forKey: "es_director"),
           let s = try? JSONDecoder().decode(DirectorSession.self, from: data) {
            session = s
        }
    }

    func attach(_ app: AppState) {
        self.app = app
        if session != nil { startPolling() }
    }

    private var client: APIClient? { app?.client }

    var savedKey: String { Keychain.read("director_key") ?? "" }

    private func begin(_ s: DirectorSession, key: String, remember: Bool) {
        session = s; show = nil; error = nil
        if let data = try? JSONEncoder().encode(s) { UserDefaults.standard.set(data, forKey: "es_director") }
        if remember { Keychain.save("director_key", key) } else { Keychain.delete("director_key") }
        startPolling()
    }

    func startShow(title: String, key: String, remember: Bool) async {
        guard let client = client else { return }
        struct Body: Encodable { let key: String; let title: String }
        busy = true; defer { busy = false }
        do {
            let t = title.trimmingCharacters(in: .whitespaces)
            let s = try await client.call("POST", "/shows", body: Body(key: key, title: t.isEmpty ? (app?.config?.title ?? "Every Angle") : t), as: DirectorSession.self)
            begin(s, key: key, remember: remember)
        } catch { self.error = message(for: error) }
    }

    func takeOver(code: String, key: String, remember: Bool) async {
        guard Codes.isValid(code) else { error = "Codes are 6 letters and numbers, like K7Q-4MZ."; return }
        guard let client = client else { return }
        struct Body: Encodable { let key: String }
        busy = true; defer { busy = false }
        do {
            let s = try await client.call("POST", "/shows/\(Codes.clean(code))/director", body: Body(key: key), as: DirectorSession.self)
            begin(s, key: key, remember: remember)
        } catch { self.error = message(for: error) }
    }

    private func message(for error: Error) -> String {
        if let e = error as? APIError, e.code == "director_disabled" {
            return "Director mode is switched off on this server. Set a director key in api/config.local.php."
        }
        return (error as? LocalizedError)?.errorDescription ?? "Something went wrong."
    }

    func leave(_ message: String? = nil) {
        pollTask?.cancel(); pollTask = nil
        session = nil; show = nil
        UserDefaults.standard.removeObject(forKey: "es_director")
        if let m = message { toast = m }
    }

    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            var failures = 0
            while !Task.isCancelled {
                guard let self = self, let s = self.session, let client = self.client else { return }
                do {
                    let st = try await client.call("GET", "/shows/\(s.code)", as: ShowState.self)
                    failures = 0
                    if st.ended { self.leave("The show has ended."); return }
                    if self.session == s { self.show = st }
                } catch let e as APIError where e.status == 404 {
                    self.leave("This show no longer exists."); return
                } catch is CancellationError {
                    return
                } catch {
                    failures += 1
                }
                try? await Task.sleep(nanoseconds: UInt64(min(15, 1.5 * Double(1 + min(failures, 6))) * 1_000_000_000))
            }
        }
    }

    var onAirCam: String? { (show?.live ?? false) ? show?.cue?.cam : nil }

    func take(_ cam: String) {
        guard let s = session, let client = client else { return }
        let subj = subject
        struct Body: Encodable { let cam: String; let subject: String }
        Task {
            do {
                _ = try await client.call("POST", "/shows/\(s.code)/cue", body: Body(cam: cam, subject: subj), token: s.token, as: LiveResponseWithCue.self)
                if let cur = show {
                    show = ShowState(code: cur.code, display_code: cur.display_code, title: cur.title, live: true, ended: false,
                                     version: cur.version + 1, cue: Cue(cam: cam, subject: subj, at: Int(Date().timeIntervalSince1970)), viewers: cur.viewers)
                }
            } catch let e as APIError where e.status == 401 || e.status == 403 {
                leave("Another device took over this show, or your session ended.")
            } catch let e as APIError where e.code == "show_ended" {
                leave("The show has ended.")
            } catch {
                toast = (error as? LocalizedError)?.errorDescription ?? "Couldn’t take that shot."
            }
        }
    }

    func setLive(_ live: Bool) {
        guard let s = session, let client = client else { return }
        struct Body: Encodable { let live: Bool }
        Task {
            do { _ = try await client.call("POST", "/shows/\(s.code)/live", body: Body(live: live), token: s.token, as: LiveResponse.self) }
            catch let e as APIError where e.status == 401 || e.status == 403 { leave("Your director session ended.") }
            catch { toast = (error as? LocalizedError)?.errorDescription ?? "Couldn’t change the live state." }
        }
    }

    func endShow() {
        guard let s = session, let client = client else { return }
        Task {
            try? await client.callNoContent("DELETE", "/shows/\(s.code)", token: s.token)
            leave("Show ended.")
        }
    }

    func viewerLink() -> URL? {
        guard let s = session, let base = client?.playerURL,
              var comps = URLComponents(url: base, resolvingAgainstBaseURL: false) else { return nil }
        comps.queryItems = [URLQueryItem(name: "show", value: s.code)]
        return comps.url
    }
}

struct LiveResponseWithCue: Decodable {
    let version: Int
    let live: Bool
}

// MARK: - Keychain (director key, only when "Remember" is on)

enum Keychain {
    private static let service = "com.toolkityourlife.everyseat.remote"

    static func save(_ account: String, _ value: String) {
        delete(account)
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        SecItemAdd(q as CFDictionary, nil)
    }

    static func read(_ account: String) -> String? {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(_ account: String) {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(q as CFDictionary)
    }
}
