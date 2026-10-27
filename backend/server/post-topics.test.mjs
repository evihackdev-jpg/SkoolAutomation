import test from 'node:test';
import assert from 'node:assert/strict';
import { postTopics, matchPostTopics } from './post-topics.mjs';
test('local topics omit contact details and rank only communities with matching topics',()=>{
  const topics=postTopics({title:'Looking for a developer',content:'React developer. Email private@example.com or https://example.com/private. Call +81 123 456 7890.'});
  assert.ok(topics.includes('developer'));assert.ok(topics.includes('react'));
  assert.doesNotMatch(topics.join(' '),/private|example|7890/);
  const result=matchPostTopics([{name:'React builders',description:'Developer discussions'},{name:'Fitness',description:'Training and nutrition'}],topics);
  assert.equal(result.ranked.length,1);assert.equal(result.ranked[0].name,'React builders');
  assert.deepEqual(matchPostTopics([{name:'Anything'}],[]).ranked,[]);
});
