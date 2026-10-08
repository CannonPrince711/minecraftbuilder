// Abstract block vocabulary the agent chooses from (its action space).
export const AIR = 0;
export const FOUNDATION = 1;
export const WALL = 2;
export const PILLAR = 3;
export const WINDOW = 4;
export const DOOR = 5;
export const ROOF = 6;
export const N_BLOCKS = 7;
export const BLOCK_NAMES = ['air', 'foundation', 'wall', 'pillar', 'window', 'door', 'roof'];

// Cosmetic themes: map abstract blocks to Minecraft block ids (and preview colours).
// The RL policy decides *structure*; the theme only decides materials.
export const THEMES = {
  oak: {
    foundation: 'cobblestone', wall: 'oak_planks', pillar: 'oak_log', window: 'glass_pane',
    door: 'oak_door', roofFull: 'dark_oak_planks', roofStairs: 'dark_oak_stairs', roofSlab: 'dark_oak_slab',
    colors: ['#000', '#7d7d7d', '#b8945f', '#6b5232', '#bfe3ef', '#8a6a3c', '#4a3220'],
  },
  spruce: {
    foundation: 'stone_bricks', wall: 'spruce_planks', pillar: 'spruce_log', window: 'glass_pane',
    door: 'spruce_door', roofFull: 'deepslate_tiles', roofStairs: 'deepslate_tile_stairs', roofSlab: 'deepslate_tile_slab',
    colors: ['#000', '#8b8b8b', '#7a5a35', '#3d2b18', '#bfe3ef', '#5c4024', '#3a3a3f'],
  },
  birch: {
    foundation: 'stone', wall: 'birch_planks', pillar: 'birch_log', window: 'glass_pane',
    door: 'birch_door', roofFull: 'spruce_planks', roofStairs: 'spruce_stairs', roofSlab: 'spruce_slab',
    colors: ['#000', '#9a9a9a', '#d7cb8d', '#e8e4d6', '#bfe3ef', '#c9b77a', '#6e4f2e'],
  },
  desert: {
    foundation: 'cut_sandstone', wall: 'smooth_sandstone', pillar: 'chiseled_sandstone', window: 'glass_pane',
    door: 'jungle_door', roofFull: 'terracotta', roofStairs: 'red_sandstone_stairs', roofSlab: 'red_sandstone_slab',
    colors: ['#000', '#d9c88f', '#e3d7a3', '#cdb878', '#bfe3ef', '#a0703f', '#b5643a'],
  },
  cherry: {
    foundation: 'mud_bricks', wall: 'cherry_planks', pillar: 'stripped_cherry_log', window: 'glass_pane',
    door: 'cherry_door', roofFull: 'deepslate_tiles', roofStairs: 'deepslate_tile_stairs', roofSlab: 'deepslate_tile_slab',
    colors: ['#000', '#8f6b55', '#e8b8b4', '#d79a9a', '#bfe3ef', '#c98a88', '#3a3a3f'],
  },
};
export const THEME_NAMES = Object.keys(THEMES);
