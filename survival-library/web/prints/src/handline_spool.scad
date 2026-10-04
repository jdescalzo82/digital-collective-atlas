// @title Fishing Handline Spool ("yo-yo" caster)
// @category Food & Fishing
// @material PETG or PLA
// @print Large flange down, no supports
// @summary Hand-held fishing reel: wind line on the drum, cast by pointing the conical lip at the target and letting line spiral off. No rod required.
// @use Tie the line through the slot, wind on 30-50m. To cast: hold spool in your off hand lip-forward, swing the weighted hook underhand and release. Rewind by hand. Keep hook stuck into the foam/cork in the centre hole.

$fn = 96;
difference() {
  union() {
    cylinder(d=100, h=4);
    cylinder(d=70, h=29);
    translate([0,0,29]) cylinder(d1=70, d2=84, h=7);
  }
  translate([0,0,-1]) cylinder(d=42, h=40);
  translate([0,0,22]) cylinder(d1=42, d2=60, h=15);
  // line tie slot
  translate([35,0,-1]) cube([12,2.5,10], center=false);
  translate([0,-48,-1]) cylinder(d=5, h=10);
}
