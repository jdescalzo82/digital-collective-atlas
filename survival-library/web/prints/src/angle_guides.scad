// @title Knife Sharpening Angle Guides
// @category Hand Tools
// @material Any
// @print Flat on bed, 3 perimeters
// @summary Three reference wedges (15, 20, 25 degrees) to set and hold a consistent edge angle on a stone, brick or concrete step.
// @use Lay the wedge on the stone, rest the blade flat on its slope, then slide the wedge away and keep that angle while stroking. 15-20 deg: kitchen/skinning knives. 25 deg: axes, machetes, hoes.

$fn=32;
angles = [15,20,25];
for (i=[0:2]) {
  a = angles[i];
  translate([0, i*28, 0]) difference() {
    rotate([90,0,0]) translate([0,0,-20]) linear_extrude(20) polygon([[0,0],[60,0],[60,60*tan(a)]]);
    // number engraved on the side face
    translate([40,0.8,1.5]) rotate([90,0,0]) linear_extrude(2) text(str(a), size=7, halign="center");
  }
}
