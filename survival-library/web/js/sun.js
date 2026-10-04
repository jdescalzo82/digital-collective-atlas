/* Sun position (NOAA solar calculator equations). Accurate to well under 1 degree.
   Sun.position(date, lat, lon) -> { azimuth, elevation, decl, eot, solarTimeMin }
   Sun.times(date, lat, lon)    -> { noon, sunrise, sunset } as Date objects (or null) */
(function () {
  var rad = Math.PI / 180, deg = 180 / Math.PI;

  function core(date) {
    var jd = date.getTime() / 86400000 + 2440587.5;
    var T = (jd - 2451545) / 36525;
    var L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
    var M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    var C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
      Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
    var omega = 125.04 - 1934.136 * T;
    var lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * rad);
    var eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    var eps = eps0 + 0.00256 * Math.cos(omega * rad);
    var decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad)) * deg;
    var y = Math.pow(Math.tan(eps * rad / 2), 2);
    var eot = 4 * deg * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) +
      4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) -
      0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad));
    return { decl: decl, eot: eot };
  }

  function position(date, lat, lon) {
    var c = core(date);
    var utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
    var tst = ((utcMin + c.eot + 4 * lon) % 1440 + 1440) % 1440;
    var H = tst / 4 - 180;
    var phi = lat * rad, d = c.decl * rad, h = H * rad;
    var cosZ = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(h);
    cosZ = Math.max(-1, Math.min(1, cosZ));
    var elev = 90 - Math.acos(cosZ) * deg;
    var az = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(d) * Math.cos(phi)) * deg + 180;
    // simple refraction correction near the horizon
    if (elev > -0.575) elev += 1.02 / Math.tan((elev + 10.3 / (elev + 5.11)) * rad) / 60;
    return { azimuth: (az + 360) % 360, elevation: elev, decl: c.decl, eot: c.eot, solarTimeMin: tst };
  }

  function times(date, lat, lon) {
    // noon of the local calendar day, in UTC
    var day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    var c = core(new Date(day + 12 * 3600000 - lon * 240000));
    var noonMin = 720 - 4 * lon - c.eot;
    var phi = lat * rad, d = c.decl * rad;
    var x = Math.cos(90.833 * rad) / (Math.cos(phi) * Math.cos(d)) - Math.tan(phi) * Math.tan(d);
    var out = { noon: new Date(day + noonMin * 60000), sunrise: null, sunset: null, polar: null };
    if (x > 1) out.polar = "night"; else if (x < -1) out.polar = "day";
    else {
      var ha = Math.acos(x) * deg;
      out.sunrise = new Date(day + (noonMin - 4 * ha) * 60000);
      out.sunset = new Date(day + (noonMin + 4 * ha) * 60000);
    }
    return out;
  }

  window.Sun = { position: position, times: times };
})();
