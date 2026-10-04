// @title Tube Frame Connectors (PVC / conduit / poles)
// @category Transport
// @material PETG or ABS, 5 perimeters, 40% infill
// @print Flat, no supports (horizontal sockets use teardrop bores)
// @summary Tee, elbow, cross, 3-way corner and 4-way side-outlet connectors for building cart frames, stretchers, greenhouse/shelter frames, drying racks, and bed frames from PVC pipe, electrical conduit, bamboo or straight poles.
// @use Push tubes in fully; drill through each pin hole into the tube and fit a screw, nail or bolt so joints can't pull apart. 21.3mm = 1/2in PVC Sch.40; 26.7mm = 3/4in PVC. Change tube_od in the .scad file for other sizes (measure with a ruler: +0.4mm clearance is added).
// @variant tee 21.3 | -D od=21.3 -D part="tee"
// @variant elbow 21.3 | -D od=21.3 -D part="elbow"
// @variant cross 21.3 | -D od=21.3 -D part="cross"
// @variant corner3 21.3 | -D od=21.3 -D part="corner3"
// @variant sidetee 21.3 | -D od=21.3 -D part="sidetee"
// @variant tee 26.7 | -D od=26.7 -D part="tee"
// @variant elbow 26.7 | -D od=26.7 -D part="elbow"
// @variant cross 26.7 | -D od=26.7 -D part="cross"
// @variant corner3 26.7 | -D od=26.7 -D part="corner3"
// @variant sidetee 26.7 | -D od=26.7 -D part="sidetee"

od = 21.3; part = "tee";
wall = 4; depth = 30;
$fn = 64;
b = od + 0.4;          // bore
S = b + 2*wall;        // outer square size
L = S/2 + depth;       // arm length from centre

// horizontal arm along +x, sits flat on the bed (z from 0 to S)
module arm_h() { translate([0,-S/2,0]) cube([L, S, S]); }
module bore_h() {
  // teardrop bore, tip clipped flat so it never breaks through the top wall
  translate([S/2, 0, S/2]) intersection() {
    hull() {
      rotate([0,90,0]) cylinder(d=b, h=depth+1);
      translate([0,-0.01,b/2*1.414-0.01]) cube([depth+1, 0.02, 0.02]);
    }
    translate([0,-b,-b]) cube([depth+1, 2*b, b + b/2 + 1.5]);
  }
  translate([S/2+depth/2, 0, -1]) cylinder(d=4.5, h=S+2);   // pin hole
}
module arm_v() { translate([-S/2,-S/2,0]) cube([S, S, L+S/2]); }
module bore_v() {
  translate([0,0,S]) cylinder(d=b, h=depth+1);
  translate([0,0,S+depth/2]) rotate([90,0,0]) cylinder(d=4.5, h=S+2, center=true);
}
dirs = (part=="tee")     ? [0,180,90]   :
       (part=="elbow")   ? [0,90]       :
       (part=="cross")   ? [0,90,180,270] :
       (part=="corner3") ? [0,90]       :
       (part=="sidetee") ? [0,180,90]   : [0,180];
vert = (part=="corner3" || part=="sidetee");

difference() {
  union() {
    translate([-S/2,-S/2,0]) cube([S,S,S]);
    for (a=dirs) rotate(a) arm_h();
    if (vert) arm_v();
  }
  for (a=dirs) rotate(a) bore_h();
  if (vert) bore_v();
}
