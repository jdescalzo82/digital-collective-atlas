<?php
// Pigment Lens: read the colors a public website uses.
//
//   site-colors.php?url=https://example.com   -> JSON: { title, colors: [{ hex, count }], images: [url] }
//   site-colors.php?image=https://...jpg      -> the image bytes (so the browser can analyse it)
//
// Browsers can't read other sites directly, so this small helper fetches the page,
// its stylesheets and its preview image on the visitor's behalf. It only fetches
// public http(s) addresses (never this server's own network), follows at most
// 3 redirects, and caps sizes and time.

header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, max-age=600');

const MAX_PAGE = 2000000;   // bytes
const MAX_CSS = 1000000;
const MAX_IMAGE = 6000000;
const MAX_STYLESHEETS = 6;

function fail($status, $message) {
  http_response_code($status);
  header('Content-Type: application/json');
  echo json_encode(['error' => $message]);
  exit;
}

// Resolve the host and refuse anything that isn't a public address.
function public_target($url) {
  $p = parse_url($url);
  if (!$p || !isset($p['scheme'], $p['host'])) return null;
  $scheme = strtolower($p['scheme']);
  if ($scheme !== 'http' && $scheme !== 'https') return null;
  $port = isset($p['port']) ? (int)$p['port'] : ($scheme === 'https' ? 443 : 80);
  if ($port !== 80 && $port !== 443) return null;
  $host = strtolower(trim($p['host'], '[]'));
  $ips = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : array_merge(
    gethostbynamel($host) ?: [],
    array_column(@dns_get_record($host, DNS_AAAA) ?: [], 'ipv6')
  );
  if (!$ips) return null;
  foreach ($ips as $ip) {
    if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) return null;
  }
  return ['host' => $host, 'port' => $port, 'ip' => $ips[0]];
}

// GET a public URL, re-checking every redirect hop. Returns [body, content-type, final url].
function fetch_public($url, $maxBytes, $accept) {
  for ($hop = 0; $hop <= 3; $hop++) {
    $t = public_target($url);
    if (!$t) fail(400, 'That address can’t be reached.');
    $body = '';
    $ch = curl_init($url);
    $ip = strpos($t['ip'], ':') !== false ? '[' . $t['ip'] . ']' : $t['ip'];
    curl_setopt_array($ch, [
      CURLOPT_RESOLVE => [$t['host'] . ':' . $t['port'] . ':' . $ip], // pin the checked IP
      CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
      CURLOPT_FOLLOWLOCATION => false,
      CURLOPT_CONNECTTIMEOUT => 5,
      CURLOPT_TIMEOUT => 10,
      CURLOPT_USERAGENT => 'PigmentLens/1.0 (+https://www.toolkityourlife.com/PigmentLens/)',
      CURLOPT_HTTPHEADER => ['Accept: ' . $accept],
      CURLOPT_ENCODING => '',
      CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$body, $maxBytes) {
        $body .= $chunk;
        return strlen($body) > $maxBytes ? 0 : strlen($chunk); // abort when too big
      },
    ]);
    curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $type = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $location = curl_getinfo($ch, CURLINFO_REDIRECT_URL);
    $err = curl_errno($ch);
    curl_close($ch);
    if ($status >= 300 && $status < 400 && $location) { $url = $location; continue; }
    if ($err && strlen($body) <= $maxBytes) fail(502, 'Couldn’t load that site. It may be offline or blocking automated visits.');
    if (strlen($body) > $maxBytes) fail(413, 'That page is too large to read.');
    if ($status < 200 || $status >= 300) fail(502, "That site answered with an error ($status).");
    return [$body, strtolower($type), $url];
  }
  fail(502, 'That site redirects too many times.');
}

function absolute_url($base, $rel) {
  $rel = trim(html_entity_decode($rel, ENT_QUOTES));
  if ($rel === '' || stripos($rel, 'data:') === 0 || stripos($rel, 'javascript:') === 0) return null;
  if (preg_match('#^https?://#i', $rel)) return $rel;
  $b = parse_url($base);
  $origin = $b['scheme'] . '://' . $b['host'] . (isset($b['port']) ? ':' . $b['port'] : '');
  if (strpos($rel, '//') === 0) return $b['scheme'] . ':' . $rel;
  if ($rel[0] === '/') return $origin . $rel;
  $dir = isset($b['path']) ? preg_replace('#/[^/]*$#', '/', $b['path']) : '/';
  return $origin . $dir . $rel;
}

