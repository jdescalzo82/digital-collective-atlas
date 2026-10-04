// @title Bicycle Tyre Levers (x3)
// @category Transport
// @material PETG or Nylon (PLA snaps)
// @print Flat, 100% infill
// @summary Lift a bicycle, cart or wheelbarrow tyre off the rim to fix a puncture without damaging the tube. The notch hooks onto a spoke to hold the first lever while you use the second.
// @use Deflate fully. Push the tyre bead into the rim's centre channel all round. Hook lever 1 under the bead opposite the valve, lever down and clip to a spoke. Insert lever 2 10cm along and slide it round. See Transport > Bicycle Repair.

$fn = 40;
module lever() {
  difference() {
    hull() {
      translate([0,0,0]) cylinder(d=18, h=5);
      translate([100,0,0]) cylinder(d=16, h=1.6);
    }
    // spoke hook
    translate([-2,-1.75,-1]) cube([10,3.5,8]);
    translate([8,0,-1]) cylinder(d=3.5, h=8);
  }
  // lip at the scoop end
  translate([104,0,0]) scale([0.5,1,1]) cylinder(d=16, h=3);
}
for (i=[0:2]) translate([0, i*22, 0]) lever();
