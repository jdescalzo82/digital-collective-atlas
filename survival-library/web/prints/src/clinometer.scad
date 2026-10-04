// @title Clinometer (slope & height finder)
// @category Navigation
// @material Any
// @print Flat, no supports
// @summary Quarter-circle inclinometer with a sighting tube. Measure slope angles (avalanche/landslide risk, drainage, roof pitch) and the height of trees, cliffs and buildings.
// @use Tie a thread with a small weight (nut, stone) through the corner hole. Sight the top of the object through the tube; pinch the thread and read the angle. Height = distance x tan(angle) + your eye height. At 45 deg the height equals your distance from the base.

$fn = 64;
R = 100; t = 4;
difference() {
  union() {
    intersection() {
      cylinder(r=R, h=t);
      translate([0,-R,0]) cube([R,R,t]);
    }
    translate([0,0,0]) cube([R, 8, t]);
    translate([0,4,4]) rotate([0,90,0]) cylinder(d=8, h=R);
  }
  translate([-1,4,4]) rotate([0,90,0]) cylinder(d=3.5, h=R+2);
  translate([6,-6,-1]) cylinder(d=2.5, h=t+2);
  for (d=[0:5:90]) {
    a = d - 90;
    rotate(a) translate([R-((d%10==0) ? 12 : 7), -0.4, t-0.8]) cube([20, 0.8, 2]);
    if (d%10==0) rotate(a) translate([R-19, 0, t-0.8]) linear_extrude(2)
      rotate(-a-90) text(str(d), size=4.5, halign="center", valign="center");
  }
  for (d=[1:89]) if (d%5!=0) rotate(d-90) translate([R-4, -0.25, t-0.6]) cube([10, 0.5, 2]);
}
