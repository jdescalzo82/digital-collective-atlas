// @title Ferro Rod Handle
// @category Fire
// @material PETG or PLA
// @print Upright, 4 perimeters, 30% infill
// @summary Ergonomic grip for a bare ferrocerium rod, with lanyard hole so the striker can be tied on.
// @use Glue or friction-fit the rod into the hole. Strike with the spine of a knife or a hacksaw blade, pushing the ROD BACK while holding the striker still on the tinder - this keeps the tinder bundle intact.
// @variant 8mm rod | -D rod=8
// @variant 10mm rod | -D rod=10
// @variant 12mm rod | -D rod=12

rod = 10; $fn = 48;
difference() {
  union() {
    cylinder(d=rod+12, h=70);
    for (z=[15:10:55]) translate([0,0,z]) cylinder(d=rod+15, h=3);
  }
  translate([0,0,70-28]) cylinder(d=rod+0.35, h=30);
  translate([0,0,8]) rotate([90,0,0]) cylinder(d=5, h=40, center=true);
}
