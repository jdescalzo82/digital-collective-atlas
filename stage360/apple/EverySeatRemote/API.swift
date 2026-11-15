import Foundation

// MARK: - Models (mirror stage360/api/index.php)

struct Cam: Decodable, Identifiable, Hashable {
    let id: String
    let key: Int
    let name: String
    let sub: String
    let group: String
    let bts: Bool
    let x: Double
    let z: Double
}

struct Subject: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
}

struct ShowConfig: Decodable {
    let title: String
    let end: Double
    let cams: [Cam]
    let subjects: [Subject]
    let poll_ms: Int
    let director_enabled: Bool
}

struct Pairing: Codable, Equatable {
    let room: String
    let token: String
    let display_code: String
}

struct ViewerSettings: Decodable, Equatable {
    var captions: Bool?
    var capsize: String?
    var ad: Bool?
    var hands: Bool?
    var motion: Bool?
    var large: Bool?
    var mix: String?
    var vocal: Int?
    var crowd: Int?
}

struct ViewerStatus: Decodable, Equatable {
    let cam: String
    let guided: Bool
    let playing: Bool
    let t: Double
    var started: Bool?
    var xr: Bool?
    var audio_locked: Bool?
    var menu_open: Bool?
    var live: Bool?
    var section: String?
    var settings: ViewerSettings?
}

struct StatusResponse: Decodable, Equatable {
    let status: ViewerStatus?
    let age: Int?
    let viewer_online: Bool
    let remotes: Int
}

struct CommandResponse: Decodable {
    let id: Int
    let viewer_online: Bool
}

struct Cue: Decodable, Equatable {
    let cam: String
    let subject: String
    let at: Int
}

struct ShowState: Decodable, Equatable {
    let code: String
    let display_code: String
    let title: String
    let live: Bool
    let ended: Bool
    let version: Int
    let cue: Cue?
    let viewers: Int
}

struct DirectorSession: Codable, Equatable {
    let code: String
    let display_code: String
    let title: String
    let token: String
}

struct LiveResponse: Decodable {
    let version: Int
    let live: Bool
}

// MARK: - Commands a remote can send

enum SettingValue: Encodable, Equatable {
    case bool(Bool)
    case int(Int)
    case string(String)

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .bool(let v): try c.encode(v)
        case .int(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        }
    }
}

struct Command: Encodable {
    var type: String
    var cam: String? = nil
    var t: Double? = nil
    var by: Double? = nil
    var on: Bool? = nil
    var open: Bool? = nil
    var key: String? = nil
    var value: SettingValue? = nil

    static func seat(_ cam: String) -> Command { Command(type: "seat", cam: cam) }
    static let play = Command(type: "play")
    static let pause = Command(type: "pause")
    static func seek(_ t: Double) -> Command { Command(type: "seek", t: t) }
    static func skip(_ by: Double) -> Command { Command(type: "skip", by: by) }
    static func guided(_ on: Bool) -> Command { Command(type: "guided", on: on) }
    static func menu(_ open: Bool) -> Command { Command(type: "menu", open: open) }
    static func setting(_ key: String, _ value: SettingValue) -> Command { Command(type: "setting", key: key, value: value) }
}

// MARK: - Errors

enum APIError: LocalizedError {
    case network(String)
    case server(status: Int, code: String, message: String)
    case decoding

    var errorDescription: String? {
        switch self {
        case .network(let m): return m
        case .server(_, _, let m): return m
        case .decoding: return "Unexpected reply from the server."
        }
    }

    var status: Int {
        if case .server(let s, _, _) = self { return s }
        return 0
    }

    var code: String {
        switch self {
        case .network: return "network"
        case .server(_, let c, _): return c
        case .decoding: return "decoding"
        }
    }

    /// The pairing or director session is gone on the server.
    var endsSession: Bool { status == 401 || status == 403 || status == 404 }
}

