import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutomation, validateRun, validateFacts } from './automation.mjs';
import { SessionError } from './skool.mjs';

const clone = x => structuredClone(x);
function collection(uniqueActive = false) {
  const rows = [];
  const matches = (row, query) => Object.entries(query).every(([key,val]) => row[key] === val);
  return { rows,
    find: query => { let output = rows.filter(r => matches(r,query)); return { sort() { output.reverse(); return this; }, limit(n) { output = output.slice(0,n); return this; }, async toArray() { return clone(output); } }; },
    async findOne(query) { return clone(rows.find(r => matches(r,query)) || null); },
    async insertOne(row) { if (rows.some(r => r._id === row._id || (uniqueActive && r.ownerId === row.ownerId && r.active && row.active))) throw Object.assign(new Error('duplicate'),{code:11000}); rows.push(clone(row)); },
    async updateOne(query, update, options) { let row = rows.find(r => matches(r,query)); if (!row && options?.upsert) { row = clone(query); rows.push(row); } if (row) Object.assign(row, clone(update.$set)); return { matchedCount: row ? 1 : 0 }; },
    async deleteOne(query) { const i=rows.findIndex(r => matches(r,query)); if(i>=0)rows.splice(i,1); },
    async deleteMany(query) { let deletedCount=0;for(let i=rows.length-1;i>=0;i--)if(matches(rows[i],query)){rows.splice(i,1);deletedCount++;}return{deletedCount}; },
  };
}
function fixture() {
  const runs=collection(true), publications=collection(), settings=collection(), accounts=collection();
  accounts.rows.push({_id:'account-a',status:'active',displayName:'Account A'});
  const communities = ['existing','new'].map(name => ({ name, id: name, url:`https://www.skool.com/${name}`, description:'A relevant topic', membershipStatus:'joined' }));
  let task, posts=0, joins=0, beforePublish; const deferred=[];
  const api = { runs, publications, settings, accounts, ownerId:'owner-a', choose: () => 0, schedule: f => {task=f;}, defer: (task,delay)=>{deferred.push({task,delay});},
    memberships: async () => ({ communities:[communities[0]], hasMore:false }),
    discovery: async () => ({communities,hasMore:false}),
    join: async () => { joins++; return {status:'joined'}; },
    publishing: { prepare: async ({groupName}) => ({ groupId:groupName, groupName, name:groupName, labels:[{id:'category',name:'General'}],rules:[] }), publish: async () => { posts++; await beforePublish?.(); return {status:'published',message:'Published',url:'https://www.skool.com/existing/article'}; } },
    ai: async (_task,data) => data.communities ? {matches:data.communities.map(c=>({groupName:c.groupName,score:95,reason:'Relevant'}))} : data.community ? {suitable:true,reason:'',title:'Useful article',content:'Useful community advice. '.repeat(15),labelId:'category'} : {queries:['topic']},
  };
  const service=createAutomation(api);
  return {service,api,runs,publications,settings,execute:()=>task(),deferred,retry:async()=>{const next=deferred.shift();assert.ok(next);await next.task();},counts:()=>({posts,joins}), beforePublish:f=>{beforePublish=f;}};
}
const input={goal:'Share useful advice about a relevant topic',discover:true,existing:true,limit:3};

test('posting schedules validate count and interval modes separately, retaining legacy count requests',()=>{
  assert.equal(validateRun(input).postingMode,'count');
  assert.equal(validateRun(input).intervalMinutes,null);
  const timed=validateRun({...input,limit:undefined,postingMode:'interval',intervalMinutes:1});
  assert.equal(timed.limit,null);assert.equal(timed.intervalMinutes,1);
  assert.equal(validateRun({...input,postingMode:'interval',intervalMinutes:1440}).intervalMinutes,1440);
  for(const intervalMinutes of [undefined,0,-1,1.5,1441,'1',Infinity])assert.throws(()=>validateRun({...input,postingMode:'interval',intervalMinutes}),/interval/);
  assert.throws(()=>validateRun({...input,postingMode:'other'}),/count or timed/);
  assert.equal(validateRun({...input,postingMode:'count',limit:20}).limit,20);
  for(const limit of [0,21])assert.throws(()=>validateRun({...input,postingMode:'count',limit}),/1 and 20/);
});

