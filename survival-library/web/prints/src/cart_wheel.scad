// @title Cart / Wheelbarrow Wheel (608 bearings, hose tyre)
// @category Transport
// @material PETG, ABS or Nylon, 6 perimeters, 40% infill
// @print Flat, no supports. 180mm version needs a 200x200mm bed.
// @summary Solid-web wheel for hand carts, wagons, wheelbarrows, bike trailers and game carts. Two 608 bearings ride on an 8mm bolt axle. A channel in the rim takes a split length of garden hose or bicycle tyre as a quiet, grippy tyre.
// @use Press a 608 bearing into each side. Axle: M8 bolt or 8mm steel rod, with an axle spacer between wheel and frame. Tyre: slit a piece of 1/2in garden hose (or old bike tyre) and stretch it into the rim channel, then wire or zip-tie the ends together through a spoke hole. Typical load ~25kg per wheel; use 4 wheels and keep loads low and centred.
// @variant 180mm | -D D=180
// @variant 125mm | -D D=125

D = 180; W = 36; rim = 9; web = 7;
$fn = 120;
difference() {
  union() {
    // hub
    cylinder(d=38, h=W);
    // web
    translate([0,0,W/2-web/2]) cylinder(d=D-2*rim, h=web);
    // rim with tyre channel (trapezoid, 45 deg walls)
    rotate_extrude() polygon([
      [D/2-rim-4, 0], [D/2, 0], [D/2, 6], [D/2-6, 12], [D/2-6, W-12], [D/2, W-6], [D/2, W], [D/2-rim-4, W]
    ]);
  }
  // bearing seats + centre lip
  translate([0,0,-1]) cylinder(d=22.25, h=8);
  translate([0,0,W-7]) cylinder(d=22.25, h=8);
  cylinder(d=12, h=W*3, center=true);
  // lightening holes / tie-down holes
  for (a=[0:60:359]) rotate(a) translate([(D/2-rim+19)/2+2, 0, -1])
    scale([1, 0.7, 1]) cylinder(d=(D/2-rim-19)*0.62, h=W+2);
}
