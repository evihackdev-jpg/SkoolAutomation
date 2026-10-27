import test from 'node:test';
import assert from 'node:assert/strict';
import { generalCategory, defaultPostCategory } from './post-category.mjs';

test('General takes priority over hiring and general discussion, ignoring decoration and case',()=>{
  const labels=[{id:'jobs',name:'Hiring'},{id:'discussion',name:'💬 General discussion'},{id:'general',name:'📣 GENERAL'}];
  assert.equal(generalCategory(labels).id,'general');assert.equal(defaultPostCategory(labels).id,'general');
  assert.equal(generalCategory(labels.slice(0,2)).id,'discussion');
});
test('missing General falls back only to supplied categories and never invents an ID',()=>{
  assert.equal(generalCategory([{id:'x',name:'General support request'}]),null);
  assert.equal(defaultPostCategory([{id:'chat',name:'Chat'}]).id,'chat');
  assert.equal(defaultPostCategory([]),null);
});
