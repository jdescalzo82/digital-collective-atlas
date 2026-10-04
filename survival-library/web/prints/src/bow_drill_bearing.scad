// @title Bow-Drill Bearing Block (608 bearing)
// @category Fire
// @material PETG or PLA
// @print Flat side down, 4 perimeters, 30% infill, no supports
// @summary Handhold for a bow drill fire set that uses a scavenged 608 skateboard/roller bearing, so the top of the spindle spins with almost no friction and all your effort goes into the hearth board.
// @use Press a 608 bearing (22mm OD, from skateboards, inline skates, fidget spinners) into the pocket. Carve the top of your spindle down to an 8mm peg that sits in the bearing's centre hole. See the Fire > Friction Fire article.

$fn = 72;
dia = 72; h = 26;
difference() {
  intersection() {
    cylinder(d=dia, h=h);
    translate([0,0,-40]) scale([1,1,1.15]) sphere(d=dia+40);
  }
  // 608 bearing pocket (opens on bed side)
  translate([0,0,-1]) cylinder(d=22.25, h=7.3+1);
  // clearance for spindle peg above bearing
  translate([0,0,7]) cylinder(d=12, h=4);
  // finger grips
  for (a=[0:60:359]) rotate(a) translate([dia/2+6,0,10]) scale([1,1,0.9]) sphere(d=18);
  // lanyard hole
  translate([0,0,h-8]) rotate([0,90,0]) translate([0,0,dia/2-14]) cylinder(d=5, h=20);
}
