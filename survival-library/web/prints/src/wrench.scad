// @title Open-End Wrench (double ended)
// @category Hand Tools
// @material PETG, Nylon or PC; 100% infill
// @print 100% infill, flat on bed, no supports
// @summary Double open-end spanner, 15 degree offset jaws. Printed wrenches are for light/moderate torque - bike racks, cart axles, furniture, stuck plumbing fittings.
// @use Snug the jaws fully onto the flats before turning. If the plastic flexes, stop - use a longer lever on a metal tool instead.
// @variant 8-10mm | -D s1=8 -D s2=10
// @variant 10-13mm | -D s1=10 -D s2=13
// @variant 13-17mm | -D s1=13 -D s2=17
// @variant 17-19mm | -D s1=17 -D s2=19

s1 = 10; s2 = 13; thick = 7;
$fn = 48;
len = 5*(s1+s2) + 55;

// jaw opening for an s-mm nut, pointing along angle a
module jaw(s, a) {
  rotate(a) union() {
    translate([-s*0.2, -(s+0.3)/2]) square([s*3, s+0.3]);
    circle(d=s+0.3);
  }
}
linear_extrude(thick) difference() {
  union() {
    circle(d=s1*2.3+6);
    translate([len,0]) circle(d=s2*2.3+6);
    hull() {
      translate([s1*0.8,0]) circle(d=s1*1.1+8);
      translate([len-s2*0.8,0]) circle(d=s2*1.1+8);
    }
  }
  jaw(s1, 180+15);                    // opens away from the handle, 15 deg offset
  translate([len,0]) jaw(s2, -15);
  translate([len/2,0]) circle(d=5);   // hang hole
}
