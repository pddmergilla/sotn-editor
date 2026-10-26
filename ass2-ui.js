// [Alternate Scarlet Symphony -Final-] tab: what the mod is, the release PPF, and a builder that applies it
// to the vanilla US BIN opened in the editor. Numbers come from ass2/ass2-release.js (tools/ass2/build-release.js)
// and the hack list from the Extra Hacks catalog, so both follow the shipped BIN.
(function () {
  "use strict";
  const R = window.SotnAss2Release, Core = window.SotnAss2Core;
  const $ = id => document.getElementById(id);
  const fmt = n => Number(n).toLocaleString("en-US");
  const mb = n => `${(n / 1048576).toFixed(1)} MB`;
  // "ASS-F.01": the build number goes up with every release of the BIN (tools/ass2/build-release.js).
  const VERSION = R?.version ? `ASS-${R.version}` : "ASS -Final-";
  const PPF_DOWNLOAD = R?.version ? `ASS-${R.version}.ppf` : R?.ppf.name;

  function el(tag, attrs = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node[k] = v;
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid.nodeType ? kid : String(kid));
    return node;
  }

  // ---- state: the opened BIN, the fetched patch, and what the BIN turned out to be
  const state = {disc: null, name: "", handle: null, ppf: null, ppfError: null, check: null, checking: null, busy: false, built: null};
  let rendered = false;

  async function loadDownloads() {
    const count = $("ass2DownloadCount");
    const [published, total] = await Promise.allSettled([
      window.SotnAss2Downloads.load(R), window.SotnAss2Downloads.total()
    ]);
    if (published.status === "fulfilled") {
      for (const link of document.querySelectorAll(".ass2PpfDownload")) {
        link.href = published.value.url;
        link.removeAttribute("download");
      }
    }
    count.textContent = total.status === "fulfilled" ? `${fmt(total.value)} total PPF downloads across all builds.` : "Download count unavailable.";
  }

  async function loadPpf() {
    if (state.ppf || state.ppfError) return state.ppf;
    try {
      const res = await fetch(R.ppf.file, {cache: "no-store"});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.ppf = Core.parsePpf(new Uint8Array(await res.arrayBuffer()));
    } catch (e) {
      state.ppfError = location.protocol === "file:" ?
        "The patch can't be loaded from a file:// page. Start the editor with node serve.js (or use the hosted editor) to build here; the Download button still works." :
        `The patch could not be loaded (${e.message || e}).`;
    }
    return state.ppf;
  }

  async function checkDisc() {
    const disc = state.disc;
    if (!disc || state.check || state.checking) return;
    state.checking = (async () => {
      const ppf = await loadPpf();
      if (!ppf || disc !== state.disc) return;
      setBuildStatus("busy", `Checking ${state.name} against vanilla US Track 1…`);
      const r = await Core.inspect(disc.file, ppf, {size: R.vanilla.size,
        onProgress: p => disc === state.disc && setBuildStatus("busy", `Checking ${state.name} against vanilla US Track 1… ${Math.round(p * 100)}%`)});
      if (disc === state.disc) state.check = r;
    })().catch(e => { state.ppfError = e.message || String(e); }).finally(() => { state.checking = null; updateBuild(); });
  }

  // ---- building
  function download(url, name) { const a = el("a", {href: url, download: name}); document.body.append(a); a.click(); a.remove(); }

  async function buildBin() {
    if (state.busy || !state.ppf || state.check?.status !== "vanilla") return;
    try {
      state.busy = true; state.built = null; updateBuild();
      const disc = state.disc;
      const parts = [];
      const {crc} = await Core.buildWithCredits(disc.file, state.ppf, {write: chunk => { parts.push(chunk); }},
        {expectedCrc: R.result.crc32, onProgress: p => setBuildStatus("busy", `Building Alternate Scarlet Symphony -Final-… ${Math.round(p * 100)}%`)});
      const saved = await window.SotnSafeSave.save(new Blob(parts, {type: "application/octet-stream"}), R.result.name,
        {sourceHandle: state.handle, sourceFile: disc.file, allowSourceOverwrite: true,
          onSourceSnapshot: file => { disc.file = file; }});
      state.built = {...saved, crc};
      window.SotnSiteStats?.count(`build/${PPF_DOWNLOAD.replace(/\.ppf$/, "")}`);
    } catch (e) {
      if (e.name === "AbortError") { state.busy = false; updateBuild(); return; }
      state.built = {error: e.message || String(e)};
    }
    state.busy = false; updateBuild();
  }

  function cueFor(binName) {
    return `FILE "${binName}" BINARY\r\n  TRACK 01 MODE2/2352\r\n    INDEX 01 00:00:00\r\n` +
      `FILE "Castlevania - Symphony of the Night (USA) (Track 2).bin" BINARY\r\n  TRACK 02 AUDIO\r\n    INDEX 00 00:00:00\r\n    INDEX 01 00:02:00\r\n`;
  }
  function downloadCue(binName) {
    const url = URL.createObjectURL(new Blob([cueFor(binName)], {type: "text/plain"}));
    download(url, binName.replace(/ \(Track 1\)\.bin$|\.bin$/i, "") + ".cue");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ---- build panel status
  function setBuildStatus(kind, text, extra) {
    const box = $("ass2BuildStatus");
    if (!box) return;
    box.className = `ass2Status ${kind}`;
    box.replaceChildren(el("span", {text}), extra || "");
  }
  function updateBuild() {
    const button = $("ass2Build");
    if (!button) return;
    const c = state.check, ready = !!state.ppf && c?.status === "vanilla" && !state.busy;
    button.disabled = !ready;
    if (state.busy) return;
    if (state.built?.error) return setBuildStatus("bad", state.built.error);
    if (state.built) return setBuildStatus("ok", `${state.built.downloaded ? "Download started for" : "Saved and verified"} ${state.built.name}: ${VERSION} with the editor link on its title screen. Output CRC32 ${state.built.crc}. ${state.built.warning || ""}`,
      el("button", {type: "button", class: "ass2Link", onclick: () => downloadCue(state.built.name), text: "Download a .cue for it"}));
    if (state.ppfError) return setBuildStatus("bad", state.ppfError);
    if (!state.disc) return setBuildStatus("idle", "Open your vanilla US BIN (Track 1) with Open SOTN BIN at the top, then build here.");
    if (state.checking || !c) return setBuildStatus("busy", `Checking ${state.name}…`);
    if (c.status === "vanilla") return setBuildStatus("ok", `${state.name} is an untouched US Track 1. Ready to build.`);
    if (c.status === "patched") return setBuildStatus("ok", `${state.name} is already Alternate Scarlet Symphony -Final-. Nothing to build.`);
    if (c.status === "size") return setBuildStatus("bad", `${state.name} isn't the size of the US Track 1 BIN (${fmt(R.vanilla.size)} bytes). Use the Track 1 file from a two-track BIN/CUE dump.`);
    setBuildStatus("bad", `${state.name} isn't an unmodified US Track 1: ${fmt(c.vanillaMismatch)} of ${fmt(c.records)} patched regions don't match. Open the vanilla BIN instead.`);
  }

  // ---- content (descriptive, no raw values: the numbers live in the Stats Editor and the Extra Hacks tab)
  const n = R.numbers;
  // Hacks that ship in ASS -Final- (work-in-progress hacks are off in the release).
  const hacks = () => (window.SotnExtraHacks?.features || []).filter(f => !f.wip);
  const BLURBS = {
    "minimap": "A small map in the corner keeps track of where you are.",
    "fast-warp": "Warp rooms send you on your way almost instantly.",
    "damage-colors": "Damage numbers show at a glance whether you hit a weakness or a resistance.",
    "mist-gas-swap": "Power of Mist and Gas Cloud trade places, and your route through the castle changes with them.",
    "aggressive-enemy": "Enemies spot you from much farther away.",
    "karasuman": "Karasuman keeps coming no matter how hard you hit him.",
    "slogra": "Slogra stands his ground when you hit him.",
    "dopplegangers": "Both Doppelgangers fight straight through your hits.",
    "succubus": "Succubus fights faster and only flinches if you catch her during her clone attack.",
    "richter-no-flinch": "Richter shrugs off your hits.",
    "richter-ai": "Richter gets a whole new fighting brain: combos, crashes and a furious second phase.",
    "quick-items": "Hold L2 and tap a face button to use a healing item without opening the menu.",
    "mp-items": "Potions and other healing items are never used up. Each use costs a resource instead.",
    "heal-hearts": "Healing items cost hearts, so every candle counts.",
    "instant-food": "Food heals the moment you use it, and the Meal Ticket serves up a random dish.",
    "eat-food-on-pickup": "Food you find is eaten on the spot.",
    "hint-items-no-attack": "Hint items are just hints and no longer count as weapons.",
    "subweapon-mp": "Subweapons draw on your MP instead of your hearts.",
    "agunea-limit": "Agunea's lightning chain has a limit, so it can't run forever.",
    "stopwatch-rework": "The Stopwatch slows down the bosses that used to ignore it.",
    "holy-water-richter": "Holy Water flies in Richter's arc, and its fire races along the floor.",
    "wolf-no-jump": "Turning into the Wolf no longer makes you hop.",
    "subweapon-weapon": "Your subweapon comes with the weapon you hold, and its icon sits right beside it in the menu.",
    "all-cloaks-hearts": "Every cloak turns the damage you survive into hearts.",
    "heart-regen": "Hearts slowly come back on their own.",
    "dark-stats": "Dark Metamorphosis makes you stronger, smarter and tougher.",
    "dark-speed": "Dark Metamorphosis makes you faster on your feet.",
    "sky-walker": "The Leap Stone becomes Sky Walker: jump in midair as often as you like.",
    "faerie-behavior": "The Faerie stops using up your items and casts buffs when you get hit."
  };

  function hero() {
    return el("section", {class: "ass2Hero"},
      el("div", {class: "ass2HeroInner"},
        el("p", {class: "ass2Kicker", text: "Castlevania: Symphony of the Night"}),
        el("h2", {class: "ass2Title"}, "Alternate Scarlet Symphony ", el("span", {text: "-Final-"})),
        el("p", {class: "ass2Tagline", text: "The final cut. Every boss rethought, a playable Richter rebuilt from the ground up, new familiars, new weapon arts, and a castle that never stops pushing back."}),
        el("div", {class: "ass2Cta"},
          el("a", {class: "ass2Button primary ass2PpfDownload", href: R.ppf.file, download: PPF_DOWNLOAD}, "Download the PPF ", el("small", {text: `${VERSION} · ${mb(R.ppf.size)}`})),
          el("a", {class: "ass2Button", href: "#ass2Install", onclick: e => { e.preventDefault(); $("ass2Install")?.scrollIntoView({behavior: "smooth"}); }}, "Build it from your vanilla BIN")),
        el("p", {class: "ass2Fine", text: "For the US release (Track 1). You need your own copy of the game: the patch only holds the mod's changes."})),
      el("div", {class: "ass2Ribbon"},
        stat(hacks().length, "gameplay hacks"),
        stat(fmt(n.changedValues), "rebalanced values"),
        stat(R.disc.stagesChanged, "stage & boss files changed")));
  }
  const stat = (big, small) => el("div", {class: "ass2Stat"}, el("strong", {text: String(big)}), el("span", {text: small}));

  function feature(icon, title, text, tags = []) {
    return el("article", {class: "ass2Feature"},
      el("div", {class: "ass2Icon", "aria-hidden": "true", text: icon}),
      el("h3", {text: title}), el("p", {text}),
      tags.length ? el("ul", {class: "ass2Tags"}, tags.map(t => el("li", {text: t}))) : null);
  }

  function features() {
    return el("section", {class: "ass2Section"},
      el("h2", {class: "ass2H", text: "What's new in -Final-"}),
      el("div", {class: "ass2Features"},
        feature("☠", "Every boss, rethought", "Seventeen bosses fight with new patterns. Olrox aims his breath, Medusa's heads strike from the edges of the screen, Death opens with a barrage, Galamoth reads where you stand, and Dracula has one more form waiting at the end.",
          ["Boss AI pack", "New final phase", "Epic Richter finisher"]),
        feature("✠", "Richter Mode, rebuilt", "Play as Richter with Rest levels, growth from everything you collect, relic abilities, Blade Dash, Rising Hurricane, a running stance and a new pause menu with a guide. He can take on every boss Alucard faces.",
          ["Rest levels", "Relic abilities", "New moves", "All bosses"]),
        feature("⚔", "A smarter bestiary", "Frozen Half, Lesser Demon, Guardian, Skull Lord, Balloon Pods and more fight with new patterns, and enemies no longer stand around waiting for you to strike first.",
          ["Enemy AI pack", "No idling"]),
        feature("✦", "New weapon arts", "The Hunter Sword returns like a boomerang, the Stone Sword raises Medusa's shield, Terminus Est borrows Crissaegrim, the Hunting Blade throws a Heaven Sword, and the elemental swords, Spirit Wand and Gram all learn something new.",
          ["Weapon specials", "Fire Rings", "Real-time shield spells"]),
        feature("❖", "New familiars", "Dawn and Ouroboros join your party, the Sword Familiar can call in a friend, and every familiar grows a level with each kill.",
          ["Dawn", "Ouroboros", "Familiar swap"]),
        feature("✚", "Survive on your terms", "Life Apples revive you on the spot, death sends you back to your last save room, the Shop Card brings the Librarian to you, and two new warp cards cut the walk home. Practice any boss in the Library before the real thing.",
          ["Life Apple revive", "Shop Card", "Warp cards", "Library Practice"]),
        feature("☾", "Alucard, sharpened", "Spells scale with INT, DEF works as a percentage, Dark Metamorphosis and the buff potions grow with your stats, and air control is tighter. Some say a secret spell lets him become the Axe Lord.",
          ["Percent DEF", "Stat-scaled buffs", "A secret spell"]),
        feature("⚙", "Built on 2.0", "Everything from 2.0 is still here: the re-rebalanced combat, a castle with no empty rooms, weapons that pick your subweapon, potions that are never used up, Heart Regeneration, the MiniMap and Fast Warp.",
          ["Re-Rebalanced", "Quick Items (L2)", "MiniMap", "Fast Warp"])));
  }

  function hackList() {
    const list = hacks();
    if (!list.length) return null;
    const groups = [];
    for (const f of list) {
      const name = f.category || "Alternate Scarlet Symphony 2.0";
      if (groups[groups.length - 1]?.name !== name) groups.push({name, items: []});
      groups[groups.length - 1].items.push(f);
    }
    return el("section", {class: "ass2Section"},
      el("h2", {class: "ass2H", text: `All ${list.length} gameplay hacks`}),
      el("p", {class: "ass2Lead", text: "Every one of these is in ASS -Final-. The Extra Hacks tab can remove any of them one at a time, add most of the -Final- hacks to ASS 2.0, and add the original ones to a vanilla BIN."}),
      groups.flatMap(group => [el("h3", {class: "ass2HackGroup", text: group.name}),
        el("div", {class: "ass2Hacks"}, group.items.map(f => el("div", {class: "ass2Hack"},
          el("strong", {text: f.label}), el("p", {text: BLURBS[f.id] || f.summary || f.subtitle || ""}))))]));
  }

  // ass2/screenshots/screenshots.json: [{file | url, caption?, source?}]
  function gallery() {
    const box = el("section", {class: "ass2Section hidden", id: "ass2Gallery"},
      el("h2", {class: "ass2H", text: "Screenshots"}), el("div", {class: "ass2Shots"}), el("p", {class: "ass2Fine ass2ShotSource"}));
    fetch("ass2/screenshots/screenshots.json", {cache: "no-store"}).then(r => r.ok ? r.json() : []).then(shots => {
      if (!Array.isArray(shots) || !shots.length) return;
      const src = s => s.url || `ass2/screenshots/${s.file}`;
      box.querySelector(".ass2Shots").replaceChildren(...shots.map(s => el("figure", {class: "ass2Shot"},
        el("a", {href: src(s), target: "_blank", rel: "noopener noreferrer"},
          el("img", {src: src(s), alt: s.caption || "Alternate Scarlet Symphony screenshot", loading: "lazy", referrerpolicy: "no-referrer"})),
        s.caption ? el("figcaption", {text: s.caption}) : null)));
      const sources = [...new Set(shots.map(s => s.source).filter(Boolean))];
      box.querySelector(".ass2ShotSource").textContent = sources.length ? `Screenshots: ${sources.join(", ")}.` : "";
      box.classList.remove("hidden");
    }).catch(() => {});
    return box;
  }

  function install() {
    return el("section", {class: "ass2Section ass2Install", id: "ass2Install"},
      el("h2", {class: "ass2H", text: "Get it"}),
      el("p", {class: "ass2Build"}, el("span", {class: "ass2BuildTag", text: "Current build"}), el("strong", {text: VERSION}),
        el("span", {class: "ass2Fine", text: `Released ${R.built}. Rebuild or re-download when the build number changes.`})),
      el("p", {class: "ass2Fine", id: "ass2DownloadCount", "aria-live": "polite", text: "Checking download count…"}),
      el("p", {class: "ass2Fine", text: "Total tracked PPF downloads since tracking began, across all builds. Browser builds and untracked website downloads are excluded."}),
      el("div", {class: "ass2InstallGrid"},
        el("div", {class: "ass2Panel"},
          el("h3", {text: "Build it here"}),
          el("ol", {class: "ass2Steps"},
            el("li", {}, "Select ", el("b", {text: "Open SOTN BIN"}), " and choose your US ", el("code", {text: "(Track 1).bin"}), "."),
            el("li", {text: "Come back to this tab. The editor checks every patched byte against vanilla."}),
            el("li", {text: "Select Build, pick where to save, and keep Track 2 next to it."})),
          el("button", {id: "ass2Build", class: "ass2Button primary", type: "button", disabled: true, onclick: buildBin}, `Build ${VERSION}`),
          el("div", {id: "ass2BuildStatus", class: "ass2Status idle"}),
          el("p", {class: "ass2Fine", text: "Your BIN is only read. The release is verified, then the editor link is added to the title screen. Unsaved editor changes are not included."})),
        el("div", {class: "ass2Panel"},
          el("h3", {text: "Or patch it yourself"}),
          el("ol", {class: "ass2Steps"},
            el("li", {}, el("a", {class: "ass2PpfDownload", href: R.ppf.file, download: PPF_DOWNLOAD, text: `Download the ${VERSION} PPF`}), ` (${mb(R.ppf.size)}).`),
            el("li", {}, "Apply it to ", el("code", {text: R.vanilla.name}), " with PPF-O-Matic or any other PPF3 patcher."),
            el("li", {}, "Point your .cue at the patched Track 1 and play. ", el("button", {type: "button", class: "ass2Link", onclick: () => downloadCue(R.result.name), text: "Download a .cue"}))),
          el("dl", {class: "ass2Hashes"},
            el("dt", {text: "Build"}), el("dd", {}, el("code", {text: VERSION})),
            el("dt", {text: "Input: US Track 1"}), el("dd", {}, el("code", {text: `SHA-256 ${R.vanilla.sha256}`})),
            el("dt", {text: `Output: ${VERSION}`}), el("dd", {}, el("code", {text: `SHA-256 ${R.result.sha256}`}), el("code", {text: `CRC32 ${R.result.crc32}`})),
            el("dt", {text: "Patch"}), el("dd", {}, el("code", {text: `SHA-256 ${R.ppf.sha256}`}))),
          el("p", {class: "ass2Fine", text: "The patch includes a PPF3 block check and undo data, so patchers can verify the input and undo it."}))));
  }

  function credits() {
    return el("section", {class: "ass2Section ass2Credits"},
      el("p", {text: "Alternate Scarlet Symphony -Final- completes Alternate Scarlet Symphony 2.0, which builds on Alternate Scarlet Symphony 1.3.1 and the BigNumbers rebalance. Dawn and Ouroboros, MiniMap, Fast Warp and Damage Number Colors are ported from Reawakened. Research used the sotn-decomp project. Castlevania: Symphony of the Night is © Konami; this is an unofficial fan modification. And yes, this page is designed by Opus 5.5."}),
      el("p", {class: "ass2Support"}, "Enjoying Alternate Scarlet Symphony? ",
        el("a", {class: "donateButton", href: "https://buymeacoffee.com/nukesheart", target: "_blank", rel: "noopener noreferrer"}, "Donate ♥️")),
      el("p", {class: "ass2Fine", text: `Release data built ${R.built}.`}));
  }

  function render() {
    const view = $("ass2View");
    if (!view) return;
    if (!R || !Core) { view.replaceChildren(el("p", {class: "ass2Fine", text: "The ASS -Final- release data is missing."})); return; }
    if (!rendered) {
      view.replaceChildren(el("div", {class: "ass2Page"}, hero(), features(), gallery(), hackList(), install(), credits()));
      rendered = true;
      loadDownloads();
    }
    updateBuild();
    checkDisc();
  }

  window.SotnAss2UI = {
    render,
    // setDisc(disc, {name, handle}): the BIN opened with Open SOTN BIN.
    setDisc(disc, {name = "", handle = null} = {}) {
      Object.assign(state, {disc, name, handle, check: null, built: null});
      if (rendered) { updateBuild(); if (!$("ass2View").classList.contains("hidden")) checkDisc(); }
    }
  };
})();