test('interval mode publishes immediately, respects the clock, continues beyond ten, and stops on request',async()=>{
  const f=fixture();let clock=Date.now();f.api.now=()=>clock;
  const communities=Array.from({length:14},(_,i)=>({name:`community-${i}`,url:`https://www.skool.com/community-${i}`,membershipStatus:'joined'}));
  f.api.memberships=async()=>({communities,hasMore:false});f.service=createAutomation(f.api);
  const {run}=await f.service.start({...input,discover:false,postingMode:'interval',intervalMinutes:1,limit:undefined});
  await f.execute();assert.equal(f.counts().posts,1);assert.equal(f.runs.rows[0].status,'waiting');assert.equal(f.runs.rows[0].waitReason,'interval');
  assert.equal(new Date(f.runs.rows[0].nextAttemptAt).getTime(),clock+60000);
  await f.retry();assert.equal(f.counts().posts,1,'An early wake-up must not publish');assert.equal(f.deferred[0].delay,60000);
  for(let i=0;i<11;i++){clock+=60000;await f.retry();assert.equal(f.counts().posts,i+2);assert.equal(f.runs.rows[0].active,true);}
  assert.equal(f.runs.rows[0].results.filter(r=>r.status==='published').length,12);
  await f.service.stop(run.id);clock+=60000;await f.retry();
  assert.equal(f.runs.rows[0].status,'stopped');assert.equal(f.counts().posts,12);
});

test('interval mode skips rejected destinations without using the interval and pauses after one success',async()=>{
  const f=fixture();let attempts=0;f.api.now=()=>Date.now();
  f.api.publishing.publish=async()=>({status:++attempts===1?'blocked':'published',message:'Result'});
  f.service=createAutomation(f.api);await f.service.start({...input,postingMode:'interval',intervalMinutes:5});await f.execute();
  assert.equal(attempts,2);assert.equal(f.runs.rows[0].results.filter(r=>r.status==='published').length,1);
  assert.equal(f.runs.rows[0].waitReason,'interval');assert.equal(f.runs.rows[0].active,true);
  assert.ok(f.deferred[0].delay>299000);
});

test('interval schedule survives a worker restart without catching up missed posts in a burst',async()=>{
  const f=fixture();let clock=Date.now();f.api.now=()=>clock;f.service=createAutomation(f.api);
  await f.service.start({...input,postingMode:'interval',intervalMinutes:1});await f.execute();
  const saved=clone(f.runs.rows[0]);f.deferred.length=0;
  const restarted=createAutomation(f.api);await restarted.resume(saved);
  assert.equal(f.deferred[0].delay,60000);await f.retry();assert.equal(f.counts().posts,1);
  clock+=10*60000;await f.retry();assert.equal(f.counts().posts,2);
  assert.equal(f.runs.rows[0]._id,saved._id);assert.equal(f.runs.rows[0].active,true);
  assert.equal(new Date(f.runs.rows[0].nextAttemptAt).getTime(),clock+60000);
});

test('an uncertain timed publication blocks later sends until verification and the next interval',async()=>{
  for(const throws of [false,true]){
    const f=fixture();let clock=Date.now(),sends=0,verified=false;f.api.now=()=>clock;
    f.api.publishing.publish=async()=>{sends++;if(throws)throw new Error('Lost response');return{status:'unconfirmed',message:'Unknown'};};
    f.api.publishing.reconcile=async()=>verified?{status:'published',message:'Verified'}:{status:'unconfirmed'};
    f.service=createAutomation(f.api);await f.service.start({...input,postingMode:'interval',intervalMinutes:30});await f.execute();
    assert.equal(sends,1);assert.equal(f.runs.rows[0].waitReason,'retry');
    clock+=15*60000;await f.retry();assert.equal(sends,1);
    verified=true;await f.retry();assert.equal(sends,1);assert.equal(f.runs.rows[0].waitReason,'interval');
    assert.equal(new Date(f.runs.rows[0].nextAttemptAt).getTime(),clock+15*60000);
  }
});

