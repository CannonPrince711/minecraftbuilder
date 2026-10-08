/* Block appearance: an approximate colour and a simple 3D shape for every block,
   from 1.12.2 (after legacy conversion) through the latest releases. Unknown or modded
   blocks fall back to keyword matching and then to a stable colour derived from the name. */
(function (root) {
  'use strict';

  var DYE = {
    white: 'E9ECEC', orange: 'F07613', magenta: 'BD44B3', light_blue: '3AAFD9', yellow: 'F8C627', lime: '70B919', pink: 'ED8DAC', gray: '3E4447',
    light_gray: '8E8E86', cyan: '158991', purple: '792AAC', blue: '35399D', brown: '724728', green: '546D1B', red: 'A12722', black: '141519'
  };
  var CONCRETE = {
    white: 'CFD5D6', orange: 'E06100', magenta: 'A9309F', light_blue: '2389C6', yellow: 'F1AF15', lime: '5EA818', pink: 'D5658E', gray: '36393D',
    light_gray: '7D7D73', cyan: '157788', purple: '64209C', blue: '2C2E8F', brown: '603B1F', green: '495B24', red: '8E2020', black: '080A0F'
  };
  var TERRACOTTA = {
    white: 'D1B2A1', orange: 'A15325', magenta: '95576C', light_blue: '706C8A', yellow: 'BA8523', lime: '677534', pink: 'A14E4E', gray: '392A23',
    light_gray: '876A61', cyan: '565B5B', purple: '764656', blue: '4A3B5B', brown: '4D3323', green: '4C532A', red: '8F3D2E', black: '251610'
  };
  var PLANKS = {
    oak: 'A2834F', spruce: '735531', birch: 'C0AF79', jungle: 'A07351', acacia: 'A85A32', dark_oak: '42291A', mangrove: '763631',
    cherry: 'E2B2AC', bamboo: 'C4AF52', crimson: '653147', warped: '2B6963', pale_oak: 'E3D9D4'
  };
  var BARK = {
    oak: '6D5532', spruce: '3A2611', birch: 'D8D7D2', jungle: '554419', acacia: '676157', dark_oak: '3C2E1A', mangrove: '543F24',
    cherry: '37212C', crimson: '5C1C1E', warped: '3A3A4D', pale_oak: '4C4643', bamboo: '7F8F2C'
  };
  var LEAVES = {
    oak: '4A7A20', spruce: '3D5D3D', birch: '5E8C3A', jungle: '4C8F1E', acacia: '4D7F1F', dark_oak: '3F6F1A', mangrove: '5A8A2A',
    cherry: 'E9B0C6', azalea: '5E7C2E', flowering_azalea: '6E7C3E', pale_oak: '878C80'
  };
  var WOOD_TYPES = Object.keys(PLANKS);

  var EXACT = {
    stone: '7D7D7D', cobblestone: '7A7A7A', mossy_cobblestone: '6E7A5C', smooth_stone: '9E9E9E', stone_bricks: '7A7978', mossy_stone_bricks: '6E7A5C',
    cracked_stone_bricks: '767574', chiseled_stone_bricks: '777676', granite: '956756', polished_granite: '9A6A59', diorite: 'BCBCBC', polished_diorite: 'C0C1C2',
    andesite: '888889', polished_andesite: '848786', deepslate: '505052', cobbled_deepslate: '4D4D50', polished_deepslate: '484849', deepslate_bricks: '464646',
    deepslate_tiles: '363637', chiseled_deepslate: '363636', reinforced_deepslate: '505654', tuff: '6C6D66', polished_tuff: '626864', tuff_bricks: '62665F',
    calcite: 'DFE0DC', dripstone_block: '866B5C', pointed_dripstone: '866B5C', blackstone: '2A2328', polished_blackstone: '353036', polished_blackstone_bricks: '302A30',
    gilded_blackstone: '382B26', basalt: '505055', polished_basalt: '636365', smooth_basalt: '484849', netherrack: '612626', nether_bricks: '2C1519',
    cracked_nether_bricks: '281417', chiseled_nether_bricks: '2F171C', red_nether_bricks: '450709', nether_wart_block: '730302', warped_wart_block: '167879',
    crimson_nylium: '831F1F', warped_nylium: '2B7265', soul_sand: '513E32', soul_soil: '4B392E', glowstone: 'FBDA74', shroomlight: 'F09A5A', magma_block: '8E3F1F',
    end_stone: 'DBDE9E', end_stone_bricks: 'DAE0A2', purpur_block: 'A97DA9', purpur_pillar: 'AB81AB', quartz_block: 'EBE5DE', quartz_bricks: 'EAE5DD',
    chiseled_quartz_block: 'E7E2DA', quartz_pillar: 'ECE6DF', smooth_quartz: 'EBE5DE', sandstone: 'D8CB9B', chiseled_sandstone: 'D8CA9B',
    cut_sandstone: 'D9CE9F', smooth_sandstone: 'E0D6AA', red_sandstone: 'BA6321', chiseled_red_sandstone: 'B7601F', cut_red_sandstone: 'BD6522',
    smooth_red_sandstone: 'B5621F', prismarine: '63A397', prismarine_bricks: '63AB9E', dark_prismarine: '335B4B', sea_lantern: 'ACC7BE',
    bricks: '966153', mud_bricks: '89694F', packed_mud: '8E6B50', mud: '3C3A3D', obsidian: '0F0A18', crying_obsidian: '200A3C', bedrock: '555555',
    dirt: '866043', coarse_dirt: '77553B', rooted_dirt: '90684C', podzol: '5B3F18', mycelium: '6F6265', grass_block: '7FB238', dirt_path: '947A41', farmland: '8F6646',
    sand: 'DBCFA3', red_sand: 'BE6621', suspicious_sand: 'D8CA9D', gravel: '857F7F', suspicious_gravel: '847E7E', clay: 'A0A6B3', snow: 'F9FEFE',
    snow_block: 'F9FEFE', powder_snow: 'F8FDFD', ice: '91B7FD', packed_ice: '8DB4FA', blue_ice: '74A7FD', frosted_ice: '8CB4FE', water: '3F76E4',
    bubble_column: '3F76E4', lava: 'D4600E', glass: 'C0F5FE', tinted_glass: '2C2630', glass_pane: 'C0F5FE', iron_bars: '8B8D8A',
    iron_block: 'DCDCDC', gold_block: 'F6D03D', diamond_block: '62EDE4', emerald_block: '2ACB57', lapis_block: '1F43A6', redstone_block: 'AF1805',
    coal_block: '101010', netherite_block: '42393B', copper_block: 'C06C50', exposed_copper: 'A17E68', weathered_copper: '6C9C74', oxidized_copper: '52A385',
    raw_iron_block: 'A6886B', raw_gold_block: 'DDA92F', raw_copper_block: '9A6A4F', amethyst_block: '8562BE', budding_amethyst: '8460BA',
    amethyst_cluster: 'A27FCF', hay_block: 'A68B0C', bookshelf: '6B5434', chiseled_bookshelf: '6F5A3A', crafting_table: '7A5B38', furnace: '6E6E6E', blast_furnace: '505050',
    smoker: '6B5A47', tnt: 'DB441A', pumpkin: 'C67418', carved_pumpkin: 'C67418', jack_o_lantern: 'D88A20', melon: '6F9124', terracotta: '985E43',
    moss_block: '596D2D', moss_carpet: '596D2D', honeycomb_block: 'E5941E', honey_block: 'F9BC3D', slime_block: '6FC05B', sponge: 'C3C04A',
    wet_sponge: 'ABB547', target: 'E2AA9E', note_block: '58392A', jukebox: '5E3F2E', dispenser: '6E6E6E', dropper: '6E6E6E', observer: '646464',
    piston: '9A8B6E', sticky_piston: '7FA067', piston_head: '9A8B6E', redstone_lamp: '5F361E', spawner: '243444', beacon: '76DDD7', conduit: 'A08C70',
    bone_block: 'E1DDC9', dried_kelp_block: '323B26', cactus: '557F2B', sugar_cane: '94C065', bamboo: '5D8F1C', cobweb: 'E4E9EB', chest: 'A2742C',
    trapped_chest: 'A2742C', ender_chest: '1D2E33', barrel: '86643B', composter: '7A5B30', lectern: 'AF8B55', loom: '8E7A5F', cartography_table: '6A513A',
    fletching_table: 'B5A473', smithing_table: '3F3F4B', stonecutter: '7B7671', grindstone: '8C8C8C', bell: 'E5BC48', anvil: '444444',
    chipped_anvil: '444444', damaged_anvil: '444444', enchanting_table: '7D1F25', end_portal_frame: '5C7B6C', cauldron: '4A4A4A', hopper: '444444',
    brewing_stand: '7A6851', beehive: 'B6924E', bee_nest: 'C9A345', lodestone: '7B7C80', respawn_anchor: '2E1A4B', crafter: '6C6363',
    scaffolding: 'C8A86A', ladder: '7D6133', vine: '3F6E1A', lily_pad: '2A7D2E', torch: 'FFD86A', wall_torch: 'FFD86A', soul_torch: '6CD3DC',
    soul_wall_torch: '6CD3DC', redstone_torch: 'C0331C', redstone_wall_torch: 'C0331C', lantern: 'C79A4D', soul_lantern: '6AA7A8', chain: '3D4350',
    iron_chain: '3D4350', end_rod: 'E8E0D5', lightning_rod: 'C06C50', rail: '7F6C55', powered_rail: '9A7B3C', detector_rail: '7F6455',
    activator_rail: '7C5B4C', redstone_wire: 'B01A02', repeater: 'A09E9D', comparator: 'A39F9C', daylight_detector: '826D52', lever: '6C5A41',
    tripwire: 'D0D0D0', tripwire_hook: '8C8C8C', flower_pot: '7C4536', campfire: '8A6B3F', soul_campfire: '5F8A8A', fire: 'E7922A', soul_fire: '52CDD1',
    nether_portal: '5A0ABF', end_portal: '0B0B12', end_gateway: '0B0B12', dragon_egg: '0C0910', cake: 'E8D4C4', candle: 'E6D3A7',
    short_grass: '6E9F3A', grass: '6E9F3A', tall_grass: '6E9F3A', fern: '5F8E33', large_fern: '5F8E33', dead_bush: '6B4F29', seagrass: '2E7524',
    tall_seagrass: '2E7524', kelp: '467A2B', kelp_plant: '467A2B', sweet_berry_bush: '3E6B2D', wheat: 'B5A23E', carrots: '4F8C2A', potatoes: '4F8C2A',
    beetroots: '5A7A2E', nether_wart: '8A1A1E', cocoa: '8C5A2B', brown_mushroom: '9A7558', red_mushroom: 'C3302A', brown_mushroom_block: '957051',
    red_mushroom_block: 'C82E2D', mushroom_stem: 'CBC4B9', chorus_plant: '5E395E', chorus_flower: '977B97', glow_lichen: '6C8A80', sculk: '0D1E24',
    sculk_sensor: '0B5161', sculk_catalyst: '3F4D45', sculk_shrieker: 'C5C9A6', sculk_vein: '0D2A2E', pale_moss_block: '6B7069', pale_moss_carpet: '6B7069',
    creaking_heart: '574A43', resin_block: 'D96C1F', resin_bricks: 'CF6519', chiseled_resin_bricks: 'CC6017', ochre_froglight: 'F5E9B2',
    verdant_froglight: 'D8EBD2', pearlescent_froglight: 'F0DCE7', dandelion: 'F2E12F', poppy: 'C42A21', blue_orchid: '2FA8E0', allium: 'B57CDB',
    azure_bluet: 'D6DBE0', red_tulip: 'C7332A', orange_tulip: 'E07B2A', white_tulip: 'E2E6E6', pink_tulip: 'E4A6C9', oxeye_daisy: 'E6E6D1',
    cornflower: '4A6AD8', lily_of_the_valley: 'E9EDEA', wither_rose: '2A2A1E', sunflower: 'F4C020', lilac: 'C29BC4', rose_bush: 'B32A23',
    peony: 'E6B6E1', torchflower: 'E58A3C', pitcher_plant: '6A8FC7', pink_petals: 'F2A8C9', spore_blossom: 'D96FA5', azalea: '5E7C2E',
    flowering_azalea: '7A6E8C', big_dripleaf: '6F9A2B', small_dripleaf: '6F9A2B', hanging_roots: '9B6E54', glow_berries: 'E4A034',
    cave_vines: '5A7A2E', cave_vines_plant: '5A7A2E', weeping_vines: '7B0000', twisting_vines: '149A83', crimson_roots: '7E082A', warped_roots: '148A7C',
    crimson_fungus: 'A12A2A', warped_fungus: '1C8A7C', nether_sprouts: '138A7C', sea_pickle: '6B7135', turtle_egg: 'E4E0C4', sniffer_egg: 'A2452F',
    frogspawn: '6B5F5A', decorated_pot: '8C4B37', trial_spawner: '2E3A43', vault: '3A4248', heavy_core: '5C5C66', structure_block: '594A5A',
    jigsaw: '4D3F4F', command_block: 'B08870', chain_command_block: '7EA49A', repeating_command_block: '7C64B2', barrier: 'E33B3B', light: 'FFF8B0',
    skeleton_skull: 'C9C9C9', wither_skeleton_skull: '2E2E2E', zombie_head: '4A7A3A', creeper_head: '5BB04A', player_head: '6B4A2A', dragon_head: '1E1E1E',
    piglin_head: 'E8A69B', infested_stone: '7D7D7D', infested_cobblestone: '7A7A7A', infested_stone_bricks: '7A7978', infested_deepslate: '505052',
    copper_grate: 'C06C50', copper_bulb: 'C06C50', chiseled_copper: 'B86650', cut_copper: 'BF6B51', crafting: '7A5B38', dried_ghast: '7C7C7C',
    bamboo_mosaic: 'BEA94F', bamboo_block: '7F8F2C', stripped_bamboo_block: 'C4AF52', mangrove_roots: '4B3B26', muddy_mangrove_roots: '453B2E',
    test_block: '4A6A9A', test_instance_block: '4A6A9A', firefly_bush: '4F6A2E', leaf_litter: '9A6A3A', bush: '4F7A2A', cactus_flower: 'D06BA4',
    short_dry_grass: 'B89B5A', tall_dry_grass: 'B89B5A', wildflowers: 'F2D64A', copper_torch: '7FD18C', copper_wall_torch: '7FD18C', copper_lantern: '7FB68C',
    copper_chest: 'C06C50', copper_golem_statue: 'C06C50', shelf: 'A2834F'
  };

  var ORES = { coal: '2E2E2E', iron: 'D8AF93', gold: 'FCEE4B', diamond: '5DECF5', emerald: '17DD62', lapis: '1F43A6', redstone: 'FF0000', copper: 'E2754F', nether_quartz: 'E8E2D8', nether_gold: 'F4D04A' };

  function hex(h) { var v = parseInt(h, 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round); }
  function hashColor(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    var hue = ((h >>> 0) % 360) / 360, sat = 0.35, lig = 0.55;
    function f(n) { var k = (n + hue * 12) % 12, a = sat * Math.min(lig, 1 - lig); return Math.round(255 * (lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }
    return [f(0), f(8), f(4)];
  }

  var SUFFIXES = ['_stairs', '_slab', '_wall', '_fence_gate', '_fence', '_button', '_pressure_plate', '_door', '_trapdoor', '_wall_hanging_sign',
    '_hanging_sign', '_wall_sign', '_sign', '_pane', '_carpet', '_bed', '_banner', '_wall_banner', '_candle_cake', '_candle', '_shulker_box', '_glazed_terracotta', '_bars', '_chain', '_lantern', '_grate', '_bulb'];

  function baseColor(id, props) {
    if (EXACT[id]) return hex(EXACT[id]);
    // Old 1.12-style names with a colour/variant property
    if (props.color && DYE[props.color]) {
      if (id.indexOf('concrete') >= 0 && id.indexOf('powder') < 0) return hex(CONCRETE[props.color]);
      if (id.indexOf('clay') >= 0 || id.indexOf('terracotta') >= 0) return hex(TERRACOTTA[props.color]);
      return hex(DYE[props.color]);
    }
    if (id === 'shulker_box') return hex('8B618B');
    // Ores
    if (/_ore$/.test(id)) {
      var oreName = id.replace(/^deepslate_/, '').replace(/_ore$/, '');
      var bg = id.indexOf('deepslate_') === 0 ? hex('505052') : (oreName.indexOf('nether') === 0 ? hex('612626') : hex('7D7D7D'));
      return ORES[oreName] ? mix(bg, hex(ORES[oreName]), 0.3) : bg;
    }
    // Copper family (waxed_ prefix, oxidation stages)
    if (id.indexOf('copper') >= 0 || id.indexOf('waxed_') === 0) {
      var c = id.replace(/^waxed_/, '');
      if (c.indexOf('oxidized') >= 0) return hex('52A385');
      if (c.indexOf('weathered') >= 0) return hex('6C9C74');
      if (c.indexOf('exposed') >= 0) return hex('A17E68');
      return hex('C06C50');
    }
    // Wood
    for (var i = 0; i < WOOD_TYPES.length; i++) {
      var w = WOOD_TYPES[i];
      if (id === w + '_leaves') return hex(LEAVES[w]);
      if (id.indexOf('stripped_' + w + '_') === 0) return hex(PLANKS[w]);
    }
    for (i = 0; i < WOOD_TYPES.length; i++) {
      w = WOOD_TYPES[i];
      if (id === w + '_log' || id === w + '_wood' || id === w + '_stem' || id === w + '_hyphae' || id === w + '_block') return hex(BARK[w]);
      if (id.indexOf(w + '_') === 0) {
        if (/_sapling$|_propagule$/.test(id)) return hex(LEAVES[w] || '4A7A20');
        if (/_leaves$/.test(id)) return hex(LEAVES[w] || '4A7A20');
        return hex(PLANKS[w]);
      }
    }
    if (/_leaves$/.test(id)) return hex(LEAVES[id.replace(/_leaves$/, '')] || '4A7A20');
    if (id === 'mangrove_propagule') return hex('5A8A2A');
    // Strip a shape suffix and try the base material
    for (i = 0; i < SUFFIXES.length; i++) {
      var s = SUFFIXES[i];
      if (id.length > s.length && id.slice(-s.length) === s) {
        var base = id.slice(0, -s.length);
        var cands = [base, base + 's', base + '_block', base + '_planks', base.replace(/_brick$/, '_bricks'), base.replace(/_tile$/, '_tiles')];
        for (var j = 0; j < cands.length; j++) if (EXACT[cands[j]]) return hex(EXACT[cands[j]]);
        if (base !== id) { var r = baseColor(base, {}); if (r) return r; }
      }
    }
    // Dye-coloured blocks
    for (var dye in DYE) {
      if (id.indexOf(dye + '_') === 0) {
        var rest = id.slice(dye.length + 1);
        if (rest === 'concrete') return hex(CONCRETE[dye]);
        if (rest === 'concrete_powder') return mix(hex(CONCRETE[dye]), [255, 255, 255], 0.18);
        if (rest === 'terracotta') return hex(TERRACOTTA[dye]);
        if (rest === 'glazed_terracotta') return mix(hex(DYE[dye]), hex(TERRACOTTA[dye]), 0.35);
        if (rest === 'shulker_box') return mix(hex(DYE[dye]), [0, 0, 0], 0.08);
        return hex(DYE[dye]);
      }
    }
    if (/^(potted_|attached_)/.test(id)) return baseColor(id.replace(/^(potted_|attached_)/, ''), props);
    if (/_coral(_block|_fan|_wall_fan)?$/.test(id)) {
      var dead = id.indexOf('dead_') === 0;
      var corals = { tube: '3157D4', brain: 'CF5B9F', bubble: 'A118A0', fire: 'A3232F', horn: 'D8C842' };
      var cn = id.replace(/^dead_/, '').split('_')[0];
      return dead ? hex('857F7A') : hex(corals[cn] || 'B0408A');
    }
    if (/_stem$/.test(id)) return hex('7A9A3A');
    // Keyword fallback
    var KW = [['quartz', 'EBE5DE'], ['deepslate', '505052'], ['blackstone', '2A2328'], ['nether_brick', '2C1519'], ['prismarine', '63A397'], ['purpur', 'A97DA9'],
      ['sandstone', 'D8CB9B'], ['brick', '966153'], ['cobble', '7A7A7A'], ['stone', '7D7D7D'], ['glass', 'C0F5FE'], ['ice', '91B7FD'], ['snow', 'F9FEFE'],
      ['log', '6D5532'], ['wood', 'A2834F'], ['plank', 'A2834F'], ['leaves', '4A7A20'], ['grass', '6E9F3A'], ['dirt', '866043'], ['sand', 'DBCFA3'],
      ['iron', 'DCDCDC'], ['gold', 'F6D03D'], ['wool', 'E9ECEC'], ['concrete', 'CFD5D6'], ['terracotta', '985E43'], ['clay', 'A0A6B3'], ['tile', '7A7978']];
    for (i = 0; i < KW.length; i++) if (id.indexOf(KW[i][0]) >= 0) return hex(KW[i][1]);
    return null;
  }

  // Old (1.12) names used with variant properties inside flattened files
  function legacyVariantColor(id, props) {
    var v = props.variant || props.type;
    if (!v) return null;
    if ((id === 'planks' || id === 'wooden_slab' || id === 'double_wooden_slab' || id === 'log' || id === 'log2' || id === 'leaves' || id === 'leaves2')) {
      if (id.indexOf('leaves') === 0) return LEAVES[v] ? hex(LEAVES[v]) : null;
      if (id.indexOf('log') === 0) return BARK[v] ? hex(BARK[v]) : null;
      return PLANKS[v] ? hex(PLANKS[v]) : null;
    }
    if (EXACT[v]) return hex(EXACT[v]);
    return null;
  }

  var P = 1 / 16;
  function plateFor(facing, t) { // plate on the side opposite the facing direction (wall-attached things)
    switch (facing) {
      case 'north': return [0, 0, 1 - t, 1, 1, 1];
      case 'south': return [0, 0, 0, 1, 1, t];
      case 'east': return [0, 0, 0, t, 1, 1];
      case 'west': return [1 - t, 0, 0, 1, 1, 1];
      default: return [0, 0, 0, 1, t, 1];
    }
  }
  function armBoxes(props, w, h, isOn) {
    var a = (1 - w) / 2, b = (1 + w) / 2, out = [];
    if (isOn(props.north)) out.push([a, 0, 0, b, h, a]);
    if (isOn(props.south)) out.push([a, 0, b, b, h, 1]);
    if (isOn(props.west)) out.push([0, 0, a, a, h, b]);
    if (isOn(props.east)) out.push([b, 0, a, 1, h, b]);
    return out;
  }
  function on(v) { return v === 'true' || v === 'low' || v === 'tall'; }

  // Returns a list of boxes [x0,y0,z0,x1,y1,z1] in block units, or 'cube'.
  function shapeFor(id, props) {
    if (/_slab$/.test(id) || id === 'stone_slab' || id === 'wooden_slab') {
      var t = props.type || props.half;
      if (t === 'double') return 'cube';
      return t === 'top' ? [[0, 0.5, 0, 1, 1, 1]] : [[0, 0, 0, 1, 0.5, 1]];
    }
    if (/^double_.*slab/.test(id)) return 'cube';
    if (/_stairs$/.test(id)) {
      var top = props.half === 'top';
      var base = top ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1];
      var y0 = top ? 0 : 0.5, y1 = top ? 0.5 : 1;
      var back = { north: [0, y0, 0, 1, y1, 0.5], south: [0, y0, 0.5, 1, y1, 1], east: [0.5, y0, 0, 1, y1, 1], west: [0, y0, 0, 0.5, y1, 1] }[props.facing || 'north'];
      return [base, back];
    }
    if (/_carpet$/.test(id) || id === 'carpet' || id === 'moss_carpet' || id === 'pale_moss_carpet') return [[0, 0, 0, 1, P, 1]];
    if (/_pressure_plate$/.test(id)) return [[P, 0, P, 1 - P, P, 1 - P]];
    if (/rail$/.test(id)) return [[0, 0, 0, 1, P, 1]];
    if (id === 'redstone_wire' || id === 'tripwire') return [[0.25, 0, 0.25, 0.75, P / 2, 0.75]];
    if (id === 'lily_pad' || id === 'pink_petals' || id === 'leaf_litter' || id === 'wildflowers' || /_sculk_vein$|^sculk_vein$|glow_lichen/.test(id)) return [[0, 0, 0, 1, P / 2, 1]];
    if (id === 'snow') return [[0, 0, 0, 1, Math.max(1, parseInt(props.layers || '1', 10)) / 8, 1]];
    if (id === 'farmland' || id === 'dirt_path' || id === 'grass_path') return [[0, 0, 0, 1, 15 / 16, 1]];
    if (/_bed$/.test(id) || id === 'bed') return [[0, 0, 0, 1, 9 / 16, 1]];
    if (id === 'enchanting_table') return [[0, 0, 0, 1, 12 / 16, 1]];
    if (id === 'daylight_detector' || id === 'daylight_detector_inverted') return [[0, 0, 0, 1, 6 / 16, 1]];
    if (id === 'repeater' || id === 'comparator' || id === 'unpowered_repeater' || id === 'powered_repeater') return [[0, 0, 0, 1, 2 / 16, 1]];
    if (id === 'stonecutter') return [[0, 0, 0, 1, 9 / 16, 1]];
    if (id === 'end_portal_frame') return [[0, 0, 0, 1, 13 / 16, 1]];
    if (/campfire$/.test(id)) return [[0, 0, 0, 1, 7 / 16, 1]];
    if (/chest$/.test(id) && id !== 'chest_minecart') return [[P, 0, P, 1 - P, 14 / 16, 1 - P]];
    if (id === 'cake' || /_cake$/.test(id)) return [[P, 0, P, 1 - P, 0.5, 1 - P]];
    if (id === 'cactus') return [[P, 0, P, 1 - P, 1, 1 - P]];
    if (/_trapdoor$/.test(id) || id === 'trapdoor') {
      if (props.open === 'true') return [plateFor(props.facing, 3 / 16)];
      return props.half === 'top' ? [[0, 13 / 16, 0, 1, 1, 1]] : [[0, 0, 0, 1, 3 / 16, 1]];
    }
    if (/_door$/.test(id)) {
      var f = props.facing || 'north';
      var closed = { east: [0, 0, 0, 3 / 16, 1, 1], west: [13 / 16, 0, 0, 1, 1, 1], south: [0, 0, 0, 1, 1, 3 / 16], north: [0, 0, 13 / 16, 1, 1, 1] }[f];
      return [closed];
    }
    if (/_fence_gate$/.test(id)) {
      var ns = props.facing === 'north' || props.facing === 'south';
      return ns ? [[0, 5 / 16, 7 / 16, 1, 1, 9 / 16]] : [[7 / 16, 5 / 16, 0, 9 / 16, 1, 1]];
    }
    if (/_fence$/.test(id) || id === 'fence') {
      return [[6 / 16, 0, 6 / 16, 10 / 16, 1, 10 / 16]].concat(armBoxes(props, 3 / 16, 15 / 16, on).map(function (b) { b[1] = 6 / 16; return b; }));
    }
    if (/_wall$/.test(id) && !/_sign$|_banner$|_torch$|_fan$|_head$|_skull$/.test(id)) {
      var post = props.up === 'false' ? [] : [[4 / 16, 0, 4 / 16, 12 / 16, 1, 12 / 16]];
      return post.concat(armBoxes(props, 6 / 16, 14 / 16, on)).concat(post.length ? [] : [[5 / 16, 0, 5 / 16, 11 / 16, 14 / 16, 11 / 16]]);
    }
    if (/(_pane|^glass_pane|iron_bars|_bars)$/.test(id)) {
      return [[7 / 16, 0, 7 / 16, 9 / 16, 1, 9 / 16]].concat(armBoxes(props, 2 / 16, 1, on));
    }
    if (id === 'ladder' || /^(\w+_)?wall_sign$/.test(id) || /_wall_banner$/.test(id)) return [plateFor(props.facing, 2 / 16)];
    if (/_wall_hanging_sign$/.test(id)) return [[0, 0, 7 / 16, 1, 10 / 16, 9 / 16]];
    if (/_hanging_sign$/.test(id)) return [[P, 0, 7 / 16, 1 - P, 10 / 16, 9 / 16]];
    if (/_sign$/.test(id)) return [[7 / 16, 0, 7 / 16, 9 / 16, 9 / 16, 9 / 16], [0, 9 / 16, 7 / 16, 1, 1, 9 / 16]];
    if (/_banner$/.test(id)) return [[7 / 16, 0, 7 / 16, 9 / 16, 1, 9 / 16], [P, 0.25, 7 / 16, 1 - P, 1, 9 / 16]];
    if (id === 'vine') {
      var vb = [];
      ['north', 'south', 'east', 'west'].forEach(function (d) { if (props[d] === 'true') vb.push(plateFor({ north: 'south', south: 'north', east: 'west', west: 'east' }[d], P)); });
      return vb.length ? vb : [[0, 1 - P, 0, 1, 1, 1]];
    }
    if (/torch$/.test(id)) return [[7 / 16, 0, 7 / 16, 9 / 16, 10 / 16, 9 / 16]];
    if (/lantern$/.test(id) && id !== 'jack_o_lantern' && id !== 'sea_lantern') return [[5 / 16, 0, 5 / 16, 11 / 16, 9 / 16, 11 / 16]];
    if (/(^|_)chain$|end_rod|lightning_rod/.test(id)) {
      var ax = props.axis || (props.facing === 'east' || props.facing === 'west' ? 'x' : (props.facing === 'north' || props.facing === 'south' ? 'z' : 'y'));
      return [{ x: [0, 7 / 16, 7 / 16, 1, 9 / 16, 9 / 16], z: [7 / 16, 7 / 16, 0, 9 / 16, 9 / 16, 1], y: [7 / 16, 0, 7 / 16, 9 / 16, 1, 9 / 16] }[ax]];
    }
    if (/_button$/.test(id) || id === 'lever' || id === 'tripwire_hook') return [[5 / 16, 0, 5 / 16, 11 / 16, 2 / 16, 11 / 16]];
    if (/candle$/.test(id)) return [[6 / 16, 0, 6 / 16, 10 / 16, 6 / 16, 10 / 16]];
    if (/(_skull|_head)$/.test(id)) return [[4 / 16, 0, 4 / 16, 12 / 16, 8 / 16, 12 / 16]];
    if (id === 'flower_pot' || /^potted_/.test(id)) return [[5 / 16, 0, 5 / 16, 11 / 16, 6 / 16, 11 / 16]].concat(/^potted_/.test(id) ? [[6 / 16, 6 / 16, 6 / 16, 10 / 16, 12 / 16, 10 / 16]] : []);
    if (id === 'brewing_stand' || id === 'sea_pickle' || id === 'turtle_egg' || id === 'frogspawn') return [[4 / 16, 0, 4 / 16, 12 / 16, 8 / 16, 12 / 16]];
    if (id === 'bamboo') return [[6 / 16, 0, 6 / 16, 10 / 16, 1, 10 / 16]];
    if (id === 'scaffolding') return [[0, 14 / 16, 0, 1, 1, 1], [0, 0, 0, 2 / 16, 14 / 16, 2 / 16], [14 / 16, 0, 0, 1, 14 / 16, 2 / 16], [0, 0, 14 / 16, 2 / 16, 14 / 16, 1], [14 / 16, 0, 14 / 16, 1, 14 / 16, 1]];
    if (isPlant(id)) return [[3 / 16, 0, 3 / 16, 13 / 16, 13 / 16, 13 / 16]];
    if (id === 'anvil' || /_anvil$/.test(id)) return [[2 / 16, 0, 2 / 16, 14 / 16, 4 / 16, 14 / 16], [6 / 16, 4 / 16, 4 / 16, 10 / 16, 10 / 16, 12 / 16], [3 / 16, 10 / 16, 0, 13 / 16, 1, 1]];
    if (id === 'hopper') return [[0, 10 / 16, 0, 1, 1, 1], [4 / 16, 4 / 16, 4 / 16, 12 / 16, 10 / 16, 12 / 16], [6 / 16, 0, 6 / 16, 10 / 16, 4 / 16, 10 / 16]];
    if (id === 'bell') return [[4 / 16, 4 / 16, 4 / 16, 12 / 16, 13 / 16, 12 / 16]];
    if (id === 'lectern') return [[0, 0, 0, 1, 2 / 16, 1], [4 / 16, 2 / 16, 4 / 16, 12 / 16, 13 / 16, 12 / 16], [0, 13 / 16, 0, 1, 1, 1]];
    if (id === 'grindstone') return [[4 / 16, 4 / 16, 2 / 16, 12 / 16, 1, 14 / 16]];
    if (id === 'decorated_pot') return [[P, 0, P, 1 - P, 1, 1 - P]];
    if (id === 'cobweb') return [[2 / 16, 2 / 16, 2 / 16, 14 / 16, 14 / 16, 14 / 16]];
    if (id === 'fire' || id === 'soul_fire') return [[P, 0, P, 1 - P, 1, 1 - P]];
    return 'cube';
  }

  var PLANT_RE = /(_sapling|_tulip|_mushroom|_fungus|_roots|_sprouts|_propagule|_bush|_flower|^short_grass$|^grass$|^tall_grass$|^fern$|^large_fern$|^dead_bush$|^seagrass$|^tall_seagrass$|^kelp|^dandelion$|^poppy$|^blue_orchid$|^allium$|^azure_bluet$|^oxeye_daisy$|^cornflower$|^lily_of_the_valley$|^wither_rose$|^sunflower$|^lilac$|^rose_bush$|^peony$|^torchflower|^pitcher_|^wheat$|^carrots$|^potatoes$|^beetroots$|^nether_wart$|^sugar_cane$|^sweet_berry_bush$|_vines(_plant)?$|^hanging_roots$|^spore_blossom$|^small_dripleaf$|^big_dripleaf|^cocoa$|_stem$|^chorus_flower$|^dead_|_coral$|_coral_fan$|_coral_wall_fan$|^short_dry_grass$|^tall_dry_grass$|^firefly_bush$|^eyeblossom|^open_eyeblossom$|^closed_eyeblossom$|^pale_hanging_moss$)/;
  function isPlant(id) {
    if (/_block$/.test(id)) return false;
    if (/^(crimson|warped)_stem$/.test(id) || id === 'mushroom_stem') return false;
    if (id === 'chorus_flower' || id === 'cactus_flower') return true;
    return PLANT_RE.test(id);
  }

  var INVISIBLE = { air: 1, cave_air: 1, void_air: 1, structure_void: 1, light: 1, moving_piston: 1, barrier: 1 };
  var TRANSLUCENT_RE = /(^glass$|_stained_glass$|^stained_glass$|^ice$|^frosted_ice$|^water$|^bubble_column$|^slime_block$|^honey_block$|^nether_portal$|^portal$|glass_pane$|^tinted_glass$)/;

  function appearance(name, props) {
    props = props || {};
    var id = name.replace(/^minecraft:/, '');
    var ns = name.indexOf(':') >= 0 ? name.slice(0, name.indexOf(':')) : 'minecraft';
    var a = { id: id, invisible: !!INVISIBLE[id], translucent: false, occludes: false, shape: 'cube', boxes: null, color: null, top: null, bottom: null, axis: null, alpha: 1 };
    if (a.invisible) { a.color = [0, 0, 0]; return a; }

    var col = legacyVariantColor(id, props) || baseColor(id, props);
    a.color = col || hashColor(ns === 'minecraft' ? id : name);
    a.unknownColor = !col;

    // Special top/side colouring
    if (id === 'grass_block' || id === 'grass') { a.top = hex('7FB238'); a.color = hex('7C7240'); a.bottom = hex('866043'); }
    else if (id === 'podzol') { a.top = hex('5B3F18'); a.color = hex('7A5737'); }
    else if (id === 'mycelium') { a.top = hex('6F6265'); a.color = hex('85706A'); }
    else if (/_nylium$/.test(id)) { a.top = a.color; a.color = hex('612626'); }
    else if (id === 'bookshelf' || id === 'chiseled_bookshelf') { a.top = hex('A2834F'); }
    else if (id === 'crafting_table') { a.top = hex('9B7A4B'); }
    else if (id === 'tnt') { a.top = hex('A0A0A0'); }
    else if (id === 'pumpkin' || id === 'carved_pumpkin' || id === 'jack_o_lantern') { a.top = hex('B86E1B'); }
    else if (id === 'melon') { a.top = hex('A4A72E'); }
    else if (id === 'hay_block') { a.axisEnds = hex('A88A1F'); }
    else if (id === 'bone_block') { a.axisEnds = hex('D2CCB0'); }
    else if (id === 'quartz_pillar' || id === 'purpur_pillar') { a.axisEnds = mix(a.color, [255, 255, 255], 0.06); }
    else if (id === 'snow_block' || id === 'snow') { a.color = hex('F9FEFE'); }
    else if (/^sandstone$|^red_sandstone$/.test(id)) { a.top = mix(a.color, [255, 255, 255], 0.08); }
    var wm = /^(\w+?)_(log|stem)$/.exec(id);
    if (wm && PLANKS[wm[1]]) a.axisEnds = hex(PLANKS[wm[1]]);
    if (/^stripped_(\w+?)_(log|stem)$/.test(id)) a.axisEnds = mix(a.color, [0, 0, 0], 0.08);
    if ((id === 'log' || id === 'log2') && props.variant && PLANKS[props.variant]) a.axisEnds = hex(PLANKS[props.variant]);
    if (a.axisEnds) a.axis = props.axis || 'y';

    var shape = shapeFor(id, props);
    if (shape === 'cube') { a.shape = 'cube'; }
    else { a.shape = 'boxes'; a.boxes = shape; }

    if (TRANSLUCENT_RE.test(id)) { a.translucent = true; a.alpha = id === 'water' || id === 'bubble_column' ? 0.62 : (id === 'tinted_glass' ? 0.85 : 0.45); }
    if (/_leaves$/.test(id) || id === 'leaves' || id === 'leaves2') a.leaves = true;
    a.occludes = a.shape === 'cube' && !a.translucent;
    if (id === 'lava') a.emissive = true;
    return a;
  }

  var api = { appearance: appearance, hex: hex };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BlockLook = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
