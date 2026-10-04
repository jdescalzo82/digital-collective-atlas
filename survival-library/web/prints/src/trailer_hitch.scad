// @title Bicycle Trailer Hitch (seat-post clamp)
// @category Transport
// @material Nylon, PETG or PC ONLY. 100% infill. Not PLA.
// @print Flat as oriented, no supports
// @summary Clamps to the seat post and gives a rearward tongue with a vertical 8mm pin hole. The trailer's tongue ends in a wooden or metal fork (clevis) and an 8mm bolt drops through both, letting the trailer swivel.
// @use Clamp below the saddle with two M5 bolts + nuts (clamp gap closes as you tighten). Hitch pin: M8 bolt with a nylock nut, or steel rod with a cotter pin. Wrap the clevis bolt in rubber (inner tube) so the trailer can pitch over bumps. Max ~25kg cargo; inspect before every trip for cracks or whitening. Ride slowly downhill.
// @variant 27.2mm post | -D post=27.2
// @variant 31.6mm post | -D post=31.6

post = 27.2; H = 32; $fn = 72;
R = post/2 + 7;
difference() {
  union() {
    cylinder(r=R, h=H);
    // clamp ears
    translate([-R-14, -9, 0]) cube([18, 18, H]);
    // tongue
    hull() {
      translate([R-6, -14, 0]) cube([1, 28, H]);
      translate([R+70, 0, 0]) cylinder(d=26, h=22);
    }
  }
  translate([0,0,-1]) cylinder(d=post+0.3, h=H+2);
  translate([-R-16, -1.5, -1]) cube([18, 3, H+2]);   // clamp slit
  for (z=[H*0.28, H*0.72]) translate([-R-6, 0, z]) rotate([90,0,0]) { cylinder(d=5.4, h=30, center=true); translate([0,0,9.5]) cylinder(d=9.5, h=5, $fn=6); }
  translate([R+70, 0, -1]) cylinder(d=8.4, h=40);    // hitch pin
}