test('a rejected rate-limited timed attempt waits for cooldown without consuming the longer interval',async()=>{
  const f=fixture();let clock=Date.now(),attempts=0;f.api.now=()=>clock;
  f.api.publishing.publish=async()=>++attempts===1?{status:'blocked',rateLimited:true,message:'Rate limited'}:{status:'published',message:'Published'};
  f.service=createAutomation(f.api);await f.service.start({...input,discover:false,postingMode:'interval',intervalMinutes:60});await f.execute();
  assert.equal(attempts,1);assert.equal(f.runs.rows[0].nextPostAt,null);
  clock+=15*60000;f.runs.rows[0].results[0].nextCheckAt=new Date(0);await f.retry();
  assert.equal(attempts,2);assert.equal(f.runs.rows[0].waitReason,'interval');
});
test('a post can start a run without a separate goal; as-is matching never calls AI',async()=>{
  const f=fixture();f.api.ai=async()=>{throw new Error('As-is post must not reach AI');};
  f.service=createAutomation(f.api);
  const post={title:'Relevant topic',content:'Share useful advice about this topic.',refineWithAI:false};
  const {run}=await f.service.start({discover:true,existing:true,limit:1,post});await f.execute();
  assert.equal(run.postOnly,true);assert.equal(f.runs.rows[0].status,'completed');assert.equal(f.counts().posts,1);
  await f.service.start({discover:true,existing:true,limit:1,post});await f.execute();
  assert.equal(f.counts().posts,2);assert.equal(f.runs.rows[1].results[0].status,'skipped');
});
test('post-only refinement derives context from the supplied post and rejects empty submissions',()=>{
  const post={title:'Hire an engineer',content:'Looking for a developer collaborator.',refineWithAI:true};
  const result=validateRun({discover:true,existing:false,limit:1,post});
  assert.equal(result.postOnly,true);assert.equal(result.goal,post.title+'\n'+post.content);
  assert.throws(()=>validateRun({discover:true,existing:false,limit:1}),/title and content/);
});
test('as-is mode preserves supplied text, never sends it to AI, and persists the selected mode',async()=>{
  const f=fixture(),ai=f.api.ai,sent=[];
  const post={title:'  Exact title 日本語  ',content:'  PRIVATE_DRAFT\n\nReply here: https://example.com/contact\n',refineWithAI:false};
  f.api.ai=async(task,data,...rest)=>{
    assert.equal(data.draft,undefined);assert.doesNotMatch(JSON.stringify(data),/PRIVATE_DRAFT|Exact title|example.com/);
    assert.equal(data.community,undefined,'As-is posts must not invoke AI writing or review');
    return ai(task,data,...rest);
  };
  f.api.publishing.publish=async({article})=>{sent.push(article);return{status:'published',message:'Published'};};
  f.service=createAutomation(f.api);const {run}=await f.service.start({...input,limit:1,post});await f.execute();
  assert.deepEqual(run.post,post);assert.deepEqual((await f.service.list()).runs[0].post,post);
  assert.equal(sent.length,1);assert.equal(sent[0].title,post.title);assert.equal(sent[0].content,post.content);
  assert.equal(f.runs.rows[0].results[0].postMode,'as_is');
  assert.equal(f.runs.rows[0].events.filter(e=>e.outcome==='success').length,1);
});

test('AI refinement receives the supplied draft and publishes the validated refinement',async()=>{
  const f=fixture(),ai=f.api.ai;let sent,draft;
  const post={title:'Need developer',content:'Hiring a developer. Pay is $1000 per month.',refineWithAI:true};
  f.api.ai=async(task,data,...rest)=>{
    if(data.community){draft=data.draft;assert.match(task,/Refine the supplied/);return{suitable:true,reason:'',title:'Developer opportunity',content:'We are hiring a developer at $1000 per month.',labelId:'category'};}
    return ai(task,data,...rest);
  };
  f.api.publishing.publish=async({article})=>{sent=article;return{status:'published',message:'Published'};};
  f.service=createAutomation(f.api);await f.service.start({...input,limit:1,post});await f.execute();
  assert.deepEqual(draft,{title:post.title,content:post.content});assert.equal(sent.title,'Developer opportunity');
  assert.equal(f.runs.rows[0].results[0].postMode,'refined');
});

