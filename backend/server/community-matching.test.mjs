import test from 'node:test';
import assert from 'node:assert/strict';
import { matchCommunities } from './community-matching.mjs';

const communities=Array.from({length:16},(_,i)=>({groupName:`group-${i}`,name:`Group ${i}`,description:'Software developers'}));
const valid=data=>({matches:data.communities.map(c=>({groupName:c.groupName,score:90,reason:'Developer audience'}))});
const malformed=()=>Object.assign(new Error('Malformed AI response'),{retryable:true});

test('a later malformed batch is split; prior results survive and all candidates get evaluated',async()=>{
  const calls=[],events=[],progress=[];
  const result=await matchCommunities({communities,goal:'I am looking for a senior developer',askAI:async(_task,_prompt,data)=>{
    const names=data.communities.map(c=>c.groupName);calls.push(names);
    if(names.includes('group-10')&&names.length>1)throw malformed();
    return valid(data);
  },onIssue:async e=>events.push(e),onProgress:async p=>progress.push(p)});
  assert.equal(result.ranked.length,16);assert.deepEqual(result.skipped,[]);
  assert.equal(calls.filter(c=>c.includes('group-0')).length,1);
  assert.match(events.join(' '),/smaller batches/);
  assert.deepEqual(progress.at(-1),{total:16,evaluated:16,matched:16,skipped:0});
});

test('one repeatedly invalid candidate is skipped without inventing a match or losing other results',async()=>{
  const result=await matchCommunities({communities,goal:'Find developers',askAI:async(_task,_prompt,data)=>{
    if(data.communities.some(c=>c.groupName==='group-7'))throw malformed();
    return valid(data);
  }});
  assert.equal(result.ranked.length,15);assert.deepEqual(result.skipped,['group-7']);
});

test('duplicate scores trigger smaller batches and never silently drop an unscored community',async()=>{
  const result=await matchCommunities({communities:communities.slice(0,2),goal:'Find developers',askAI:async(_task,_prompt,data)=>{
    const response=valid(data);if(data.communities.length>1)response.matches[1]={...response.matches[0]};return response;
  }});
  assert.deepEqual(result.ranked.map(c=>c.groupName),['group-0','group-1']);
});

test('persistent malformed output is bounded and reported as unevaluated',async()=>{
  let calls=0;
  const result=await matchCommunities({communities,goal:'Find developers',askAI:async()=>{calls++;throw malformed();}});
  assert.ok(calls<=14);assert.deepEqual(result.ranked,[]);
  assert.equal(result.skipped.length,16);assert.equal(new Set(result.skipped).size,16);
});

test('cancellation during recovery prevents more AI requests',async()=>{
  let cancelled=false,calls=0;
  await matchCommunities({communities,goal:'Find developers',isCancelled:async()=>cancelled,askAI:async()=>{calls++;throw malformed();},onIssue:async()=>{cancelled=true;}});
  assert.equal(calls,1);
});

test('nonretryable provider errors stop immediately instead of bypassing quota or policy',async()=>{
  let calls=0;
  await assert.rejects(matchCommunities({communities,goal:'Find developers',askAI:async()=>{calls++;throw Object.assign(new Error('Quota reached'),{retryable:false});}}),/Quota/);
  assert.equal(calls,1);
});
