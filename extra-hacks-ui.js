(function (global) {
  "use strict";

  // Extra Hacks: optional ASS hacks recognized by their own bytes, not by a whole-image hash.
  // An image is accepted when its code fingerprint matches vanilla US or Alternate Scarlet Symphony;
  // each hack is then read as on, off, or unrecognized from the bytes it owns.

  const UNSUPPORTED = "This imported BIN doesn't support this feature.";

  const CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const hex8 = value => (value >>> 0).toString(16).toUpperCase().padStart(8, "0");

  // Immediate operands of addi/addiu/slti/sltiu/andi/ori/xori/lui are tuning values, so the
  // fingerprint ignores them: a later build that only retunes numbers is still recognized.
  function maskedCopy(bytes, offset, length) {
    const out = bytes.slice(offset, offset + length);
    for (let at = (4 - (offset & 3)) & 3; at + 4 <= out.length; at += 4) {
      const op = out[at + 3] >>> 2;
      if (op >= 8 && op <= 15) { out[at] = 0; out[at + 1] = 0; }
    }
    return out;
  }

  function hexBytes(value) {
    if (typeof value !== "string" || value.length % 2 || !/^[0-9a-f]*$/i.test(value)) return null;
    const bytes = new Uint8Array(value.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  }

  function prepareEdit(feature, edit) {
    const on = hexBytes(edit.on), off = hexBytes(edit.off);
    const vanillaOff = edit.vanillaOff ? hexBytes(edit.vanillaOff) : off;
    if (!on || !off || !vanillaOff || !on.length || on.length !== off.length || vanillaOff.length !== on.length) {
      throw new Error(`Extra Hacks catalog: invalid edit in ${feature.id} at ${edit.file} 0x${Number(edit.offset).toString(16)}.`);
    }
    const tunable = new Uint8Array(on.length);
    for (const [start, length] of edit.tunable || []) tunable.fill(1, start, start + length);
    // onAlt: other byte forms that older releases used for the same hack; they read as on.
    const onAlt = [], onAltTunable = [];
    for (const form of edit.onAlt || []) {
      const alt = hexBytes(typeof form === "string" ? form : form.bytes);
      if (!alt || alt.length !== on.length) throw new Error(`Extra Hacks catalog: invalid alternate in ${feature.id}.`);
      const mask = typeof form === "string" ? tunable : new Uint8Array(on.length);
      if (typeof form !== "string") for (const [start, length] of form.tunable || []) mask.fill(1, start, start + length);
      onAlt.push(alt);
      onAltTunable.push(mask);
    }
    // vanillaOn: the form written when the hack is added to a vanilla image (for example
    // damage values scaled for vanilla stats); it reads as on in either image.
    const vanillaOn = edit.vanillaOn ? hexBytes(edit.vanillaOn) : on;
    if (!vanillaOn || vanillaOn.length !== on.length) throw new Error(`Extra Hacks catalog: invalid vanillaOn in ${feature.id}.`);
    if (vanillaOn !== on) { onAlt.push(vanillaOn); onAltTunable.push(tunable); }
    // with: the form these bytes take when another hack is on too (for example the L2 shortcuts
    // spending hearts when Healing items use Hearts is on). Either form reads as on.
    let withEdit = null;
    if (edit.with) {
      withEdit = {feature: edit.with.feature, on: hexBytes(edit.with.on)};
      if (!withEdit.on || withEdit.on.length !== on.length) throw new Error(`Extra Hacks catalog: invalid with-bytes in ${feature.id}.`);
      onAlt.push(withEdit.on);
      onAltTunable.push(tunable);
    }
    // Written when toggling but not used to decide whether the hack is present: edits made only of
    // tunable bytes (item-table values the Stats Editor can change), and install-only code that
    // other ASS features share (its ASS off bytes equal its on bytes).
    const detect = tunable.some(flag => !flag) && on.some((value, i) => value !== off[i]);
    // stats: an item cost the Stats Editor shows; the app writes it through the stats model.
    return {file: edit.file, offset: edit.offset, on, off, vanillaOff, vanillaOn, tunable, onAlt, onAltTunable, detect, with: withEdit, stats: !!edit.stats, free: !!edit.free, optional: !!edit.optional};
  }

  // Stage entity-layout records are 10 bytes: x, y, entity id, slot, params (u16 each). The map
  // editor can re-pack layouts, so entity hacks find their records by x/y/id/slot, not by offset.
  const u16 = (b, o) => b[o] | b[o + 1] << 8;
  function prepareEntity([file, x, y, id, slot, off, on, vanillaOnly]) {
    return {file, x, y, id, slot, off, on, vanillaOnly: !!vanillaOnly};
  }
  function entityParams(bytes, entity) {
    const found = [];
    for (let at = 0; at + 10 <= bytes.length; at += 2) {
      if (u16(bytes, at) === entity.x && u16(bytes, at + 2) === entity.y && u16(bytes, at + 4) === entity.id && u16(bytes, at + 6) === entity.slot) found.push(at + 8);
    }
    return found;
  }
  const entitiesFor = (feature, profile) => feature.entities.filter(entity => profile === "vanilla" || !entity.vanillaOnly);
  function entityCounts(feature, files, profile) {
    const counts = {on: 0, off: 0, other: 0, missing: 0, total: 0};
    for (const entity of entitiesFor(feature, profile)) {
      counts.total++;
      const bytes = files.get(entity.file);
      // A record with the same key but other params is a different entity in another room.
      const params = bytes ? entityParams(bytes, entity).map(at => u16(bytes, at)).filter(value => value === entity.on || value === entity.off) : [];
      if (!params.length) counts.missing++;
      else if (params.every(value => value === entity.on)) counts.on++;
      else if (params.every(value => value === entity.off)) counts.off++;
      else counts.other++;
    }
    return counts;
  }

  function prepareCatalog(raw) {
    if (!raw || raw.version !== 2 || !Array.isArray(raw.features)) return null;
    const features = raw.features.map(feature => ({
      ...feature,
      requires: feature.requires || [],
      vanillaRequires: feature.vanillaRequires || [],
      entities: (feature.entities || []).map(prepareEntity),
      edits: (feature.edits || []).map(edit => prepareEdit(feature, edit)),
      onVersions: (feature.onVersions || []).map(version => {
        if (version.length !== feature.edits.length) throw new Error(`Extra Hacks catalog: incomplete version in ${feature.id}.`);
        return version.map((bytes, i) => {
          const parsed = hexBytes(bytes);
          if (!parsed || parsed.length !== feature.edits[i].on.length / 2) throw new Error(`Extra Hacks catalog: invalid version in ${feature.id}.`);
          return parsed;
        });
      }),
      // vanillaEdits: a hack that needs different bytes on vanilla (the relic swap uses other pedestals).
      vanillaEdits: feature.vanillaEdits ? feature.vanillaEdits.map(edit => prepareEdit(feature, edit)) : null
    }));
    return {...raw, features};
  }

  // vanillaRequires: dependencies that apply only when adding hacks to a vanilla image.
  const requiresFor = (feature, profile) => profile === "vanilla" ? [...feature.requires, ...feature.vanillaRequires] : feature.requires;
  const editsFor = (feature, profile) => profile === "vanilla" && feature.vanillaEdits ? feature.vanillaEdits : feature.edits;

  function filesUsed(catalog) {
    const names = new Set(Object.keys(catalog.files || {}));
    for (const file of Object.keys(catalog.fingerprint?.windows || {})) names.add(file);
    for (const [file] of catalog.fingerprint?.markers || []) names.add(file);
    for (const feature of catalog.features) {
      for (const edit of [...feature.edits, ...feature.vanillaEdits || [], ...feature.entities]) names.add(edit.file);
      for (const [file] of feature.context || []) names.add(file);
    }
    return [...names];
  }

  function regionCrc(files, file, offset, length) {
    const bytes = files.get(file);
    return bytes && offset + length <= bytes.length ? hex8(crc32(maskedCopy(bytes, offset, length))) : null;
  }

  // windows: code shared by vanilla US and ASS; another mod that rewrites code misses many of them.
  // markers: code and data that ASS changed from vanilla; their majority tells the two apart, so a
  // build with some edited stats or tables still votes clearly for its family.
  function fingerprint(catalog, files) {
    const fp = catalog.fingerprint;
    let windowMisses = 0, windows = 0, vanillaVotes = 0, assVotes = 0;
    for (const [file, list] of Object.entries(fp.windows)) {
      for (let i = 0; i < list.length; i += 2, windows++) {
        if (regionCrc(files, file, list[i], fp.windowLength) !== list[i + 1]) windowMisses++;
      }
    }
    for (const [file, offset, length, vanilla, ass] of fp.markers) {
      const crc = regionCrc(files, file, offset, length);
      if (crc === vanilla) vanillaVotes++;
      else if (crc === ass) assVotes++;
    }
    const votes = vanillaVotes + assVotes;
    let profile = null;
    if (windowMisses <= fp.windowTolerance && votes >= fp.minMarkerVotes) {
      if (vanillaVotes >= votes * fp.markerAgreement) profile = "vanilla";
      else if (assVotes >= votes * fp.markerAgreement) profile = "ass";
    }
    return {profile, windowMisses, windows, vanillaVotes, assVotes, markers: fp.markers.length};
  }

  const NONE = new Uint8Array(0);
  function matches(actual, expected, tunable = NONE) {
    for (let i = 0; i < expected.length; i++) if (!tunable[i] && actual[i] !== expected[i]) return false;
    return true;
  }

  // Exact off bytes read as off. Otherwise the hack's fixed bytes decide: tunable bytes (balance
  // numbers inside the hack) may hold any value, so a retuned hack still reads as on.
  function editState(actual, edit, profile) {
    const offBytes = profile === "vanilla" ? edit.vanillaOff : edit.off;
    const exactOn = matches(actual, edit.on) || edit.onAlt.some(alt => matches(actual, alt));
    const exactOff = matches(actual, offBytes);
    if (exactOn && exactOff) return "same";
    if (exactOff) return "off";
    if (exactOn || matches(actual, edit.on, edit.tunable) || edit.onAlt.some((alt, i) => matches(actual, alt, edit.onAltTunable[i]))) return "on";
    if (matches(actual, offBytes, edit.tunable)) return "off";
    return "unknown";
  }

  function featureState(feature, files, profile) {
    // Recognize complete earlier versions.
    for (const [version, forms] of (feature.onVersions || []).entries()) {
      if (editsFor(feature, profile) !== feature.edits) continue;
      if (forms.every((form, i) => {
        const edit = feature.edits[i], bytes = files.get(edit.file);
        return bytes && edit.offset + form.length <= bytes.length && matches(bytes.subarray(edit.offset, edit.offset + form.length), form);
      })) return {state: "on", version: version + 1};
    }
    let on = 0, off = 0;
    const optional = [];
    for (const edit of editsFor(feature, profile)) {
      const bytes = files.get(edit.file);
      if (!bytes || edit.offset + edit.on.length > bytes.length) return {state: "unknown", mismatch: edit};
      if (!edit.detect) continue;
      const state = editState(bytes.subarray(edit.offset, edit.offset + edit.on.length), edit, profile);
      if (state === "unknown") return {state, mismatch: edit};
      if (edit.optional) {
        optional.push(matches(bytes.subarray(edit.offset, edit.offset + edit.on.length), edit.off) ? "off" : "on");
        continue;
      }
      if (state === "on") on++;
      else if (state === "off") off++;
    }
    // A hack made of independent tuning values (for example detection ranges) stays on when a
    // later build resets some of them to vanilla.
    if (new Set(optional).size > 1 || (!on && optional.includes("on"))) return {state: "unknown"};
    if (on && off) return {state: feature.partialIsOn ? "on" : "mixed"};
    return {state: on ? "on" : "off"};
  }

  function contextOk(feature, files) {
    return (feature.context || []).every(([file, offset, length, crc]) => regionCrc(files, file, offset, length) === crc);
  }

  // Reads the tuning values a hack shows in the UI from the 16-bit immediates that hold them.
  const TRANSFORMS = {
    // sltiu limit on a frame counter that strikes every 12 frames: extra strikes after the first.
    aguneaExtra: v => Math.max(0, Math.ceil(v / 12) - 1),
    // speed + (speed >> n): shown as a multiplier.
    sraMultiplier: v => +(1 + 1 / 2 ** ((v >> 6) & 31)).toFixed(3),
    // Item cost (mpUsage): bit 0x8000 makes it a heart cost (Healing items use Hearts).
    cost: v => v & 0x8000 ? `${v & 0x7FFF} hearts` : `${v} MP`
  };
  const transformValue = (def, v) => TRANSFORMS[def.transform] ? TRANSFORMS[def.transform](v) : v;
  function readValues(feature, files) {
    const values = {};
    for (const value of feature.values || []) {
      if (value.optional && feature.edits.filter(e => e.optional).every(e => matches(files.get(e.file)?.subarray(e.offset, e.offset + e.off.length) || NONE, e.off))) {
        values[value.key] = feature.defaults?.[value.key] ?? 0;
        continue;
      }
      const bytes = files.get(value.file);
      if (!bytes || value.offset + 2 > bytes.length) continue;
      let v = bytes[value.offset] | bytes[value.offset + 1] << 8;
      if (value.signed && v & 0x8000) v -= 0x10000;
      values[value.key] = transformValue(value, v);
    }
    return values;
  }

  // Inspect an image. files: Map of ISO path -> Uint8Array (missing files may be absent).
  function analyze(catalog, files) {
    for (const [file, size] of Object.entries(catalog.files || {})) {
      if (!files.has(file) || files.get(file).length !== size) {
        return {profile: null, reason: `${file} is missing or has an unexpected size.`, features: []};
      }
    }
    const print = fingerprint(catalog, files);
    const result = {profile: print.profile, print, features: []};
    if (!print.profile) {
      result.reason = print.windowMisses > catalog.fingerprint.windowTolerance
        ? `Its game code differs from vanilla US and Alternate Scarlet Symphony in ${print.windowMisses} of ${print.windows} checked regions.`
        : `Its code matches neither vanilla US nor Alternate Scarlet Symphony (${print.vanillaVotes} vanilla and ${print.assVotes} ASS markers of ${print.markers}).`;
      return result;
    }
    for (const feature of catalog.features) {
      const state = featureState(feature, files, print.profile);
      // free: code placed in spare space (for example text padding) installs only where that space is still free.
      const taken = editsFor(feature, print.profile).find(edit => {
        const bytes = files.get(edit.file);
        return edit.free && bytes && !matches(bytes.subarray(edit.offset, edit.offset + edit.on.length), print.profile === "vanilla" ? edit.vanillaOff : edit.off);
      });
      if (taken) state.blocked = `${taken.file} 0x${taken.offset.toString(16).toUpperCase()}`;
      result.features.push({id: feature.id, ...state, context: contextOk(feature, files), values: readValues(feature, files),
        entities: feature.entities.length ? entityCounts(feature, files, print.profile) : null});
    }
    return result;
  }

  // Decide which hacks can be toggled for an analysis, given the user's selection (id -> bool).
  function availability(catalog, analysis) {
    const out = new Map();
    for (const feature of catalog.features) {
      const info = analysis.features.find(item => item.id === feature.id);
      let reason = "", canToggle = false;
      if (!analysis.profile || !info) reason = UNSUPPORTED;
      else if (analysis.profile === "vanilla" && feature.vanilla !== true && info.state !== "on") reason = typeof feature.vanilla === "string" ? feature.vanilla : "Available only on Alternate Scarlet Symphony images.";
      else if (info.state === "unknown" || info.state === "mixed") reason = UNSUPPORTED;
      else if (info.state === "off" && info.blocked) reason = `The spare space this hack needs (${info.blocked}) holds other data in this BIN, such as longer item text.`;
      else if (info.state === "off" && !info.context) reason = feature.contextReason || "This BIN lacks the Alternate Scarlet Symphony code this hack builds on.";
      else canToggle = true;
      out.set(feature.id, {feature, info, reason, canToggle, source: info?.state === "on"});
    }
    return out;
  }

  // Apply a selection: returns {selected, notes}. Turning a hack on turns on what it requires;
  // turning one off turns off hacks that require it.
  function cascade(catalog, avail, selected, id, value, profile = null) {
    const next = new Map(selected), notes = [];
    const byId = new Map(catalog.features.map(feature => [feature.id, feature]));
    const visit = (key, on) => {
      if (next.get(key) === on) return;
      next.set(key, on);
      if (on) for (const need of byId.get(key) ? requiresFor(byId.get(key), profile) : []) {
        if (!avail.get(need)?.canToggle && !avail.get(need)?.source) throw new Error(`${byId.get(key).label} needs ${byId.get(need)?.label || need}, which this BIN cannot enable.`);
        if (!next.get(need)) { notes.push(`${byId.get(need).label} was turned on because ${byId.get(key).label} needs it.`); visit(need, true); }
      } else for (const other of catalog.features) {
        if (requiresFor(other, profile).includes(key) && next.get(other.id)) { notes.push(`${other.label} was turned off because it needs ${byId.get(key).label}.`); visit(other.id, false); }
      }
    };
    visit(id, value);
    return {selected: next, notes};
  }

  // Every edit a selection implies: the hacks whose selection differs from the source image, plus
  // the "with" bytes of a selected hack when the hack they depend on changes.
  function plannedEdits(catalog, analysis, selected) {
    const edits = [];
    const source = new Map(analysis.features.map(item => [item.id, item.state === "on"]));
    const changed = id => !!selected.get(id) !== source.get(id);
    const vanilla = analysis.profile === "vanilla";
    for (const feature of catalog.features) {
      const info = analysis.features.find(item => item.id === feature.id);
      if (!info || (info.state !== "on" && info.state !== "off")) continue;
      const want = !!selected.get(feature.id), self = changed(feature.id);
      for (const edit of editsFor(feature, analysis.profile)) {
        if (want && edit.optional) continue;
        if (!self && !(want && edit.with && changed(edit.with.feature))) continue;
        const bytes = !want ? (vanilla ? edit.vanillaOff : edit.off) :
          edit.with && selected.get(edit.with.feature) ? edit.with.on : (vanilla ? edit.vanillaOn : edit.on);
        edits.push({file: edit.file, offset: edit.offset, bytes, label: feature.label, stats: edit.stats});
      }
      if (!self) continue;
      for (const entity of entitiesFor(feature, analysis.profile)) {
        edits.push({file: entity.file, entity, from: want ? entity.off : entity.on, to: want ? entity.on : entity.off, label: feature.label});
      }
    }
    return edits;
  }
  // Byte edits for a build. options.statsOwned(file, offset) is true for item costs the Stats
  // Editor writes itself (see statsValues).
  function plan(catalog, analysis, selected, options = {}) {
    const edits = plannedEdits(catalog, analysis, selected).filter(edit => !(edit.stats && options.statsOwned?.(edit.file, edit.offset)));
    for (const feature of catalog.features) {
      const tuning = options.tuning?.get(feature.id);
      if (!selected.get(feature.id) || !tuning || !Object.keys(tuning).length) continue;
      const info = analysis.features.find(f => f.id === feature.id);
      if (!info || !["on", "off"].includes(info.state)) throw new Error(`${feature.label}: bonus code is not recognized.`);
      const baseline = info.state === "on" ? info.values : feature.defaults;
      const install = (feature.values || []).some(v => v.optional && tuning[v.key] !== undefined && tuning[v.key] !== baseline[v.key]);
      if (install) for (const edit of feature.edits.filter(e => e.optional)) {
        if (!edits.some(e => e.file === edit.file && e.offset === edit.offset)) edits.push({file: edit.file, offset: edit.offset, bytes: edit.on.slice(), label: feature.label});
      }
      for (const def of feature.values || []) {
        if (!def.editable) continue;
        const value = tuning[def.key] ?? baseline?.[def.key] ?? feature.defaults?.[def.key];
        if (tuning[def.key] !== undefined && (!Number.isInteger(value) || value < def.min || value > def.max)) throw new Error(`${def.key.toUpperCase()} bonus must be between ${def.min} and ${def.max}.`);
        for (const offset of def.offsets || [def.offset]) {
          const existing = edits.find(e => e.file === def.file && e.offset <= offset && e.offset + e.bytes.length >= offset + 2);
          if (existing) {
            existing.bytes = existing.bytes.slice();
            existing.bytes[offset - existing.offset] = value & 255;
            existing.bytes[offset - existing.offset + 1] = value >> 8 & 255;
          } else if (tuning[def.key] !== undefined && value !== baseline?.[def.key]) {
            edits.push({file: def.file, offset, bytes: Uint8Array.of(value & 255, value >> 8 & 255), label: feature.label});
          }
        }
      }
    }
    return edits;
  }
  // Item costs (u16) for the Stats Editor: [{file, offset, value}], value null where the selection
  // leaves the cost as the BIN has it.
  function statsValues(catalog, analysis, selected) {
    const planned = new Map();
    for (const edit of plannedEdits(catalog, analysis, selected)) if (edit.stats) planned.set(`${edit.file}:${edit.offset}`, edit);
    const out = [];
    for (const feature of catalog.features) for (const edit of editsFor(feature, analysis.profile)) {
      if (!edit.stats) continue;
      const p = planned.get(`${edit.file}:${edit.offset}`);
      out.push({file: edit.file, offset: edit.offset, value: p ? p.bytes[0] | p.bytes[1] << 8 : null, label: feature.label});
    }
    return out;
  }

  function conflict(message) {
    const error = new Error(message);
    error.extraHackConflict = true;
    return error;
  }

  // Write planned edits into {before, after} file buffers; edits made by the other editors win only
  // if they agree with the hack, otherwise the build stops with a conflict.
  // Entity edits are matched in the already edited file, so a map edit made in this session that
  // moved the layout is followed; a record the user moved or retyped keeps the user's version.
  function applyEdits(file, edits, path) {
    for (const edit of edits) {
      if (edit.entity) {
        for (const at of entityParams(file.after, edit.entity)) {
          if (u16(file.after, at) === edit.from) { file.after[at] = edit.to & 255; file.after[at + 1] = edit.to >> 8; }
        }
        continue;
      }
      if (edit.offset + edit.bytes.length > file.after.length) throw new Error(`${edit.label} does not fit ${path}.`);
      for (let i = 0; i < edit.bytes.length; i++) {
        const at = edit.offset + i;
        if (file.after[at] !== file.before[at] && file.after[at] !== edit.bytes[i]) {
          throw conflict(`${edit.label} conflicts with a map, stats or shop edit in ${path} at 0x${at.toString(16).toUpperCase()}. Undo that edit or leave the hack unchanged.`);
        }
        file.after[at] = edit.bytes[i];
      }
    }
  }

  // ---- browser UI ----
  const $ = id => global.document?.getElementById(id);
  let hooks = {};
  let catalog = null;
  let catalogError = "";
  let disc = null, records = new Map(), files = new Map();
  let analysis = null, avail = new Map(), selected = new Map();
  let tuning = new Map();
  let phase = "empty", statusText = "Open a BIN to inspect Extra Hacks.", noteText = "";
  let loadToken = 0;

  try { catalog = prepareCatalog(global.SotnExtraHacks); if (!catalog) catalogError = "The Extra Hacks catalog is missing."; }
  catch (error) { catalogError = error.message; }

  function element(tag, className, text) {
    const node = global.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function stateLabel(state) {
    return ({on: "On", off: "Off", mixed: "Partly present", unknown: "Not recognized"})[state] || "—";
  }

  // Values come from the loaded BIN when the hack is already there, otherwise from what a build adds.
  function valueText(feature, info) {
    if (!feature.valueTemplate) return "";
    const values = {...(feature.defaults || {}), ...(info?.state === "on" ? info.values : {}), ...tuning.get(feature.id)};
    // Item costs follow the Stats Editor, which also holds what this selection sets.
    for (const def of feature.values || []) {
      const current = hooks.currentValue?.(def.file, def.offset);
      if (Number.isInteger(current)) values[def.key] = transformValue(def, current);
    }
    return feature.valueTemplate.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "?");
  }

  function renderStatus() {
    const node = $("extraHacksSourceStatus");
    if (node) {
      node.textContent = statusText;
      node.classList.toggle("unsupported", phase === "unsupported");
    }
    const notes = $("extraHacksConflict");
    if (notes) { notes.textContent = noteText; notes.classList.toggle("hidden", !noteText); }
  }

  function render() {
    const list = $("extraHacksList");
    if (!list || !global.document) return;
    list.replaceChildren();
    list.classList.toggle("blocked", phase === "unsupported");
    for (const feature of catalog?.features || []) {
      const entry = avail.get(feature.id);
      const info = entry?.info;
      const on = !!selected.get(feature.id);
      const card = element("article", "extraHackCard");
      const label = element("label", "extraHackLabel");
      const input = element("input");
      input.type = "checkbox";
      input.checked = on;
      input.disabled = phase !== "ready" || !entry?.canToggle;
      input.addEventListener("change", () => toggle(feature.id, input.checked));
      const text = element("span", "extraHackText");
      const name = element("span", "extraHackName", feature.label);
      if (feature.wip) name.append(" ", element("span", "extraHackWip", "WIP"));
      text.append(name);
      if (feature.subtitle) text.append(element("span", "extraHackSubtitle", feature.subtitle));
      label.append(input, text);
      card.append(label);
      if (phase === "ready" && info) {
        const states = element("div", "extraHackStates");
        const vanillaOnly = analysis.profile === "vanilla" && feature.vanilla !== true && info.state !== "on";
        states.append(element("span", "", `In this BIN: ${vanillaOnly ? "Not available on vanilla" : stateLabel(info.state)}`));
        if (entry.canToggle && on !== entry.source) states.append(element("span", "extraHackSelected changed", `Build: ${on ? "adds it" : "removes it"}`));
        card.append(states);
      }
      if (feature.summary) card.append(element("p", "extraHackDetail", feature.summary));
      if (phase === "ready" && info?.entities?.total) {
        const e = info.entities;
        card.append(element("p", "extraHackDetail", `${feature.entityLabel || "Entities"}: ${e.on} of ${e.total} ${feature.entityOnText || "changed"} in this BIN${e.missing + e.other ? `; ${e.missing + e.other} were moved or changed in the map editor and are left as they are` : ""}.`));
      }
      const values = on ? valueText(feature, info) : "";
      if (values) card.append(element("p", "extraHackDetail extraHackBonus", values));
      if ((feature.values || []).some(v => v.editable)) {
        const controls = element("div", "sfGrid");
        for (const def of feature.values.filter(v => v.editable)) {
          const label = element("label", "sf");
          label.append(element("span", "sfLabel", `${def.key.toUpperCase()} bonus`));
          const input = element("input", "sfNum");
          input.type = "number"; input.min = def.min; input.max = def.max; input.step = 1;
          const original = info?.state === "on" ? info.values[def.key] : feature.defaults[def.key];
          input.value = tuning.get(feature.id)?.[def.key] ?? original;
          input.disabled = !on || phase !== "ready" || !entry?.canToggle;
          input.classList.toggle("changed", Number(input.value) !== original);
          input.addEventListener("change", () => {
            const value = Number(input.value);
            if (!input.value.trim() || !Number.isInteger(value) || value < def.min || value > def.max) {
              input.classList.add("invalid"); noteText = `${def.key.toUpperCase()} bonus must be between ${def.min} and ${def.max}.`; renderStatus(); return;
            }
            const before = tuning;
            tuning = new Map(tuning);
            const next = {...tuning.get(feature.id)};
            if (value === original) delete next[def.key]; else next[def.key] = value;
            tuning.set(feature.id, next); noteText = "";
            hooks.pushUndo?.(`${def.key.toUpperCase()} bonus edit`, () => { tuning = before; noteText = ""; render(); });
            render(); hooks.onChange?.();
          });
          label.append(input); controls.append(label);
        }
        card.append(controls);
        if (!on) card.append(element("p", "extraHackDetail", "Enable this hack to configure its bonuses."));
      }
      if (on && analysis?.profile === "vanilla" && feature.vanillaNote) card.append(element("p", "extraHackDetail", feature.vanillaNote));
      const needs = requiresFor(feature, analysis?.profile);
      if (needs.length) {
        const names = needs.map(id => catalog.features.find(item => item.id === id)?.label || id);
        card.append(element("p", "extraHackDetail", `Needs: ${names.join(", ")}.`));
      }
      if (phase === "ready" && entry?.reason) card.append(element("p", "extraHackReason", entry.reason));
      list.append(card);
    }
    renderStatus();
  }

  function toggle(id, value) {
    const previous = selected;
    try {
      const result = cascade(catalog, avail, selected, id, value, analysis?.profile);
      for (const [key, on] of result.selected) {
        const entry = avail.get(key);
        if (on !== entry.source && !entry.canToggle) throw new Error(`${entry.feature.label}: ${entry.reason}`);
      }
      selected = result.selected;
      noteText = result.notes.join(" ");
    } catch (error) {
      noteText = error.message;
    }
    render();
    if (selected !== previous) {
      notifySelection();
      hooks.pushUndo?.("Extra Hacks selection", () => { selected = previous; noteText = ""; notifySelection(); });
      hooks.onChange?.();
    }
  }
  // Tells the app what the build will contain and which item costs that sets.
  function notifySelection() {
    if (hooks.onSelection) {
      const ready = phase === "ready";
      hooks.onSelection({selected: ready ? new Map(selected) : new Map(), statsValues: ready ? statsValues(catalog, analysis, selected) : []});
    }
    render();
  }

  function hasChanges() {
    return phase === "ready" && ([...avail.values()].some(entry => !!selected.get(entry.feature.id) !== entry.source) ||
      [...tuning].some(([id, values]) => selected.get(id) && Object.keys(values).length));
  }

  async function readCatalogFiles(target) {
    const out = new Map(), recs = new Map();
    for (const path of filesUsed(catalog)) {
      try {
        const record = await target.findPath(path.split("/"));
        if (record.isDirectory) continue;
        recs.set(path, record);
        out.set(path, await target.readFile(record));
      } catch { /* missing file: analyze() reports it */ }
    }
    return {files: out, records: recs};
  }

  async function setDisc(nextDisc) {
    const token = ++loadToken;
    disc = nextDisc || null;
    files = new Map(); records = new Map(); analysis = null; avail = new Map(); selected = new Map(); tuning = new Map(); noteText = "";
    phase = "empty";
    hooks.onSelection?.({selected: new Map(), statsValues: []});
    if (!disc) { phase = "empty"; statusText = "Open a BIN to inspect Extra Hacks."; render(); hooks.onReady?.(); return; }
    if (!catalog) { phase = "unsupported"; statusText = catalogError; render(); hooks.onReady?.(); return; }
    phase = "checking"; statusText = "Checking the BIN's code for Extra Hacks…"; render();
    try {
      const read = await readCatalogFiles(disc);
      if (token !== loadToken) return;
      files = read.files; records = read.records;
      analysis = analyze(catalog, files);
      if (!analysis.profile) {
        phase = "unsupported";
        statusText = UNSUPPORTED;
        noteText = analysis.reason || "";
        render(); hooks.onReady?.();
        return;
      }
      avail = availability(catalog, analysis);
      for (const entry of avail.values()) selected.set(entry.feature.id, entry.source);
      const found = analysis.features.filter(item => item.state === "on").length;
      const unknown = analysis.features.filter(item => item.state === "unknown" || item.state === "mixed").length;
      phase = "ready";
      statusText = analysis.profile === "vanilla"
        ? `Vanilla US BIN detected. ${found ? `${found} of ${catalog.features.length} hacks are already present.` : "No hacks are present; check the ones to add."}`
        : `Alternate Scarlet Symphony BIN detected. ${found} of ${catalog.features.length} hacks are present${unknown ? `; ${unknown} could not be recognized and are locked` : ""}.`;
      notifySelection(); hooks.onReady?.();
    } catch (error) {
      if (token !== loadToken) return;
      console.error(error);
      phase = "unsupported"; statusText = UNSUPPORTED; noteText = error.message || String(error); render(); hooks.onReady?.();
    }
  }

  // Edits grouped by file record for SOTN app collectChanges().
  function pendingEdits() {
    if (!hasChanges()) return [];
    const byFile = new Map();
    for (const edit of plan(catalog, analysis, selected, {statsOwned: hooks.statsOwned, tuning})) {
      if (!byFile.has(edit.file)) byFile.set(edit.file, {path: edit.file, record: records.get(edit.file), edits: []});
      byFile.get(edit.file).edits.push(edit);
    }
    for (const entry of byFile.values()) if (!entry.record) throw new Error(`${entry.path} is not on this disc.`);
    return [...byFile.values()];
  }

  const api = {
    init(options = {}) { hooks = options; render(); },
    setDisc,
    hasChanges,
    refresh: render,
    pendingEdits,
    applyEdits,
    setConflict(message) { noteText = message || ""; renderStatus(); },
    get catalog() { return catalog; },
    get analysis() { return analysis; }
  };
  global.SotnExtraHacksUI = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {UNSUPPORTED, crc32, maskedCopy, hexBytes, prepareCatalog, filesUsed, fingerprint, featureState, readValues, analyze, availability, cascade, plan, statsValues, applyEdits, api};
  }
})(typeof window !== "undefined" ? window : globalThis);
