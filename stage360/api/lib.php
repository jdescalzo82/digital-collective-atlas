<?php
/* Every Seat API — shared helpers: responses, input, database, auth, rate limits. */

const ES_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const ES_MAX_BODY = 4096;

final class EsError extends Exception {
    public int $status; public string $errCode; public ?string $field; public array $headers;
    public function __construct(int $status, string $code, string $message, ?string $field = null, array $headers = []) {
        parent::__construct($message);
        $this->status = $status; $this->errCode = $code; $this->field = $field; $this->headers = $headers;
    }
}

function es_fail(int $status, string $code, string $message, ?string $field = null, array $headers = []): never {
    throw new EsError($status, $code, $message, $field, $headers);
}

function es_send(int $status, $data = null, array $headers = []): never {
    http_response_code($status);
    foreach ($headers as $k => $v) header("$k: $v");
    if ($status === 204 || $data === null) { exit; }
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function es_now(): int { return time(); }

function es_client_ip(): string {
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 0, 64);
}

/* ---------- input ---------- */

function es_body(): array {
    $type = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
    $len = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($len > ES_MAX_BODY) es_fail(413, 'payload_too_large', 'Request body is too large.');
    $raw = file_get_contents('php://input', false, null, 0, ES_MAX_BODY + 1);
    if ($raw === false) $raw = '';
    if (strlen($raw) > ES_MAX_BODY) es_fail(413, 'payload_too_large', 'Request body is too large.');
    if (trim($raw) === '') return [];
    if ($type !== 'application/json' && $type !== 'text/plain') {
        es_fail(415, 'unsupported_media_type', 'Send JSON with Content-Type: application/json.');
    }
    $data = json_decode($raw, true, 8);
    if (!is_array($data) || ($data !== [] && array_is_list($data))) {
        es_fail(400, 'invalid_json', 'Request body must be a JSON object.');
    }
    return $data;
}

function es_bool($v, string $field): bool {
    if (!is_bool($v)) es_fail(422, 'invalid_' . $field, "$field must be true or false.", $field);
    return $v;
}

function es_num($v, string $field, float $min, float $max): float {
    if (!is_int($v) && !is_float($v)) es_fail(422, 'invalid_' . $field, "$field must be a number.", $field);
    if (!is_finite((float) $v) || $v < $min || $v > $max) {
        es_fail(422, 'invalid_' . $field, "$field must be between $min and $max.", $field);
    }
    return (float) $v;
}

function es_int($v, string $field, int $min, int $max): int {
    if (is_float($v) && floor($v) == $v) $v = (int) $v;
    if (!is_int($v) || $v < $min || $v > $max) {
        es_fail(422, 'invalid_' . $field, "$field must be a whole number from $min to $max.", $field);
    }
    return $v;
}

function es_enum($v, string $field, array $allowed) {
    if (!in_array($v, $allowed, true)) {
        es_fail(422, 'invalid_' . $field, "$field must be one of: " . implode(', ', $allowed) . '.', $field);
    }
    return $v;
}

function es_code_normalize($v): string {
    if (!is_string($v)) es_fail(422, 'invalid_code', 'Enter the 6-character code.', 'code');
    $c = strtoupper(preg_replace('/[\s\-]+/', '', $v));
    if (strlen($c) !== 6 || strspn($c, ES_CODE_ALPHABET) !== 6) {
        es_fail(422, 'invalid_code', 'Codes are 6 letters and numbers, like K7Q-4MZ.', 'code');
    }
    return $c;
}

function es_display_code(string $c): string { return substr($c, 0, 3) . '-' . substr($c, 3); }

function es_random_code(): string {
    $s = '';
    for ($i = 0; $i < 6; $i++) $s .= ES_CODE_ALPHABET[random_int(0, strlen(ES_CODE_ALPHABET) - 1)];
    return $s;
}

function es_token(): string { return rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '='); }
function es_hash(string $t): string { return hash('sha256', $t); }

function es_request_token(): ?string {
    $t = $_SERVER['HTTP_X_ES_TOKEN'] ?? '';
    if ($t === '') {
        $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if (stripos($auth, 'Bearer ') === 0) $t = trim(substr($auth, 7));
    }
    if ($t === '') return null;
    if (!preg_match('/^[A-Za-z0-9_-]{20,64}$/', $t)) es_fail(401, 'invalid_token', 'Malformed token.');
    return $t;
}

/* ---------- database ---------- */

