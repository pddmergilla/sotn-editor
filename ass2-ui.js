// [Alternate Scarlet Symphony 2.0] tab: what the mod is, the release PPF, and a builder that applies it
// to the vanilla US BIN opened in the editor. Numbers come from ass2/ass2-release.js (tools/ass2/build-release.js)
// and the hack list from the Extra Hacks catalog, so both follow the shipped BIN.
(function () {
  "use strict";
  const R = window.SotnAss2Release, Core = window.SotnAss2Core;
  const $ = id => document.getElementById(id);
  const fmt = n => Number(n).toLocaleString("en-US");
  const mb = n => `${(n / 1048576).toFixed(1)} MB`;
  // "ASS 2.0.03": the build number goes up with every release of the BIN (tools/ass2/build-release.js).
  const VERSION = R?.version ? `ASS ${R.version}` : "ASS 2.0";
  const PPF_DOWNLOAD = R?.version ? `Alternate-Scarlet-Symphony-${R.version}.ppf` : R?.ppf.name;

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
    try {
      const result = await window.SotnAss2Downloads.load(R);
      for (const link of document.querySelectorAll(".ass2PpfDownload")) {
        link.href = result.url;
        link.removeAttribute("download");
      }
      count.textContent = `${fmt(result.count)} PPF downloads for ${VERSION}.`;
    } catch {
      count.textContent = "Download count unavailable.";
    }
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
  async function saveTarget(name) {
    if (window.showSaveFilePicker) {
      const handle = await showSaveFilePicker({suggestedName: name, types: [{description: "PlayStation BIN image", accept: {"application/octet-stream": [".bin"]}}]});
      if (state.handle && await handle.isSameEntry(state.handle)) throw new Error("Choose a different file name so your vanilla BIN stays intact.");
      const stream = await handle.createWritable();
      return {name: handle.name, write: chunk => stream.write(chunk), done: () => stream.close(), abort: () => stream.abort()};
    }
    const parts = [];
    return {name, write: chunk => { parts.push(chunk); },
      done: () => { const url = URL.createObjectURL(new Blob(parts, {type: "application/octet-stream"})); download(url, name); setTimeout(() => URL.revokeObjectURL(url), 60000); },
      abort: () => { parts.length = 0; }};
  }
  function download(url, name) { const a = el("a", {href: url, download: name}); document.body.append(a); a.click(); a.remove(); }

  async function buildBin() {
    if (state.busy || !state.ppf || state.check?.status !== "vanilla") return;
    let target = null;
    try {
      target = await saveTarget(R.result.name);
      state.busy = true; state.built = null; updateBuild();
      const crc = await Core.build(state.disc.file, state.ppf, target,
        {onProgress: p => setBuildStatus("busy", `Building Alternate Scarlet Symphony 2.0… ${Math.round(p * 100)}%`)});
      if (crc !== R.result.crc32) {
        await target.abort();
        throw new Error(`The built image's CRC32 is ${crc}, not ${R.result.crc32}; nothing was saved.`);
      }
      await target.done();
      state.built = {name: target.name, crc};
    } catch (e) {
      if (e.name === "AbortError") { state.busy = false; updateBuild(); return; }
      try { await target?.abort(); } catch {}
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
    if (state.built) return setBuildStatus("ok", `Saved ${state.built.name}. CRC32 ${state.built.crc} matches the release, so it is byte-for-byte ${VERSION}.`,
      el("button", {type: "button", class: "ass2Link", onclick: () => downloadCue(state.built.name), text: "Download a .cue for it"}));
    if (state.ppfError) return setBuildStatus("bad", state.ppfError);
    if (!state.disc) return setBuildStatus("idle", "Open your vanilla US BIN (Track 1) with Open SOTN BIN at the top, then build here.");
    if (state.checking || !c) return setBuildStatus("busy", `Checking ${state.name}…`);
    if (c.status === "vanilla") return setBuildStatus("ok", `${state.name} is an untouched US Track 1. Ready to build.`);
    if (c.status === "patched") return setBuildStatus("ok", `${state.name} is already Alternate Scarlet Symphony 2.0. Nothing to build.`);
    if (c.status === "size") return setBuildStatus("bad", `${state.name} isn't the size of the US Track 1 BIN (${fmt(R.vanilla.size)} bytes). Use the Track 1 file from a two-track BIN/CUE dump.`);
    setBuildStatus("bad", `${state.name} isn't an unmodified US Track 1: ${fmt(c.vanillaMismatch)} of ${fmt(c.records)} patched regions don't match. Open the vanilla BIN instead.`);
  }

  // ---- content (descriptive, no raw values: the numbers live in the Stats Editor and the Extra Hacks tab)
  const n = R.numbers;
  // Hacks that ship in ASS 2.0 (work-in-progress hacks are off in the release).
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
        el("h2", {class: "ass2Title"}, "Alternate Scarlet Symphony ", el("span", {text: "2.0"})),
        el("p", {class: "ass2Tagline", text: "The castle you know, rebuilt to hit back. Harder fights, bosses that won't flinch, a Richter with a new brain, and an arsenal reworked down to the last Holy Water flame."}),
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
      el("h2", {class: "ass2H", text: "What's new"}),
      el("div", {class: "ass2Features"},
        feature("⚔", "Re-Rebalanced combat", "Enemies hit hard. Alucard hits hard too. Every enemy, weapon, spell and item has been retuned so every fight matters. This game is hard, but not too hard. Think Order of Ecclesia hard.",
          ["Retuned enemies", "Retuned gear", "Retuned spells"]),
        feature("☗", "A castle that's never empty", "New enemy placements fill the new areas, and no room sits empty anymore. Enemies will ambush you, gang up on you, and sometimes vanish without a trace. Keep your guard up. You've been warned.",
          ["New placements", "No empty rooms", "Ambushes"]),
        feature("☠", "Bosses that hold their ground", "Karasuman, Slogra, both Doppelgangers and Richter shrug off hit-stun. Succubus only flinches during her clone attack and fights faster. The Stopwatch's freeze is shorter, but the bosses that used to ignore it are now slowed by it.",
          ["No Flinch", "Faster Succubus", "Stopwatch slows bosses"]),
        feature("✠", "Epic Richter", "A completely new boss AI: distance-based combos, slide kicks, blade dashes and backflips, every subweapon and item crash, and a faster aggressive phase after Hydro Storm.",
          ["New AI", "No Flinch", "Item crashes"]),
        feature("✦", "Your weapon picks your subweapon", "The subweapon follows the weapon in your first hand, and its icon sits beside the weapon in the equipment menu. Subweapon candles drop Big Hearts instead, Holy Water flies in Richter's arc with flames that race along the floor, and Agunea's chain is capped.",
          ["Weapon pairings", "Richter-style Holy Water", "Agunea Limit"]),
        feature("✚", "Healing, reinvented", "Potions are never used up. Hold L2 and tap a face button to drink without opening the menu. Food is eaten the moment you use it or pick it up, hearts trickle back on their own, and every cloak turns survived damage into hearts.",
          ["Quick Items (L2)", "Eat Food on Pickup", "Heart Regeneration", "All Cloaks give Hearts"]),
        feature("☾", "Dark Metamorphosis unleashed", "Dark Metamorphosis now raises ATK, INT and DEF and speeds up walking, jumping, falling and backdashing while it lasts. Spells hit like they mean it.",
          ["Stat buff", "SpeedUp"]),
        feature("❖", "A sharper castle", "Enemies notice you from much farther away. A MiniMap tracks your position, warp rooms teleport in a blink, and damage numbers color-code weaknesses and resistances. And an actual underwater level!",
          ["MiniMap", "Fast Warp", "Damage Number Colors", "Underwater level"])));
  }

  function hackList() {
    const list = hacks();
    if (!list.length) return null;
    return el("section", {class: "ass2Section"},
      el("h2", {class: "ass2H", text: `All ${list.length} gameplay hacks`}),
      el("p", {class: "ass2Lead", text: "Every one of these is in ASS 2.0. The Extra Hacks tab can also add most of them to a vanilla BIN one at a time, or remove them from ASS 2.0."}),
      el("div", {class: "ass2Hacks"}, list.map(f => el("div", {class: "ass2Hack"},
        el("strong", {text: f.label}), el("p", {text: BLURBS[f.id] || f.subtitle || ""})))));
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
      el("p", {class: "ass2Fine", text: "Counts cover PPF downloads from this release; browser builds and earlier website downloads are excluded."}),
      el("div", {class: "ass2InstallGrid"},
        el("div", {class: "ass2Panel"},
          el("h3", {text: "Build it here"}),
          el("ol", {class: "ass2Steps"},
            el("li", {}, "Select ", el("b", {text: "Open SOTN BIN"}), " and choose your US ", el("code", {text: "(Track 1).bin"}), "."),
            el("li", {text: "Come back to this tab. The editor checks every patched byte against vanilla."}),
            el("li", {text: "Select Build, pick where to save, and keep Track 2 next to it."})),
          el("button", {id: "ass2Build", class: "ass2Button primary", type: "button", disabled: true, onclick: buildBin}, `Build ${VERSION}`),
          el("div", {id: "ass2BuildStatus", class: "ass2Status idle"}),
          el("p", {class: "ass2Fine", text: "Your BIN is only read. The new image is checked against the release CRC32 before it is saved. Unsaved editor changes are not included."})),
        el("div", {class: "ass2Panel"},
          el("h3", {text: "Or patch it yourself"}),
          el("ol", {class: "ass2Steps"},
            el("li", {}, el("a", {class: "ass2PpfDownload", href: R.ppf.file, download: PPF_DOWNLOAD, text: `Download the ${VERSION} PPF`}), ` (${mb(R.ppf.size)}).`),
            el("li", {}, "Apply it to ", el("code", {text: R.vanilla.name}), " with PPF-O-Matic or any other PPF3 patcher."),
            el("li", {}, "Point your .cue at the patched Track 1 and play. ", el("button", {type: "button", class: "ass2Link", onclick: () => downloadCue(R.result.name), text: "Download a .cue"}))),
          el("dl", {class: "ass2Hashes"},
            el("dt", {text: "Build"}), el("dd", {}, el("code", {text: VERSION})),
            el("dt", {text: "Input: US Track 1"}), el("dd", {}, el("code", {text: `SHA-256 ${R.vanilla.sha256}`})),
            el("dt", {text: "Output: ASS 2.0"}), el("dd", {}, el("code", {text: `SHA-256 ${R.result.sha256}`}), el("code", {text: `CRC32 ${R.result.crc32}`})),
            el("dt", {text: "Patch"}), el("dd", {}, el("code", {text: `SHA-256 ${R.ppf.sha256}`}))),
          el("p", {class: "ass2Fine", text: "The patch includes a PPF3 block check and undo data, so patchers can verify the input and undo it."}))));
  }

  function credits() {
    return el("section", {class: "ass2Section ass2Credits"},
      el("p", {text: "Alternate Scarlet Symphony 2.0 builds on Alternate Scarlet Symphony 1.3.1 and the BigNumbers rebalance. QoL features such as MiniMap, Fast Warp and Damage Number Colors are ported from Reawakened. Research used the sotn-decomp project. Castlevania: Symphony of the Night is © Konami; this is an unofficial fan modification. And yes, this page is designed by Opus 5.5."}),
      el("p", {class: "ass2Support"}, "Enjoying Alternate Scarlet Symphony? ",
        el("a", {class: "donateButton", href: "https://buymeacoffee.com/nukesheart", target: "_blank", rel: "noopener noreferrer"}, "Donate ♥️")),
      el("p", {class: "ass2Fine", text: `Release data built ${R.built}.`}));
  }

  function render() {
    const view = $("ass2View");
    if (!view) return;
    if (!R || !Core) { view.replaceChildren(el("p", {class: "ass2Fine", text: "The ASS 2.0 release data is missing."})); return; }
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
