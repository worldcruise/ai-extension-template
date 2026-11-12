import test from 'node:test';
import assert from 'node:assert/strict';
import {JOB_ANALYSIS_KEY,readJobAnalysisSetting,createJobAnalysisSettings} from '../src/job-analysis-settings.mjs';

function fixture(stored) {
  const nodes=new Map(),changed=new Set();let value=stored,failure=false;
  const node=id=>{if(!nodes.has(id))nodes.set(id,{checked:false,disabled:false,textContent:'',addEventListener(name,fn){this[name]=fn;},removeEventListener(name){delete this[name];}});return nodes.get(id);};
  const writes=[],browser={storage:{local:{get:async()=>({[JOB_ANALYSIS_KEY]:value}),set:async data=>{if(failure)throw new Error('Disk unavailable');value=data[JOB_ANALYSIS_KEY];writes.push(value);for(const fn of changed)fn({[JOB_ANALYSIS_KEY]:{newValue:value}},'local');}},onChanged:{addListener:fn=>changed.add(fn),removeListener:fn=>changed.delete(fn)}}};
  const settings=createJobAnalysisSettings({browser,root:{querySelector:selector=>node(selector.slice(1))},events:{addEventListener(){},removeEventListener(){}}});
  return {browser,settings,writes,nodes,changed,value:()=>value,fail:()=>{failure=true;},toggle(enabled){node('job-ai-analysis').checked=enabled;node('job-ai-analysis').change();},flush:async()=>{for(let i=0;i<50;i++)await Promise.resolve();}};
}
test('job analysis is off by default and only boolean true enables it',async()=>{
  for(const stored of [undefined,false,'true',1,null]) {const f=fixture(stored);await f.settings.ready;assert.equal(await readJobAnalysisSetting(f.browser),false);assert.equal(f.nodes.get('job-ai-analysis').checked,false);assert.equal(f.writes.length,0);f.settings.dispose();}
  const f=fixture(true);await f.settings.ready;assert.equal(f.nodes.get('job-ai-analysis').checked,true);f.settings.dispose();
});
test('analysis opt-in persists rapid changes in order and syncs external changes',async()=>{
  const f=fixture();await f.settings.ready;f.toggle(true);f.toggle(false);f.toggle(true);await f.flush();
  assert.deepEqual(f.writes,[true,false,true]);assert.equal(f.value(),true);
  for(const fn of f.changed)fn({[JOB_ANALYSIS_KEY]:{newValue:false}},'local');
  assert.equal(f.nodes.get('job-ai-analysis').checked,false);f.settings.dispose();assert.equal(f.changed.size,0);
});
test('failed writes do not claim analysis was saved',async()=>{
  const f=fixture();await f.settings.ready;f.fail();f.toggle(true);await f.flush();assert.equal(f.value(),undefined);assert.match(f.nodes.get('job-ai-analysis-status').textContent,/Could not save/);f.settings.dispose();
});