test('both post modes select General even when AI or a hiring category suggests another ID',async()=>{
  for(const refineWithAI of [true,false]){
    const f=fixture(),ai=f.api.ai;let posted;
    f.api.publishing.prepare=async({groupName})=>({groupId:groupName,groupName,name:groupName,labels:[{id:'jobs',name:'Hiring'},{id:'general',name:'General discussion'}],rules:[]});
    f.api.ai=async(task,data,schema,...rest)=>{
      if(data.community){assert.equal(data.community.category.name,'General discussion');assert.equal(schema.properties.labelId,undefined);return{suitable:true,reason:'',title:'Hiring a developer',content:'Looking for a developer collaborator.',labelId:'jobs'};}
      return ai(task,data,schema,...rest);
    };
    f.api.publishing.publish=async({article})=>{posted=article;return{status:'published',message:'Published'};};
    f.service=createAutomation(f.api);await f.service.start({...input,limit:1,post:{title:'Hiring a developer',content:'Looking for a developer collaborator.',refineWithAI}});await f.execute();
    assert.equal(posted.labelId,'general');assert.equal(f.runs.rows[0].results[0].categoryName,'General discussion');
  }
});

test('as-is posts are attempted without local community-rule filtering after explicit user approval',async()=>{
  const f=fixture(),prepare=f.api.publishing.prepare,sent=[];
  f.api.publishing.prepare=async args=>({...await prepare(args),rules:args.groupName==='existing'?[{title:'No self-promotion',description:'No recruitment or advertising.'}]:[]});
  f.api.publishing.publish=async({context})=>{sent.push(context.groupName);return{status:'published',message:'Published'};};
  f.service=createAutomation(f.api);await f.service.start({...input,limit:1,post:{title:'Hiring a developer',content:'Work with me. Payment: $1000 per month.',refineWithAI:false}});await f.execute();
  assert.deepEqual(sent,['existing']);assert.equal(f.runs.rows[0].results[0].status,'published');
  assert.equal(f.runs.rows[0].events.filter(e=>e.outcome==='success').length,1);
});

test('formerly filtered destinations are retried once, General is used, and as-is needs no AI',async()=>{
  const f=fixture();f.api.ai=async()=>{throw new Error('Unexpected AI request');};
  f.service=createAutomation(f.api);
  const {run}=await f.service.start({existing:true,discover:false,limit:1,post:{title:'A post',content:'My unchanged content.',refineWithAI:false}});
  f.runs.rows[0].results.push({groupName:'existing',name:'existing',status:'skipped',message:'No self-promotion',account:{id:'account-a',displayName:'Account A'}});
  await f.execute();assert.equal(f.counts().posts,1);assert.equal(f.runs.rows[0].results.length,1);assert.equal(f.runs.rows[0].results[0].status,'published');
  assert.equal(f.runs.rows[0].results[0].categoryName,'General');assert.equal(f.runs.rows[0]._id,run.id);
});