// Count every color written in CSS: #hex, rgb()/rgba(), hsl()/hsla().
function collect_colors($css, &$counts) {
  $add = function ($r, $g, $b, $a = 1) use (&$counts) {
    if ($a < 0.35) return; // nearly transparent overlays don't read as a color
    $hex = sprintf('#%02x%02x%02x', max(0, min(255, round($r))), max(0, min(255, round($g))), max(0, min(255, round($b))));
    $counts[$hex] = ($counts[$hex] ?? 0) + 1;
  };
  preg_match_all('/#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/i', $css, $m);
  foreach ($m[1] as $h) {
    if (strlen($h) <= 4) $h = implode('', array_map(fn($c) => $c . $c, str_split($h)));
    $a = strlen($h) === 8 ? hexdec(substr($h, 6, 2)) / 255 : 1;
    $add(hexdec(substr($h, 0, 2)), hexdec(substr($h, 2, 2)), hexdec(substr($h, 4, 2)), $a);
  }
  $num = '\s*([\d.]+%?)\s*';
  $alpha = '(?:[,\/]\s*([\d.]+%?)\s*)?';
  $pct = fn($v, $max) => substr($v, -1) === '%' ? floatval($v) / 100 * $max : floatval($v);
  preg_match_all("/rgba?\($num,?$num,?$num$alpha\)/i", $css, $m, PREG_SET_ORDER);
  foreach ($m as $x) $add($pct($x[1], 255), $pct($x[2], 255), $pct($x[3], 255), isset($x[4]) && $x[4] !== '' ? $pct($x[4], 1) : 1);
  preg_match_all("/hsla?\(\s*([\d.]+)(?:deg)?\s*,?$num,?$num$alpha\)/i", $css, $m, PREG_SET_ORDER);
  foreach ($m as $x) {
    $h = fmod(floatval($x[1]), 360) / 360; $s = floatval($x[2]) / 100; $l = floatval($x[3]) / 100;
    $f = function ($n) use ($h, $s, $l) {
      $k = fmod($n + $h * 12, 12);
      return 255 * ($l - $s * min($l, 1 - $l) * max(-1, min($k - 3, 9 - $k, 1)));
    };
    $add($f(0), $f(8), $f(4), isset($x[4]) && $x[4] !== '' ? $pct($x[4], 1) : 1);
  }
}

// ---- image proxy ----
if (isset($_GET['image'])) {
  [$body, $type] = fetch_public((string)$_GET['image'], MAX_IMAGE, 'image/*');
  if (!preg_match('#^image/(png|jpe?g|gif|webp|avif)#', $type, $mt)) fail(415, 'That isn’t an image.');
  header('Content-Type: image/' . $mt[1]);
  echo $body;
  exit;
}

// ---- page colors ----
$url = trim((string)($_GET['url'] ?? ''));
if ($url === '') fail(400, 'Enter a website address.');
if (!preg_match('#^https?://#i', $url)) $url = 'https://' . $url;

[$html, $type, $final] = fetch_public($url, MAX_PAGE, 'text/html,application/xhtml+xml');
if (strpos($type, 'html') === false) fail(415, 'That address isn’t a web page.');

$counts = [];
$doc = new DOMDocument();
libxml_use_internal_errors(true);
$doc->loadHTML('<?xml encoding="utf-8"?>' . $html, LIBXML_NONET);
$title = trim($doc->getElementsByTagName('title')->item(0)->textContent ?? '');

foreach ($doc->getElementsByTagName('style') as $s) collect_colors($s->textContent, $counts);
$xp = new DOMXPath($doc);
foreach ($xp->query('//*[@style]') as $el) collect_colors($el->getAttribute('style'), $counts);
foreach ($xp->query('//*[@fill or @stroke or @color or @bgcolor]') as $el) {
  foreach (['fill', 'stroke', 'color', 'bgcolor'] as $a) collect_colors($el->getAttribute($a), $counts);
}
// The brand color the site declares for browsers counts extra.
foreach ($xp->query('//meta[@name="theme-color"]/@content') as $a) { $c = []; collect_colors($a->value, $c); foreach ($c as $h => $n) $counts[$h] = ($counts[$h] ?? 0) + 25; }

$sheets = 0;
foreach ($xp->query('//link[contains(concat(" ", normalize-space(@rel), " "), " stylesheet ")]/@href') as $href) {
  if ($sheets >= MAX_STYLESHEETS) break;
  $cssUrl = absolute_url($final, $href->value);
  if (!$cssUrl || !public_target($cssUrl)) continue;
  $sheets++;
  [$css] = fetch_public_soft($cssUrl, MAX_CSS, 'text/css'); // a failed stylesheet is skipped
  if ($css !== null) collect_colors($css, $counts);
}

$images = [];
foreach ($xp->query('//meta[@property="og:image" or @name="twitter:image" or @property="og:image:secure_url"]/@content') as $a) {
  $u = absolute_url($final, $a->value);
  if ($u && !in_array($u, $images, true)) $images[] = $u;
}

arsort($counts);
$colors = [];
foreach (array_slice($counts, 0, 60, true) as $hex => $n) $colors[] = ['hex' => $hex, 'count' => $n];

header('Content-Type: application/json');
echo json_encode(['url' => $final, 'title' => $title, 'colors' => $colors, 'images' => array_slice($images, 0, 2), 'stylesheets' => $sheets]);

// Like fetch_public, but returns [null] instead of ending the request on failure.
function fetch_public_soft($url, $maxBytes, $accept) {
  $t = public_target($url);
  if (!$t) return [null];
  $body = '';
  $ch = curl_init($url);
  $ip = strpos($t['ip'], ':') !== false ? '[' . $t['ip'] . ']' : $t['ip'];
  curl_setopt_array($ch, [
    CURLOPT_RESOLVE => [$t['host'] . ':' . $t['port'] . ':' . $ip],
    CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 4,
    CURLOPT_TIMEOUT => 6,
    CURLOPT_USERAGENT => 'PigmentLens/1.0 (+https://www.toolkityourlife.com/PigmentLens/)',
    CURLOPT_HTTPHEADER => ['Accept: ' . $accept],
    CURLOPT_ENCODING => '',
    CURLOPT_WRITEFUNCTION => function ($ch, $chunk) use (&$body, $maxBytes) {
      $body .= $chunk;
      return strlen($body) > $maxBytes ? 0 : strlen($chunk);
    },
  ]);
  curl_exec($ch);
  $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  curl_close($ch);
  return [$status >= 200 && $status < 300 ? $body : null];
}
