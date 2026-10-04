// @title Bucket Gravity Filter Cartridge
// @category Water
// @material PETG (food-safe grade if possible)
// @print Grate down, flange up, 3 perimeters, no supports
// @summary A slotted-bottom tube that hangs in a 92mm hole cut in a bucket lid. Fill with layers of cloth, fine sand, crushed charcoal and gravel to clarify water before disinfecting it.
// @use Cut a 92mm hole in a bucket lid; the flange rests on it. Bottom to top: 2 layers of cloth over the grate, 3cm fine gravel, 5cm crushed charcoal (not ash), 5cm fine sand, cloth. Pour water in slowly. IMPORTANT: this removes dirt and some taste, it does NOT make water safe. Always boil, bleach or SODIS afterwards (see Water > Disinfection).

$fn = 96;
od = 90; wall = 3; h = 120; flange = 112;
difference() {
  union() {
    cylinder(d=od, h=h);
    translate([0,0,h-14]) cylinder(d1=od, d2=flange, h=(flange-od)/2);
    translate([0,0,h-14+(flange-od)/2]) cylinder(d=flange, h=3);
  }
  translate([0,0,3]) cylinder(d=od-2*wall, h=h+10);
  // grate slots
  for (x=[-36:5:36]) translate([x-1, -od/2, -1]) cube([2, od, 5]);
}
// grate cross-bars for strength (inside the tube only)
intersection() {
  cylinder(d=od-1, h=3);
  union() {
    translate([-od/2,-2,0]) cube([od,4,3]);
    translate([-od/2,-22,0]) cube([od,4,3]);
    translate([-od/2,18,0]) cube([od,4,3]);
  }
}
difference() { cylinder(d=od, h=3); cylinder(d=od-2*wall, h=3); }
