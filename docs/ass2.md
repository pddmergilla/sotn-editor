# Alternate Scarlet Symphony 2.0 tab

[← Back to the README](../README.md)

The **Alternate Scarlet Symphony 2.0** tab presents the mod: its features, every gameplay hack, screenshots, and downloads.

- **Download the PPF.** `ass2/Alternate-Scarlet-Symphony-2.0.ppf` is a PPF3 from the US Track 1 BIN to ASS 2.0. It has a block check and undo data, so PPF3 patchers can verify the input and undo it. The tab lists the input, output and patch SHA-256 hashes.
- **Build it here.** Open the vanilla US Track 1 with **Open SOTN BIN**. The tab compares every patched region with the patch's undo bytes, so it says whether the BIN is untouched vanilla, already ASS 2.0, or something else. **Build** streams the patched image to the file you choose in 8 MB windows. It saves only when the output CRC32 matches the release. Your BIN is only read, and unsaved editor changes are not included. A `.cue` that pairs the new Track 1 with the vanilla Track 2 can be downloaded.
- **Release data.** The hashes, sizes and headline counts on the page come from `ass2/ass2-release.js`, and the hack list comes from the Extra Hacks catalog. After changing the ASS 2.0 BIN, rebuild the PPF and the data with:

  ```text
  node tools/ass2/build-release.js [--vanilla PATH] [--ass PATH]
  ```

  The builder checks that the PPF turns vanilla into the ASS BIN byte for byte. Most of the patch is the Form 2 (XA/STR) sector EDC, which differs in about 173,000 sectors. Keeping it makes the result an exact copy of ASS 2.0.
- **Screenshots.** Put images in `ass2/screenshots/` and list them in `ass2/screenshots/screenshots.json` as `[{"file": "castle.png", "caption": "...", "source": "..."}]`. Use `"url"` instead of `"file"` for an image hosted elsewhere. The list currently links to five screenshots from the Romhack Plaza page as placeholders. The gallery stays hidden while the list is empty.
- **Copy.** Feature text describes the changes without exact values; those live in the Stats Editor and Extra Hacks tabs. Work-in-progress hacks (marked `wip`, currently Richter always saved) are left out of the hack count and list.
- The build needs the page served over http (`node serve.js` or the hosted editor). From a `file://` page only the download link works.
