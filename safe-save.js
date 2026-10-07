(function (global) {
  "use strict";
  const WINDOW = 8 * 1024 * 1024;
  let saving = false;

  async function snapshot(file) {
    const parts = [];
    for (let start = 0; start < file.size; start += WINDOW) {
      const bytes = await file.slice(start, start + WINDOW).arrayBuffer();
      if (bytes.byteLength !== Math.min(WINDOW, file.size - start)) throw new Error("The file could not be read completely.");
      parts.push(bytes);
    }
    const copy = new Blob(parts, {type: file.type});
    if (file.name) Object.defineProperty(copy, "name", {value: file.name});
    return copy;
  }

  async function verify(actual, expected) {
    if (actual.size !== expected.size) throw new Error("Saved file size does not match.");
    for (let start = 0; start < expected.size; start += WINDOW) {
      const [a, b] = await Promise.all([actual, expected].map(file =>
        file.slice(start, start + WINDOW).arrayBuffer().then(buffer => new Uint8Array(buffer))));
      if (a.length !== b.length || a.some((byte, index) => byte !== b[index])) {
        throw new Error("Saved file contents do not match.");
      }
    }
  }

  async function write(handle, blob) {
    const stream = await handle.createWritable();
    try {
      for (let start = 0; start < blob.size; start += WINDOW) {
        await stream.write(await blob.slice(start, start + WINDOW).arrayBuffer());
      }
      await stream.close();
    } catch (error) {
      try { await stream.abort(); } catch {}
      throw error;
    }
  }

  async function existing(directory, name) {
    try { return await directory.getFileHandle(name); }
    catch (error) { if (error.name === "NotFoundError") return null; throw error; }
  }

  function validName(name, suggested) {
    const suffix = suggested.slice(suggested.lastIndexOf("."));
    return !!name && !/[\\/\x00-\x1f<>:"|?*]/.test(name) && !/[. ]$/.test(name) &&
      name !== "." && name !== ".." && name.toLowerCase().endsWith(suffix.toLowerCase());
  }

  function chooseDestination(name) {
    return new Promise((resolve, reject) => {
      const dialog = document.createElement("dialog"), form = document.createElement("form");
      const label = document.createElement("label"), input = document.createElement("input");
      const note = document.createElement("p"), cancel = document.createElement("button"), save = document.createElement("button");
      dialog.setAttribute("aria-label", "Save file with backup protection");
      dialog.style.cssText = "max-width:32rem;padding:1.5rem;background:#20232b;color:#fff;border:1px solid #697080;border-radius:8px";
      label.textContent = "Save file name "; input.value = name; input.required = true;
      input.style.cssText = "display:block;width:100%;box-sizing:border-box;margin-top:.5rem";
      note.textContent = "Choose the destination folder next. Existing files are backed up before replacement; the backup is removed only after the saved file is verified.";
      cancel.type = "button"; cancel.textContent = "Cancel";
      save.type = "submit"; save.textContent = "Choose folder and save";
      function finish(error, value) { dialog.close(); dialog.remove(); error ? reject(error) : resolve(value); }
      const cancelled = () => finish(new DOMException("Cancelled", "AbortError"));
      cancel.onclick = cancelled;
      dialog.oncancel = event => { event.preventDefault(); cancelled(); };
      input.oninput = () => input.setCustomValidity("");
      form.onsubmit = async event => {
        event.preventDefault();
        const filename = input.value.trim();
        if (!validName(filename, name)) {
          input.setCustomValidity("Use a file name with the original extension and no folder path.");
          input.reportValidity(); return;
        }
        save.disabled = cancel.disabled = true;
        try {
          const directory = await global.showDirectoryPicker({mode: "readwrite"});
          finish(null, {directory, name: filename});
        } catch (error) { finish(error); }
      };
      label.append(input); form.append(label, note, cancel, save); dialog.append(form);
      document.body.append(dialog); dialog.showModal(); input.select();
    });
  }

  async function saveToDirectory(blob, directory, name, options = {}) {
    if (!validName(name, options.suggestedName || name)) throw new Error("Invalid save file name.");
    if (!blob.size) throw new Error("The output is empty. Nothing was written.");
    let target = await existing(directory, name), backupName = null, backupVerified = false, targetStarted = false;
    try {
      const sameSource = target && (options.sourceHandle ? await target.isSameEntry(options.sourceHandle) :
        options.sourceFile?.name?.toLowerCase() === name.toLowerCase());
      if (sameSource && !options.allowSourceOverwrite) throw new Error("Choose a different name for this export so the source BIN stays intact.");
      // Keep the open edits readable after replacement.
      if (sameSource) {
        const source = await snapshot(options.sourceFile);
        await options.onSourceSnapshot?.(source);
      }
      const output = await snapshot(blob);
      if (target) {
        const original = await snapshot(await target.getFile());
        if (!original.size) throw new Error("The selected file is empty. Choose a valid BIN or a new file name.");
        let candidate = `${name}.sotn-backup`, index = 1;
        while (await existing(directory, candidate)) candidate = `${name}.sotn-backup-${index++}`;
        const backup = await directory.getFileHandle(candidate, {create: true});
        backupName = candidate;
        await write(backup, original);
        await verify(await backup.getFile(), original);
        backupVerified = true;
        // Stop if another app changed the destination.
        await verify(await target.getFile(), original);
      } else target = await directory.getFileHandle(name, {create: true});
      targetStarted = true;
      await write(target, output);
      await verify(await target.getFile(), output);
      if (backupName) {
        try { await directory.removeEntry(backupName); }
        catch { return {name, warning: `Saved and verified. Backup retained as ${backupName}.`}; }
      }
      return {name};
    } catch (error) {
      if (backupName) {
        const status = targetStarted ? "The build was not verified." : "The destination was not overwritten.";
        throw new Error(`${error.message || error} ${status} ${backupVerified ? "Verified backup" : "Incomplete backup"} retained as ${backupName} in the selected folder.`);
      }
      throw error;
    }
  }

  async function save(blob, name, options = {}) {
    if (saving) throw new Error("A file is already being saved. Wait for it to finish.");
    saving = true;
    try {
      if (typeof global.showDirectoryPicker === "function") {
        const destination = await chooseDestination(name);
        return await saveToDirectory(blob, destination.directory, destination.name, {...options, suggestedName: name});
      }
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return {name, downloaded: true};
    } finally { saving = false; }
  }

  const api = {save, saveToDirectory, snapshot, verify};
  global.SotnSafeSave = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
