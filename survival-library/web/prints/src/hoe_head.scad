// @title Hoe Head
// @category Hand Tools
// @material PETG or ABS (PLA becomes brittle in sun)
// @print 5 perimeters, 40% infill, blade flat on bed, no supports
// @summary Weeding / furrowing hoe blade with an angled socket for a 25mm wooden handle.
// @use Fit a 1.2-1.5m straight stick (25mm). Pin through the side hole. Best for weeding and shallow furrows in worked soil, not for breaking hard ground.

blade_w = 140; blade_d = 70; blade_t = 6;
handle_d = 25.5; wall = 4.5; socket_len = 60; tilt = 25;
$fn = 60;
socket_od = handle_d + 2*wall;

module socket_solid(h) {
  translate([0,14,0]) rotate([tilt,0,0]) cylinder(d=socket_od, h=h);
}
intersection() {
  difference() {
    union() {
      // blade with bevelled front edge
      hull() {
        translate([-blade_w/2,0,0]) cube([blade_w, blade_d-12, blade_t]);
        translate([-blade_w/2+4,0,0]) cube([blade_w-8, blade_d, 1.2]);
      }
      // stiffening rib
      translate([-blade_w/2+10,6,0]) cube([blade_w-20, 6, blade_t+4]);
      hull() {
        translate([-28,0,0]) cube([56,34,blade_t]);
        socket_solid(28);
      }
      socket_solid(socket_len + 12);
    }
    translate([0,14,0]) rotate([tilt,0,0]) translate([0,0,14]) cylinder(d=handle_d, h=socket_len+20);
    translate([0,14,0]) rotate([tilt,0,0]) translate([0,0,socket_len-5]) rotate([0,90,0]) cylinder(d=4, h=socket_od+4, center=true);
  }
  translate([-200,-200,0]) cube([400,400,200]);
}
