// [Sound Browser] tab: browse, play and export the sound effects and samples of the BIN opened in the editor.
// Parsing lives in tools/audio/sound-check-core.js (also used by the standalone Sound Browser page); it and the
// 300 KB sound-name catalog are loaded the first time the tab is opened.
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const S = name => $("sound" + name);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const safe = s => String(s).replace(/[\/\\:*?"<>|]/g, "_");
  const nn = n => String(n).padStart(2, "0");
  const EMPTY_CATALOG = {names: {}, uses: {}, areaNames: {}};

  const state = {disc: null, name: "", size: 0, core: null, coreDisc: null, token: 0, data: null, selected: null, playUrl: null, sampleMap: new Map(), loading: false};
  let rendered = false, libsPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = () => { s.remove(); reject(new Error(`Could not load ${src}.`)); };
      document.head.appendChild(s);
    });
  }
  function loadLibs() {
    if (window.SotnSoundCore) return Promise.resolve();
    if (!libsPromise) {
      libsPromise = (window.SOTN_SFX_CATALOG ? Promise.resolve() : loadScript("tools/audio/sound-check-catalog.js?v=8.1"))
        .then(() => loadScript("tools/audio/sound-check-core.js?v=8.1"))
        .catch(e => { libsPromise = null; throw e; });
    }
    return libsPromise;
  }

  const MARKUP = `
    <div class="soundBar">
      <h2>Sound Browser</h2>
      <p>Inspect, play and download the sound effects and samples of the opened BIN. It reads the BIN as it was opened; unsaved editor changes are not reflected.</p>
    </div>
    <p id="soundStatus" class="soundStatus" role="status" aria-live="polite">Open a SotN BIN to browse its sounds.</p>
    <div id="soundBody" class="soundBody hidden">
      <div class="soundControls">
        <label>Character<select id="soundMode"><option value="alucard" selected>Alucard</option><option value="richter">Richter</option><option value="maria">Maria</option></select></label>
        <label>Stage / boss bank<select id="soundStage"></select></label>
        <label>Familiar bank<select id="soundFamiliar"></select></label>
        <label class="soundGrow">Search<input id="soundSearch" aria-label="Search sounds" placeholder="Search ID, name, address, source use…"></label>
        <label>Browse<select id="soundBrowse"><option value="sounds">737 PS1 sound-table slots</option><option value="samples">Every bank’s raw samples</option></select></label>
        <button id="soundCsv" type="button">Download full list (CSV)</button>
      </div>
      <div class="soundLayout">
        <div class="soundTableWrap"><table class="soundTable"><thead id="soundHead"></thead><tbody id="soundRows"></tbody></table></div>
        <div class="soundDetail">
          <h3 id="soundTitle">Pick a sound</h3>
          <div id="soundInfo" class="soundTiny soundMuted">Pick a row to see its RAM address, BIN offset and source references.</div>
          <audio id="soundPlayer" controls></audio>
          <label>Raw sample rate<select id="soundRate"><option value="11025">11,025 Hz</option><option value="22050">22,050 Hz</option><option value="44100" selected>44,100 Hz</option></select></label>
          <div class="soundRow"><button id="soundPlay" type="button" disabled>▶ Play</button><button id="soundStop" type="button">Stop</button></div>
          <div class="soundRow" aria-label="Export"><button id="soundDlVag" type="button" disabled>Download .VAG</button><button id="soundDlWav" type="button" disabled>Download .WAV</button><button id="soundDlVh" type="button" disabled>Download bank .VH</button><button id="soundDlVb" type="button" disabled>Download bank .VB</button></div>
          <p class="soundTiny soundMuted">Exports are the samples’ original PlayStation ADPCM data (.VAG) or whole banks (.VH + .VB); WAV files are decoded previews. Previews include paired tones and sound-script timing with approximate pitch and volume, stop after eight seconds, and do not emulate reverb, envelopes, looping or channel stealing.</p>
          <p class="soundTiny soundMuted">Stage and boss sound names depend on the loaded bank. Source matches are references, not a complete runtime trace. Streamed XA dialogue, movies and music are a separate audio system and are not covered here.</p>
          <p id="soundWarnings" class="soundTiny soundError"></p>
          <div id="soundImage" class="soundTiny soundMuted"></div>
          <p class="soundTiny soundMuted"><a href="https://github.com/Xeeynamo/sotn-decomp" target="_blank" rel="noopener">Sound names and call sites: sotn-decomp</a> · <a href="https://psx.arthus.net/sdk/Psy-Q/DOCS/Devrefs/Filefrmt.pdf" target="_blank" rel="noopener">Sony sound-bank format</a></p>
        </div>
      </div>
    </div>`;

  function status(text, error = false) { const n = S("Status"); n.textContent = text; n.classList.toggle("error", error); }
  function query() { return new URLSearchParams({mode: S("Mode").value, stage: S("Stage").value, familiar: S("Familiar").value}); }

  function stopPlayback() {
    const p = S("Player"); if (!p) return;
    p.pause(); p.removeAttribute("src"); p.load();
    if (state.playUrl) { URL.revokeObjectURL(state.playUrl); state.playUrl = null; }
  }
  function updateExports() {
    const r = state.selected?.row, raw = !!state.selected?.raw;
    S("DlVag").disabled = S("DlVh").disabled = S("DlVb").disabled = !raw;
    S("DlWav").disabled = !r || (!raw && !r.available);
  }
  function resetSelection() {
    stopPlayback(); state.selected = null;
    S("Title").textContent = "Pick a sound";
    S("Info").textContent = "RAM table entries and physical BIN offsets are shown separately.";
    S("Play").disabled = true; updateExports();
  }

  function download(name, content, type = "application/octet-stream") {
    const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], {type}));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function attempt(fn) { try { fn(); } catch (e) { status(e.message, true); } }

  // Rebuild the table data for the current Character / bank selection.
  function reload() {
    resetSelection();
    const core = state.core;
    if (!core) { renderTable(); return; }
    try {
      state.data = {image: core.image, imageSize: core.imageSize, banks: core.banks, rows: core.rows(query()), samples: core.samples, warnings: core.warnings};
      state.sampleMap = new Map(state.data.samples.map(s => [s.bankName + "\n" + s.sample, s]));
      renderTable();
    } catch (e) { state.data = null; renderTable(); status(e.message, true); }
  }

  function renderTable() {
    const data = state.data;
    if (!data) { S("Head").innerHTML = ""; S("Rows").innerHTML = ""; return; }
    const sample = S("Browse").value === "samples", term = S("Search").value.trim().toLowerCase();
    const all = sample ? data.samples : data.rows;
    const shown = all.filter(r => JSON.stringify(r).toLowerCase().includes(term));
    S("Head").innerHTML = sample ? "<tr><th>Bank / sample</th><th>BIN offset</th><th>Size</th></tr>" : "<tr><th>ID</th><th>Sound / where it is used</th><th>RAM table entry</th></tr>";
    S("Rows").innerHTML = shown.map(r => {
      const index = all.indexOf(r);
      return sample
        ? `<tr data-index="${index}" tabindex="0"><td>${esc(r.bankName)}<small>Sample ${r.sample}</small></td><td><code>${esc(r.bin)}</code></td><td>${r.size.toLocaleString()} bytes</td></tr>`
        : `<tr data-index="${index}" tabindex="0"><td><code>${esc(r.id)}</code><small>${r.available ? "Ready" : "Bank needed / unused"}</small></td><td>${esc(r.name)}<small>${esc(r.description || r.uses[0]?.where || "No named source usage found.")}</small></td><td><code>${esc(r.ram)}</code><small>BIN ${esc(r.bin)}</small></td></tr>`;
    }).join("");
    status(`${shown.length.toLocaleString()} of ${all.length.toLocaleString()} ${sample ? "samples" : "slots"} · ${data.banks.length} banks · click a row, then Play`);
  }

  function pick(index) {
    stopPlayback();
    const raw = S("Browse").value === "samples";
    state.selected = {raw, row: (raw ? state.data.samples : state.data.rows)[index], settings: query().toString()};
    const r = state.selected.row;
    if (raw) S("Rate").value = String([11025, 22050, 44100].reduce((a, b) => Math.abs(a - r.rate) < Math.abs(b - r.rate) ? a : b));
    S("Title").textContent = raw ? `${r.bankName} · sample ${r.sample}` : `${r.id} · ${r.name}`;
    S("Info").innerHTML = raw
      ? `<p>Sample bytes: <code>${esc(r.bin)}</code> in BIN<br>SPU: <code>${esc(r.spu)}</code> when loaded in its usual slot<br>${r.size} compressed bytes</p>`
      : `<p>${esc(r.description)}</p><p>RAM table entry: <code>${esc(r.ram)}</code><br>BIN table bytes: <code>${esc(r.bin)}</code><br>Bank / program / note / volume / mode / tone / priority:<br><code>${r.config.join(" / ")}</code></p><p>${esc(r.mapping)}</p><p>${esc(r.reason)}</p><p>Sample locations:</p><div class="soundList">${r.samples.map(s => {
          const e = state.sampleMap.get(s.bank + "\n" + s.sample);
          return `${esc(s.bank)} · sample ${s.sample}${e ? ` <button type="button" class="soundMini" data-bank="${e.bank}" data-sample="${e.sample}" data-rate="${e.rate}" title="Download this sample as a PlayStation .VAG file">VAG</button>` : ""}<br>BIN <code>${esc(s.bin)}</code> · SPU <code>${esc(s.spu)}</code><br>`;
        }).join("") || "None in the selected banks."}</div><p>Where source code uses it (${r.uses.length}):</p><div class="soundList">${r.uses.map(u => `<a href="https://github.com/Xeeynamo/sotn-decomp/blob/master/${encodeURI(u.file)}#L${Number(u.line)}" target="_blank" rel="noopener">${esc(u.where)} · ${esc(u.file)}:${Number(u.line)}</a><br>${esc(u.text)}<br>`).join("") || "No named call site found; may be numeric, unused, or missing from the decompilation."}</div>`;
    S("Play").disabled = !raw && !r.available;
    updateExports();
    for (const tr of S("Rows").children) tr.classList.toggle("selected", Number(tr.dataset.index) === index);
  }

  function previewWav() {
    const sel = state.selected, r = sel.row;
    return sel.raw ? state.core.sampleWav(r.bank, r.sample, S("Rate").value) : state.core.sound(Number(r.id), new URLSearchParams(sel.settings));
  }

  function bind() {
    S("Rows").onclick = e => { const tr = e.target.closest("tr[data-index]"); if (tr) pick(Number(tr.dataset.index)); };
    S("Rows").onkeydown = e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const tr = e.target.closest("tr[data-index]"); if (tr) pick(Number(tr.dataset.index)); }
    };
    S("Search").oninput = renderTable;
    S("Browse").onchange = () => { resetSelection(); renderTable(); };
    for (const id of ["Mode", "Stage", "Familiar"]) S(id).onchange = reload;
    S("Play").onclick = () => {
      if (!state.selected || !state.core) return;
      try {
        const wav = previewWav(); stopPlayback();
        state.playUrl = URL.createObjectURL(new Blob([wav], {type: "audio/wav"}));
        S("Player").src = state.playUrl;
        S("Player").play().then(() => status("Playing sample preview."), e => status("Could not play this preview: " + e.message, true));
      } catch (e) { status("Could not play this preview: " + e.message, true); }
    };
    S("Stop").onclick = stopPlayback;
    S("DlVag").onclick = () => attempt(() => {
      const sel = state.selected; if (!sel?.raw) return; const r = sel.row;
      download(`${safe(r.bankName)}_sample${nn(r.sample)}.vag`, state.core.sampleVag(r.bank, r.sample, r.rate || 44100));
    });
    S("DlWav").onclick = () => attempt(() => {
      const sel = state.selected; if (!sel) return; const r = sel.row;
      download(sel.raw ? `${safe(r.bankName)}_sample${nn(r.sample)}.wav` : `${safe(r.id + "_" + r.name)}.wav`, previewWav(), "audio/wav");
    });
    S("DlVh").onclick = () => attempt(() => { const sel = state.selected; if (!sel?.raw) return; const r = sel.row; download(safe(r.bankName) + ".VH", state.core.bankFiles(r.bank).vh); });
    S("DlVb").onclick = () => attempt(() => { const sel = state.selected; if (!sel?.raw) return; const r = sel.row; download(safe(r.bankName) + ".VB", state.core.bankFiles(r.bank).vb); });
    S("Info").onclick = e => {
      const b = e.target.closest("button[data-bank]"); if (!b || !state.core) return;
      attempt(() => {
        const bank = state.core.banks[Number(b.dataset.bank)];
        download(`${safe(bank.name)}_sample${nn(b.dataset.sample)}.vag`, state.core.sampleVag(Number(b.dataset.bank), Number(b.dataset.sample), Number(b.dataset.rate) || 44100));
      });
    };
    S("Csv").onclick = () => {
      const data = state.data; if (!data) return;
      const raw = S("Browse").value === "samples";
      const columns = raw ? ["bankName", "sample", "slot", "bin", "spu", "size", "rate"] : ["id", "name", "description", "ram", "bin", "mapping", "available", "reason", "config", "samples", "uses"];
      const rows = raw ? data.samples : data.rows;
      const quote = x => '"' + String(typeof x === "object" ? JSON.stringify(x) : x ?? "").replaceAll('"', '""') + '"';
      download(raw ? "SotN raw sample catalog.csv" : "SotN SFX catalog.csv", "﻿" + [columns.map(quote).join(","), ...rows.map(r => columns.map(k => quote(r[k])).join(","))].join("\r\n"), "text/csv;charset=utf-8");
    };
  }

  function showEmpty(message) {
    S("Body").classList.add("hidden");
    status(message, false);
  }

  async function startLoad() {
    const disc = state.disc, token = ++state.token;
    state.loading = true; S("Body").classList.add("hidden"); status("Reading sound banks…");
    try {
      await loadLibs();
      if (token !== state.token) return;
      const next = await window.SotnSoundCore.loadSoundImage(disc, {catalog: window.SOTN_SFX_CATALOG || EMPTY_CATALOG, imageName: state.name, imageSize: state.size});
      if (token !== state.token) return;
      state.core = next; state.coreDisc = disc; state.data = null; state.loading = false;
      S("Stage").innerHTML = ""; S("Familiar").innerHTML = ""; S("Search").value = "";
      for (const [id, slot] of [["Stage", 3], ["Familiar", 2]]) {
        S(id).innerHTML = next.banks.filter(b => b.slot === slot).map(b => `<option value="${b.id}">${esc(b.location ? b.location + " · " + b.name : b.name)}</option>`).join("");
      }
      S("Warnings").textContent = next.warnings.join(" ");
      S("Image").textContent = `${state.name || "BIN"} · ${Number(state.size).toLocaleString()} bytes`;
      S("Body").classList.remove("hidden");
      reload();
    } catch (e) {
      if (token !== state.token) return;
      state.loading = false;
      S("Body").classList.add("hidden");
      status("Could not read sounds from this BIN: " + (e.message || e), true);
    }
  }

  // Make the panel match the opened BIN; loads the sound banks once per disc object.
  function sync() {
    if (!state.disc) { state.core = null; state.coreDisc = null; state.data = null; state.token++; resetSelection(); showEmpty("Open a SotN BIN to browse its sounds."); return; }
    if (state.coreDisc === state.disc) return;
    if (state.loading && state.loadingDisc === state.disc) return;
    state.loadingDisc = state.disc;
    startLoad();
  }

  function render() {
    const view = $("soundView");
    if (!view) return;
    if (!rendered) { view.innerHTML = MARKUP; bind(); rendered = true; }
    sync();
  }

  window.SotnSoundUI = {
    render,
    // setDisc(disc, {name, size}): the BIN opened with Open SOTN BIN, or null when none is loaded.
    setDisc(disc, {name = "", size = 0} = {}) {
      stopPlayback();
      if (disc === state.disc) return;
      Object.assign(state, {disc: disc || null, name, size, core: null, coreDisc: null, data: null, loading: false, loadingDisc: null});
      state.token++;
      if (rendered && !$("soundView").classList.contains("hidden")) sync();
      else if (rendered && !state.disc) sync();
    }
  };
})();
