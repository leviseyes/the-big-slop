import test from 'node:test';
import assert from 'node:assert/strict';
import {videoStatusEndpoint} from '../services/production-core.mjs';
test('status routes only use a validated saved ID, with no response-host dependency', () => {
 assert.equal(videoStatusEndpoint('a36c7d53-331b-4ac0-b111-a65432109876'), 'requests/a36c7d53-331b-4ac0-b111-a65432109876/status');
 for(const id of [undefined, null, {}, '', '../admin', 'x?foo=bar', 'https://evil.example', 'a/b', 'x#fragment', 'a'.repeat(201)]) assert.throws(()=>videoStatusEndpoint(id), /Invalid provider request ID/);
});
