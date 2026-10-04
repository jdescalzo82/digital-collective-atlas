// @title Door / Lid Hinge (nail or bolt pin)
// @category Shelter
// @material PETG or ABS (outdoors), 50% infill
// @print Flat as oriented, no supports. Print 2 sets per door.
// @summary Two-leaf butt hinge for shelter doors, storage boxes, chicken coops, rabbit hutches and cold frames. The pin is any 4mm nail, bolt or stiff wire.
// @use Slide the leaves together, push a 4mm nail through the knuckles and bend over the end. Screw each leaf on with 4mm wood screws.

$fn = 48;
Lk = 12; n = 5; Wl = 36; t = 3.5; kd = 11;
module leaf(odd) {
  difference() {
    union() {
      translate([0, kd/2-0.1, 0]) cube([n*Lk, Wl, t]);
      for (i=[0:n-1]) if ((i%2==1) == odd)
        translate([i*Lk + (odd ? 0.3 : 0.3), 0, kd/2]) rotate([0,90,0]) cylinder(d=kd, h=Lk-0.6);
      for (i=[0:n-1]) if ((i%2==1) == odd)
        translate([i*Lk+0.3, 0, 0]) cube([Lk-0.6, kd/2+1, kd/2]);
    }
    // teardrop pin hole
    translate([-1,0,kd/2]) hull() { rotate([0,90,0]) cylinder(d=4.4, h=n*Lk+2); translate([0,-0.01,3]) cube([n*Lk+2,0.02,0.02]); }
    // clearance for the other leaf's knuckles
    for (i=[0:n-1]) if ((i%2==1) != odd) translate([i*Lk-0.3, -kd/2-1, -1]) cube([Lk+0.6, kd+1, kd+2]);
    for (x=[Lk*0.5, n*Lk/2, n*Lk-Lk*0.5]) translate([x, kd/2+Wl*0.6, -1]) { cylinder(d=4.4, h=t+2); translate([0,0,t-1.4]) cylinder(d1=4.4, d2=8.4, h=2.41); }
  }
}
leaf(false);
translate([0, -kd-6, 0]) mirror([0,1,0]) leaf(true);