function es_db(array $cfg): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $path = $cfg['db_path'];
    $dir = dirname($path);
    if (!is_dir($dir) && !@mkdir($dir, 0700, true)) {
        es_fail(503, 'storage_unavailable', 'The server cannot create its data folder.');
    }
    try {
        $pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_TIMEOUT => 5,
        ]);
        $pdo->exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
        $pdo->exec(<<<SQL
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL, viewer_seen INTEGER NOT NULL,
  status TEXT, status_at INTEGER
);
CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY, scope TEXT NOT NULL, role TEXT NOT NULL,
  created INTEGER NOT NULL, seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tokens_scope ON tokens(scope, role);
CREATE TABLE IF NOT EXISTS commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT, room TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  body TEXT NOT NULL, created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS commands_room ON commands(room, id);
CREATE TABLE IF NOT EXISTS shows (
  code TEXT PRIMARY KEY, title TEXT NOT NULL, live INTEGER NOT NULL DEFAULT 0, ended INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0, cue TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS show_viewers (
  show TEXT NOT NULL, viewer TEXT NOT NULL, seen INTEGER NOT NULL, PRIMARY KEY (show, viewer)
);
CREATE TABLE IF NOT EXISTS ratelimit (k TEXT PRIMARY KEY, win INTEGER NOT NULL, n INTEGER NOT NULL);
SQL);
    } catch (PDOException $e) {
        error_log('Every Seat DB error: ' . $e->getMessage());
        $pdo = null;
        es_fail(503, 'storage_unavailable', 'The server database is unavailable.');
    }
    return $pdo;
}

function es_housekeeping(PDO $db, array $cfg): void {
    $now = es_now();
    $db->prepare('DELETE FROM rooms WHERE viewer_seen < ? OR created < ?')
       ->execute([$now - $cfg['room_idle_ttl'], $now - $cfg['room_max_age']]);
    $db->exec("DELETE FROM tokens WHERE role IN ('viewer','remote') AND scope NOT IN (SELECT id FROM rooms)");
    $db->prepare('DELETE FROM commands WHERE created < ?')->execute([$now - $cfg['command_ttl']]);
    $db->prepare('DELETE FROM shows WHERE updated < ?')->execute([$now - $cfg['show_idle_ttl']]);
    $db->exec("DELETE FROM tokens WHERE role = 'director' AND scope NOT IN (SELECT code FROM shows)");
    $db->prepare('DELETE FROM show_viewers WHERE seen < ?')->execute([$now - 300]);
    $db->prepare('DELETE FROM ratelimit WHERE win < ?')->execute([intdiv($now, 60) - 1]);
}

/* ---------- rate limiting (fixed one-minute windows) ---------- */

