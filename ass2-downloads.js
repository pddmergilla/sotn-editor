// Release downloads for the current build.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SotnAss2Downloads = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const repository = "pddmergilla/sotn-editor";

  function details(release) {
    if (!/^2\.0\.\d{2,}$/.test(release?.version || "")) throw new Error("Missing ASS build version.");
    const tag = `ass2-v${release.version}`;
    const name = `Alternate-Scarlet-Symphony-${release.version}.ppf`;
    return {tag, name, api: `https://api.github.com/repos/${repository}/releases/tags/${tag}`,
      url: `https://github.com/${repository}/releases/download/${tag}/${name}`};
  }

  function matches(asset, release) {
    return asset?.state === "uploaded" && asset.size === release.ppf.size &&
      asset.digest?.toLowerCase() === `sha256:${release.ppf.sha256.toLowerCase()}`;
  }

  async function load(release, fetcher = fetch) {
    const info = details(release);
    const response = await fetcher(info.api, {headers: {Accept: "application/vnd.github+json"},
      signal: AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    const data = await response.json();
    const asset = data.assets?.find(a => a.name === info.name);
    if (data.tag_name !== info.tag || data.draft || data.prerelease || !matches(asset, release) ||
        asset.browser_download_url !== info.url || !Number.isSafeInteger(asset.download_count) || asset.download_count < 0)
      throw new Error("The published patch does not match this build.");
    return {url: info.url, count: asset.download_count};
  }

  return {repository, details, matches, load};
});
