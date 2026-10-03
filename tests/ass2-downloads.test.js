const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const D = require("../ass2-downloads.js");
const P = require("../tools/ass2/publish-release.js");

const patch = Buffer.from("test patch");
const release = {build: 5, version: "2.0.05", ppf: {size: patch.length,
  sha256: crypto.createHash("sha256").update(patch).digest("hex").toUpperCase()}};
const info = D.details(release);
const asset = {name: info.name, size: patch.length, state: "uploaded", digest: `sha256:${release.ppf.sha256.toLowerCase()}`,
  browser_download_url: info.url, download_count: 42};
const published = {id: 123, tag_name: info.tag, draft: false, prerelease: false, assets: [asset]};
const response = (data, status = 200) => ({ok: status === 200, status, json: async () => data});
const missing = () => Object.assign(new Error("Not found"), {status: 404});
const options = {repository: D.repository, commit: "a".repeat(40)};

function page(data, failure = false) {
  const elements = [];
  class Element {
    constructor(tag) { this.tag = tag; this.nodeType = 1; this.children = []; this.attrs = {}; this.textContent = ""; elements.push(this); }
    setAttribute(key, value) { this.attrs[key] = value; }
    removeAttribute(key) { delete this.attrs[key]; }
    set href(value) { this.attrs.href = value; }
    get href() { return this.attrs.href; }
    append(...kids) { this.children.push(...kids); }
    replaceChildren(...kids) { this.children = kids; }
  }
  const view = new Element("section"); view.attrs.id = "ass2View";
  const document = {
    createElement: tag => new Element(tag),
    getElementById: id => elements.find(e => e.attrs.id === id),
    querySelectorAll: selector => elements.filter(e => (e.className || "").split(" ").includes(selector.slice(1)))
  };
  const window = {SotnAss2Core: {}};
  const fetcher = async url => {
    if (url.includes("screenshots")) return response([]);
    if (failure) throw new Error("Offline");
    return response(data);
  };
  const context = vm.createContext({window, document, fetch: fetcher, AbortSignal, console});
  for (const name of ["ass2/ass2-release.js", "ass2-downloads.js", "ass2-ui.js"])
    vm.runInContext(fs.readFileSync(require.resolve(`../${name}`), "utf8"), context);
  window.SotnAss2UI.render();
  return {document, window};
}

(async () => {
  assert.equal(info.url, "https://github.com/pddmergilla/sotn-editor/releases/download/ass2-v2.0.05/Alternate-Scarlet-Symphony-2.0.05.ppf");
  assert.throws(() => D.details({version: "../../other"}));
  assert.deepEqual(await D.load(release, async (url, init) => {
    assert.equal(url, info.api); assert(init.signal); return response(published);
  }), {url: info.url, count: 42});
  assert.equal((await D.load(release, async () => response({...published, assets: [{...asset, download_count: 0}]}))).count, 0);
  for (const status of [404, 403, 429, 500])
    await assert.rejects(D.load(release, async () => response({}, status)), new RegExp(String(status)));
  await assert.rejects(D.load(release, async () => { throw Error("Offline"); }), /Offline/);
  for (const changes of [{name: "older.ppf"}, {size: 1}, {digest: "sha256:other"}, {digest: null}, {state: "starter"},
    {browser_download_url: "https://example.com/other.ppf"}, {download_count: -1}, {download_count: "42"}])
    await assert.rejects(D.load(release, async () => response({...published, assets: [{...asset, ...changes}]})), /match/);
  for (const changes of [{tag_name: "ass2-v2.0.04"}, {draft: true}, {prerelease: true}, {assets: []}])
    await assert.rejects(D.load(release, async () => response({...published, ...changes})), /match/);

  assert.throws(() => P.validate(release, Buffer.from("other")), /match/);
  assert.throws(() => P.validate({...release, build: 6}, patch), /differ/);
  let calls = [];
  assert.equal(await P.publish(release, patch, {...options, request: async (url, init) => {
    calls.push([url, init]); return published;
  }}), info.url);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], undefined);

  calls = [];
  await P.publish(release, patch, {...options, request: async (url, init) => {
    calls.push([url, init]);
    if (!init) throw missing();
    if (init.json?.draft === true) return {...published, draft: true, assets: []};
    if (init.patch) { assert.equal(init.patch, patch); return asset; }
    assert.deepEqual(init.json, {draft: false, make_latest: "false"}); return published;
  }});
  assert.equal(calls.length, 4);
  assert.equal(calls[1][1].json.target_commitish, options.commit);
  assert.match(calls[2][0], /^https:\/\/uploads\.github\.com\/repos\/pddmergilla\/sotn-editor\/releases\/123\/assets\?name=/);

  for (const draftAssets of [[], [asset]]) {
    calls = [];
    await P.publish(release, patch, {...options, request: async (url, init) => {
      calls.push([url, init]);
      if (!init) return {...published, draft: true, assets: draftAssets};
      return init.patch ? asset : published;
    }});
    assert.equal(calls.length, draftAssets.length ? 2 : 3);
  }
  calls = [];
  await assert.rejects(P.publish(release, patch, {...options, request: async (url, init) => {
    calls.push([url, init]); return {...published, assets: [{...asset, digest: "sha256:other"}]};
  }}), /increase the build/);
  assert.equal(calls.length, 1);
  await assert.rejects(P.publish(release, patch, {...options, repository: "someone/fork", request: assert.fail}), /original repository/);
  await assert.rejects(P.publish(release, patch, {...options, commit: "main", request: assert.fail}), /commit/);
  await assert.rejects(P.publish(release, patch, {...options, request: async () => { throw Object.assign(Error("Forbidden"), {status: 403}); }}), /Forbidden/);
  calls = [];
  await assert.rejects(P.publish(release, patch, {...options, request: async (url, init) => {
    calls.push([url, init]);
    if (!init) return {...published, draft: true, assets: []};
    return {...asset, digest: null};
  }}), /verified/);
  assert.equal(calls.length, 2);

  const metadataText = fs.readFileSync(require.resolve("../ass2/ass2-release.js"), "utf8");
  const real = JSON.parse(metadataText.slice(metadataText.indexOf("{"), metadataText.lastIndexOf("}") + 1));
  const realInfo = D.details(real);
  const realAsset = {...asset, name: realInfo.name, size: real.ppf.size, digest: `sha256:${real.ppf.sha256.toLowerCase()}`,
    browser_download_url: realInfo.url};
  for (const failure of [false, true]) {
    const p = page({...published, tag_name: realInfo.tag, assets: [realAsset]}, failure);
    await new Promise(resolve => setImmediate(resolve));
    const links = p.document.querySelectorAll(".ass2PpfDownload");
    assert.equal(links.length, 2);
    for (const link of links) {
      assert.equal(link.href, failure ? real.ppf.file : realInfo.url);
      assert.equal(link.attrs.download, failure ? realInfo.name : undefined);
    }
    assert.equal(p.document.getElementById("ass2DownloadCount").textContent,
      failure ? "Download count unavailable." : `42 PPF downloads for ASS ${real.version}.`);
    p.window.SotnAss2UI.render();
    assert.equal(p.document.querySelectorAll(".ass2PpfDownload").length, 2);
  }
  console.log("ASS download checks passed: matching counts, fallback links, safe publishing and preserved counts.");
})().catch(error => { console.error(error); process.exitCode = 1; });
