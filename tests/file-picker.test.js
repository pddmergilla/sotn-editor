const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const choose = source.slice(source.indexOf('  async function chooseFile()'), source.indexOf('  async function openDisc()'));
const save = source.slice(source.indexOf('  async function saveBlob('), source.indexOf('  async function exportResult('));
function setup(native = {}) {
  const nodes = [], attached = new Set(), timers = [], revoked = [];
  const document = {
    body:{appendChild:node=>attached.add(node)},
    createElement(tag) {
      const node = {tag, files:[], clicked:0, remove(){attached.delete(node);}, click(){this.clicked++;}};
      nodes.push(node);return node;
    }
  };
  const context = {document,window:native,...native,DOMException,state:{discHandle:null},
    URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:url=>revoked.push(url)},setTimeout:(fn,ms)=>timers.push({fn,ms})};
  vm.runInNewContext(`${choose}\n${save}\nthis.pick=chooseFile;this.save=saveBlob;`,context);
  return {context,nodes,attached,timers,revoked};
}
(async()=>{
  const file = {name:'test.bin'}, handle = {getFile:async()=>file};
  const native = setup({showOpenFilePicker:async()=>[handle]});
  const picked = await native.context.pick();
  assert.equal(picked.file,file);assert.equal(picked.handle,handle);assert.equal(native.nodes.length,0);
  const aborted = setup({showOpenFilePicker:async()=>{throw new DOMException('Cancelled','AbortError');}});
  await assert.rejects(aborted.context.pick(),{name:'AbortError'});assert.equal(aborted.nodes.length,0);
  const fallback = setup();
  let pending = fallback.context.pick();
  let input = fallback.nodes.at(-1);
  assert.equal(input.type,'file');assert.equal(input.clicked,1);assert(fallback.attached.has(input));
  input.files=[file];input.onchange();
  const selected = await pending;
  assert.equal(selected.file,file);assert.equal(selected.handle,null);assert.equal(fallback.attached.size,0);
  pending=fallback.context.pick();input=fallback.nodes.at(-1);input.oncancel();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(fallback.attached.size,0);
  pending=fallback.context.pick();input=fallback.nodes.at(-1);input.onchange();
  await assert.rejects(pending,{name:'AbortError'});
  pending=fallback.context.pick();input=fallback.nodes.at(-1);input.files=[file];input.onchange();
  assert.equal((await pending).file,file);
  await fallback.context.save('image','test-edits.bin');
  const link = fallback.nodes.at(-1);
  assert.equal(link.download,'test-edits.bin');assert.equal(link.href,'blob:test');assert.equal(link.clicked,1);
  assert.equal(fallback.attached.size,0);assert.equal(fallback.timers[0].ms,60000);
  fallback.timers[0].fn();assert.deepEqual(fallback.revoked,['blob:test']);
  let writes = 0, closes = 0, comparisons = 0;
  const saved = setup({showSaveFilePicker:async()=>({isSameEntry:async()=>{comparisons++;return true;},
    createWritable:async()=>({write:async()=>writes++,close:async()=>closes++})})});
  await saved.context.save('image','new.bin');
  assert.equal(comparisons,0);assert.equal(writes,1);assert.equal(closes,1);
  saved.context.state.discHandle=handle;
  await assert.rejects(saved.context.save('image','test.bin'),/source BIN stays intact/);
  assert.equal(comparisons,1);assert.equal(writes,1);
  console.log('File picker, cancellation and export tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
