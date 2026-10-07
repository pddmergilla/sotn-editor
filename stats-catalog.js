(function (global) {
  "use strict";

  // Element bits from include/game.h (Elements enum). Low bits are kept untouched.
  const ELEMENTS = [
    {bit: 0x0020, name: "Hit"}, {bit: 0x0040, name: "Cut"}, {bit: 0x0080, name: "Poison"},
    {bit: 0x0100, name: "Curse"}, {bit: 0x0200, name: "Stone"}, {bit: 0x0400, name: "Water"},
    {bit: 0x0800, name: "Dark"}, {bit: 0x1000, name: "Holy"}, {bit: 0x2000, name: "Ice"},
    {bit: 0x4000, name: "Thunder"}, {bit: 0x8000, name: "Fire"}
  ];

  const SUBWEAPONS = ["None", "Dagger", "Axe", "Holy Water", "Cross", "Bible", "Stopwatch", "Rebound Stone", "Vibhuti", "Agunea"];

  // Extra DRA g_SubwpnDefs rows used by Alucard's subweapons (config_us.h).
  const ALUCARD_SUBWEAPON_EXTRAS = {
    3: [{entry: 11, label: "Holy Water flames"}],
    4: [{entry: 12, label: "Cross beam (crash cross)"}],
    9: [{entry: 10, label: "Lightning bolt", note: "Its heart-cost field is not read by the game; the follow-up cost is below."}]
  };

  // RIC subweapons_def rows (src/ric/ric_shared.h RicSubweapons and the entities that use them).
  const RICHTER_ENTRIES = {
    0: "No subweapon", 10: "PL_W_10 (unused copy)", 11: "Holy Water flames", 12: "Cross crash (cross)",
    13: "Cross crash beam", 14: "Whip", 15: "Crash without a subweapon (PL_W_15)", 16: "Hydro Storm",
    17: "Blade Dash / Bible crash beam", 18: "Slide", 19: "PL_W_19 (unused)", 20: "Axe crash cost row",
    21: "Dagger crash cost row", 22: "High-jump attack", 23: "Slide kick", 24: "Vibhuti crash cloud",
    25: "Rebound Stone crash particles", 26: "Agunea crash circle / Bible crash cost", 27: "Stopwatch crash cost row",
    28: "Agunea crash cost row", 29: "Rebound Stone crash explosion", 30: "Stopwatch crash lightning"
  };
  const RICHTER_SKILLS = [
    {entry: 14, label: "Whip"}, {entry: 18, label: "Slide"}, {entry: 23, label: "Slide kick"},
    {entry: 22, label: "High-jump attack"}, {entry: 17, label: "Blade Dash", note: "Same row as the Bible crash beam."},
    {entry: 16, label: "Hydro Storm", note: "Same row as the Holy Water crash."}
  ];
  // Rows whose damage a crash uses, besides the crash cost row named by crashId.
  const RICHTER_CRASH_DAMAGE = {
    1: [{entry: 1, label: "Crash daggers (reuse Dagger damage)"}],
    2: [{entry: 2, label: "Crash axes (reuse Axe damage)"}],
    3: [{entry: 16, label: "Hydro Storm"}],
    4: [{entry: 12, label: "Crash cross"}, {entry: 13, label: "Crash cross beam"}],
    5: [{entry: 17, label: "Bible crash beam"}],
    6: [{entry: 30, label: "Stopwatch crash lightning"}],
    7: [{entry: 25, label: "Rebound Stone crash particles"}, {entry: 29, label: "Rebound Stone crash explosion"}],
    8: [{entry: 24, label: "Vibhuti crash cloud"}],
    9: [{entry: 26, label: "Agunea crash circle"}]
  };
  const RICHTER_EXTRAS = {3: [{entry: 11, label: "Holy Water flames"}]};

  // Familiar attacks use g_SpellDefs rows (GetServantStats in src/dra/7879C.c);
  // damage is scaled by (level * 4 / 95 + 1) in game. Names are g_MenuStr[46..50].
  const FAMILIARS = [
    {menu: 46, fallback: "Bat", attacks: [{spell: 15, label: "Dive attack"}]},
    {menu: 47, fallback: "Ghost", attacks: [{spell: 17, label: "Life-drain touch (levels 1-69)"}, {spell: 18, label: "Soul-steal touch (levels 70+)"}]},
    {menu: 48, fallback: "Faerie", attacks: []},
    {menu: 49, fallback: "Demon", attacks: [
      {spell: 21, label: "Basic attack A"}, {spell: 22, label: "Basic attack B"}, {spell: 23, label: "Special attack 1"},
      {spell: 24, label: "Special attack 2"}, {spell: 25, label: "Special attack 3"}, {spell: 26, label: "Special attack 4"},
      {spell: 27, label: "Special attack 5"}]},
    {menu: 50, fallback: "Sword", attacks: [{spell: 19, label: "Slash (levels 1-69)"}, {spell: 20, label: "Slash (levels 70+)"},
      {spell: 7, label: "Sword Brothers", note: "Same row as Alucard's Sword Brothers spell."}]}
  ];

  // g_MenuStr item categories (EquipDef.itemCategory).
  const CATEGORIES = ["S.sword", "Sword", "Throw 1", "Fist", "Club", "Two-hand", "Food", "Bomb", "Throw 2", "Shield", "Medicine"];
  const RELICS = ["Soul of Bat", "Fire of Bat", "Echo of Bat", "Force of Echo", "Soul of Wolf", "Power of Wolf", "Skill of Wolf",
    "Form of Mist", "Power of Mist", "Gas Cloud", "Cube of Zoe", "Spirit Orb", "Gravity Boots", "Leap Stone", "Holy Symbol",
    "Faerie Scroll", "Jewel of Open", "Merman Statue", "Bat Card", "Ghost Card", "Faerie Card", "Demon Card", "Sword Card",
    "Sprite Card", "Nosedevil Card", "Heart of Vlad", "Tooth of Vlad", "Rib of Vlad", "Ring of Vlad", "Eye of Vlad"];
  // ITEMDROP IDs that gate progress: vessels plus Holy glasses, Spike Breaker, Gold Ring, Silver Ring (0x80 + 169 + body index).
  const PROGRESSION_DROPS = [0x17, 0x0C, 0x80 + 169 + 34, 0x80 + 169 + 14, 0x80 + 169 + 72, 0x80 + 169 + 73];

  const PRIZE_DROPS = ["Small heart", "Large heart", "$1", "$25", "$50", "$100", "$250", "$400", "$700", "$1000", "$2000", "$5000",
    "Heart Max-Up", "Dummy", "Dagger", "Axe", "Cross", "Holy Water", "Stopwatch", "Bible", "Rebound Stone", "Vibhuti", "Agunea", "Life Max-Up"];

  // Special effects are CheckEquipmentItemCount(item, slot) calls. Keys are the
  // vanilla US DRA offsets of the jal; overlay effects are matched by item/slot.
  // slot: 0 hand, 1 head, 2 armor, 3 cloak, 4 accessory.
  const DRA_EFFECTS = {
    0x54950: {group: "alucart-sword", label: "Alucart set piece (sword)", desc: "Counts toward the Alucart set bonus with the shield and mail."},
    0x54960: {group: "alucart-shield", label: "Alucart set piece (shield)", desc: "Counts toward the Alucart set bonus with the sword and mail."},
    0x54970: {group: "alucart-mail", label: "Alucart set piece (mail)", desc: "Counts toward the Alucart set bonus with the sword and shield."},
    0x54A88: {group: "sunstone", label: "Stats up by day", desc: "STR, CON, INT and LCK bonuses per equipped stone between 6:00 and 18:00 game time."},
    0x54AC8: {group: "moonstone", label: "Stats up by night", desc: "STR, CON, INT and LCK bonuses per equipped stone between 18:00 and 6:00 game time."},
    0x55138: {group: "medusa", label: "Stone immunity", desc: "Grants immunity to Stone while held."},
    0x55160: {group: "fireshield", label: "Fire immunity", desc: "Grants immunity to Fire while held."},
    0x55310: {group: "walk", label: "DEF grows with map", desc: "DEF +1 for every 60 rooms explored."},
    0x5DAD0: {group: "mojo", label: "Spell damage x1.5", desc: "Spells deal 50% more damage."},
    0x5DC54: {group: "ankh", label: "Longer status timers", desc: "Status timers 4 and 5 last 50% longer (GetStatusAilmentTimer)."},
    0x5DD94: {group: "duplicator", label: "Infinite items", desc: "Consumable hand items are not used up."},
    0x5E4A8: {group: "heartbroach", label: "Cheaper subweapons", desc: "Subweapon heart cost /2 (/3 with two), including Agunea's follow-up."},
    0x89008: {group: "heartbroach"},
    0x5E61C: {group: "brilliant", label: "Subweapon damage +10", desc: "Adds 10 to subweapon attack."},
    0x5E654: {group: "staurolite", label: "Stronger Cross", desc: "Cross damage x2 (x3 with two)."},
    0x5EA44: {group: "cateye", label: "Double healing hits", desc: "Doubles HP restored by healing hits (damage kind 7)."},
    0x5EADC: {group: "ballroom", label: "Damage reduction", desc: "Reduces damage from some hazard types by 20%."},
    0x5EC7C: {group: "talisman", label: "Dodge chance", desc: "LCK-based chance to avoid a hit."},
    0x5EDF0: {group: "bloodcloak", label: "Hearts from damage", desc: "Gain hearts equal to damage taken."},
    0x5EE18: {group: "fury", label: "DEF up when hit", desc: "DEF +20 for a while after taking damage."},
    0x5F1B0: {group: "dragonhelm", label: "Halves enemy DEF", desc: "Enemies' DEF is halved when you hit them."},
    0x5F4B8: {group: "arcana", label: "Better rare drops", desc: "Raises the rare item drop rate."},
    0x61D68: {group: "mysticpendant", label: "Faster MP regen", desc: "Restores MP twice as often."},
    0x61DD4: {group: "healingmail", label: "HP regen", desc: "Restores 1 HP every 128 frames while moving (not transformed)."},
    0x69910: {group: "axelord", label: "Axe Armor form", desc: "Turns Alucard into an Axe Armor.", readOnly: "Also checked by direct comparisons elsewhere; not safe to move."},
    0x6A274: {group: "axelord"},
    0x6BB98: {group: "secretboots", label: "Taller Alucard", desc: "Raises Alucard's height."}
  };
  const OVERLAY_EFFECTS = {
    b: {group: "bloodstone", label: "Stronger blood healing", desc: "Doubles HP healed by blood (Dark Metamorphosis). Checked in every stage and boss overlay."},
    s: {group: "spikebreaker", label: "Breaks spikes", desc: "Destroys spikes on contact (checked in the NO2, RNO2 and BO0 overlays)."},
    h: {group: "holyglasses", label: "Reveals Shaft's orb", desc: "Lets you see and hit Shaft's orb in the Richter fight (BO6)."}
  };
  // Vanilla US call offsets of g_api.CheckEquipmentItemCount in each overlay.
  const OVERLAY_SITES = {
    "ST/ARE":{0x431DC:"b"}, "ST/CAT":{0x4E908:"b"}, "ST/CEN":{0x1B954:"b"}, "ST/CHI":{0x27B28:"b"}, 
    "ST/DAI":{0x50A90:"b"}, "ST/DRE":{0x21A98:"b"}, "ST/LIB":{0x4BBC0:"b"}, "ST/NO0":{0x4769C:"b"}, 
    "ST/NO1":{0x4D058:"b"}, "ST/NO2":{0x3587C:"s",0x47BE8:"b"}, "ST/NO3":{0x4C354:"b"}, "ST/NO4":{0x550F8:"b"}, 
    "ST/NP3":{0x43BC4:"b"}, "ST/NZ0":{0x43188:"b"}, "ST/NZ1":{0x3720C:"b"}, "ST/RARE":{0x31648:"b"}, 
    "ST/RCAT":{0x3EA58:"b"}, "ST/RCEN":{0x2AF74:"b"}, "ST/RCHI":{0x256FC:"b"}, "ST/RDAI":{0x3F134:"b"}, 
    "ST/RLIB":{0x2D668:"b"}, "ST/RNO0":{0x45ED0:"b"}, "ST/RNO1":{0x33AF4:"b"}, "ST/RNO2":{0x34454:"s",0x417F8:"b"}, 
    "ST/RNO3":{0x3E9B8:"b"}, "ST/RNO4":{0x52950:"b"}, "ST/RNZ0":{0x3770C:"b"}, "ST/RNZ1":{0x379A8:"b"}, 
    "ST/RTOP":{0x2CFFC:"b"}, "ST/RWRP":{0x14C70:"b"}, "ST/ST0":{0x3A588:"b"}, "ST/TOP":{0x38138:"b"}, 
    "ST/WRP":{0x12CF0:"b"}, "BOSS/BO0":{0x2B8A4:"s",0x4C934:"b"}, "BOSS/BO1":{0x3009C:"b"}, "BOSS/BO2":{0x3216C:"b"}, 
    "BOSS/BO3":{0x3120C:"b"}, "BOSS/BO4":{0x414B8:"b"}, "BOSS/BO5":{0x316B0:"b"}, 
    "BOSS/BO6":{0x27FC0:"h",0x34650:"b",0x40884:"h"}, "BOSS/BO7":{0x202F0:"b"}, "BOSS/MAR":{0x17A6C:"b"}, 
    "BOSS/RBO0":{0x24B60:"b"}, "BOSS/RBO1":{0x1FC40:"b"}, "BOSS/RBO2":{0x2C57C:"b"}, "BOSS/RBO3":{0x1DC94:"b"}, 
    "BOSS/RBO4":{0x23908:"b"}, "BOSS/RBO5":{0x403EC:"b"}, "BOSS/RBO6":{0x2FFB8:"b"}, "BOSS/RBO7":{0x209D0:"b"}, 
    "BOSS/RBO8":{0x24894:"b"}
  };

  // Names from g_EInit* initializers in src/st and src/boss (enemy definition index -> name).
  const ENEMY_LABELS = {
    6:"Axe Knight",7:"Axe Knight Axe",9:"Sword Lord",10:"Sword Lord Attack",11:"Skelerang",
    12:"Skelerang Boomerang",13:"Bloody Zombie",14:"Flying Zombie / Flying Zombie Half",
    15:"Flying Zombie / Flying Zombie Half",16:"Diplocephalus",17:"Diplocephalus Foot",18:"Diplocephalus Tail",
    19:"Diplocephalus Fireball",20:"Owl Knight",21:"Owl Knight Sword",22:"Owl",23:"Lesser Demon",
    24:"Lesser Demon Dummy",25:"Lesser Demon Spit",26:"Lesser Demon Fireball",27:"Merman",28:"Merman Fireball",
    29:"Water Object",30:"Water Splash",31:"Gorgon",32:"Gorgon Head",33:"Gorgon Attack",34:"Armor Lord",
    35:"Armor Lord Sword Shadow",36:"Armor Lord Temp",38:"Dark Octopus",40:"Flea Man",41:"Flea Armor",
    42:"Flea Armor Attack Hitbox",44:"White Dragon Flame Breath",45:"Bone Ark / Bone Ark Attack Effects",
    46:"Bone Ark Skeleton",47:"Bone Ark Projectile",48:"Flea Rider",49:"Marionette",61:"Wereskeleton",64:"Bat",
    65:"Large Slime",66:"Slime",67:"Phantom Skull",68:"Flail Guard",69:"Flail Guard Flail",70:"Blood Skeleton",
    71:"Hellfire Beast",72:"Hellfire Beast Flame Pillar",73:"Hellfire Beast Thors Hammer",
    74:"Hellfire Beast Punch Hitbox",75:"Skeleton",76:"Skeleton Bone",77:"Discus Lord",78:"Discus",
    79:"Fire Demon",80:"Fire Demon Fireball",81:"Spittle Bone",82:"Spittle Bone Spit",83:"Skeleton Ape",
    84:"Skeleton Ape Barrel",85:"Stone Rose",88:"Ectoplasm",91:"Lock Camera Variant",93:"Spear Guard",
    96:"Thrown Spear",97:"Plate Lord / Reverse Small Rocks",98:"Unused80180B",99:"Frozen Shade",
    100:"Frozen Shade Crystal",101:"Confessional Blades",102:"Bone Musket",104:"Dodo Bird",105:"Bone Scimitar",
    106:"Toad",107:"Frog",108:"Bone Archer",109:"Bone Archer Arrow",110:"Zombie",111:"Grave Keeper",
    112:"Grave Keeper Hitbox",113:"Tombstone",114:"Blue Raven",115:"Black Crow",116:"Jack O Bones",
    117:"Jack O Bones",118:"Bone Halberd",119:"Bone Halberd Attack",120:"Yorick",121:"Yorick Skull",
    122:"Blade Master",123:"Blade Master Attack Hitbox",124:"Blade Soldier",125:"Blade Soldier Attack Hitbox",
    126:"Nova Skeleton",127:"Nova Skeleton",128:"Winged Guard",129:"Spectral Sword",130:"Poltergeist",
    131:"Lossoth",132:"Lossoth Attack",133:"Valhalla Knight",134:"Valhalla Knight Unk",135:"Valhalla Knight Unk",
    136:"Spectral Sword",137:"Spectral Sword Weapon",138:"Spectral Sword RDAI",139:"Spear",140:"Shield",
    141:"Orobourous",142:"Oruburos",143:"Oruburos Rider",144:"Dragon Rider",145:"Dragon Rider",146:"Dhuron",
    148:"Fire Warg",150:"Fire Warg",151:"Fire Warg",153:"Cave Troll",156:"Ghost Enemy",157:"Thornweed",
    158:"801806DC / Corpseweed Unused",159:"Corpseweed",160:"Corpseweed Projectile",161:"Venus Weed Root",
    162:"Venus Weed Flower",163:"Venus Weed Tendril",164:"Venus Weed Dart",165:"Bomb Knight",166:"Bomb",
    167:"Rock Knight",168:"Rock",169:"Dracula",170:"Dracula Fireball",171:"Dracula Meteorball",
    172:"Dracula Final Form",173:"Dracula Mega Fireball",174:"Dracula Rain Attack",175:"Warg",178:"Slinger",
    179:"Slinger Rib",180:"Corner Guard",181:"Corner Guard Attack",182:"Bitterfly",183:"Bone Pillar Skull",
    184:"Bone Pillar Fire Breath",185:"Bone Pillar Spike Ball",186:"Hammer",187:"Hammer Weapon",188:"Gurkha",
    189:"Gurkha Weapon",190:"Blade",191:"Blade Weapon",193:"Ouija Table",194:"Ouija Table Component",
    198:"Galamoth Lvl",199:"Galamoth Lvl",203:"Minotaurus",204:"Minotaur Attack Hitbox",
    205:"Minotaur Spit Liquid",206:"Werewolf ARE",207:"Werewolf Attack Hitbox",210:"Frozen Shade Icicle",
    211:"Paranthropus",212:"Paranthropus Bone Hitbox",213:"Paranthropus Thrown Bone",214:"Mudman",
    216:"Ghost Dancer",217:"Frozen Half",218:"Frozen Half Orbit Icicle",219:"Frozen Half Thrown Chunk",
    220:"Frozen Half Falling Ice",221:"Salem Witch",222:"Salem Witch Curse",223:"Salem Witch Tribolt",
    224:"Azaghal",225:"Gremlin",226:"Gremlin Fire",227:"Hunting Girl",228:"Vandal Sword",229:"Salome",
    230:"Salome Magic Orb",231:"Salome Skull",232:"Salome Cat",233:"Ctulhu",234:"Ctulhu Fireball",
    235:"Ctulhu Ice Shockwave",236:"Malachi",239:"Harpy",240:"Harpy Kick",241:"Harpy Dagger",242:"Harpy Flame",
    243:"Slogra NP / Slogra",244:"Slogra Spear NP / Slogra Spear",245:"Slogra Projectile NP / Slogra Projectile",
    246:"Axe Knight",247:"Spellbook",251:"Magic Tome",253:"Doppleganger",254:"Gaibon NP / Gaibon",
    255:"Gaibon Projectile NP / Gaibon Projectile",256:"Gaibon Large Projectile",261:"Skull Lord",262:"Lion",
    264:"Tinman",267:"Akmodan II",271:"Cloaked Knight",272:"Cloaked Knight Sword",273:"Darkwing Bat",
    277:"Fishhead",278:"Fishhead Fireball",279:"Fishhead Fire Breath",280:"Karasuman",
    281:"Karasuman Feather Attack",282:"Karasuman Orb Attack",283:"Karasuman Raven Attack",284:"Imp",
    285:"Rdai Unk",286:"Imp Death Particle",287:"Scylla",294:"Scyllawyrm",295:"Granfaloon Core",
    296:"Granfaloon Shell",297:"Grafaloon Zombie",298:"Homing Laser",300:"Hippogryph",303:"Medusa Head Blue",
    304:"Medusa Head Yellow",305:"Archer",322:"Scarecrow",323:"Schmoo",324:"Beezelbub / Beezelbub801804A",
    342:"Succubus",350:"Killer Fish",351:"Shaft",356:"Death",361:"Death",363:"Cerberos",366:"Medusa",
    370:"The Creature",379:"Dracula Lvl",384:"Stone Skull",385:"Skeleton Ape Punch",386:"Minotaur",
    387:"Minotaur Attack Hitbox",388:"Minotaur Spit Liquid",389:"Werewolf",390:"Werewolf Attack Hitbox",
    391:"Werewolf Energy Wave",392:"Venus Weed Root / Blue Venus Weed",393:"Venus Weed Flower / Blue Venus Weed",
    394:"Venus Weed Tendril",395:"Venus Weed Dart",396:"Guardian",397:"Guardian Sword Shadow",398:"Guardian Temp",
    399:"Axe Knight Axe",
  };

  // Shield spells (Shield rod + shield) run EntityWeaponShieldSpell from the
  // shield's own weapon overlay, so the effect follows the overlay ID.
  // Descriptions are read from src/weapon/w_0XX.c of the vanilla game.
  const SHIELD_SPELL_EFFECTS = {
    8: "Raises DEF for a while (the Shield potion buff).",
    9: "Raises ATK for a while (the Attack potion buff).",
    10: "Swords fly around Alucard and hit enemies.",
    11: "Small figures march along the floor and hit enemies.",
    23: "Gives fire and thunder resistance for a while.",
    24: "Rocks rise from the ground and hit enemies; the screen shakes.",
    25: "Clouds drift around Alucard, then gives dark resistance for a while.",
    26: "Stars circle Alucard, then raises INT for a while.",
    27: "A beam locks onto the nearest enemy.",
    28: "A beam fires straight ahead to the edge of the screen.",
    29: "A dragon head shoots fireballs.",
    52: "Alucard hurts enemies he touches while MP drains, until the timer or MP runs out.",
    58: "A question mark appears over Alucard; nothing else happens.",
    13: "Two Heaven swords together: their combo attack."
  };

  // ---- Library shop (src/st/lib/e_shop.c)
  const SHOP_CATEGORIES = ["Hand item", "Head gear", "Armor", "Cloak", "Accessory", "Relic", "Document"];
  const SHOP_MILESTONES = ["Met Maria after Hippogryph", "Richter cutscene after Minotaur and Werewolf", "Have Soul of Bat",
    "Met Maria in the Center", "Inverted castle unlocked", "Death fight cutscene seen", "Galamoth defeated"];
  const SHOP_MENU_OPTIONS = ["Buy item", "Tactics", "Enemy list", "Sound test", "Exit", "Sell gem"];
  const SHOP_DOCUMENTS = ["Castle map", "Magic scroll 1", "Magic scroll 2", "Magic scroll 3", "Magic scroll 4", "Magic scroll 5"];
  const TACTICS_BOSSES = ["Dracula", "Olrox", "Doppleganger10", "Granfaloon", "Minotaur & Werewolf", "Scylla", "Slogra & Gaibon",
    "Hippogryph", "Beelzebub", "Succubus", "Karasuman", "Trevor, Grant & Sypha", "Death", "Cerberus", "Richter Belmont", "Medusa",
    "The Creature", "Lesser Demon", "Doppleganger40", "Akmodan II", "Darkwing Bat", "Galamoth", "(unused)", "(unused)", "(unused)",
    "(unused)", "(unused)", "Shaft", "Lord Dracula"];

  // ---- Map Editor: breakables (EntityBreakable). Params >> 12 is the look;
  // most looks drop params & 0xFFF directly (ReplaceBreakableWithItemDrop).
  // Urns (7), jugs (8) and busts (9) in some stages spawn a persistent drop
  // instead: "slot" uses params & 0x1FF as the PrizeDrops index, a number is
  // a slot fixed in that stage's code.
  const BREAKABLE_RULES = {
    DAI: {7: "slot", 8: "slot"}, RDAI: {7: "slot", 8: "slot"}, NO2: {7: "slot", 8: "slot"}, RNO1: {7: "slot", 8: "slot"},
    NO1: {7: "slot", 8: 3}, TOP: {7: "slot", 8: "slot", 9: "slot"}, RTOP: {7: "slot", 8: "slot", 9: "slot"},
    LIB: {7: "slot", 8: 3, 9: "slot"}, CAT: {7: "slot", 8: 3, 9: "slot"}, RCAT: {7: "slot", 8: 3, 9: "slot"},
    NZ1: {7: 0x28, 8: 0x29}, RNZ1: {7: 0, 8: 0}, NO4: {7: "slot", 8: 0x29}, RNO4: {7: "slot", 8: "slot"}, ARE: {7: 0x28, 8: 0x29}, RARE: {7: 0x28, 8: 0x29}
  };
  const BREAKABLE_LOOKS = {7: "Urn", 8: "Jug", 9: "Bust"};
  // EntitySubWeaponContainer: params picks subweapon_params[params] (ITEMDROP IDs).
  const SUBWEAPON_CONTAINER = [22, 20, 16, 14, 19, 21, 15, 17, 18];

  const api = {ELEMENTS, SUBWEAPONS, ALUCARD_SUBWEAPON_EXTRAS, RICHTER_ENTRIES, RICHTER_SKILLS, RICHTER_CRASH_DAMAGE,
    RICHTER_EXTRAS, FAMILIARS, PRIZE_DROPS, CATEGORIES, RELICS, PROGRESSION_DROPS, DRA_EFFECTS, OVERLAY_EFFECTS, OVERLAY_SITES, ENEMY_LABELS,
    SHIELD_SPELL_EFFECTS, SHOP_CATEGORIES, SHOP_MILESTONES, SHOP_MENU_OPTIONS, SHOP_DOCUMENTS, TACTICS_BOSSES,
    BREAKABLE_RULES, BREAKABLE_LOOKS, SUBWEAPON_CONTAINER};
  global.SotnStatsCatalog = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
