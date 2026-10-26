// Private site counts with GoatCounter (https://www.goatcounter.com): page visits, ASS PPF downloads and browser
// builds. Counts are anonymous (no cookies, no BIN data) and only the owner's GoatCounter dashboard shows them.
// Set CODE to the GoatCounter site code (the "mycode" in mycode.goatcounter.com); empty turns counting off and
// nothing is loaded. GoatCounter itself ignores localhost, so local testing is not counted.
(function (global) {
  "use strict";
  const CODE = "pddmergilla";
  const pending = [];

  // count("download/ASS-F.01"): one event; queued until GoatCounter's script has loaded.
  function count(path, title = path) {
    if (!CODE) return;
    const event = {path, title, event: true};
    if (global.goatcounter?.count) global.goatcounter.count(event);
    else pending.push(event);
  }

  if (CODE && global.document) {
    const script = global.document.createElement("script");
    script.async = true;
    script.src = "https://gc.zgo.at/count.js";
    script.dataset.goatcounter = `https://${CODE}.goatcounter.com/count`;
    script.onload = () => { while (pending.length && global.goatcounter?.count) global.goatcounter.count(pending.shift()); };
    global.document.head.append(script);
    // PPF download links on the Alternate Scarlet Symphony page (rendered later, so delegated).
    global.document.addEventListener("click", event => {
      const link = event.target.closest?.("a.ass2PpfDownload");
      if (link) count(`download/${link.getAttribute("download") || "ppf"}`);
    });
  }

  global.SotnSiteStats = {count, enabled: !!CODE};
})(typeof window !== "undefined" ? window : globalThis);
