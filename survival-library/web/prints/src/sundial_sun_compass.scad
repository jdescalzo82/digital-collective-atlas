// @title Sundial / Sun Compass (latitude-specific)
// @category Navigation
// @material Any (PETG or ASA if left outdoors)
// @print Flat, no supports. Print the variant closest to your latitude.
// @summary Horizontal sundial. Tells local SOLAR time when aligned to north, or finds NORTH when you know the solar time. Hour lines are calculated for the latitude printed on it.
// @use As a clock: set it level with the tall end of the gnomon pointing to true north (south in the southern hemisphere); read the shadow. As a compass: hold level, rotate until the shadow falls on the current solar time; the gnomon now points to the pole. Solar time differs from clock time by longitude, daylight saving, and up to +/-16 minutes through the year (see Navigation > Sun & Stars).
// @variant 15N | -D lat=15
// @variant 25N | -D lat=25
// @variant 35N | -D lat=35
// @variant 45N | -D lat=45
// @variant 55N | -D lat=55
// @variant 25S | -D lat=-25
// @variant 35S | -D lat=-35

lat = 40;
R = 62; t = 4; $fn = 96;
alat = abs(lat);
south = lat < 0;
dir = south ? -1 : 1; // southern dial: gnomon points south, hours run the other way

module dial() {
  difference() {
    cylinder(r=R+6, h=t);
    for (h=[-6:6]) {
      a = (abs(h)==6) ? 90*sign(h) : atan(sin(alat)*tan(15*h));
      rotate(-a*dir) translate([-0.6, 8, t-1]) cube([1.2, R-14, 2]);
      rotate(-a*dir) translate([0, R-1, t-1]) linear_extrude(2)
        rotate(a*dir) text(str(12+h), size=5.5, halign="center", valign="center");
    }
    for (h=[-5.5:1:5.5]) {
      a = atan(sin(alat)*tan(15*h));
      rotate(-a*dir) translate([-0.4, R-20, t-0.8]) cube([0.8, 8, 2]);
    }
    translate([0,-R+6,t-1]) linear_extrude(2) text(str(alat, south ? "S" : "N"), size=7, halign="center");
    translate([0,R+1,t-1]) linear_extrude(2) text(south ? "S" : "N", size=4, halign="center", valign="center");
  }
  // gnomon: style angle = latitude
  translate([-1.5,6,t-0.01]) rotate([90,0,90]) linear_extrude(3)
    polygon([[0,0],[R-12,0],[R-12,(R-12)*tan(alat)]]);
}
// +y (tall end of gnomon) points to the visible celestial pole.
// North: east = +x, afternoon lines on the right. South: east = -x.
dial();
