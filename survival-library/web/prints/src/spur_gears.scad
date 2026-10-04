// @title Involute Spur Gears (module 2)
// @category Mechanical
// @material PETG, Nylon or ABS, 50%+ infill
// @print Flat, no supports
// @summary Meshing spur gears for hand-crank mechanisms: grain mills, winches, pumps, pedal/crank generators, drills. All share module 2 and 20 deg pressure angle so any two mesh.
// @use Mount on 8mm bolts or threaded rod; the hex pocket traps an M8 nut so the gear turns with the rod. Centre distance between two gears = (teeth A + teeth B) mm (for module 2). 15T driving 45T = 3x torque, 1/3 speed. Lubricate with grease, soap or tallow.
// @variant 15 teeth | -D teeth=15
// @variant 30 teeth | -D teeth=30
// @variant 45 teeth | -D teeth=45

teeth = 30; mod = 2; thick = 10; pa = 20;
$fn = 64;

function inv(rb, t) = rb * [cos(t*180/PI) + t*sin(t*180/PI), sin(t*180/PI) - t*cos(t*180/PI)];
function rot(p, a) = [p[0]*cos(a) - p[1]*sin(a), p[0]*sin(a) + p[1]*cos(a)];

module gear2d(z, m) {
  rp = m*z/2; rb = rp*cos(pa); ra = rp + m; rf = rp - 1.25*m;
  tmax = sqrt(pow(ra/rb,2) - 1);
  hb = 90/z + (tan(pa) - pa*PI/180)*180/PI;   // half tooth angle at base circle
  steps = 10;
  lower = [for (i=[0:steps]) rot(inv(rb, tmax*i/steps), -hb)];
  upper = [for (i=[steps:-1:0]) let(p = rot(inv(rb, tmax*i/steps), -hb)) [p[0], -p[1]]];
  union() {
    circle(r=rf);
    for (k=[0:z-1]) rotate(k*360/z) polygon(concat([[0,0]], lower, upper));
  }
}
difference() {
  linear_extrude(thick) gear2d(teeth, mod);
  translate([0,0,-1]) cylinder(d=8.3, h=thick+2);
  translate([0,0,thick-6.6]) cylinder(d=13.3/cos(30), h=7, $fn=6);
  if (teeth >= 30) for (a=[0:60:359]) rotate(a) translate([teeth*mod*0.27,0,-1]) cylinder(d=teeth*mod*0.17, h=thick+2);
}
