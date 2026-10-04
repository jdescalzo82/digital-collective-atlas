// @title Garden Trowel (socket for wooden handle)
// @category Hand Tools
// @material PETG or ABS preferred; PLA works for light soil
// @print 4 perimeters, 25% infill, no supports, 8mm brim (stands tip-down)
// @summary Scoop-shaped digging trowel. Push a 25mm stick into the socket and pin it with a screw or nail through the side hole.
// @use Cut a straight green or seasoned hardwood stick ~25mm diameter. Whittle the end until it is a tight push fit, then drive a small screw or nail through the side hole. For latrines, planting and fire pits.

blade_len = 120;   // tip to heel
blade_w   = 80;    // width at heel
depth     = 26;    // depth of scoop
wall      = 3.5;
handle_d  = 25.5;  // stick diameter + clearance
socket_len= 50;
$fn = 64;

module profile() {
  difference() {
    scale([blade_w/2, depth]) circle(1);
    offset(-wall) scale([blade_w/2, depth]) circle(1);
    translate([-blade_w, 0]) square([2*blade_w, 2*depth]);
  }
}
module scoop() {
  translate([0,0,blade_len]) mirror([0,0,1])
    linear_extrude(blade_len, scale=0.35) profile();
}
socket_od = handle_d + 2*4;
socket_z  = blade_len + 20;

difference() {
  union() {
    scoop();
    // solid reinforced tip
    intersection() {
      hull() scoop();
      translate([-50,-50,0]) cube([100,100,12]);
    }
    // heel / neck
    hull() {
      translate([-15,-depth,blade_len-30]) cube([30,wall+2,30]);
      translate([0,0,socket_z]) cylinder(d=socket_od, h=1);
    }
    translate([0,0,socket_z]) cylinder(d=socket_od, h=socket_len);
  }
  translate([0,0,socket_z+3]) cylinder(d=handle_d, h=socket_len);
  // pin hole
  translate([0,0,socket_z+socket_len-15]) rotate([0,90,0]) cylinder(d=4, h=socket_od+2, center=true);
}
