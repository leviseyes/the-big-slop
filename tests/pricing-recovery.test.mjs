import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {estimateUsd,resumePricingQuote,assertQuoteReady,quoteFrom} from '../services/production-core.mjs';
const tariff=JSON.parse(fs.readFileSync(new URL('./fixtures/seedance-pricing-2026-10-20.json',import.meta.url)));
test('live October tariff uses exact token calculation for image references',()=>{
 assert.ok(Math.abs(estimateUsd(tariff,{resolution:'480p',duration:30,aspect_ratio:'16:9',image_urls:['image']})-6.168015)<1e-9);
 assert.ok(Math.abs(estimateUsd(tariff,{resolution:'720p',duration:30})-13.8672)<1e-9);
 assert.equal(quoteFrom(Array(320).fill(estimateUsd(tariff,{resolution:'480p',duration:30})),0).providerCents,197377);
});
test('unreviewed tariffs and unmeasured video inputs still block quoting',()=>{
 for(const text of [tariff.pricing_description.replace('$0.0214','$0.0314'),tariff.pricing_description.replace('× 24','× 30'),tariff.pricing_description+' Extra surcharge applies.']) assert.throws(()=>estimateUsd({...tariff,pricing_description:text}),/Unrecognized/);
 for(const input of [{resolution:'480p',duration:30,video_urls:['video']},{resolution:'480p',duration:30,aspect_ratio:'9:16'},{resolution:'480p',duration:60},{resolution:'1080p',duration:30}]) assert.throws(()=>estimateUsd(tariff,input));
 for(const usd of [Infinity,'Infinity',-1,0,true,'n/a']) assert.throws(()=>estimateUsd({usd}),/invalid/);
});
const make=()=>({status:'failed',error:'Unrecognized provider pricing. An operator must review the rate before quoting.',referencesApprovedAt:1,storyboardsApprovedAt:2,assets:[{imageKey:'asset',referenceUrl:'asset-url'}],clips:[{id:'clip',frameKey:'frame',frameUrl:'frame-url',storyboard:[{imageKey:'board',approvedImageKey:'board',referenceUrl:'board-url'}]}]});
test('quote-only recovery preserves saved work and approvals without render authorization',()=>{
 const p=make(),next=resumePricingQuote(p);assertQuoteReady(next);
 assert.equal(next.workStage,'quote');assert.equal(next.status,'preparing');assert.equal(next.error,undefined);
 assert.deepEqual(next.assets,p.assets);assert.deepEqual(next.clips,p.clips);assert.equal(next.storyboardsApprovedAt,2);
 assert.equal(next.generationAuthorization,undefined);assert.equal(p.status,'failed');
});
test('quote recovery cannot bypass review or resume incomplete/committed work',()=>{
 for(const change of [p=>p.status='ready',p=>p.error='fetch failed',p=>delete p.referencesApprovedAt,p=>delete p.clips[0].frameKey,p=>delete p.clips[0].storyboard[0].approvedImageKey,p=>p.generationAuthorization={},p=>p.paidAt=1,p=>p.checkoutId='checkout',p=>p.clips[0].requestId='submitted']){
 const p=make();change(p);assert.throws(()=>resumePricingQuote(p));
 }
});
