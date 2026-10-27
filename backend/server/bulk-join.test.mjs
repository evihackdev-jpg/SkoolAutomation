import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createBulkJoin, validateBulkJoin } from './bulk-join.mjs';
import { createHandler } from './http.mjs';
import { SessionError } from './skool.mjs';

const clone=value=>structuredClone(value);
function store(){const rows=[];const matches=(row,q)=>Object.entries(q).every(([k,v])=>row[k]===v);return{rows,
  find:q=>{let result=rows.filter(r=>matches(r,q));return{sort(){result.reverse();return this;},limit(n){result=result.slice(0,n);return this;},async toArray(){return clone(result);}};},
  async findOne(q){return clone(rows.find(r=>matches(r,q))||null);},
  async insertOne(row){if(rows.some(r=>r._id===row._id||(r.ownerId===row.ownerId&&r.active&&row.active)))throw Object.assign(new Error('Duplicate'),{code:11000});rows.push(clone(row));},
  async updateOne(q,u){const row=rows.find(r=>matches(r,q));if(row)Object.assign(row,clone(u.$set));return{matchedCount:row?1:0};}
};}
const community=name=>({name,url:`https://www.skool.com/${name}`,price:'Free',members:100});
function fixture(){const jobs=store(),accounts=store(),tasks=[],deferred=[],calls=[];accounts.rows.push({_id:'a',displayName:'Account A',status:'active'});
  const deps={jobs,accounts,ownerId:'owner',choose:()=>0,schedule:task=>tasks.push(task),defer:(task,ms)=>deferred.push({task,ms}),memberships:async()=>({communities:[],hasMore:false}),discovery:async p=>({communities:[community('first')],hasMore:false,total:1}),join:async body=>{calls.push(body);return{status:'joined',message:'Joined'};}};
  return{deps,jobs,accounts,calls,tasks,deferred,service:createBulkJoin(deps),execute:async()=>{assert.ok(tasks.length);await tasks.shift()();},retry:async()=>{assert.ok(deferred.length);await deferred.shift().task();}};
}

test('all free search pages are processed, individual failures do not stop pagination, and duplicates are skipped',async()=>{
  const f=fixture(),pages=[];let allow=true;
  f.deps.discovery=async p=>{assert.equal(p.get('price'),'free');assert.equal(p.get('q'),'painting');const page=Number(p.get('page'));pages.push(page);return{communities:page===1?[community('first'),community('needs-answer'),{...community('paid'),price:'$10/month'}]:[community('first'),community('last')],hasMore:page===1,total:4};};
  f.deps.join=async body=>{f.calls.push(body);return{status:body.groupName==='needs-answer'&&allow?'action_required':'joined',message:'Result'};};
  f.service=createBulkJoin(f.deps);const {job}=await f.service.start({q:'painting',price:'paid'});await assert.rejects(f.service.start({}),/already active/);await f.execute();
  assert.deepEqual(pages,[1,2]);assert.deepEqual(f.calls.map(c=>c.groupName),['first','needs-answer','last']);
  assert.equal(f.jobs.rows[0].status,'waiting');assert.ok(f.deferred[0].ms>=900000);
  allow=false;await f.retry();assert.equal(f.jobs.rows[0].status,'completed');assert.equal(f.jobs.rows[0].active,false);
  assert.equal(f.jobs.rows[0].results.filter(r=>r.status==='joined').length,3);
  assert.equal((await f.service.list()).jobs[0].id,job.id);
});

test('existing memberships across accounts avoid duplicate registrations and pending is reported accurately',async()=>{
  const f=fixture();f.accounts.rows.push({_id:'b',displayName:'B',status:'active'});
  f.deps.memberships=async p=>({communities:[{...community('first'),membershipStatus:p.get('accountId')==='a'?'pending':'joined'}],hasMore:false});
  f.service=createBulkJoin(f.deps);await f.service.start({});await f.execute();
  assert.equal(f.calls.length,0);assert.equal(f.jobs.rows[0].results[0].status,'joined');assert.equal(f.jobs.rows[0].results[0].account.id,'b');
});

test('bulk registration yields to an active posting run before making Skool requests',async()=>{
  const f=fixture();let posting=true;
  f.deps.shouldYield=async()=>posting;
  f.service=createBulkJoin(f.deps);await f.service.start({});await f.execute();
  assert.equal(f.calls.length,0);assert.equal(f.jobs.rows[0].status,'waiting');assert.equal(f.deferred[0].ms,60000);
  posting=false;await f.retry();assert.equal(f.calls.length,1);assert.equal(f.jobs.rows[0].status,'completed');
});

