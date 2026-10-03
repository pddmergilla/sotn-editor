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
- **Build number.** Each release has a build number, shown as **ASS 2.0.NN** in the Get it section, on the download button, and in the downloaded file name (`Alternate-Scarlet-Symphony-2.0.NN.ppf`). It is also written into the PPF description. `build-release.js` raises it by one whenever the ASS BIN differs from the one the previous release was built from. `--build N` sets it directly.
- **Current build: ASS 2.0.08.** The title screen displays "Alternate Scarlet Symphony 2.0" below the start prompt; the old QHack and classicgamehacking credits are removed.
- **Download counts.** The tab checks the GitHub Release tagged `ass2-v2.0.NN`. When its PPF name, size and SHA-256 match the current build, both download links use that release attachment and the Get it section shows its download count. Failed checks keep the website copy available and show "Download count unavailable." Counts exclude browser builds, fallback downloads and older website downloads; they are downloads, not unique players.
- **Publishing.** Commit and push these changes to `main`. The **Publish ASS 2.0 downloads** workflow publishes the current numbered PPF, then runs automatically when the patch or release data changes. You can also run it from GitHub's Actions tab on `main`. It uses GitHub's built-in token; no extra secret is needed. The workflow verifies the shipped patch against the release data before publishing and leaves matching attachments untouched on reruns to preserve their counts. If an existing build has different bytes, increase the build number rather than replacing its attachment. Each build has its own count, also available through the GitHub release-assets API.
- **Screenshots.** Put images in `ass2/screenshots/` and list them in `ass2/screenshots/screenshots.json` as `[{"file": "castle.png", "caption": "...", "source": "..."}]`. Use `"url"` instead of `"file"` for an image hosted elsewhere. It currently holds four ASS 2.0 screenshots. The gallery stays hidden while the list is empty.
- **Copy.** Feature text describes the changes without exact values; those live in the Stats Editor and Extra Hacks tabs. Work-in-progress hacks (marked `wip`, currently Richter always saved) are left out of the hack count and list.
- The build needs the page served over http (`node serve.js` or the hosted editor). From a `file://` page only the download link works.
