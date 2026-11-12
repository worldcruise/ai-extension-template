import test from 'node:test';
import assert from 'node:assert/strict';
import {openDocumentPreview} from '../src/document-preview-tabs.mjs';
function fixture(){const rows=[],created=[],updated=[];const browser={runtime:{getURL:path=>'chrome-extension://test/'+path},tabs:{query:async()=>structuredClone(rows),create:async value=>{const tab={id:rows.length+1,...value};rows.push(tab);created.push(value);return tab;},update:async(id,value)=>{updated.push({id,...value});Object.assign(rows.find(row=>row.id===id),value);return rows.find(row=>row.id===id);}}};return {browser,rows,created,updated};}
test('automatic previews reuse one tab per kind/format, including concurrent jobs',async()=>{
  const f=fixture();await Promise.all(Array.from({length:15},(_,n)=>openDocumentPreview(f.browser,{key:`job-${n}/resume.pdf`,kind:'resume',format:'pdf'})));
  assert.equal(f.created.length,1);assert.equal(f.updated.length,14);
  assert.equal(new URL(f.rows[0].url).searchParams.get('file'),'job-14/resume.pdf');
  await openDocumentPreview(f.browser,{key:'job-14/cover-letter.pdf',kind:'cover-letter',format:'pdf'});assert.equal(f.created.length,2);
});
test('pinned previews and tabs navigating elsewhere are preserved',async()=>{
  const f=fixture();await openDocumentPreview(f.browser,{key:'one/resume.json',kind:'resume',format:'json'});
  f.rows[0].pinned=true;await openDocumentPreview(f.browser,{key:'two/resume.json',kind:'resume',format:'json'});assert.equal(f.rows.length,2);
  f.rows[1].pendingUrl='https://example.test/';await openDocumentPreview(f.browser,{key:'three/resume.json',kind:'resume',format:'json'});assert.equal(f.rows.length,3);
});