test('rate limits persist the full remaining page and resume after cooldown, retaining the selected account',async()=>{
  const f=fixture();let limited=true;
  f.deps.discovery=async()=>({communities:[community('first'),community('second')],hasMore:false,total:2});
  f.deps.join=async body=>{f.calls.push(body);if(limited){limited=false;throw new SessionError('Rate limited',429,false);}return{status:'pending',message:'Approval required'};};
  f.service=createBulkJoin(f.deps);await f.service.start({});await f.execute();
  assert.equal(f.jobs.rows[0].status,'waiting');assert.equal(f.jobs.rows[0].results.length,2);assert.equal(f.calls.length,1);
  await f.retry();assert.deepEqual(f.calls.map(c=>c.groupName),['first','first','second']);
  assert.equal(f.calls[0].accountId,f.calls[1].accountId);assert.equal(f.jobs.rows[0].status,'completed');
  assert.ok(f.jobs.rows[0].results.every(r=>r.status==='pending'));
});

test('restart recovery preserves progress and cancellation prevents queued mutations',async()=>{
  const f=fixture();let saved;
  const {job}=await f.service.start({});saved=clone(f.jobs.rows[0]);
  const restarted=createBulkJoin(f.deps);await restarted.resume(saved);await restarted.resume(saved);
  assert.equal(f.tasks.length,2);await f.execute();assert.equal(f.calls.length,1);await f.execute();assert.equal(f.calls.length,1);
  const g=fixture();const second=await g.service.start({});await g.service.stop(second.job.id);await g.execute();assert.equal(g.calls.length,0);assert.equal(g.jobs.rows[0].status,'stopped');
  await assert.rejects(createBulkJoin({...f.deps,ownerId:'foreign'}).stop(job.id),/not found/);
  assert.deepEqual((await createBulkJoin({...f.deps,ownerId:'foreign'}).list()).jobs,[]);
});

test('minimum member filters and unavailable free joins cannot submit paid memberships',async()=>{
  const f=fixture();f.deps.discovery=async()=>({communities:[{...community('small'),members:2},community('closed')],hasMore:false});
  f.deps.join=async body=>{f.calls.push(body);return{status:'action_required',code:'free_join_unavailable',message:'Closed or paid'};};
  f.service=createBulkJoin(f.deps);await f.service.start({minimumMembers:10});await f.execute();
  assert.deepEqual(f.calls.map(c=>c.groupName),['closed']);assert.equal(f.jobs.rows[0].results[0].status,'skipped');assert.equal(f.jobs.rows[0].status,'completed');
  for(const input of [{q:'x'.repeat(201)},{language:'../../foreign'},{minimumMembers:-1},{type:'unknown'},{q:{}}])assert.throws(()=>validateBulkJoin(input));
});

test('the source pagination cap never causes unseen results to be claimed complete',async()=>{
  const f=fixture();f.deps.discovery=async()=>({communities:[],hasMore:true,total:5000});
  f.service=createBulkJoin(f.deps);await f.service.start({});f.jobs.rows[0].page=100;await f.execute();
  assert.equal(f.jobs.rows[0].status,'waiting');assert.equal(f.jobs.rows[0].scanFinished,false);assert.match(f.jobs.rows[0].stage,/100-page/);
});

test('bulk HTTP routes enforce same-origin JSON writes and bounded bodies',async()=>{
  let writes=0;
  const bulkJoin={list:async()=>({jobs:[]}),start:async()=>{writes++;return{job:{id:'test'}};},stop:async()=>{writes++;return{stopped:true};}};
  const config={port:0,origins:[],bulkJoin};const server=createServer(createHandler({},config));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));config.port=server.address().port;
  const base=`http://127.0.0.1:${config.port}/api/communities/bulk-join`,json={method:'POST',headers:{'Content-Type':'application/json'},body:'{}'};
  try{
    assert.equal((await fetch(base)).status,200);
    assert.equal((await fetch(base,{method:'POST',body:'{}'})).status,415);
    assert.equal((await fetch(base,{...json,headers:{...json.headers,Origin:'https://foreign.test'}})).status,403);
    assert.equal((await fetch(base,{...json,body:'x'.repeat(4097)})).status,413);
    assert.equal((await fetch(base,{...json,body:'not JSON'})).status,400);assert.equal(writes,0);
    assert.equal((await fetch(base,json)).status,202);
    assert.equal((await fetch(base+'/'+('a'.repeat(36))+'/stop',json)).status,200);assert.equal(writes,2);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
