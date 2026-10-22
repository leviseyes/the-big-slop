import test from 'node:test';import assert from 'node:assert/strict';import {assetLibraryCatalog} from '../services/asset-library.mjs';
test('catalog groups uploaded refs, boards, continuity and older images without duplicates',()=>{
 const p={assets:[{id:'a',name:'Actor',kind:'character',source:'upload',imageKey:'p/a.png',editSourceKey:'p/old.png'}],clips:[{frameKey:'p/f.png',lastFrameKey:'p/end.png',storyboard:[{imageKey:'p/b.png',start:0,end:30,composition:'Wide',action:'Walk',audio:'Hello'}]}],editReferenceLibrary:[{imageKey:'p/a.png',name:'Duplicate'}]};
 const images=assetLibraryCatalog(p);assert.equal(images.length,5);assert.equal(images[0].source,'Uploaded');assert.deepEqual(new Set(images.map(i=>i.group)),new Set(['Characters','Saved versions','Scene frames','Continuity frames','Storyboards']));assert.match(images.find(i=>i.group==='Storyboards').description,/0–30s/);
});
