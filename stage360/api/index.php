<?php
/*
 * Every Seat API (PHP 8.1+, SQLite). Routes are passed as ?r=/path so it works
 * on any cPanel host without rewrite rules. Tokens go in the X-ES-Token header.
 *
 *   GET    ?r=/health
 *   GET    ?r=/config                          cameras, subjects, settings, poll interval
 *
 *   Pairing a remote (iPhone / Mac / web) with a viewer (Quest / browser):
 *   POST   ?r=/rooms                           viewer opens a room → code + viewer token
 *   POST   ?r=/rooms/join          {code}      remote joins → remote token
 *   POST   ?r=/rooms/{id}/commands {type,...}  remote sends a command
 *   GET    ?r=/rooms/{id}/commands&after=N     viewer polls for commands (after=-1 → cursor only)
 *   POST   ?r=/rooms/{id}/status   {status}    viewer reports what it is doing
 *   GET    ?r=/rooms/{id}/status               remote reads it
 *   DELETE ?r=/rooms/{id}                      viewer closes the room / remote leaves
 *
 *   Live director's cut:
 *   POST   ?r=/shows               {key,title?}  director creates a show → code + director token
 *   POST   ?r=/shows/{code}/director {key}       director takes over an existing show
 *   POST   ?r=/shows/{code}/cue    {cam,subject?} director takes a shot (goes live)
 *   POST   ?r=/shows/{code}/live   {live}        director goes live / pauses the live cut
 *   GET    ?r=/shows/{code}&after=V&viewer=ID    viewers poll the current cue
 *   DELETE ?r=/shows/{code}                      director ends the show
 */

declare(strict_types=1);

require __DIR__ . '/config.php';
require __DIR__ . '/lib.php';

ini_set('display_errors', '0');

$cfg = $ES_CONFIG;
$show = $ES_SHOW;
$camIds = array_column($show['cams'], 'id');
$subjectIds = array_column($show['subjects'], 'id');

/* ---------- CORS ---------- */
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$cors = ['Vary' => 'Origin'];
if ($origin !== '' && in_array(rtrim($origin, '/'), $cfg['allowed_origins'], true)) {
    $cors += [
        'Access-Control-Allow-Origin' => $origin,
        'Access-Control-Allow-Methods' => 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers' => 'Content-Type, X-ES-Token, Authorization',
        'Access-Control-Max-Age' => '600',
    ];
}
foreach ($cors as $k => $v) header("$k: $v");
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$route = '/' . trim((string) ($_GET['r'] ?? ($_SERVER['PATH_INFO'] ?? '/')), '/');

