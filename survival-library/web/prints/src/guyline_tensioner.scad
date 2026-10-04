// @title Guyline Tensioners (x6)
// @category Shelter
// @material PETG (UV and cold resistant)
// @print Flat, 100% infill
// @summary Three-hole line adjusters for tarps, tents, clotheslines and lashings. Lets you tighten a line without re-tying knots.
// @use Tie the line to the first hole with a stopper knot, run it around the stake or tree, then back up through the middle hole and down through the far hole. Slide the tensioner to tighten - friction holds it. Fits 2-4mm cord.

$fn = 32;
for (i=[0:5]) translate([(i%3)*48, floor(i/3)*20, 0])
  linear_extrude(3.2) difference() {
    offset(r=3) square([36,10]);
    translate([5,5]) circle(d=4.6);
    translate([18,5]) circle(d=4.6);
    translate([31,5]) circle(d=4.6);
  }
