// @title Floating Needle Compass
// @category Navigation
// @material Any
// @print Both parts flat, no supports. Float: 2 perimeters, 0% infill (the closed air pocket is modelled in)
// @summary Water-bowl compass with a direction ring and a hollow float that carries a magnetized sewing needle. Works with no batteries and no electronics.
// @use Magnetize a steel needle: stroke it 30-50 times in ONE direction with a magnet (speaker, motor, fridge magnet), or with silk/hair. Lay it in the float's groove, fill the bowl with water, float it in the centre away from metal. The needle settles N-S; check which end is north using the sun (shadow-stick method). Re-magnetize every few hours. See Navigation > Improvised Compass.

$fn = 96;
// bowl
difference() {
  union() {
    cylinder(d=100, h=3);
    cylinder(d=86, h=18);
  }
  translate([0,0,3]) cylinder(d=78, h=20);
  for (a=[0:10:359]) rotate(-a) translate([-0.4, 44, 2.2]) cube([0.8, (a%30==0) ? 5 : 3, 2]);
  for (i=[0:3]) rotate(-i*90) translate([0,46.5,2]) linear_extrude(2)
    text(["N","E","S","W"][i], size=3.5, halign="center", valign="bottom");
}
// direction lines on bowl floor
translate([-0.5,-36,3]) cube([1,72,0.6]);
translate([-36,-0.5,3]) cube([72,1,0.6]);
// float with sealed air cavity
translate([75,0,0]) difference() {
  cylinder(d=34, h=6);
  translate([0,0,1.2]) cylinder(d=30, h=3.6);
  translate([-20,-0.7,5.3]) cube([40,1.4,1]);
}