try {
    if ($method === 'OPTIONS') es_send(204);

    /* ---------- routes that need no database ---------- */
    if ($route === '/config' && $method === 'GET') {
        es_send(200, [
            'title' => $show['title'], 'end' => $show['end'],
            'cams' => $show['cams'], 'subjects' => $show['subjects'],
            'settings' => ES_SETTINGS_PUBLIC,
            'poll_ms' => $cfg['poll_ms'],
            'director_enabled' => $cfg['director_key'] !== '',
        ]);
    }

    $db = es_db($cfg);
    if (random_int(1, 50) === 1) es_housekeeping($db, $cfg);

    if ($route === '/health') {
        if ($method !== 'GET') es_fail(405, 'method_not_allowed', 'Use GET.', null, ['Allow' => 'GET']);
        $db->query('SELECT 1')->fetchColumn();
        es_send(200, ['status' => 'ok', 'time' => es_now()]);
    }

    $parts = explode('/', trim($route, '/'));

    /* ================= rooms ================= */
    if ($parts[0] === 'rooms') {
        // POST /rooms
        if (count($parts) === 1) {
            if ($method !== 'POST') es_fail(405, 'method_not_allowed', 'Use POST.', null, ['Allow' => 'POST']);
            es_rate($db, $cfg, 'create');
            es_body();
            $id = bin2hex(random_bytes(8));
            for ($i = 0; ; $i++) {
                $code = es_random_code();
                try {
                    $db->prepare('INSERT INTO rooms (id, code, created, viewer_seen) VALUES (?, ?, ?, ?)')
                       ->execute([$id, $code, es_now(), es_now()]);
                    break;
                } catch (PDOException $e) {
                    if ($i >= 5) throw $e;   // code collision; try another
                }
            }
            $token = es_issue_token($db, $id, 'viewer');
            es_send(201, ['room' => $id, 'code' => $code, 'display_code' => es_display_code($code),
                          'token' => $token, 'poll_ms' => $cfg['poll_ms']]);
        }

        // POST /rooms/join
        if (count($parts) === 2 && $parts[1] === 'join') {
            if ($method !== 'POST') es_fail(405, 'method_not_allowed', 'Use POST.', null, ['Allow' => 'POST']);
            es_rate($db, $cfg, 'join');
            $body = es_body();
            $code = es_code_normalize($body['code'] ?? null);
            $st = $db->prepare('SELECT id, viewer_seen, created FROM rooms WHERE code = ?');
            $st->execute([$code]);
            $room = $st->fetch();
            if (!$room || $room['viewer_seen'] < es_now() - $cfg['room_idle_ttl'] || $room['created'] < es_now() - $cfg['room_max_age']) {
                es_fail(404, 'no_room', 'No viewer is using that code. Check the code shown in the program.', 'code');
            }
            $token = es_issue_token($db, $room['id'], 'remote');
            es_send(201, ['room' => $room['id'], 'code' => $code, 'display_code' => es_display_code($code),
                          'token' => $token, 'poll_ms' => $cfg['poll_ms']]);
        }

        $roomId = $parts[1] ?? '';
        if (!preg_match('/^[a-f0-9]{16}$/', $roomId)) es_fail(404, 'not_found', 'No such room.');
        $st = $db->prepare('SELECT * FROM rooms WHERE id = ?'); $st->execute([$roomId]);
        $room = $st->fetch();
        if (!$room) es_fail(404, 'room_closed', 'This viewer has disconnected. Ask for a new code.');
        $sub = $parts[2] ?? '';

        // DELETE /rooms/{id}
        if ($sub === '' && count($parts) === 2) {
            if ($method !== 'DELETE') es_fail(405, 'method_not_allowed', 'Use DELETE.', null, ['Allow' => 'DELETE']);
            es_rate($db, $cfg, 'write');
            $who = es_auth($db, $roomId, ['viewer', 'remote']);
            if ($who['role'] === 'viewer') {
                $db->prepare('DELETE FROM tokens WHERE scope = ?')->execute([$roomId]);
                $db->prepare('DELETE FROM rooms WHERE id = ?')->execute([$roomId]);
            } else {
                $db->prepare('DELETE FROM tokens WHERE hash = ?')->execute([$who['hash']]);
            }
            es_send(204);
        }

        if ($sub === 'commands' && count($parts) === 3) {
            if ($method === 'POST') {
                es_rate($db, $cfg, 'write');
                es_auth($db, $roomId, ['remote']);
                $cmd = es_validate_command(es_body(), $camIds, (float) $show['end']);
                $db->prepare('INSERT INTO commands (room, body, created) VALUES (?, ?, ?)')
                   ->execute([$roomId, json_encode($cmd), es_now()]);
                es_send(201, ['id' => (int) $db->lastInsertId(), 'viewer_online' => $room['viewer_seen'] >= es_now() - $cfg['viewer_online_s']]);
            }
            if ($method === 'GET') {
                es_rate($db, $cfg, 'read');
                es_auth($db, $roomId, ['viewer']);
                $db->prepare('UPDATE rooms SET viewer_seen = ? WHERE id = ?')->execute([es_now(), $roomId]);
                $after = filter_var($_GET['after'] ?? '-1', FILTER_VALIDATE_INT, ['options' => ['min_range' => -1]]);
                if ($after === false) es_fail(400, 'invalid_after', 'after must be a whole number.', 'after');
                $remotes = $db->prepare("SELECT COUNT(*) FROM tokens WHERE scope = ? AND role = 'remote' AND seen >= ?");
                $remotes->execute([$roomId, es_now() - 15]);
                $remoteCount = (int) $remotes->fetchColumn();
                if ($after === -1) {
                    $max = $db->prepare('SELECT COALESCE(MAX(id), 0) FROM commands WHERE room = ?'); $max->execute([$roomId]);
                    es_send(200, ['commands' => [], 'cursor' => (int) $max->fetchColumn(), 'remotes' => $remoteCount]);
                }
                $q = $db->prepare('SELECT id, body FROM commands WHERE room = ? AND id > ? AND created >= ? ORDER BY id LIMIT 50');
                $q->execute([$roomId, $after, es_now() - $cfg['command_ttl']]);
                $out = []; $cursor = $after;
                foreach ($q->fetchAll() as $r) { $out[] = ['id' => (int) $r['id']] + json_decode($r['body'], true); $cursor = (int) $r['id']; }
                es_send(200, ['commands' => $out, 'cursor' => $cursor, 'remotes' => $remoteCount]);
            }
            es_fail(405, 'method_not_allowed', 'Use GET or POST.', null, ['Allow' => 'GET, POST']);
        }

        if ($sub === 'status' && count($parts) === 3) {
            if ($method === 'POST') {
                es_rate($db, $cfg, 'write');
                es_auth($db, $roomId, ['viewer']);
                $status = es_validate_status(es_body()['status'] ?? null, $camIds, (float) $show['end']);
                $db->prepare('UPDATE rooms SET status = ?, status_at = ?, viewer_seen = ? WHERE id = ?')
                   ->execute([json_encode($status), es_now(), es_now(), $roomId]);
                es_send(204);
            }
            if ($method === 'GET') {
                es_rate($db, $cfg, 'read');
                es_auth($db, $roomId, ['viewer', 'remote']);
                $remotes = $db->prepare("SELECT COUNT(*) FROM tokens WHERE scope = ? AND role = 'remote' AND seen >= ?");
                $remotes->execute([$roomId, es_now() - 15]);
                es_send(200, [
                    'status' => $room['status'] ? json_decode($room['status'], true) : null,
                    'age' => $room['status_at'] ? es_now() - (int) $room['status_at'] : null,
                    'viewer_online' => $room['viewer_seen'] >= es_now() - $cfg['viewer_online_s'],
                    'remotes' => (int) $remotes->fetchColumn(),
                ]);
            }
            es_fail(405, 'method_not_allowed', 'Use GET or POST.', null, ['Allow' => 'GET, POST']);
        }
        es_fail(404, 'not_found', 'No such endpoint.');
    }

    /* ================= shows (live director's cut) ================= */
    if ($parts[0] === 'shows') {
        if (count($parts) === 1) {
            if ($method !== 'POST') es_fail(405, 'method_not_allowed', 'Use POST.', null, ['Allow' => 'POST']);
            es_rate($db, $cfg, 'director');
            $body = es_body();
            es_check_director_key($cfg, $body['key'] ?? null);
            $title = $body['title'] ?? $show['title'];
            if (!is_string($title)) es_fail(422, 'invalid_title', 'Title must be text.', 'title');
            $title = trim(preg_replace('/\s+/u', ' ', $title));
            if ($title === '' || mb_strlen($title) > 60 || preg_match('/[\p{Cc}\p{Cf}]/u', $title)) {
                es_fail(422, 'invalid_title', 'Title must be 1–60 characters.', 'title');
            }
            for ($i = 0; ; $i++) {
                $code = es_random_code();
                try {
                    $db->prepare('INSERT INTO shows (code, title, created, updated) VALUES (?, ?, ?, ?)')
                       ->execute([$code, $title, es_now(), es_now()]);
                    break;
                } catch (PDOException $e) { if ($i >= 5) throw $e; }
            }
            $token = es_issue_token($db, $code, 'director');
            es_send(201, ['code' => $code, 'display_code' => es_display_code($code), 'title' => $title, 'token' => $token]);
        }

        $code = es_code_normalize($parts[1]);
        $st = $db->prepare('SELECT * FROM shows WHERE code = ?'); $st->execute([$code]);
        $row = $st->fetch();
        if (!$row) es_fail(404, 'no_show', 'No live show with that code.', 'code');
        $sub = $parts[2] ?? '';

        if ($sub === '' && $method === 'GET') {
            es_rate($db, $cfg, 'read');
            $viewer = $_GET['viewer'] ?? '';
            if ($viewer !== '') {
                if (!is_string($viewer) || !preg_match('/^[A-Za-z0-9_-]{8,40}$/', $viewer)) es_fail(400, 'invalid_viewer', 'Bad viewer id.', 'viewer');
                $db->prepare('INSERT INTO show_viewers (show, viewer, seen) VALUES (?, ?, ?)
                              ON CONFLICT(show, viewer) DO UPDATE SET seen = excluded.seen')->execute([$code, $viewer, es_now()]);
            }
            $n = $db->prepare('SELECT COUNT(*) FROM show_viewers WHERE show = ? AND seen >= ?');
            $n->execute([$code, es_now() - 15]);
            es_send(200, [
                'code' => $code, 'display_code' => es_display_code($code), 'title' => $row['title'],
                'live' => (bool) $row['live'], 'ended' => (bool) $row['ended'],
                'version' => (int) $row['version'],
                'cue' => $row['cue'] ? json_decode($row['cue'], true) : null,
                'viewers' => (int) $n->fetchColumn(),
            ]);
        }
        if ($sub === '' && $method === 'DELETE') {
            es_rate($db, $cfg, 'write');
            es_auth($db, $code, ['director']);
            $db->prepare('UPDATE shows SET live = 0, ended = 1, version = version + 1, updated = ? WHERE code = ?')->execute([es_now(), $code]);
            es_send(204);
        }
        if ($sub === 'director' && $method === 'POST') {
            es_rate($db, $cfg, 'director');
            es_check_director_key($cfg, es_body()['key'] ?? null);
            $db->prepare('UPDATE shows SET ended = 0, updated = ? WHERE code = ?')->execute([es_now(), $code]);
            es_send(201, ['code' => $code, 'display_code' => es_display_code($code), 'title' => $row['title'],
                          'token' => es_issue_token($db, $code, 'director')]);
        }
        if ($sub === 'cue' && $method === 'POST') {
            es_rate($db, $cfg, 'write');
            es_auth($db, $code, ['director']);
            if ($row['ended']) es_fail(409, 'show_ended', 'This show has ended. Take it over again to restart it.');
            $body = es_body();
            $cam = es_enum($body['cam'] ?? null, 'cam', $camIds);
            $subject = es_enum($body['subject'] ?? 'wide', 'subject', $subjectIds);
            $cue = ['cam' => $cam, 'subject' => $subject, 'at' => es_now()];
            $db->prepare('UPDATE shows SET cue = ?, live = 1, version = version + 1, updated = ? WHERE code = ?')
               ->execute([json_encode($cue), es_now(), $code]);
            es_send(200, ['version' => (int) $row['version'] + 1, 'cue' => $cue, 'live' => true]);
        }
        if ($sub === 'live' && $method === 'POST') {
            es_rate($db, $cfg, 'write');
            es_auth($db, $code, ['director']);
            $live = es_bool(es_body()['live'] ?? null, 'live');
            $db->prepare('UPDATE shows SET live = ?, ended = 0, version = version + 1, updated = ? WHERE code = ?')
               ->execute([$live ? 1 : 0, es_now(), $code]);
            es_send(200, ['version' => (int) $row['version'] + 1, 'live' => $live]);
        }
        if (in_array($sub, ['', 'director', 'cue', 'live'], true)) es_fail(405, 'method_not_allowed', 'Method not allowed.');
        es_fail(404, 'not_found', 'No such endpoint.');
    }

    es_fail(404, 'not_found', 'No such endpoint.');
} catch (EsError $e) {
    $err = ['code' => $e->errCode, 'message' => $e->getMessage()];
    if ($e->field) $err['field'] = $e->field;
    es_send($e->status, ['error' => $err], $e->headers);
} catch (Throwable $e) {
    error_log('Every Seat API error: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    es_send(500, ['error' => ['code' => 'internal_error', 'message' => 'Something went wrong on the server.']]);
}
