const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
require('../actor-parser.js');
require('../exporter.js');
const parser = globalThis.BlueprintCompactActorParser;
const exporter = globalThis.BlueprintCompactExporter;
const actor = (body, name = 'Demo') => `Begin Map\nBegin Level\nBegin Actor Class=/Script/Engine.Actor Name=${name}\n${body}\nEnd Actor\nEnd Level\nBegin Surface\nEnd Surface\nEnd Map`;
const object = (name, body) => `Begin Object Class=/Script/Engine.InstancedStaticMeshComponent Name="${name}"\n${body}\nEnd Object`;

test('Actor declarations merge only within owner; references, false, zero, and hierarchy remain', () => {
  const data = actor(object('One', '') + '\nBegin Object Name="One"\nbEnabled=False\nValue=0\nAttachParent="Root"\nEnd Object\n' +
    object('Two', object('One', 'Value=42')) + '\nActorLabel="日本語 Actor"');
  const g = parser.parseActorText(data);
  assert.equal(g.metadata.objectCount, 3);
  assert.equal(g.actors[0].properties.ActorLabel, '日本語 Actor');
  assert.equal(g.actors[0].objects[0].properties.Value, '0');
  assert.equal(g.actors[0].objects[0].properties.bEnabled, 'False');
  assert.equal(g.actors[0].objects[0].properties.AttachParent, 'Root');
  assert.equal(g.actors[0].objects[1].objects[0].properties.Value, '42');
});

test('Instance summary counts, scalar ranges, stored translation ranges, and omissions', () => {
  const matrices = [-4, 3, 10, 20].map((x,i) => `PerInstanceSMData(${i})=(Transform=(WPlane=(W=1,X=${x},Y=2,Z=-3)))`);
  const values = [0, -1, 2, 4].map((n,i) => `PerInstanceSMCustomData(${i})=${n}`);
  const g = parser.parseActorText(actor(object('Instances', matrices.concat(values).join('\n'))));
  const arrays = g.actors[0].objects[0].arrays;
  assert.equal(g.metadata.instanceCount, 4);
  assert.equal(g.metadata.customValueCount, 4);
  assert.equal(arrays.PerInstanceSMData.examples.length, 3);
  assert.equal(arrays.PerInstanceSMData.omittedEntries, 1);
  assert.deepEqual(arrays.PerInstanceSMData.serializedWPlaneXYZ.X, {min:-4,max:20});
  assert.deepEqual(arrays.PerInstanceSMCustomData.numericRange, {min:-1,max:4});
  assert.equal(arrays.PerInstanceSMData.mode, 'summary');
});

test('Small arrays retain every indexed entry, large arrays summarize, irregular indices warn', () => {
  const body = 'Small(2)="A"\nSmall(5)="B"\n' + Array.from({length:33},(_,i)=>`Big(${i})=${i}`).join('\n');
  const g = parser.parseActorText(actor(body));
  assert.deepEqual(g.actors[0].arrays.Small.entries,[{index:2,value:'A'},{index:5,value:'B'}]);
  assert.equal(g.actors[0].arrays.Big.count,33);
  assert.equal(g.actors[0].arrays.Big.omittedEntries,30);
  assert.equal(g.metadata.irregularArrays,1);
});

test('Incremental parsing across CRLF, Unicode, headers and property boundaries', () => {
  const source = actor('ActorLabel="日本語🚀"\nValue=0').replaceAll('\n','\r\n');
  const streamed = parser.createActorParser();
  for (let i=0;i<source.length;i+=7) streamed.push(source.slice(i,i+7));
  assert.deepEqual(streamed.finish(Buffer.byteLength(source)),parser.parseActorText(source));
  assert.throws(()=>parser.parseActorText(source.slice(0,-8)),/INCOMPLETE_ACTOR/);
  assert.throws(()=>parser.parseActorText('Begin Map\nEnd Actor'),/INCOMPLETE_ACTOR/);
});

