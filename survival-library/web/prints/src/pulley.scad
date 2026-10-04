// @title Pulley Sheave and Block Plates (608 bearings)
// @category Mechanical
// @material PETG, Nylon or ABS, 60%+ infill
// @print Sheave flat (V-groove prints without supports). Plates flat. Print 1 sheave + 2 plates per block.
// @summary Rope pulley for hoisting, block-and-tackle, clotheslines and well buckets. Runs on two 608 bearings (scavenged from skateboards/rollerblades) on an 8mm bolt.
// @use Press a 608 bearing into each side of the sheave. Sandwich between two plates with an M8 bolt as axle; use washers/spacers so the sheave spins freely. Bolts through the top and bottom holes, with spacer tubes (axle_spacers) between the plates, keep the plates parallel. Hang from the top bolt; tie the rope's dead end to the bottom (becket) hole for a 2:1 or 3:1 system. Rope 6-10mm. Light loads only (~50kg per block); never use for climbing or lifting people.
// @variant sheave | -D part="sheave"
// @variant side plate | -D part="plate"

part = "sheave";
$fn = 96;
D = 64; W = 18; rope = 10;
module sheave() {
  difference() {
    cylinder(d=D, h=W);
    // V groove
    rotate_extrude() polygon([[D/2-rope*0.75, W/2], [D/2+1, W/2-rope*0.75-1], [D/2+1, W/2+rope*0.75+1]]);
    // bearing seats
    translate([0,0,-1]) cylinder(d=22.25, h=7+1);
    translate([0,0,W-7]) cylinder(d=22.25, h=8);
    cylinder(d=13, h=W*3, center=true);
  }
}
module plate() {
  linear_extrude(5) difference() {
    hull() { circle(d=D+10); translate([0,D/2+18]) circle(d=26); translate([0,-D/2-12]) circle(d=18); }
    circle(d=8.4);
    translate([0,D/2+18]) circle(d=10.4);
    translate([0,-D/2-12]) circle(d=6.4);
  }
}
if (part=="sheave") sheave(); else plate();
