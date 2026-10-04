// @title Hand Winch / Windlass (drum, pawl, crank)
// @category Mechanical
// @material PETG or Nylon, 60%+ infill
// @print Drum: ratchet face down. Pawl and crank flat. No supports.
// @summary Ratcheting rope drum for hauling water buckets from wells, pulling carts up slopes, tensioning fences and lifting loads with a mechanical advantage of about 3:1 (crank radius / drum radius).
// @use Axle: a 15mm square wooden or steel bar through the drum's square hole, supported in two posts/blocks. Slide the crank onto the square end. Mount the pawl on a bolt beside the ratchet so it drops into the teeth - the load can't run back. Tie rope through the drum hole. Never stand under a suspended load.
// @variant drum | -D part="drum"
// @variant pawl | -D part="pawl"
// @variant crank | -D part="crank"

part = "drum";
sq = 15.4;    // square axle + clearance
$fn = 72;

module ratchet2d(r, n) {
  polygon([for (i=[0:n-1]) each [ [ (r-7)*cos(i*360/n), (r-7)*sin(i*360/n) ],
                                    [ r*cos((i+0.95)*360/n), r*sin((i+0.95)*360/n) ] ]]);
}
module drum() {
  difference() {
    union() {
      linear_extrude(8) ratchet2d(46, 24);
      cylinder(d=44, h=91);
      translate([0,0,8]) cylinder(d=80, h=4);             // bottom flange
      translate([0,0,70]) cylinder(d1=44, d2=80, h=18);   // 45 deg top flange (no supports)
      translate([0,0,88]) cylinder(d=80, h=3);
    }
    translate([0,0,-1]) linear_extrude(100) square(sq, center=true);
    translate([0,0,40]) rotate([90,0,0]) cylinder(d=7, h=60, center=true);  // rope anchor
  }
}
module pawl() {
  linear_extrude(8) difference() {
    hull() { circle(d=18); translate([46,8]) circle(d=6); }
    circle(d=8.4);
  }
}
module crank() {
  difference() {
    union() {
      hull() { cylinder(d=34, h=14); translate([120,0,0]) cylinder(d=24, h=10); }
      translate([120,0,0]) cylinder(d=22, h=80);
    }
    translate([0,0,-1]) linear_extrude(20) square(sq, center=true);
    translate([120,0,-1]) cylinder(d=8.4, h=90);  // M8 bolt through the handle for strength
  }
}
if (part=="drum") drum(); else if (part=="pawl") pawl(); else crank();
