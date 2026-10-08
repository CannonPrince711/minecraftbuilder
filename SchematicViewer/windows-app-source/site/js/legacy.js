/* Pre-1.13 numeric block IDs (MCEdit / Schematica .schematic, Minecraft 1.12.2 and older)
   converted to modern (1.13+) block state names, so every format renders the same way. */
(function (root) {
  'use strict';
  var COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  var WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'];
  var STAIR_FACING = ['east', 'west', 'south', 'north'];
  var DOOR_FACING = ['east', 'south', 'west', 'north'];
  var AXIS = ['y', 'x', 'z', 'y'];

  function pick(list, d, fallback) { return list[d] !== undefined ? list[d] : (fallback || list[0]); }
  function stairs(name) { return function (d) { return [name, { facing: STAIR_FACING[d & 3], half: d & 4 ? 'top' : 'bottom' }]; }; }
  function slab(names, dbl) { return function (d) { return [pick(names, d & 7), { type: dbl ? 'double' : (d & 8 ? 'top' : 'bottom') }]; }; }
  function door(name) { return function (d) { return [name, { half: d & 8 ? 'upper' : 'lower', facing: d & 8 ? 'north' : DOOR_FACING[d & 3] }]; }; }
  function colored(suffix) { return function (d) { return [COLORS[d & 15] + '_' + suffix, {}]; }; }
  function plain(name) { return function () { return [name, {}]; }; }

  var STONE_SLABS = ['smooth_stone_slab', 'sandstone_slab', 'petrified_oak_slab', 'cobblestone_slab', 'brick_slab', 'stone_brick_slab', 'nether_brick_slab', 'quartz_slab'];
  var WOOD_SLABS = WOODS.map(function (w) { return w + '_slab'; });

  var T = {};
  function def(id, v) { T[id] = typeof v === 'string' ? plain(v) : v; }

  def(0, 'air');
  def(1, function (d) { return [pick(['stone', 'granite', 'polished_granite', 'diorite', 'polished_diorite', 'andesite', 'polished_andesite'], d), {}]; });
  def(2, 'grass_block');
  def(3, function (d) { return [pick(['dirt', 'coarse_dirt', 'podzol'], d), {}]; });
  def(4, 'cobblestone');
  def(5, function (d) { return [pick(WOODS, d) + '_planks', {}]; });
  def(6, function (d) { return [pick(WOODS, d & 7) + '_sapling', {}]; });
  def(7, 'bedrock');
  def(8, 'water'); def(9, 'water'); def(10, 'lava'); def(11, 'lava');
  def(12, function (d) { return [d === 1 ? 'red_sand' : 'sand', {}]; });
  def(13, 'gravel'); def(14, 'gold_ore'); def(15, 'iron_ore'); def(16, 'coal_ore');
  def(17, function (d) { return [WOODS[d & 3] + ((d & 12) === 12 ? '_wood' : '_log'), { axis: AXIS[(d >> 2) & 3] }]; });
  def(18, function (d) { return [WOODS[d & 3] + '_leaves', {}]; });
  def(19, function (d) { return [d === 1 ? 'wet_sponge' : 'sponge', {}]; });
  def(20, 'glass'); def(21, 'lapis_ore'); def(22, 'lapis_block'); def(23, 'dispenser');
  def(24, function (d) { return [pick(['sandstone', 'chiseled_sandstone', 'cut_sandstone'], d), {}]; });
  def(25, 'note_block');
  def(26, function (d) { return ['red_bed', { part: d & 8 ? 'head' : 'foot', facing: ['south', 'west', 'north', 'east'][d & 3] }]; });
  def(27, 'powered_rail'); def(28, 'detector_rail'); def(29, 'sticky_piston'); def(30, 'cobweb');
  def(31, function (d) { return [pick(['dead_bush', 'short_grass', 'fern'], d, 'short_grass'), {}]; });
  def(32, 'dead_bush'); def(33, 'piston'); def(34, 'piston_head');
  def(35, colored('wool'));
  def(36, 'moving_piston'); def(37, 'dandelion');
  def(38, function (d) { return [pick(['poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy'], d), {}]; });
  def(39, 'brown_mushroom'); def(40, 'red_mushroom'); def(41, 'gold_block'); def(42, 'iron_block');
  def(43, function (d) { return d === 8 ? ['smooth_stone', {}] : (d === 9 ? ['smooth_sandstone', {}] : slab(STONE_SLABS, true)(d)); });
  def(44, slab(STONE_SLABS, false));
  def(45, 'bricks'); def(46, 'tnt'); def(47, 'bookshelf'); def(48, 'mossy_cobblestone'); def(49, 'obsidian');
  def(50, function (d) { return d === 5 || d === 0 ? ['torch', {}] : ['wall_torch', { facing: ['', 'east', 'west', 'south', 'north'][d] || 'north' }]; });
  def(51, 'fire'); def(52, 'spawner'); def(53, stairs('oak_stairs')); def(54, 'chest'); def(55, 'redstone_wire');
  def(56, 'diamond_ore'); def(57, 'diamond_block'); def(58, 'crafting_table'); def(59, 'wheat'); def(60, 'farmland');
  def(61, 'furnace'); def(62, 'furnace'); def(63, 'oak_sign'); def(64, door('oak_door')); def(65, 'ladder'); def(66, 'rail');
  def(67, stairs('cobblestone_stairs')); def(68, 'oak_wall_sign'); def(69, 'lever'); def(70, 'stone_pressure_plate');
  def(71, door('iron_door')); def(72, 'oak_pressure_plate'); def(73, 'redstone_ore'); def(74, 'redstone_ore');
  def(75, 'redstone_torch'); def(76, 'redstone_torch'); def(77, 'stone_button');
  def(78, function (d) { return ['snow', { layers: String((d & 7) + 1) }]; });
  def(79, 'ice'); def(80, 'snow_block'); def(81, 'cactus'); def(82, 'clay'); def(83, 'sugar_cane'); def(84, 'jukebox');
  def(85, 'oak_fence'); def(86, 'carved_pumpkin'); def(87, 'netherrack'); def(88, 'soul_sand'); def(89, 'glowstone');
  def(90, 'nether_portal'); def(91, 'jack_o_lantern'); def(92, 'cake'); def(93, 'repeater'); def(94, 'repeater');
  def(95, colored('stained_glass'));
  def(96, function (d) { return ['oak_trapdoor', { half: d & 8 ? 'top' : 'bottom', open: d & 4 ? 'true' : 'false' }]; });
  def(97, function (d) { return [pick(['infested_stone', 'infested_cobblestone', 'infested_stone_bricks', 'infested_mossy_stone_bricks', 'infested_cracked_stone_bricks', 'infested_chiseled_stone_bricks'], d), {}]; });
  def(98, function (d) { return [pick(['stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks', 'chiseled_stone_bricks'], d), {}]; });
  def(99, 'brown_mushroom_block'); def(100, 'red_mushroom_block'); def(101, 'iron_bars'); def(102, 'glass_pane');
  def(103, 'melon'); def(104, 'pumpkin_stem'); def(105, 'melon_stem'); def(106, 'vine'); def(107, 'oak_fence_gate');
  def(108, stairs('brick_stairs')); def(109, stairs('stone_brick_stairs')); def(110, 'mycelium'); def(111, 'lily_pad');
  def(112, 'nether_bricks'); def(113, 'nether_brick_fence'); def(114, stairs('nether_brick_stairs')); def(115, 'nether_wart');
  def(116, 'enchanting_table'); def(117, 'brewing_stand'); def(118, 'cauldron'); def(119, 'end_portal'); def(120, 'end_portal_frame');
  def(121, 'end_stone'); def(122, 'dragon_egg'); def(123, 'redstone_lamp'); def(124, 'redstone_lamp');
  def(125, slab(WOOD_SLABS, true)); def(126, slab(WOOD_SLABS, false));
  def(127, 'cocoa'); def(128, stairs('sandstone_stairs')); def(129, 'emerald_ore'); def(130, 'ender_chest');
  def(131, 'tripwire_hook'); def(132, 'tripwire'); def(133, 'emerald_block');
  def(134, stairs('spruce_stairs')); def(135, stairs('birch_stairs')); def(136, stairs('jungle_stairs'));
  def(137, 'command_block'); def(138, 'beacon');
  def(139, function (d) { return [d === 1 ? 'mossy_cobblestone_wall' : 'cobblestone_wall', {}]; });
  def(140, 'flower_pot'); def(141, 'carrots'); def(142, 'potatoes'); def(143, 'oak_button'); def(144, 'skeleton_skull');
  def(145, 'anvil'); def(146, 'trapped_chest'); def(147, 'light_weighted_pressure_plate'); def(148, 'heavy_weighted_pressure_plate');
  def(149, 'comparator'); def(150, 'comparator'); def(151, 'daylight_detector'); def(152, 'redstone_block');
  def(153, 'nether_quartz_ore'); def(154, 'hopper');
  def(155, function (d) { return d === 1 ? ['chiseled_quartz_block', {}] : (d >= 2 ? ['quartz_pillar', { axis: ['y', 'x', 'z'][d - 2] || 'y' }] : ['quartz_block', {}]); });
  def(156, stairs('quartz_stairs')); def(157, 'activator_rail'); def(158, 'dropper');
  def(159, colored('terracotta')); def(160, colored('stained_glass_pane'));
  def(161, function (d) { return [(d & 1) ? 'dark_oak_leaves' : 'acacia_leaves', {}]; });
  def(162, function (d) { return [((d & 1) ? 'dark_oak' : 'acacia') + ((d & 12) === 12 ? '_wood' : '_log'), { axis: AXIS[(d >> 2) & 3] }]; });
  def(163, stairs('acacia_stairs')); def(164, stairs('dark_oak_stairs')); def(165, 'slime_block'); def(166, 'barrier');
  def(167, function (d) { return ['iron_trapdoor', { half: d & 8 ? 'top' : 'bottom', open: d & 4 ? 'true' : 'false' }]; });
  def(168, function (d) { return [pick(['prismarine', 'prismarine_bricks', 'dark_prismarine'], d), {}]; });
  def(169, 'sea_lantern'); def(170, 'hay_block'); def(171, colored('carpet')); def(172, 'terracotta'); def(173, 'coal_block');
  def(174, 'packed_ice');
  def(175, function (d) { return [d & 8 ? 'tall_grass' : pick(['sunflower', 'lilac', 'tall_grass', 'large_fern', 'rose_bush', 'peony'], d & 7), { half: d & 8 ? 'upper' : 'lower' }]; });
  def(176, 'white_banner'); def(177, 'white_wall_banner'); def(178, 'daylight_detector');
  def(179, function (d) { return [pick(['red_sandstone', 'chiseled_red_sandstone', 'cut_red_sandstone'], d), {}]; });
  def(180, stairs('red_sandstone_stairs'));
  def(181, function () { return ['red_sandstone_slab', { type: 'double' }]; });
  def(182, function (d) { return ['red_sandstone_slab', { type: d & 8 ? 'top' : 'bottom' }]; });
  ['spruce', 'birch', 'jungle', 'dark_oak', 'acacia'].forEach(function (w, i) { def(183 + i, w + '_fence_gate'); def(188 + i, w + '_fence'); });
  def(193, door('spruce_door')); def(194, door('birch_door')); def(195, door('jungle_door')); def(196, door('acacia_door')); def(197, door('dark_oak_door'));
  def(198, 'end_rod'); def(199, 'chorus_plant'); def(200, 'chorus_flower'); def(201, 'purpur_block'); def(202, 'purpur_pillar');
  def(203, stairs('purpur_stairs'));
  def(204, function () { return ['purpur_slab', { type: 'double' }]; });
  def(205, function (d) { return ['purpur_slab', { type: d & 8 ? 'top' : 'bottom' }]; });
  def(206, 'end_stone_bricks'); def(207, 'beetroots'); def(208, 'dirt_path'); def(209, 'end_gateway');
  def(210, 'repeating_command_block'); def(211, 'chain_command_block'); def(212, 'frosted_ice'); def(213, 'magma_block');
  def(214, 'nether_wart_block'); def(215, 'red_nether_bricks'); def(216, 'bone_block'); def(217, 'structure_void'); def(218, 'observer');
  COLORS.forEach(function (c, i) { def(219 + i, c + '_shulker_box'); def(235 + i, (c === 'light_gray' ? 'light_gray' : c) + '_glazed_terracotta'); });
  def(251, colored('concrete')); def(252, colored('concrete_powder'));
  def(255, 'structure_block');

  function legacyToState(id, data) {
    var f = T[id];
    if (!f) return { name: 'minecraft:unknown_legacy_' + id, props: { data: String(data) } };
    var r = f(data | 0);
    return { name: 'minecraft:' + r[0], props: r[1] || {} };
  }

  // Schematica stores its own name->id mapping; map legacy 1.12 registry names to IDs.
  var LEGACY_NAMES = {
    'minecraft:air': 0, 'minecraft:stone': 1, 'minecraft:grass': 2, 'minecraft:dirt': 3, 'minecraft:cobblestone': 4, 'minecraft:planks': 5,
    'minecraft:sapling': 6, 'minecraft:bedrock': 7, 'minecraft:flowing_water': 8, 'minecraft:water': 9, 'minecraft:flowing_lava': 10, 'minecraft:lava': 11,
    'minecraft:sand': 12, 'minecraft:gravel': 13, 'minecraft:log': 17, 'minecraft:leaves': 18, 'minecraft:glass': 20, 'minecraft:sandstone': 24,
    'minecraft:wool': 35, 'minecraft:stone_slab': 44, 'minecraft:double_stone_slab': 43, 'minecraft:stained_glass': 95, 'minecraft:stonebrick': 98,
    'minecraft:wooden_slab': 126, 'minecraft:double_wooden_slab': 125, 'minecraft:stained_hardened_clay': 159, 'minecraft:stained_glass_pane': 160,
    'minecraft:leaves2': 161, 'minecraft:log2': 162, 'minecraft:carpet': 171, 'minecraft:concrete': 251, 'minecraft:concrete_powder': 252
  };

  var api = { legacyToState: legacyToState, LEGACY_NAMES: LEGACY_NAMES, COLORS: COLORS, WOODS: WOODS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LegacyBlocks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