test('Multiple actors keep distinct ownership; unknown blocks do not overwrite actor properties', () => {
  const source = 'Begin Actor Class=/Script/Engine.Actor Name=First\nValue=1\nBegin Brush\nValue=99\nEnd Brush\nEnd Actor\n' +
    'Begin Actor Class=/Script/Engine.Actor Name=Second\nValue=2\nEnd Actor';
  const g = parser.parseActorText(source);
  assert.equal(g.metadata.actorCount,2);
  assert.equal(g.actors[0].properties.Value,'1');
  assert.equal(g.actors[1].properties.Value,'2');
  assert.ok(g.metadata.warningCount>0);
});

test('Actor JSON and Markdown carry correct bilingual context and actual summary policy', () => {
  const g = parser.parseActorText(actor(object('Instances','PerInstanceSMCustomData(0)=0')));
  for (const preset of ['compact','standard','full']) {
    const filtered = exporter.filterGraph(g,{},preset);
    for (const language of ['ja','en']) {
      const json = JSON.parse(exporter.exportPrettyJson(filtered,{language}));
      assert.ok(json.actors);
      assert.equal(json.nodes,undefined);
      assert.match(json.ai_context.purpose,/Actor/);
      assert.match(exporter.exportMarkdown(filtered,{language}),/"numericRange"/);
    }
    assert.equal(JSON.parse(exporter.exportCompactJson(filtered,{includeAiInstructions:false})).ai_context,undefined);
  }
});

async function workerRun(input) {
  const messages=[];
  const context = vm.createContext({TextDecoder,TextEncoder, self:{postMessage:m=>messages.push(m)}});
  context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context));
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../conversion-worker.js'),'utf8'),context);
  await context.self.onmessage({data:input});
  return messages;
}

test('Worker file input decodes UTF-8 chunks and rejects broken files', async () => {
  const text = actor('ActorLabel="日本語🚀"\nValue=0');
  const result = (await workerRun({file:new Blob([text])})).at(-1);
  assert.equal(result.graph.actors[0].properties.ActorLabel,'日本語🚀');
  assert.equal(result.graph.metadata.sourceSize,Buffer.byteLength(text));
  const bad = (await workerRun({file:new Blob([text.slice(0,-8)])})).at(-1);
  assert.ok(bad.error);
});

test('75 MB supplied Actor sample streamed through file worker', {skip:!process.env.ACTOR_SAMPLE}, async () => {
  const filePath = process.env.ACTOR_SAMPLE;
  // Slice reads model the browser File API without loading the full sample into memory.
  const handle = fs.openSync(filePath,'r');
  const file = {size:fs.statSync(filePath).size, slice(start,end) {
    const buffer=Buffer.alloc(Math.max(0,Math.min(end,this.size)-start));
    fs.readSync(handle,buffer,0,buffer.length,start);
    return {text:async()=>buffer.toString('utf8'),arrayBuffer:async()=>buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)};
  }};
  try {
    const messages=await workerRun({file});
    const result=messages.at(-1);
    assert.equal(result.error,undefined);
    const g=result.graph;
    assert.equal(g.metadata.actorCount,1);
    assert.equal(g.metadata.objectCount,96);
    assert.equal(g.metadata.instanceCount,170397);
    assert.equal(g.metadata.customValueCount,511191);
    assert.equal(g.metadata.warningCount,0);
    assert.equal(g.metadata.sourceSize,74830547);
    assert.ok(messages.some(m=>m.progress===100));
    assert.ok(result.sourcePreview.length<=20000);
    assert.equal(result.previewTruncated,true);
    const output=exporter.exportCompactJson(exporter.filterGraph(g,{},'standard'));
    assert.ok(Buffer.byteLength(output)<200000);
    console.log(`Actor: ${g.metadata.instanceCount} instance rows, ${g.metadata.customValueCount} custom values → ${Buffer.byteLength(output)} JSON bytes`);
  } finally {fs.closeSync(handle);}
});
