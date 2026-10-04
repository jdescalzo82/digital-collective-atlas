// @title Axle Spacer & Washer Kit (8mm)
// @category Transport
// @material PETG or Nylon, 100% infill
// @print Upright, no supports
// @summary Spacer tubes (5, 10, 15, 20, 30mm) and washers for M8 axles. Use with the cart wheel, pulley and windlass so parts spin without rubbing.
// @use Slide onto the bolt between bearing inner race and frame. Spacers must touch only the bearing's INNER ring.

$fn = 48;
lens = [5,10,15,20,30];
for (i=[0:len(lens)-1]) translate([i*16,0,0]) difference() { cylinder(d=12.5, h=lens[i]); translate([0,0,-1]) cylinder(d=8.4, h=lens[i]+2); }
for (i=[0:5]) translate([i*20,22,0]) difference() { cylinder(d=17, h=1.6); translate([0,0,-1]) cylinder(d=8.4, h=4); }
