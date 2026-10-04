// @title Bucket Pannier Hooks (bike rack)
// @category Transport
// @material PETG or Nylon, 100% infill
// @print Flat as oriented (profile on bed), no supports
// @summary Two top hooks + one lower anti-sway hook. Bolt them to a plastic bucket or box to make a waterproof bicycle pannier for carrying water, food and tools.
// @use Bolt through the bucket wall with M5 bolts, large washers inside. Space the top hooks to match your rack rails. The lower hook goes on an elastic cord to the lower rack strut so the bucket can't bounce off. Keep each pannier under ~10kg and load both sides evenly.
// @variant 10mm rail | -D rail=10
// @variant 12mm rail | -D rail=12

rail = 10; w = 22; $fn = 48;
module hook2d() {
  difference() {
    union() {
      translate([0,0]) square([6, 60]);                   // back plate
      translate([0,60]) square([rail+12, 6]);             // top
      translate([rail+6, 60-rail*0.9]) square([6, rail*0.9+6]); // front lip
    }
    translate([6+rail/2, 60-rail/2+0.01]) circle(d=rail+0.6);
  }
}
module hook() {
  difference() {
    linear_extrude(w) hook2d();
    for (y=[15, 42]) translate([-1, y, w/2]) rotate([0,90,0]) cylinder(d=5.4, h=8);
  }
}
hook();
translate([40,0,0]) hook();
// lower anti-sway hook
translate([80,0,0]) difference() {
  linear_extrude(w) union() { square([6,40]); translate([0,0]) square([20,6]); translate([14,0]) square([6,16]); }
  translate([-1, 28, w/2]) rotate([0,90,0]) cylinder(d=5.4, h=8);
}