test('draft validation rejects partial, empty, oversized and ambiguous modes',()=>{
  assert.equal(validateRun(input).post,null);
  for(const post of [{title:'Title',content:'Text'}, {title:'Title',content:'Text',refineWithAI:'false'}, {title:' ',content:'Text',refineWithAI:false}, {title:'Title',content:' ',refineWithAI:true}, {title:'x'.repeat(151),content:'Text',refineWithAI:false}, {title:'Title',content:'x'.repeat(10001),refineWithAI:false}, {title:'Title',content:'@everyone join',refineWithAI:false}])assert.throws(()=>validateRun({...input,post}));
});
test('clearing history removes only finished owned runs and retains duplicate-post protection',async()=>{
  const f=fixture();await f.service.start({...input,limit:2});await f.execute();
  const journal=clone(f.publications.rows);
  f.runs.rows.push({_id:'foreign-finished',ownerId:'other',active:false,status:'completed'});
  const {run}=await f.service.start(input);
  assert.deepEqual(await f.service.clearHistory(),{cleared:1});
  assert.deepEqual(f.publications.rows,journal);
  assert.ok(await f.runs.findOne({_id:run.id,active:true}));
  assert.ok(await f.runs.findOne({_id:'foreign-finished'}));
  assert.deepEqual(await f.service.clearHistory(),{cleared:0});
  await f.execute();assert.deepEqual(f.counts(),{posts:2,joins:1});
  assert.ok((await f.service.list()).runs[0].results.every(r=>r.status==='skipped'));
});
test('automatic joining reads the shared profile saved in Settings',async()=>{
  const f=fixture();let supplied;
  f.settings.rows.push({_id:'owner-a',profile:{city:'Shared city',occupation:'Engineer',answers:[]}});
  f.api.join=async body=>{supplied=body.facts;return{status:'joined'};};
  f.service=createAutomation(f.api);await f.service.start(input);await f.execute();
  assert.deepEqual(supplied,{city:'Shared city',occupation:'Engineer',answers:[]});
  assert.equal((await f.service.list()).facts,undefined);
});
test('Auto Mode ranks new and existing memberships, joins only new, publishes once, and deduplicates later runs', async () => {
  const f=fixture(); const {run}=await f.service.start({...input,limit:2});
  await assert.rejects(f.service.start(input),/already active/);
  await f.execute();
  assert.deepEqual(f.counts(),{posts:2,joins:1});
  const saved=await f.runs.findOne({_id:run.id}); assert.equal(saved.status,'completed'); assert.equal(saved.active,false);
  assert.equal(saved.results[0].source,'joined'); assert.equal(saved.results[1].source,'discovered');
  await f.service.start(input); await f.execute(); assert.deepEqual(f.counts(),{posts:2,joins:1});
  assert.ok((await f.service.list()).runs[0].results.every(r=>r.status==='skipped'));
});
test('cancellation is scoped and prevents subsequent mutations, including after AI returns', async () => {
  const f=fixture();const {run}=await f.service.start(input);
  await assert.rejects(createAutomation({...f.api,ownerId:'other'}).stop(run.id),/not found/);
  assert.deepEqual((await createAutomation({...f.api,ownerId:'other'}).list()).runs,[]);
  const ai=f.api.ai;
  const g=fixture();
  g.api.ai=async (task,data,...rest)=> { const result=await ai(task,data,...rest); if(data.community)await g.service.stop(g.runs.rows[0]._id); return result; };
  g.service=createAutomation(g.api);
  await g.service.start(input);await g.execute();assert.equal(g.counts().posts,0);assert.equal(g.runs.rows[0].status,'stopped');
  await f.service.stop(run.id); await f.execute(); assert.equal(f.counts().posts,0); assert.equal(f.runs.rows[0].status,'stopped');
});
test('pending memberships cannot publish, uncertain publications cannot retry', async () => {
  const f=fixture(); f.api.join=async()=>({status:'pending',message:'Owner approval required'});
  f.api.publishing.publish=async()=>({status:'unconfirmed',message:'Timeout'});
  f.service=createAutomation(f.api);await f.service.start(input);await f.execute();
  assert.deepEqual(f.runs.rows[0].results.map(r=>r.status),['unconfirmed','pending']); assert.equal(f.runs.rows[0].status,'waiting');
  assert.equal(f.publications.rows[0].status,'unconfirmed');
  await f.retry();assert.equal(f.runs.rows[0].results[0].status,'unconfirmed');
});
test('input and facts reject foreign accounts, arbitrary levels, empty scope and unbounded runs',()=>{
  assert.throws(()=>validateRun({...input,limit:100})); assert.throws(()=>validateRun({...input,discover:false,existing:false}));
  assert.throws(()=>validateFacts({foreign:{city:'x',skill:'Beginner'}},['own']));
  assert.deepEqual(validateFacts({own:{city:'',skill:''}},['own']),{own:{}});
  assert.throws(()=>validateRun({...input,goal:'Hire a caller for [specific tasks], [hours] hours weekly. Required: [skills].'}),/Replace.*specific tasks/);
  assert.equal(validateRun({...input,goal:'Hire a caller to arrange meetings for 10 hours weekly. Required skills: spoken English.'}).limit,3);
});

