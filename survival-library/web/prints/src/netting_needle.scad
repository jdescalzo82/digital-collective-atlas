// @title Net-Making Needle and Mesh Gauge
// @category Food & Fishing
// @material Any
// @print Flat, 3 perimeters, 100% infill (thin part)
// @summary Shuttle and gauge for knotting fishing nets, gill nets, cargo nets, hammocks and bags from cord or unraveled rope.
// @use Wind cord around the tongue and through the tail fork. Wrap each loop over the gauge so every mesh is the same size, tie with a sheet bend (netting knot). See Knots and Food > Fishing.
// @variant 25mm mesh | -D gauge=25
// @variant 40mm mesh | -D gauge=40

gauge = 25; t = 3; $fn = 40;
linear_extrude(t) {
  difference() {
    polygon([[0,-11],[150,-11],[182,0],[150,11],[0,11]]);
    hull() { translate([88,0]) circle(r=5); translate([150,0]) circle(r=4); }
    translate([-1,-4]) square([16,8]);
    translate([15,0]) circle(r=4);
  }
  hull() { translate([85,-2]) square([2,4]); translate([138,0]) circle(r=2); }
  // gauge
  translate([0,24]) offset(r=2) offset(delta=-2) square([120, gauge/2]);
}
