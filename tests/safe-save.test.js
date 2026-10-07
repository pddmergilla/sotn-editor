const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Save = require('../safe-save.js');

function directory(initial, failure = {}) {
  const files = new Map(Object.entries(initial).map(([name, value]) => [name.toLowerCase(), Buffer.from(value)]));
  const events = [], versions = new Map(), handles = new Map();
  const dir = {
    files, events,
    async getFileHandle(name, {create = false} = {}) {
      const key = name.toLowerCase();
      if (!files.has(key)) {
        if (!create) throw new DOMException('Missing', 'NotFoundError');
        files.set(key, Buffer.alloc(0)); events.push(`create:${name}`);
      }
      if (!handles.has(key)) handles.set(key, {
        name,
        isSameEntry: async other => handles.get(key) === other,
        async getFile() {
          events.push(`read:${name}`);
          if (failure.read === key) throw new Error('Read failed');
          const data = new Blob([files.get(key)]), version = versions.get(key);
          return {name, size: data.size, slice(start, end) {
            return {arrayBuffer: async () => {
              if (version !== versions.get(key)) throw new Error('Stale file reference');
              return data.slice(start, end).arrayBuffer();
            }};
          }};
        },
        async createWritable() {
          events.push(`write:${name}`);
          if (failure.open === key) throw new Error('Open failed');
          files.set(key, Buffer.alloc(0)); versions.set(key, (versions.get(key) || 0) + 1);
          return {
            async write(data) {
              if (failure.write === key) throw new Error('Write failed');
              files.set(key, Buffer.concat([files.get(key), Buffer.from(data)]));
            },
            async close() {
              events.push(`close:${name}`);
              if (failure.close === key) throw new Error('Close failed');
              if (failure.corrupt === key) files.get(key)[0] ^= 1;
              if (failure.truncate === key) files.set(key, files.get(key).subarray(1));
            },
            async abort() { events.push(`abort:${name}`); }
          };
        }
      });
      return handles.get(key);
    },
    async removeEntry(name) {
      events.push(`delete:${name}`);
      if (failure.remove) throw new Error('Delete failed');
      files.delete(name.toLowerCase());
    }
  };
  return dir;
}

async function overwrite(dir, output = new Blob(['updated']), sourceHandle = null) {
  const handle = sourceHandle || await dir.getFileHandle('main.bin');
  let source = await handle.getFile();
  const result = await Save.saveToDirectory(output, dir, 'main.bin', {
    sourceHandle: handle, sourceFile: source, allowSourceOverwrite: true,
    onSourceSnapshot: copy => { source = copy; }
  });
  return {result, source};
}