test('AI failures record the exact step and retry event without publishing',async()=>{
  const f=fixture();f.api.ai=async(_task,_data,_schema,options)=>{
    await options.onRetry({attempt:2,reason:'The AI answer was cut short before it finished.'});
    const {SessionError}=await import('./skool.mjs');throw new SessionError('AI provider unavailable.',502,false);
  };
  f.service=createAutomation(f.api);await f.service.start(input);await f.execute();
  assert.equal(f.runs.rows[0].results[0].failedStage,'Writing for existing');
  assert.match(f.runs.rows[0].events.map(e=>e.message).join('\n'),/Retrying AI \(attempt 2 of 3\)/);
  assert.deepEqual(f.counts(),{posts:0,joins:1});
});

test('community matching never calls AI or excludes communities based on relevance',async()=>{
  const f=fixture(),ai=f.api.ai;
  f.api.memberships=async()=>({hasMore:false,communities:Array.from({length:16},(_,i)=>({name:`Unrelated community ${i}`,description:'An entirely different topic',url:`https://www.skool.com/group-${i}`,membershipStatus:'joined'}))});
  f.api.ai=async(task,data,...rest)=>{
    assert.equal(data.communities,undefined);assert.equal(data.goal,input.goal);
    assert.ok(data.community,'Only article writing can invoke AI');
    return ai(task,data,...rest);
  };
  f.service=createAutomation(f.api);await f.service.start({...input,discover:false});await f.execute();
  assert.equal(f.runs.rows[0].status,'completed');assert.equal(f.counts().posts,3);
  assert.equal(f.runs.rows[0].matching,null);assert.equal(f.runs.rows[0].selectionMode,'all');
});

test('real posting restrictions and rejected posts advance to another community without consuming the success target',async()=>{
  const f=fixture(),prepare=f.api.publishing.prepare;
  const names=['restricted','rejected','allowed','unused'];
  f.api.memberships=async()=>({communities:names.map(name=>({name,url:`https://www.skool.com/${name}`,membershipStatus:'joined'})),hasMore:false});
  f.api.publishing.prepare=async args=>{
    if(args.groupName==='restricted')throw new SessionError('No category allows regular member posts.',502,false);
    return prepare(args);
  };
  const sent=[];
  f.api.publishing.publish=async({context})=>{sent.push(context.groupName);return context.groupName==='rejected'?{status:'blocked',message:'Posting rejected'}:{status:'published',message:'Published'};};
  f.service=createAutomation(f.api);await f.service.start({...input,discover:false,limit:1});await f.execute();
  assert.deepEqual(sent,['rejected','allowed']);
  assert.deepEqual(f.runs.rows[0].results.map(r=>r.status),['error','blocked','published']);
  assert.equal(f.runs.rows[0].status,'completed');
  assert.match(f.runs.rows[0].stage,/Published 1 of 1.*Target reached/);
});

test('pending, incomplete and failed joins try another community before using the post limit',async()=>{
  for(const outcome of ['pending','action_required','error']){
    const f=fixture(), attempts=[];
    f.api.memberships=async()=>({communities:[],hasMore:false});
    f.api.join=async({groupName})=>{
      attempts.push(groupName);
      if(groupName==='new')return {status:'joined'};
      if(outcome==='error')throw new SessionError('Joining failed',502,false);
      return {status:outcome,message:'Membership not yet confirmed'};
    };
    f.service=createAutomation(f.api);await f.service.start({...input,existing:false,limit:1});await f.execute();
    assert.deepEqual(attempts,['existing','new']);assert.equal(f.counts().posts,1);
    assert.deepEqual(f.runs.rows[0].results.map(r=>r.status),[outcome,'published']);
    assert.equal(f.runs.rows[0].status,'completed');
  }
});

test('earlier publication attempts do not hide unused matches on a later run',async()=>{
  const f=fixture();await f.service.start({...input,limit:1});await f.execute();
  await f.service.start({...input,limit:1});await f.execute();
  assert.deepEqual(f.counts(),{posts:2,joins:1});
  assert.deepEqual(f.runs.rows[1].results.map(r=>r.status),['skipped','published']);
});

