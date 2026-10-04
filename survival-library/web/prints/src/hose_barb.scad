// @title Hose Barb Connectors
// @category Water
// @material PETG or ABS, 100% infill
// @print Straight: upright. Tee: on its side with supports off (small overhangs).
// @summary Join or split flexible tubing for gravity water systems, rain-catchment, siphons and drip irrigation.
// @use Warm the tubing in hot water, push it over all three barbs, secure with wire or a hose clamp. Low pressure only (gravity / siphon).
// @variant 10mm straight | -D id=10 -D part="straight"
// @variant 13mm (1/2in) straight | -D id=13 -D part="straight"
// @variant 10mm tee | -D id=10 -D part="tee"
// @variant 13mm (1/2in) tee | -D id=13 -D part="tee"

id = 13; part = "straight";
$fn = 48;
bore = id*0.6;
module barbs() {
  for (i=[0:2]) translate([0,0,i*id*0.8]) cylinder(d1=id*1.15, d2=id*0.9, h=id*0.8);
}
module leg() { union() { barbs(); } }
if (part == "straight") {
  difference() {
    union() {
      leg();
      translate([0,0,id*2.4]) cylinder(d=id*1.3, h=6);
      translate([0,0,id*4.8+6]) mirror([0,0,1]) leg();
    }
    translate([0,0,-1]) cylinder(d=bore, h=id*5+10);
  }
} else {
  L = id*2.4;
  difference() {
    union() {
      translate([0,0,0]) leg();
      translate([0,0,L]) cylinder(d=id*1.3, h=id*1.4);
      translate([0,0,L+id*1.4+L]) mirror([0,0,1]) leg();
      translate([0,0,L+id*0.7]) rotate([0,90,0]) union() { cylinder(d=id*1.1, h=id*0.8); translate([0,0,id*0.6]) leg(); }
    }
    translate([0,0,-1]) cylinder(d=bore, h=2*L+id*1.4+2);
    translate([0,0,L+id*0.7]) rotate([0,90,0]) cylinder(d=bore, h=L+id);
  }
}
