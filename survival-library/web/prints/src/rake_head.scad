// @title Garden Rake Head
// @category Hand Tools
// @material PETG or ABS
// @print 4 perimeters, 40% infill, flat on bed, no supports
// @summary 11-tine rake for leveling beds, gathering straw/leaves and covering seed. Socket takes a 25mm handle.
// @use Fit a 1.2-1.5m stick and pin it. For heavy work, lash a wooden batten behind the tines with wire or cord.

bar_w = 200; tines = 11; tine_len = 55; handle_d = 25.5; wall = 4.5;
$fn = 60;
socket_od = handle_d + 2*wall;

difference() {
  union() {
    translate([-bar_w/2,0,0]) cube([bar_w,16,14]);
    for (i=[0:tines-1]) {
      x = -bar_w/2 + 8 + i*(bar_w-16)/(tines-1);
      hull() {
        translate([x-3.5,8,0]) cube([7,8,10]);
        translate([x-1.5,16+tine_len-2,0]) cube([3,2,4]);
      }
    }
    hull() {
      translate([-25,0,0]) cube([50,16,14]);
      translate([0,6,0]) rotate([-15,0,0]) cylinder(d=socket_od, h=20);
    }
    translate([0,6,0]) rotate([-15,0,0]) cylinder(d=socket_od, h=65);
  }
  translate([0,6,0]) rotate([-15,0,0]) translate([0,0,12]) cylinder(d=handle_d, h=70);
  translate([0,6,0]) rotate([-15,0,0]) translate([0,0,52]) rotate([0,90,0]) cylinder(d=4, h=60, center=true);
  translate([-300,-300,-100]) cube([600,600,100]);
}