test('exhausted matches wait for another search without claiming completion',async()=>{
  const f=fixture();f.api.publishing.prepare=async()=>{throw new SessionError('Posting restricted',502,false);};
  f.service=createAutomation(f.api);await f.service.start({...input,limit:1});await f.execute();
  assert.equal(f.runs.rows[0].results.length,2);assert.equal(f.counts().posts,0);
  assert.equal(f.runs.rows[0].active,true);assert.equal(f.runs.rows[0].status,'waiting');
  assert.match(f.runs.rows[0].stage,/Published 0 of 1.*Searching again/);
});

test('uncertain or thrown publication outcomes reserve a slot and never exceed the limit',async()=>{
  for(const throws of [false,true]){
    const f=fixture();let attempts=0;
    f.api.publishing.publish=async()=>{attempts++;if(throws)throw new Error('Response lost');return {status:'unconfirmed',message:'Timeout'};};
    f.service=createAutomation(f.api);await f.service.start({...input,limit:1});await f.execute();
    assert.equal(attempts,1);assert.equal(f.runs.rows[0].results.length,1);
    assert.equal(f.runs.rows[0].results[0].status,'unconfirmed');
    assert.match(f.runs.rows[0].stage,/Waiting to verify unconfirmed/);
  }
});

test('rate limits during joining, reading rules or publishing wait for a cooldown',async()=>{
  for(const step of ['join','prepare','publish']){
    const f=fixture();let attempts=0;
    const limited=async()=>{attempts++;throw new SessionError('Rate limited',429,false);};
    if(step==='join'){f.api.memberships=async()=>({communities:[],hasMore:false});f.api.join=limited;}
    else if(step==='prepare')f.api.publishing.prepare=limited;
    else f.api.publishing.publish=async()=>{attempts++;return {status:'blocked',rateLimited:true,message:'Rate limited'};};
    f.service=createAutomation(f.api);await f.service.start(input);await f.execute();
    assert.equal(attempts,1);assert.equal(f.runs.rows[0].results.length,1);
    assert.equal(f.runs.rows[0].status,'waiting');assert.match(f.runs.rows[0].stage,/rate-limiting/);
  }
});

test('cancellation after rejection prevents moving on to another community',async()=>{
  const f=fixture();let attempts=0;
  f.api.publishing.publish=async()=>{attempts++;await f.service.stop(f.runs.rows[0]._id);return {status:'blocked',message:'Rejected'};};
  f.service=createAutomation(f.api);await f.service.start({...input,limit:1});await f.execute();
  assert.equal(attempts,1);assert.equal(f.runs.rows[0].status,'stopped');assert.equal(f.runs.rows[0].results.length,1);
});

test('three means three: failed candidates and exhausted pages continue until exactly three confirmed posts',async()=>{
  const f=fixture(),pages=[],sent=[];
  f.api.memberships=async()=>({communities:[],hasMore:false});
  f.api.discovery=async params=>{
    const page=Number(params.get('page'));pages.push(page);
    const names=page===1?['blocked','first']:page===2?['second']:['third','unused'];
    return {communities:names.map(name=>({name,url:`https://www.skool.com/${name}`})),hasMore:page<3};
  };
  f.api.publishing.publish=async({context})=>{sent.push(context.groupName);return{status:context.groupName==='blocked'?'blocked':'published',message:'Result'};};
  f.service=createAutomation(f.api);await f.service.start(input);await f.execute();
  assert.equal(f.runs.rows[0].status,'waiting');assert.equal(f.runs.rows[0].active,true);
  assert.equal(f.runs.rows[0].results.filter(r=>r.status==='published').length,2);
  assert.equal(f.deferred.length,1);assert.ok(f.deferred[0].delay>=60000);
  await f.retry();
  assert.deepEqual(pages,[1,2,3]);assert.deepEqual(sent,['blocked','first','second','third']);
  assert.equal(f.runs.rows[0].status,'completed');assert.equal(f.runs.rows[0].active,false);
  assert.equal(f.runs.rows[0].results.filter(r=>r.status==='published').length,3);
  assert.equal(f.deferred.length,0);
});

