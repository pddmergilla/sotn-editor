// Publish each build once to preserve its download count.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const D = require("../../ass2-downloads.js");

function validate(release, patch) {
  const info = D.details(release);
  if (!Number.isInteger(release.build) || release.build < 1 ||
      release.version !== `2.0.${String(release.build).padStart(2, "0")}`)
    throw new Error("The build number and version differ.");
  const digest = crypto.createHash("sha256").update(patch).digest("hex");
  if (patch.length !== release.ppf.size || digest !== release.ppf.sha256.toLowerCase())
    throw new Error("The PPF does not match the release data.");
  return info;
}

async function publish(release, patch, {repository, commit, request}) {
  const info = validate(release, patch);
  if (repository !== D.repository) throw new Error("Publish from the original repository.");
  if (!/^[a-f0-9]{40}$/.test(commit || "")) throw new Error("Missing release commit.");
  const api = `https://api.github.com/repos/${repository}/releases`;
  let current;
  try { current = await request(`${api}/tags/${info.tag}`); }
  catch (error) { if (error.status !== 404) throw error; }
  if (!current) {
    current = await request(api, {method: "POST", json: {
      tag_name: info.tag, target_commitish: commit, name: `Alternate Scarlet Symphony ${release.version}`,
      draft: true, prerelease: false,
      body: `PPF3 patch for the US Track 1 BIN.\n\nPatch SHA-256: ${release.ppf.sha256}\n\n` +
        `Install and build in the browser: https://pddmergilla.github.io/sotn-editor/\n\n` +
        "Download counts cover this release attachment only; browser builds and earlier website downloads are excluded."
    }});
  }
  if (current.tag_name !== info.tag || current.prerelease || !Number.isSafeInteger(current.id))
    throw new Error("Unexpected GitHub release.");
  let asset = current.assets?.find(a => a.name === info.name);
  if (asset && !D.matches(asset, release))
    throw new Error("This build already has a different patch; increase the build number instead of replacing it.");
  if (!asset) {
    asset = await request(`https://uploads.github.com/repos/${repository}/releases/${current.id}/assets?name=${info.name}`,
      {method: "POST", patch});
    if (!D.matches(asset, release)) throw new Error("The uploaded patch could not be verified.");
  }
  if (current.draft) await request(`${api}/${current.id}`, {method: "PATCH", json: {draft: false, make_latest: "false"}});
  return info.url;
}

async function main() {
  const root = path.resolve(__dirname, "../..");
  const text = fs.readFileSync(path.join(root, "ass2/ass2-release.js"), "utf8");
  const release = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  const patch = fs.readFileSync(path.join(root, release.ppf.file));
  const info = validate(release, patch);
  if (process.argv.includes("--check")) { console.log(`Verified ${info.name}; no release published.`); return; }
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error("GH_TOKEN is required to publish.");
  const request = async (url, {method = "GET", json, patch} = {}) => {
    const response = await fetch(url, {method, headers: {
      Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": patch ? "application/octet-stream" : "application/json"
    }, body: patch || (json ? JSON.stringify(json) : undefined), signal: AbortSignal.timeout(60000)});
    if (!response.ok) {
      const error = new Error(`GitHub ${method} failed (${response.status}).`);
      error.status = response.status; throw error;
    }
    return response.json();
  };
  console.log(await publish(release, patch, {repository: process.env.GITHUB_REPOSITORY,
    commit: process.env.GITHUB_SHA, request}));
}

module.exports = {validate, publish};
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
