// [Alternate Scarlet Symphony 2.0] tab: what the mod is, the release PPF, and a builder that applies it
// to the vanilla US BIN opened in the editor. Numbers come from ass2/ass2-release.js (tools/ass2/build-release.js)
// and the hack list from the Extra Hacks catalog, so both follow the shipped BIN.
(function () {
  "use strict";
  const R = window.SotnAss2Release, Core = window.SotnAss2Core;
  const $ = id => document.getElementById(id);
  const fmt = n => Number(n).toLocaleString("en-US");
  const mb = n => `${(n / 1048576).toFixed(1)} MB`;

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
    if (state.built) return setBuildStatus("ok", `Saved ${state.built.name}. CRC32 ${state.built.crc} matches the release, so it is byte-for-byte Alternate Scarlet Symphony 2.0.`,
      el("button", {type: "button", class: "ass2Link", onclick: () => downloadCue(state.built.name), text: "Download a .cue for it"}));
    if (state.ppfError) return setBuildStatus("bad", state.ppfError);
    if (!state.disc) return setBuildStatus("idle", "Open your vanilla US BIN (Track 1) with Open SOTN BIN at the top, then build here.");
    if (state.checking || !c) return setBuildStatus("busy", `Checking ${state.name}…`);
    if (c.status === "vanilla") return setBuildStatus("ok", `${state.name} is an untouched US Track 1. Ready to build.`);
    if (c.status === "patched") return setBuildStatus("ok", `${state.name} is already Alternate Scarlet Symphony 2.0. Nothing to build.`);
    if (c.status === "size") return setBuildStatus("bad", `${state.name} isn't the size of the US Track 1 BIN (${fmt(R.vanilla.size)} bytes). Use the Track 1 file from a two-track BIN/CUE dump.`);
    setBuildStatus("bad", `${state.name} isn't an unmodified US Track 1: ${fmt(c.vanillaMismatch)} of ${fmt(c.records)} patched regions don't match. Open the vanilla BIN instead.`);
  }

  // ---- content
  const n = R.numbers;
  const pair = ([a, b], unit = "") => el("span", {class: "ass2Pair"}, el("s", {text: fmt(a)}), el("span", {class: "ass2Arrow", text: "→"}), el("b", {text: fmt(b) + unit}));
  const hacks = () => window.SotnExtraHacks?.features || [];

  function hero() {
    const top = Math.max(...n.bosses.map(b => b.hp[1]));
    return el("section", {class: "ass2Hero"},
      el("div", {class: "ass2HeroInner"},
        el("p", {class: "ass2Kicker", text: "Castlevania: Symphony of the Night"}),
        el("h2", {class: "ass2Title"}, "Alternate Scarlet Symphony ", el("span", {text: "2.0"})),
        el("p", {class: "ass2Tagline", text: "The castle you know, rebuilt to hit back. Bigger numbers, bosses that won't flinch, a Richter with a new brain, and an arsenal reworked down to the last Holy Water flame."}),
        el("div", {class: "ass2Cta"},
          el("a", {class: "ass2Button primary", href: R.ppf.file, download: R.ppf.name}, "Download the PPF ", el("small", {text: mb(R.ppf.size)})),
          el("a", {class: "ass2Button", href: "#ass2Install", onclick: e => { e.preventDefault(); $("ass2Install")?.scrollIntoView({behavior: "smooth"}); }}, "Build it from your vanilla BIN")),
        el("p", {class: "ass2Fine", text: "For the US release (Track 1). You need your own copy of the game: the patch only holds the mod's changes."})),
      el("div", {class: "ass2Ribbon"},
        stat(hacks().length || 30, "gameplay hacks"),
        stat(fmt(n.changedValues), "rebalanced values"),
        stat(R.disc.stagesChanged, "stage & boss files changed"),
        stat(fmt(top), "HP on the toughest bosses")));
  }
  const stat = (big, small) => el("div", {class: "ass2Stat"}, el("strong", {text: String(big)}), el("span", {text: small}));

  function feature(icon, title, text, tags = []) {
    return el("article", {class: "ass2Feature"},
      el("div", {class: "ass2Icon", "aria-hidden": "true", text: icon}),
      el("h3", {text: title}), el("p", {text}),
      tags.length ? el("ul", {class: "ass2Tags"}, tags.map(t => el("li", {text: t}))) : null);
  }

  function features() {
    const p = n.potions, a = n.alucard, pk = n.pickups;
    const heal = p.map(x => `${x.name} ${fmt(x.ass)} HP`).join(", ");
    const costs = p.map(x => fmt(x.cost)).join(" / ");
    const anyHearts = p.some(x => x.costHearts);
    return el("section", {class: "ass2Section"},
      el("h2", {class: "ass2H", text: "What's new"}),
      el("div", {class: "ass2Features"},
        feature("⚔", "BigNumbers combat", `Alucard wakes up with ${fmt(a.hpMax[1])} HP, ${fmt(a.mpMax[1])} MP and ${a.str[1]} in every stat, and every Life Max Up adds ${pk.hpMaxUp[1]}. ${n.enemies[0]} enemy entries, all ${n.hand[1]} hand items and every spell were retuned to match.`,
          ["Heart cap " + fmt(a.heartsMax[1]), `Small/Big Heart ${pk.smallHeart[1]}/${pk.bigHeart[1]}`, `Soul Steal orbs heal ${n.soulSteal[1]}`]),
        feature("☠", "Bosses that hold their ground", "Karasuman, Slogra, both Doppelgangers and Richter shrug off hit-stun. Succubus only flinches during her clone attack and fights faster. The Stopwatch's freeze is shorter, but the bosses that used to ignore it are now slowed to quarter speed.",
          ["No Flinch", "Faster Succubus", "Stopwatch slows bosses"]),
        feature("✠", "Epic Richter", `A completely new boss AI: distance-based combos, slide kicks, blade dashes and backflips, every subweapon and item crash, a faster aggressive phase after Hydro Storm, and a stopwatch-and-dagger finisher. ${fmt(bossHp("Richter Belmont"))} HP, and beating him always opens the Inverted Castle.`,
          ["New AI", "Always saved", "Item crashes"]),
        feature("✦", "Your weapon picks your subweapon", "The subweapon follows the weapon in your first hand: 72 weapons carry one, and its icon sits beside the weapon in the equipment menu. Subweapon candles drop Big Hearts instead, Holy Water flies in Richter's arc with flames that race along the floor, and Agunea's chain is capped.",
          ["72 weapon pairings", "Richter-style Holy Water", "Agunea Limit"]),
        feature("✚", "Healing, reinvented", `Potions are never used up. ${heal}, paid for with ${anyHearts ? "hearts" : "MP"} (${costs}). Hold L2 and tap a face button to drink without opening the menu. Food is eaten the moment you use it or pick it up, hearts trickle back on their own, and every cloak turns survived damage into hearts.`,
          ["Quick Items (L2)", "Eat Food on Pickup", "Heart Regeneration", "All Cloaks give Hearts"]),
        feature("☾", "Dark Metamorphosis unleashed", "Dark Metamorphosis now raises ATK, INT and DEF and speeds up walking, jumping, falling and backdashing while it lasts. Spells hit like they mean it: " +
          n.spells.filter(s => s.attack && s.attack[1] > s.attack[0]).sort((x, y) => y.attack[1] - x.attack[1]).slice(0, 3).map(s => `${s.name} ${fmt(s.attack[1])}`).join(", ") + " attack.",
          ["Stat buff", "SpeedUp"]),
        feature("✧", "Move like a vampire lord", `The Leap Stone becomes Sky Walker: jump again in midair as often as you like, with the dive kick on Up+Triangle. The Wolf no longer hops when you transform${n.mistDrain ? `, and Mist drains only ${n.mistDrain[1]} MP` : ""}. Power of Mist and Gas Cloud have traded pedestals.`,
          ["Sky Walker", "No Jump Wolf", "Mist & Gas swap"]),
        feature("❖", "A sharper castle", "37 enemy types notice you from twice as far away. A MiniMap tracks your square, warp rooms teleport in a blink, and damage numbers color-code weaknesses and resistances. Your Faerie stops using up your items and casts a random +20 stat buff when you take a hit.",
          ["MiniMap", "Fast Warp", "Damage Number Colors", "Faerie buffs"])));
  }
  const bossHp = name => n.bosses.find(b => b.name === name)?.hp[1] ?? 0;

  function numbers() {
    const a = n.alucard, top = Math.max(...n.bosses.map(b => b.hp[1]));
    const row = (label, p, unit) => el("tr", {}, el("th", {text: label}), el("td", {}, pair(p, unit)));
    return el("section", {class: "ass2Section ass2Split"},
      el("div", {},
        el("h2", {class: "ass2H", text: "Bosses, rebuilt"}),
        el("table", {class: "ass2Bosses"},
          el("thead", {}, el("tr", {}, el("th", {text: "Boss"}), el("th", {text: "Vanilla"}), el("th", {text: "ASS 2.0"}), el("th", {"aria-hidden": "true"}))),
          el("tbody", {}, n.bosses.map(b => el("tr", {},
            el("th", {text: b.name}), el("td", {class: "num", text: fmt(b.hp[0])}), el("td", {class: "num hot", text: fmt(b.hp[1])}),
            el("td", {class: "bar"}, el("span", {style: `width:${(100 * b.hp[1] / top).toFixed(1)}%`}))))))),
      el("div", {},
        el("h2", {class: "ass2H", text: "Alucard by the numbers"}),
        el("table", {class: "ass2Compare"}, el("tbody", {},
          row("Starting HP", a.hpMax), row("Starting MP", a.mpMax), row("Max hearts", a.heartsMax),
          row("STR / CON / INT / LCK", a.str), row("Life Max Up", n.pickups.hpMaxUp, " HP"), row("Heart Max Up", n.pickups.heartMaxUp),
          row("Small Heart", n.pickups.smallHeart), row("Big Heart", n.pickups.bigHeart),
          ...n.potions.filter(p => p.vanilla).map(p => row(p.name, [p.vanilla, p.ass], " HP")))),
        el("h2", {class: "ass2H small", text: "Subweapons"}),
        el("table", {class: "ass2Compare"}, el("tbody", {},
          n.subweapons.filter(s => s.attack[1] !== s.attack[0]).map(s => row(`${s.name} damage`, s.attack))))));
  }

  function hackList() {
    const list = hacks();
    if (!list.length) return null;
    return el("section", {class: "ass2Section"},
      el("h2", {class: "ass2H", text: `All ${list.length} gameplay hacks`}),
      el("p", {class: "ass2Lead", text: "Every one of these is in ASS 2.0. The Extra Hacks tab can also add most of them to a vanilla BIN one at a time, or remove them from ASS 2.0."}),
      el("div", {class: "ass2Hacks"}, list.map(f => el("details", {class: "ass2Hack"},
        el("summary", {}, el("strong", {text: f.label}), f.subtitle ? el("span", {text: f.subtitle}) : null),
        el("p", {text: f.summary || ""})))));
  }

  function gallery() {
    const box = el("section", {class: "ass2Section hidden", id: "ass2Gallery"},
      el("h2", {class: "ass2H", text: "Screenshots"}), el("div", {class: "ass2Shots"}));
    fetch("ass2/screenshots/screenshots.json", {cache: "no-store"}).then(r => r.ok ? r.json() : []).then(shots => {
      if (!Array.isArray(shots) || !shots.length) return;
      box.querySelector(".ass2Shots").replaceChildren(...shots.map(s => el("figure", {class: "ass2Shot"},
        el("a", {href: `ass2/screenshots/${s.file}`, target: "_blank", rel: "noopener"},
          el("img", {src: `ass2/screenshots/${s.file}`, alt: s.caption || "Alternate Scarlet Symphony 2.0 screenshot", loading: "lazy"})),
        s.caption ? el("figcaption", {text: s.caption}) : null)));
      box.classList.remove("hidden");
    }).catch(() => {});
    return box;
  }

  function install() {
    return el("section", {class: "ass2Section ass2Install", id: "ass2Install"},
      el("h2", {class: "ass2H", text: "Get it"}),
      el("div", {class: "ass2InstallGrid"},
        el("div", {class: "ass2Panel"},
          el("h3", {text: "Build it here"}),
          el("ol", {class: "ass2Steps"},
            el("li", {}, "Select ", el("b", {text: "Open SOTN BIN"}), " and choose your US ", el("code", {text: "(Track 1).bin"}), "."),
            el("li", {text: "Come back to this tab. The editor checks every patched byte against vanilla."}),
            el("li", {text: "Select Build, pick where to save, and keep Track 2 next to it."})),
          el("button", {id: "ass2Build", class: "ass2Button primary", type: "button", disabled: true, onclick: buildBin}, "Build Alternate Scarlet Symphony 2.0"),
          el("div", {id: "ass2BuildStatus", class: "ass2Status idle"}),
          el("p", {class: "ass2Fine", text: "Your BIN is only read. The new image is checked against the release CRC32 before it is saved. Unsaved editor changes are not included."})),
        el("div", {class: "ass2Panel"},
          el("h3", {text: "Or patch it yourself"}),
          el("ol", {class: "ass2Steps"},
            el("li", {}, el("a", {href: R.ppf.file, download: R.ppf.name, text: "Download the PPF"}), ` (${mb(R.ppf.size)}).`),
            el("li", {}, "Apply it to ", el("code", {text: R.vanilla.name}), " with PPF-O-Matic or any other PPF3 patcher."),
            el("li", {}, "Point your .cue at the patched Track 1 and play. ", el("button", {type: "button", class: "ass2Link", onclick: () => downloadCue(R.result.name), text: "Download a .cue"}))),
          el("dl", {class: "ass2Hashes"},
            el("dt", {text: "Input: US Track 1"}), el("dd", {}, el("code", {text: `SHA-256 ${R.vanilla.sha256}`})),
            el("dt", {text: "Output: ASS 2.0"}), el("dd", {}, el("code", {text: `SHA-256 ${R.result.sha256}`}), el("code", {text: `CRC32 ${R.result.crc32}`})),
            el("dt", {text: "Patch"}), el("dd", {}, el("code", {text: `SHA-256 ${R.ppf.sha256}`}))),
          el("p", {class: "ass2Fine", text: "The patch includes a PPF3 block check and undo data, so patchers can verify the input and undo it."}))));
  }

  function credits() {
    return el("section", {class: "ass2Section ass2Credits"},
      el("p", {text: "Alternate Scarlet Symphony 2.0 builds on Alternate Scarlet Symphony 1.3.1 and the BigNumbers rebalance. Damage Number Colors are ported from Reawakened. Research used the sotn-decomp project. Castlevania: Symphony of the Night is © Konami; this is an unofficial fan modification."}),
      el("p", {class: "ass2Fine", text: `Release data built ${R.built}.`}));
  }

  function render() {
    const view = $("ass2View");
    if (!view) return;
    if (!R || !Core) { view.replaceChildren(el("p", {class: "ass2Fine", text: "The ASS 2.0 release data is missing."})); return; }
    if (!rendered) {
      view.replaceChildren(el("div", {class: "ass2Page"}, hero(), features(), numbers(), gallery(), hackList(), install(), credits()));
      rendered = true;
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
