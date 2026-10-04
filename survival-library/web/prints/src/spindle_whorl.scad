// @title Drop-Spindle Whorl
// @category Textiles & Cordage
// @material PLA or PETG
// @print Flat side down, 100% infill for weight
// @summary Weight for a drop spindle - spin wool, plant fibre or recycled plastic bag strips into yarn and cord for clothing, nets, snares and rope.
// @use Push onto a straight 8mm dowel or carved stick ~30cm long, 5cm from the top. Cut a notch or add a small hook at the top. Heavier whorl = thicker yarn.
// @variant light 45mm | -D dia=45
// @variant heavy 70mm | -D dia=70

dia = 60; $fn = 96;
difference() {
  union() {
    cylinder(d=dia, h=6);
    translate([0,0,6]) scale([1,1,0.25]) sphere(d=dia);
  }
  translate([0,0,-1]) cylinder(d1=8.2, d2=7.9, h=40);
  translate([-50,-50,dia*0.12+6]) cube([100,100,50]);
}
