<?php
/*
 * Every Seat API — show data and settings.
 *
 * Secrets do NOT go here. Copy config.local.sample.php to config.local.php
 * on the server and set the director key there (that file is never committed).
 *
 * CAMS must match the CAMS list in ../index.html (same ids, same order).
 * tests/test_everyseat_api.py checks this.
 */

$ES_CONFIG = [
    // Where the SQLite database lives. Outside public_html is best; the
    // default folder is blocked from the web by api/data/.htaccess.
    'db_path'        => __DIR__ . '/data/everyseat.sqlite',

    // Required to create or take over a director's show. Empty = director mode off.
    'director_key'   => '',

    // Cross-origin browsers allowed to call the API (same-origin pages and
    // native apps don't need to be listed).
    'allowed_origins' => ['https://toolkityourlife.com', 'https://www.toolkityourlife.com'],

    // How long things live.
    'room_idle_ttl'    => 2 * 3600,   // a paired room closes after 2 h with no viewer
    'room_max_age'     => 24 * 3600,
    'command_ttl'      => 30,         // stale remote commands are dropped, never replayed later
    'show_idle_ttl'    => 12 * 3600,
    'viewer_online_s'  => 8,          // viewer counts as connected if seen within this many seconds
    'poll_ms'          => 1000,       // suggested polling interval for clients

    // Requests per minute per IP, per bucket.
    'rate' => ['read' => 240, 'write' => 90, 'join' => 10, 'create' => 20, 'director' => 10],
];

$ES_SHOW = [
    'title' => 'Every Angle',
    'end'   => 150,  // seconds
    'cams'  => [
        ['id' => 'front',   'key' => 1, 'name' => 'Front Row',        'sub' => 'Row A, centre aisle',        'group' => 'Audience',  'bts' => false, 'x' => 0,     'z' => 2.2],
        ['id' => 'mid',     'key' => 2, 'name' => 'Mid-House',        'sub' => 'Row H, centre aisle',        'group' => 'Audience',  'bts' => false, 'x' => 0,     'z' => 9],
        ['id' => 'balcony', 'key' => 3, 'name' => 'Balcony',          'sub' => 'Front rail, centre',         'group' => 'Audience',  'bts' => false, 'x' => 0,     'z' => 16.2],
        ['id' => 'stage',   'key' => 4, 'name' => 'On Stage',         'sub' => 'Between bass and drums',     'group' => 'Audience',  'bts' => false, 'x' => 0,     'z' => -6.2],
        ['id' => 'wings',   'key' => 5, 'name' => 'Stage-Left Wings', 'sub' => 'Crew and stage manager',     'group' => 'Backstage', 'bts' => true,  'x' => -11.2, 'z' => -5],
        ['id' => 'foh',     'key' => 6, 'name' => 'Mix Position',     'sub' => 'Front-of-house sound desk',  'group' => 'Backstage', 'bts' => true,  'x' => 4,     'z' => 12.6],
    ],
    // What a director's cue can frame. 'wide' = the camera's default angle.
    'subjects' => [
        ['id' => 'wide',   'name' => 'Wide'],
        ['id' => 'vocal',  'name' => 'Singer'],
        ['id' => 'guitar', 'name' => 'Guitar'],
        ['id' => 'keys',   'name' => 'Keys'],
        ['id' => 'bass',   'name' => 'Bass'],
        ['id' => 'drums',  'name' => 'Drums'],
    ],
];

if (is_file(__DIR__ . '/config.local.php')) {
    require __DIR__ . '/config.local.php';
}

// Environment overrides (used by the test suite and container deploys).
foreach (['db_path' => 'ES_DB_PATH', 'director_key' => 'ES_DIRECTOR_KEY'] as $k => $env) {
    $v = getenv($env);
    if ($v !== false && $v !== '') $ES_CONFIG[$k] = $v;
}
if (getenv('ES_RATE_SCALE')) {
    foreach ($ES_CONFIG['rate'] as $k => $v) $ES_CONFIG['rate'][$k] = (int) max(1, $v * (float) getenv('ES_RATE_SCALE'));
}
