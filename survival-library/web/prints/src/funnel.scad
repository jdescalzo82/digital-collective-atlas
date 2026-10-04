// @title Funnel (with air-vent groove)
// @category Water
// @material PETG (food-safe grade if possible) or PLA
// @print Wide rim down, 3 perimeters, no supports
// @summary 120mm funnel for decanting water, fuel and grain. The groove on the spout lets air escape so bottles fill without glugging.
// @use Keep a separate funnel for fuel/chemicals and mark it. FDM prints have tiny crevices - for drinking water, sanitize with a bleach rinse before use.

$fn = 96;
top = 120; neck = 20; wall = 2; spout = 40;
cone_h = (top-neck)/2;
difference() {
  union() {
    cylinder(d=top+10, h=2.5);
    cylinder(d1=top, d2=neck, h=cone_h);
    translate([0,0,cone_h-0.01]) cylinder(d1=neck, d2=neck-4, h=spout);
    // hanging tab
    translate([top/2+2,-6,0]) cube([12,12,2.5]);
  }
  translate([0,0,-0.01]) cylinder(d1=top-2*wall*1.414, d2=neck-2*wall*1.414, h=cone_h);
  translate([0,0,cone_h-0.02]) cylinder(d1=neck-2*wall*1.414, d2=neck-4-2*wall, h=spout+0.05);
  translate([neck/2-3, -1.2, cone_h+2]) cube([4, 2.4, spout]);
  translate([top/2+8,0,-1]) cylinder(d=6, h=5);
}