(async () => {
  const dir = directory({'main.bin': 'original', 'main.bin.sotn-backup': 'older backup'});
  const {result, source} = await overwrite(dir);
  assert.equal(result.name, 'main.bin');
  assert.equal(dir.files.get('main.bin').toString(), 'updated');
  assert.equal(dir.files.get('main.bin.sotn-backup').toString(), 'older backup');
  assert(!dir.files.has('main.bin.sotn-backup-1'));
  assert.equal(await source.text(), 'original');assert.equal(source.name, 'main.bin');
  const backupClose = dir.events.indexOf('close:main.bin.sotn-backup-1'), targetWrite = dir.events.indexOf('write:main.bin');
  assert(backupClose < targetWrite);
  assert(dir.events.slice(backupClose, targetWrite).includes('read:main.bin.sotn-backup-1'));
  const targetClose = dir.events.indexOf('close:main.bin'), backupDelete = dir.events.indexOf('delete:main.bin.sotn-backup-1');
  assert(targetClose < backupDelete);assert(dir.events.slice(targetClose, backupDelete).includes('read:main.bin'));

  const repeat = await Save.saveToDirectory(new Blob([source.slice(0, 3), ' again']), dir, 'main.bin', {
    sourceHandle: await dir.getFileHandle('main.bin'), sourceFile: source, allowSourceOverwrite: true,
    onSourceSnapshot: copy => assert.equal(copy.size, 8)
  });
  assert.equal(repeat.name, 'main.bin');assert.equal(dir.files.get('main.bin').toString(), 'ori again');

  for (const kind of ['open', 'write', 'close', 'corrupt', 'truncate', 'read']) {
    for (const target of ['main.bin', 'main.bin.sotn-backup']) {
      const failed = directory({'main.bin': 'original'}, {[kind]: target});
      await assert.rejects(overwrite(failed), /failed|match/i);
      assert(!failed.events.some(event => event.startsWith('delete:')));
      if (target.includes('backup') || kind === 'open' || kind === 'read') {
        assert.equal(failed.files.get('main.bin').toString(), 'original');
        if (target.includes('backup')) assert(!failed.events.includes('write:main.bin'));
      } else assert.equal(failed.files.get('main.bin.sotn-backup').toString(), 'original');
      if (kind === 'write' || kind === 'close') assert(failed.events.includes(`abort:${target}`));
    }
  }
  const kept = directory({'main.bin': 'original'}, {remove: true});
  assert.match((await overwrite(kept)).result.warning, /Backup retained/);
  assert.equal(kept.files.get('main.bin').toString(), 'updated');
  assert.equal(kept.files.get('main.bin.sotn-backup').toString(), 'original');
  const empty = directory({'main.bin': ''});
  await assert.rejects(overwrite(empty), /empty/);assert(!empty.events.some(event => event.startsWith('write:')));
  const emptyOutput = directory({'main.bin': 'original'});
  await assert.rejects(overwrite(emptyOutput, new Blob([])), /output is empty/);
  assert(!emptyOutput.events.some(event => event.startsWith('write:')));
  await assert.rejects(Save.snapshot({size: 2, slice: () => new Blob(['x'])}), /read completely/);
  const fresh = directory({});await Save.saveToDirectory(new Blob(['new']), fresh, 'new.bin');
  assert.equal(fresh.files.get('new.bin').toString(), 'new');assert(!fresh.events.some(event => event.startsWith('delete:')));
  const other = directory({'other.bin': 'old output'});
  await Save.saveToDirectory(new Blob(['new output']), other, 'other.bin');
  assert.equal(other.files.get('other.bin').toString(), 'new output');assert(!other.files.has('other.bin.sotn-backup'));
  const unreadable = directory({'main.bin': 'original'});
  await assert.rejects(Save.saveToDirectory({size: 1, slice: () => ({arrayBuffer: async () => {throw new Error('Output read failed');}})},
    unreadable, 'main.bin'), /Output read failed/);
  assert(!unreadable.events.some(event => event.startsWith('write:')));
  const changed = directory({'main.bin': 'original'}), originalGet = changed.getFileHandle;
  changed.getFileHandle = async (...args) => {
    const file = await originalGet(...args);
    if (args[0] !== 'main.bin.sotn-backup') return file;
    return {getFile: async () => {changed.files.set('main.bin', Buffer.from('later edit'));return file.getFile();},
      createWritable: () => file.createWritable()};
  };
  await assert.rejects(overwrite(changed), /destination was not overwritten.*Verified backup retained/);
  assert.equal(changed.files.get('main.bin').toString(), 'later edit');assert(!changed.events.includes('write:main.bin'));
  const protectedDir = directory({'main.bin': 'original'}), handle = await protectedDir.getFileHandle('main.bin');
  await assert.rejects(Save.saveToDirectory(new Blob(['patch']), protectedDir, 'main.bin', {sourceHandle: handle}), /source BIN stays intact/);
  assert(!protectedDir.events.some(event => event.startsWith('write:')));
  await assert.rejects(Save.saveToDirectory(new Blob(['patch']), protectedDir, 'main.bin', {suggestedName: 'patch.ppf'}), /Invalid/);
  for (const name of ['../main.bin', 'bad\\main.bin', 'bad\x00.bin', 'main.bin ']) {
    await assert.rejects(Save.saveToDirectory(new Blob(['x']), protectedDir, name), /Invalid/);
  }
  const fallbackSource = directory({'main.bin': 'original'});
  let preserved;
  await Save.saveToDirectory(new Blob(['updated']), fallbackSource, 'MAIN.BIN', {
    sourceFile: await (await fallbackSource.getFileHandle('main.bin')).getFile(), allowSourceOverwrite: true,
    onSourceSnapshot: copy => { preserved = copy; }
  });
  assert.equal(await preserved.text(), 'original');
  const big = Buffer.alloc(17 * 1024 * 1024, 19), bigDir = directory({'main.bin': big});
  const bigHandle = await bigDir.getFileHandle('main.bin'), lazy = await bigHandle.getFile();
  const largeOutput = {size: lazy.size, slice: (...args) => lazy.slice(...args)};
  await overwrite(bigDir, largeOutput, bigHandle);assert(bigDir.files.get('main.bin').equals(big));

  const ui = fs.readFileSync(require.resolve('../ass2-ui.js'), 'utf8');
  const build = ui.slice(ui.indexOf('  async function buildBin()'), ui.indexOf('  function cueFor('));
  const state = {busy: false, ppf: {}, check: {status: 'vanilla'}, disc: {file: new Blob(['vanilla'])}, handle: {}};
  let saves = 0;
  const context = {state, Blob, R: {result: {name: 'ASS.bin', crc32: 'expected'}}, updateBuild() {}, setBuildStatus() {},
    Core: {buildWithCredits: async (file, ppf, target) => {target.write(Buffer.from('patched'));return {crc: 'expected'};}},
    window: {SotnSafeSave: {save: async (blob, name, options) => {
      saves++;assert.equal(await blob.text(), 'patched');assert.equal(options.allowSourceOverwrite, true);
      assert.equal(options.sourceHandle, state.handle);options.onSourceSnapshot(new Blob(['vanilla']));return {name};
    }}}};
  vm.runInNewContext(`${build}\nthis.build=buildBin;`, context);
  await context.build();assert.equal(saves, 1);assert.equal(state.built.name, 'ASS.bin');assert.equal(state.busy, false);
  context.Core.buildWithCredits = async () => {throw new Error('Release verification failed');};
  await context.build();assert.equal(saves, 1);assert.match(state.built.error, /verification failed/);assert.equal(state.busy, false);
  assert(!ui.includes('showSaveFilePicker'));
  console.log('Safe saves: backup order, every byte, failures, collisions, repeat builds, source preservation and both builders passed.');
})().catch(error => {console.error(error);process.exitCode = 1;});
