import test from 'node:test';
import assert from 'node:assert/strict';
import {scriptSections,scriptWritingInstructions} from '../services/idea-script.mjs';
test('long-form screenplay sections preserve the chosen runtime',()=>{for(const m of [.5,5,5.5,90,360]) assert.equal(scriptSections(m).reduce((a,b)=>a+b,0),m);assert.throws(()=>scriptSections(0));});
test('category, language, performance and ending instructions reach the writer',()=>{const s=scriptWritingInstructions({format:'Standup comedy',targetMinutes:10,dialogueLanguages:['Spanish'],textLanguages:[],style:'Stage play'},5,true);for(const v of ['Standup comedy','Spanish','punchlines','satisfying','never an outline']) assert.ok(s.includes(v));});
