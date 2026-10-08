// Zones: what a cell of the lot is *for*. A structure type (src/structures/*.js)
// paints zones onto the lot; the agent learns which abstract block suits each zone
// from the reward table below. Add a zone here if a new structure needs a new idea.

export const Z_OUT = 0;      // outside the structure: keep empty
export const Z_FOUND = 1;    // ground layer / floor slab
export const Z_WALL = 2;     // wall: wall blocks, windows in the window band, a door on the front
export const Z_CORNER = 3;   // corner / column: pillars
export const Z_INTERIOR = 4; // must stay empty (rooms, openings, passages)
export const Z_ROOF = 5;     // exposed roof surface
export const Z_ATTIC = 6;    // hidden space under a roof: empty preferred
export const Z_GABLE = 7;    // triangular wall end under a gable roof
export const Z_BODY = 8;     // solid masonry (castle walls, lintels)
export const Z_STEP = 9;     // stepped outer surface (pyramids)
export const Z_CORE = 10;    // hidden inside of a solid mass: anything, empty is cheapest
export const Z_FLOOR = 11;   // upper floors and decks: wooden floor (roof block)
export const Z_MERLON = 12;  // battlement tooth: solid
export const Z_CRENEL = 13;  // battlement gap: empty
export const N_ZONES = 14;

export const ZONE_NAMES = ['out', 'foundation', 'wall', 'corner', 'interior', 'roof', 'attic', 'gable',
  'body', 'step', 'core', 'floor', 'merlon', 'crenel'];

// Base reward for placing [air, foundation, wall, pillar, window, door, roof] in each zone.
// Wall and gable zones (null) have extra rules for windows and doors in env.js.
export const ZONE_REWARD = [
  /* out      */[0, -1, -1, -1, -1, -1, -1],
  /* found    */[-0.5, 0.5, -0.2, -0.2, -0.2, -0.2, -0.2],
  /* wall     */null,
  /* corner   */[-0.8, -0.3, -0.3, 0.8, -0.5, -1, -0.3],
  /* interior */[0.1, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5],
  /* roof     */[-0.6, -0.4, -0.1, -0.4, -0.4, -0.4, 0.6],
  /* attic    */[0.1, -0.3, -0.3, -0.3, -0.3, -0.3, 0],
  /* gable    */null,
  /* body     */[-0.8, 0.1, 0.5, 0.2, -0.4, -1, 0.1],
  /* step     */[-0.8, 0.5, 0.2, 0, -0.5, -1, 0.1],
  /* core     */[0.1, 0, 0, -0.2, -0.3, -1, -0.1],
  /* floor    */[-0.6, 0.1, 0.1, -0.3, -0.5, -1, 0.6],
  /* merlon   */[-0.8, 0, 0.6, 0.3, -0.5, -1, -0.2],
  /* crenel   */[0.4, -0.5, -0.5, -0.5, -0.5, -1, -0.5],
];

const set = (...z) => { const a = new Uint8Array(N_ZONES); for (const k of z) a[k] = 1; return a; };
// Zones where left-right symmetry is rewarded.
export const VISIBLE = set(Z_WALL, Z_CORNER, Z_GABLE, Z_ROOF, Z_BODY, Z_STEP, Z_FLOOR, Z_MERLON, Z_CRENEL);
// Wall surfaces that count toward the window ratio.
export const WALLISH = set(Z_WALL, Z_CORNER, Z_GABLE);
// Trivial zones that are down-sampled during training.
export const EASY = set(Z_OUT, Z_INTERIOR, Z_ATTIC, Z_CORE);
