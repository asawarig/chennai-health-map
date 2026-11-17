/* The OpenStreetMap areas the map covers, shared by every build script.
 *
 * Greater Chennai Corporation is one relation (1766358, admin_level 8), with
 * its 15 zones at admin_level 9 and 200 wards at 10. Tambaram and Avadi City
 * Municipal Corporations are not mapped in OSM as areas of their own, so their
 * taluks stand in for them: Tambaram and Pallavaram taluks (Chengalpattu
 * district; Pallavaram, with Chromepet and Pammal, was carved out of Tambaram
 * taluk and is a relation of its own) and Avadi taluk (Thiruvallur district).
 * Each taluk is a little larger than its
 * corporation (it takes in the panchayats round the edge), which only means the
 * map reaches slightly further than the corporations do.
 */
export const CITY_RELS = [
  1766358, // Greater Chennai Corporation
  10326121, // Tambaram taluk  } together these stand in for Tambaram City
  10326417, // Pallavaram taluk } Municipal Corporation (Chromepet, Pallavaram, Pammal are Pallavaram taluk)
  21492307, // Avadi taluk (stands in for Avadi City Municipal Corporation)
];
export const CITY_NAME = 'Chennai, Tambaram and Avadi (GCC and the Tambaram and Avadi corporations)';
export const CITY_SHORT = 'Chennai';
/* Prefix for new entry ids (CHN-0001…). */
export const ID_PREFIX = 'CHN';