private struct ErrorBody: Decodable {
    struct Inner: Decodable { let code: String; let message: String }
    let error: Inner
}

// MARK: - Client

final class APIClient {
    static let defaultBase = "https://toolkityourlife.com/EverySeat/api/"

    let base: URL
    private let session: URLSession

    init(base: URL) {
        self.base = base
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 8
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.waitsForConnectivity = false
        self.session = URLSession(configuration: cfg)
    }

    /// Accepts "toolkityourlife.com/EverySeat", ".../EverySeat/api", with or without https://.
    static func baseURL(from text: String) -> URL? {
        var s = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { s = defaultBase }
        if !s.lowercased().hasPrefix("http://") && !s.lowercased().hasPrefix("https://") { s = "https://" + s }
        if !s.hasSuffix("/") { s += "/" }
        if !s.lowercased().hasSuffix("/api/") { s += "api/" }
        guard let url = URL(string: s), url.host != nil else { return nil }
        return url
    }

    /// The player page a viewer opens (one level above the API folder).
    var playerURL: URL { base.deletingLastPathComponent() }

    private func makeRequest(_ method: String, _ route: String, query: [URLQueryItem], body: Data?, token: String?) throws -> URLRequest {
        guard var comps = URLComponents(url: base, resolvingAgainstBaseURL: false) else { throw APIError.network("Bad server address.") }
        comps.queryItems = [URLQueryItem(name: "r", value: route)] + query
        guard let url = comps.url else { throw APIError.network("Bad server address.") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body = body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token = token { req.setValue(token, forHTTPHeaderField: "X-ES-Token") }
        return req
    }

    private func perform(_ req: URLRequest) async throws -> (Data, Int) {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            if (error as? URLError)?.code == .cancelled { throw CancellationError() }
            throw APIError.network("Can’t reach the server. Check the connection.")
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if !(200..<300).contains(status) {
            if let e = try? JSONDecoder().decode(ErrorBody.self, from: data) {
                throw APIError.server(status: status, code: e.error.code, message: e.error.message)
            }
            throw APIError.server(status: status, code: "http_\(status)", message: "The server returned an error (\(status)).")
        }
        return (data, status)
    }

    func call<T: Decodable>(_ method: String, _ route: String, query: [URLQueryItem] = [],
                            body: (any Encodable)? = nil, token: String? = nil, as type: T.Type) async throws -> T {
        let bodyData = try body.map { try JSONEncoder().encode($0) }
        let (data, _) = try await perform(makeRequest(method, route, query: query, body: bodyData, token: token))
        do { return try JSONDecoder().decode(T.self, from: data) } catch { throw APIError.decoding }
    }

    /// For endpoints that answer 204 No Content.
    func callNoContent(_ method: String, _ route: String, body: (any Encodable)? = nil, token: String? = nil) async throws {
        let bodyData = try body.map { try JSONEncoder().encode($0) }
        _ = try await perform(makeRequest(method, route, query: [], body: bodyData, token: token))
    }
}

// MARK: - Codes

enum Codes {
    static let alphabet = Set("ABCDEFGHJKMNPQRSTUVWXYZ23456789")

    static func clean(_ s: String) -> String {
        String(s.uppercased().filter { !$0.isWhitespace && $0 != "-" })
    }

    static func isValid(_ s: String) -> Bool {
        let c = clean(s)
        return c.count == 6 && c.allSatisfy { alphabet.contains($0) }
    }

    /// Formats as the user types: "abc12" → "ABC-12".
    static func format(_ s: String) -> String {
        let c = String(clean(s).filter { $0.isLetter || $0.isNumber }.prefix(6))
        guard c.count > 3 else { return c }
        return String(c.prefix(3)) + "-" + String(c.dropFirst(3))
    }
}

func formatTime(_ t: Double) -> String {
    let s = max(0, Int(t))
    return String(format: "%02d:%02d", s / 60, s % 60)
}
