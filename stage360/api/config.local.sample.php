<?php
/*
 * Copy this file to config.local.php on the server (cPanel File Manager),
 * then set a long random director key. config.local.php is never committed
 * and is blocked from the web by api/.htaccess.
 *
 * Make a key on any computer with:  openssl rand -base64 24
 */

$ES_CONFIG['director_key'] = 'paste-a-long-random-key-here';

// Optional: keep the database outside public_html, e.g.
// $ES_CONFIG['db_path'] = '/home/YOUR_CPANEL_USER/everyseat-data/everyseat.sqlite';