function es_rate(PDO $db, array $cfg, string $bucket): void {
    $limit = $cfg['rate'][$bucket];
    $win = intdiv(es_now(), 60);
    $k = $bucket . '|' . es_client_ip();
    $db->prepare('INSERT INTO ratelimit (k, win, n) VALUES (?, ?, 1)
                  ON CONFLICT(k) DO UPDATE SET n = CASE WHEN win = excluded.win THEN n + 1 ELSE 1 END, win = excluded.win')
       ->execute([$k, $win]);
    $st = $db->prepare('SELECT n FROM ratelimit WHERE k = ?'); $st->execute([$k]);
    if ((int) $st->fetchColumn() > $limit) {
        es_fail(429, 'rate_limited', 'Too many requests. Wait a moment and try again.', null,
                ['Retry-After' => (string) (60 - es_now() % 60)]);
    }
}

/* ---------- auth ---------- */

/** Returns the token row for the request, checked against scope and allowed roles. */
function es_auth(PDO $db, string $scope, array $roles): array {
    $t = es_request_token();
    if ($t === null) es_fail(401, 'unauthorized', 'This needs the token you were given when you connected.');
    $st = $db->prepare('SELECT hash, scope, role FROM tokens WHERE hash = ?');
    $st->execute([es_hash($t)]);
    $row = $st->fetch();
    if (!$row || !hash_equals($row['scope'], $scope)) es_fail(403, 'forbidden', 'This connection has ended. Connect again.');
    if (!in_array($row['role'], $roles, true)) es_fail(403, 'forbidden', 'Not allowed for this connection.');
    $db->prepare('UPDATE tokens SET seen = ? WHERE hash = ?')->execute([es_now(), $row['hash']]);
    return $row;
}

function es_issue_token(PDO $db, string $scope, string $role): string {
    $t = es_token();
    $db->prepare('INSERT INTO tokens (hash, scope, role, created, seen) VALUES (?, ?, ?, ?, ?)')
       ->execute([es_hash($t), $scope, $role, es_now(), es_now()]);
    return $t;
}

/* ---------- validation of what devices send ---------- */

const ES_SETTINGS = [
    'captions' => 'bool', 'ad' => 'bool', 'hands' => 'bool', 'motion' => 'bool', 'large' => 'bool',
    'capsize' => ['small', 'medium', 'large'],
    'mix' => ['binaural', 'board'],
    'vocal' => [0, 12], 'crowd' => [0, 100],
];
const ES_SETTINGS_PUBLIC = [
    'captions' => ['type' => 'bool', 'label' => 'Captions'],
    'capsize' => ['type' => 'enum', 'label' => 'Caption size', 'options' => ['small', 'medium', 'large']],
    'ad' => ['type' => 'bool', 'label' => 'Audio description'],
    'hands' => ['type' => 'bool', 'label' => 'Hands-free'],
    'motion' => ['type' => 'bool', 'label' => 'Reduce motion'],
    'large' => ['type' => 'bool', 'label' => 'Large controls'],
    'mix' => ['type' => 'enum', 'label' => 'Sound', 'options' => ['binaural', 'board']],
    'vocal' => ['type' => 'int', 'label' => 'Vocal clarity (dB)', 'min' => 0, 'max' => 12],
    'crowd' => ['type' => 'int', 'label' => 'Crowd noise', 'min' => 0, 'max' => 100],
];

function es_setting_value(string $key, $value) {
    $rule = ES_SETTINGS[$key];
    if ($rule === 'bool') return es_bool($value, $key);
    if (is_int($rule[0])) return es_int($value, $key, $rule[0], $rule[1]);
    return es_enum($value, $key, $rule);
}

function es_validate_command(array $b, array $camIds, float $end): array {
    $type = es_enum($b['type'] ?? null, 'type',
        ['seat', 'play', 'pause', 'toggle_play', 'seek', 'skip', 'guided', 'menu', 'setting']);
    switch ($type) {
        case 'seat':   return ['type' => $type, 'cam' => es_enum($b['cam'] ?? null, 'cam', $camIds)];
        case 'seek':   return ['type' => $type, 't' => round(es_num($b['t'] ?? null, 't', 0, $end), 2)];
        case 'skip':   return ['type' => $type, 'by' => round(es_num($b['by'] ?? null, 'by', -600, 600), 2)];
        case 'guided': return ['type' => $type, 'on' => es_bool($b['on'] ?? null, 'on')];
        case 'menu':   return ['type' => $type, 'open' => es_bool($b['open'] ?? null, 'open')];
        case 'setting':
            $key = es_enum($b['key'] ?? null, 'key', array_keys(ES_SETTINGS));
            return ['type' => $type, 'key' => $key, 'value' => es_setting_value($key, $b['value'] ?? null)];
        default:       return ['type' => $type];
    }
}

function es_validate_status($s, array $camIds, float $end): array {
    if (!is_array($s) || array_is_list($s)) es_fail(422, 'invalid_status', 'status must be an object.', 'status');
    $out = [
        'cam' => es_enum($s['cam'] ?? null, 'cam', $camIds),
        'guided' => es_bool($s['guided'] ?? null, 'guided'),
        'playing' => es_bool($s['playing'] ?? null, 'playing'),
        't' => round(es_num($s['t'] ?? null, 't', 0, $end), 2),
    ];
    foreach (['started', 'xr', 'audio_locked', 'menu_open', 'live'] as $k) {
        if (array_key_exists($k, $s)) $out[$k] = es_bool($s[$k], $k);
    }
    if (isset($s['section'])) {
        if (!is_string($s['section']) || mb_strlen($s['section']) > 40) es_fail(422, 'invalid_section', 'Bad section.', 'section');
        $out['section'] = $s['section'];
    }
    if (isset($s['settings'])) {
        if (!is_array($s['settings'])) es_fail(422, 'invalid_settings', 'settings must be an object.', 'settings');
        $out['settings'] = [];
        foreach ($s['settings'] as $k => $v) {
            if (!is_string($k) || !isset(ES_SETTINGS[$k])) continue;  // ignore unknown keys from newer players
            $out['settings'][$k] = es_setting_value($k, $v);
        }
    }
    return $out;
}

function es_check_director_key(array $cfg, $key): void {
    if ($cfg['director_key'] === '') {
        es_fail(403, 'director_disabled', 'Director mode is off. Set a director key in api/config.local.php on the server.');
    }
    if (!is_string($key) || !hash_equals($cfg['director_key'], $key)) {
        es_fail(403, 'wrong_key', 'That director key is not right.', 'key');
    }
}