test('AI and membership failures retry in the same run without losing prior successful posts',async()=>{
  const f=fixture(),ai=f.api.ai;let fails=true;
  f.api.ai=async(...args)=>{if(fails){fails=false;throw Object.assign(new SessionError('AI unavailable',502,false),{retryable:true});}return ai(...args);};
  f.service=createAutomation(f.api);await f.service.start({...input,limit:2});await f.execute();
  assert.equal(f.runs.rows[0].status,'waiting');
  f.runs.rows[0].results.filter(r=>r.status==='error').forEach(r=>{r.nextCheckAt=new Date(0);});
  await f.retry();assert.equal(f.runs.rows[0].status,'completed');assert.equal(f.counts().posts,2);
});

test('uncertain posts are reconciled before completion and never replaced or counted as success prematurely',async()=>{
  const f=fixture();let sends=0,checks=0;
  f.api.publishing.publish=async()=>{sends++;return{status:'unconfirmed',message:'Lost response'};};
  f.api.publishing.reconcile=async()=>{checks++;return checks===1?{status:'unconfirmed'}:{status:'published',message:'Verified',postId:'confirmed'};};
  f.service=createAutomation(f.api);await f.service.start({...input,limit:1});await f.execute();
  assert.equal(f.runs.rows[0].status,'waiting');await f.retry();
  assert.equal(f.runs.rows[0].status,'waiting');assert.equal(sends,1);
  await f.retry();assert.equal(sends,1);assert.equal(checks,2);
  assert.equal(f.runs.rows[0].status,'completed');assert.equal(f.publications.rows[0].status,'published');
});

test('stopping during cooldown is immediate and queued retries cannot publish',async()=>{
  const f=fixture();await f.service.start(input);await f.execute();
  assert.equal(f.runs.rows[0].status,'waiting');await f.service.stop(f.runs.rows[0]._id);
  assert.equal(f.runs.rows[0].status,'stopped');assert.equal(f.runs.rows[0].active,false);
  await f.retry();assert.equal(f.counts().posts,2);
});

test('a restarted service resumes the same run, verifies receipts and keeps the exact remaining target',async()=>{
  const f=fixture();await f.service.start(input);await f.execute();
  const saved=clone(f.runs.rows[0]);saved.nextAttemptAt=null;
  f.api.discovery=async()=>({communities:[{name:'Third',url:'https://www.skool.com/third'}],hasMore:false});
  const resumed=createAutomation(f.api);
  await resumed.resume(saved);await resumed.resume(saved);await f.execute();
  assert.equal(f.counts().posts,3);assert.equal(f.runs.rows[0].status,'completed');
  const other=createAutomation({...f.api,ownerId:'other'});await other.resume(saved);
  assert.equal(f.counts().posts,3);
});

test('pending memberships can become joined on a later round without a second run',async()=>{
  const f=fixture();let accepted=false;
  f.api.join=async()=>({status:accepted?'joined':'pending',message:'Approval status'});
  f.service=createAutomation(f.api);await f.service.start({...input,limit:2});await f.execute();
  assert.equal(f.counts().posts,1);assert.equal(f.runs.rows[0].status,'waiting');
  accepted=true;f.runs.rows[0].results.find(r=>r.status==='pending').nextCheckAt=new Date(0);
  await f.retry();assert.equal(f.counts().posts,2);assert.equal(f.runs.rows[0].status,'completed');
});

test('a confirmed rate-limit rejection retries after cooldown without consuming a success',async()=>{
  const f=fixture();let attempts=0;
  f.api.publishing.publish=async()=>{attempts++;return attempts===1?{status:'blocked',rateLimited:true,message:'Rate limited'}:{status:'published',message:'Published'};};
  f.service=createAutomation(f.api);await f.service.start({...input,discover:false,limit:1});await f.execute();
  assert.equal(attempts,1);assert.ok(f.deferred[0].delay>=900000);
  f.runs.rows[0].results[0].nextCheckAt=new Date(0);
  await f.retry();assert.equal(attempts,2);assert.equal(f.runs.rows[0].status,'completed');
  assert.equal(f.publications.rows.length,1);assert.equal(f.publications.rows[0].status,'published');
});

test('cooldown runs remain active and cannot be cleared or duplicated',async()=>{
  const f=fixture();await f.service.start(input);await f.execute();
  assert.deepEqual(await f.service.clearHistory(),{cleared:0});
  await assert.rejects(f.service.start(input),/already active/);
  assert.equal((await f.service.list()).runs[0].status,'waiting');
});
