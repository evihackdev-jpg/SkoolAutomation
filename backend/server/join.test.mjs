import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createJoin, createRandomAccount, automaticJoinPlan, createMembershipCheck } from './join.mjs';
import { ownerCollection } from './identity.mjs';
import { encryptCookies } from './accounts.mjs';
import { createHandler } from './http.mjs';
import { createSurveyAnswers } from './ai.mjs';

const groupName = 'test-community';

test('random selection chooses exactly one active owned account without joining', async () => {
  const records = [
    { _id: 'one', ownerId: 'alice', status: 'active', displayName: 'One', encryptedCookies: 'secret' },
    { _id: 'two', ownerId: 'alice', status: 'active', displayName: 'Two', encryptedCookies: 'secret' },
    { _id: 'expired', ownerId: 'alice', status: 'unverified' },
    { _id: 'foreign', ownerId: 'bob', status: 'active' },
  ];
  const collection = { find: query => ({ toArray: async () => records.filter(row => row.ownerId === query.ownerId && row.status === query.status) }) };
  let choices = 0;
  const select = createRandomAccount(ownerCollection(collection, 'alice'), length => { choices++; assert.equal(length, 2); return 1; });
  assert.deepEqual(await select({ groupName }), { account: { id: 'two', displayName: 'Two' } });
  assert.equal(choices, 1);
  await assert.rejects(select({ groupName: '../escape' }), /valid community/);
  await assert.rejects(createRandomAccount(ownerCollection(collection, 'nobody'))({ groupName }), /Connect a Skool account/);
});
const page = ({ role, model = 1, lockdown = 0, name = groupName, signedIn = true, surveyEnabled = 0 } = {}) => new Response(`<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { currentGroup: { id: 'a'.repeat(32), name, metadata: { membershipModel: model, lockdown, surveyEnabled } }, self: signedIn ? { id: 'test-user', member: role ? { role } : undefined } : null } } })}</script>`);
function setup(fetcher, answerSurvey) {
  const key = randomBytes(32), id = randomUUID();
  const cookies = ['auth_token', 'client_id', 'aws-waf-token'].map(name => ({ name, value: 'synthetic', domain: '.skool.com', path: '/' }));
  const account = { _id: id, status: 'active', encryptedCookies: encryptCookies(cookies, key, id) };
  return { body: { accountId: id, groupName }, join: createJoin({ findOne: async query => query._id === id ? account : null }, key, fetcher, answerSurvey, {wait:async()=>{}}) };
}

test('free join sends only approved cookies and verifies the resulting membership', async () => {
  const calls = [];
  const { join, body } = setup(async (url, options) => {
    calls.push([url, options]);
    assert.equal(options.headers.Cookie, 'auth_token=synthetic; client_id=synthetic');
    assert.equal(options.redirect, 'manual');
    if (calls.length === 1) return page();
    if (calls.length === 2) {
      assert.equal(url, 'https://api2.skool.com/groups/test-community/join-group');
      assert.equal(options.method, 'POST');
      return Response.json({});
    }
    return page({ role: 'member' });
  });
  assert.equal((await join(body)).status, 'joined');
  assert.equal(calls.length, 3);
});

test('paid, tiered, unknown and locked communities never submit a join', async () => {
  for (const props of [{ model: 2 }, { model: 4 }, { model: 5 }, { model: 99 }, { lockdown: 1 }]) {
    let calls = 0;
    const { join, body } = setup(async (_url, options) => { calls++; assert.notEqual(options.method, 'POST'); return page(props); });
    assert.equal((await join(body)).status, 'action_required');
    assert.equal(calls, 1);
  }
});

test('freemium automatically selects Standard through the free join action', async () => {
  let calls = 0;
  const { join, body } = setup(async (url, options) => {
    calls++;
    if (calls === 1) return page({ model: 3 });
    if (calls === 2) {
      assert.equal(url, 'https://api2.skool.com/groups/test-community/join-group');
      assert.equal(options.method, 'POST');
      assert.equal(options.body, undefined);
      return Response.json({});
    }
    return page({ model: 3, role: 'member' });
  });
  const result = await join(body);
  assert.equal(result.status, 'joined');
  assert.equal(result.plan, 'Standard (free)');
  assert.equal(calls, 3);
});

test('legacy free groups are distinguished from legacy billing and closed groups', () => {
  for (const metadata of [{}, { membershipModel: 0 }, { membershipModel: null }]) assert.equal(automaticJoinPlan(metadata).allowed, true);
  for (const metadata of [{ currentMBp: 'monthly' }, { currentABp: 'annual' }, { currentOtBp: 'once' }, { membershipModel: 3, lockdown: 1 }]) assert.equal(automaticJoinPlan(metadata).allowed, false);
});

test('existing, pending and banned memberships are not joined again', async () => {
  for (const [role, status] of [['member', 'joined'], ['group-admin', 'joined'], ['pending', 'pending'], ['banned', 'action_required']]) {
    const { join, body } = setup(async (_url, options) => { assert.notEqual(options.method, 'POST'); return page({ role }); });
    assert.equal((await join(body)).status, status);
  }
});

test('questions, pending approval and uncertain results are never reported as joined', async () => {
  for (const [post, after, status] of [[{ needs_survey: true }, undefined, 'action_required'], [{}, 'pending', 'pending'], [{}, undefined, 'unconfirmed']]) {
    let calls = 0;
    const { join, body } = setup(async () => ++calls === 1 ? page() : calls === 2 ? Response.json(post) : page({ role: after }));
    assert.equal((await join(body)).status, status);
  }
  let calls = 0;
  const { join, body } = setup(async () => { if (++calls === 1) return page(); throw new Error('timeout'); });
  assert.equal((await join(body)).status, 'unconfirmed');
  assert.equal(calls, 5);
});

test('foreign account IDs, invalid names, signed-out pages and redirects cannot submit joins', async () => {
  const { join, body } = setup(() => { throw new Error('Unexpected network request'); });
  await assert.rejects(join({ ...body, accountId: randomUUID() }), /Account not found/);
  await assert.rejects(join({ ...body, groupName: '../other' }), /valid community/);
  for (const response of [page({ signedIn: false }), page({ name: 'another-group' }), new Response('', { status: 302, headers: { Location: 'https://example.com' } })]) {
    const { join, body } = setup(async (_url, options) => { assert.notEqual(options.method, 'POST'); return response; });
    await assert.rejects(join(body));
  }
});

test('AI questionnaire answers are submitted before rejoining, then verified against live membership', async () => {
  for (const initialRole of [undefined, 'pending']) {
    const calls = [];
    const survey = [{ question: 'Why join?', type: 'text', answer: 'To learn.' }];
    const { join, body } = setup(async (url, options) => {
      calls.push(url);
      if (calls.length === 1) return page({ role: initialRole, surveyEnabled: 1 });
      if (calls.length === 2) return Response.json({ needs_survey: true });
      if (calls.length === 3) {
        assert.equal(url, `https://api2.skool.com/groups/${'a'.repeat(32)}/submit-survey-answers`);
        assert.deepEqual(JSON.parse(options.body), { survey });
        assert.equal(options.headers.Cookie, 'auth_token=synthetic; client_id=synthetic');
        return Response.json({});
      }
      if (calls.length === 4) return Response.json({});
      return page({ role: 'member' });
    }, async () => ({ survey, missing: [] }));
    const result = await join(body);
    assert.equal(result.status,'joined'); assert.match(result.message,/questions answered/); assert.equal(calls.length,5);
  }
});
test('unknown personal facts never submit survey answers', async () => {
  let calls=0;
  const {join,body}=setup(async()=>++calls===1?page():Response.json({needs_survey:true}),async()=>({missing:['What is your city?'],survey:[]}));
  const result=await join(body);assert.equal(result.status,'action_required');assert.match(result.message,/city/);assert.equal(calls,2);
});

test('configured membership questions are completed even when the join response omits needs_survey',async()=>{
  let calls=0,submitted;
  const survey=[{question:'What would you like to learn?',type:'options',options:['Design','Coding'],answer:'Coding'}];
  const {join,body}=setup(async(url,options)=>{
    calls++;
    if(calls===1)return page({surveyEnabled:1});
    if(url.endsWith('/submit-survey-answers')){submitted=JSON.parse(options.body);return Response.json({});}
    if(options.method==='POST')return Response.json({});
    return page({role:'member',surveyEnabled:1});
  },async()=>({survey,missing:[]}));
  assert.equal((await join(body)).status,'joined');assert.deepEqual(submitted,{survey});
});

test('automatic interest selection flows through answer submission and independent membership verification',async()=>{
  const questions=[{question:'What topic interests you?',type:'options',options:['Design','Development']},{question:'Do you agree to follow our community rules?',type:'options',options:['Yes','No']}];
  let submitted=false,posts=0;
  const answer=createSurveyAnswers(async()=>{throw new Error('These choices do not require AI');});
  const {join,body}=setup(async(url,options)=>{
    if(url.endsWith('/submit-survey-answers')){
      const survey=JSON.parse(options.body).survey;
      assert.deepEqual(survey.map(q=>q.answer),['Development','Yes']);submitted=true;return Response.json({});
    }
    if(options.method==='POST'){posts++;return Response.json({needs_survey:!submitted});}
    return new Response(`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{currentGroup:{id:'a'.repeat(32),name:groupName,metadata:{membershipModel:1,surveyEnabled:true,survey:JSON.stringify({survey:questions})}},self:{id:'test-user',member:submitted?{role:'member'}:undefined}}}})}</script>`);
  },answer);
  const result=await join({...body,facts:{goal:'Learn development'}});
  assert.equal(submitted,true);assert.equal(posts,2);assert.equal(result.status,'joined');
  assert.match(result.message,/Membership questions answered/);
});

test('Skool follow-up modal flags cannot hide an independently confirmed successful join',async()=>{
  let joined=false;
  const {join,body}=setup(async(_url,options)=>{
    if(options.method==='POST'){joined=true;return Response.json({skoolers_modal:true});}
    return page({role:joined?'member':undefined});
  });
  assert.equal((await join(body)).status,'joined');
});

test('a lost or rejected follow-up after survey submission still verifies the actual membership',async()=>{
  for(const outcome of ['reject','timeout']){
    let submitted=false,posts=0;
    const {join,body}=setup(async(url,options)=>{
      if(url.endsWith('/submit-survey-answers')){submitted=true;return Response.json({});}
      if(options.method==='POST'){
        posts++;if(posts===1)return Response.json({needs_survey:true});
        if(outcome==='timeout')throw new Error('Lost response');return new Response('',{status:400});
      }
      return page({role:submitted?'member':undefined,surveyEnabled:1});
    },async()=>({survey:[{question:'Email?',type:'email',answer:'test@example.com'}],missing:[]}));
    assert.equal((await join(body)).status,'joined');assert.equal(posts,2);
  }
});

test('membership checking is scoped, read-only, and accurately reports owner approval',async()=>{
  const id=randomUUID(),key=randomBytes(32),encryptedCookies=encryptCookies([{name:'auth_token',value:'test',domain:'.skool.com',path:'/'},{name:'client_id',value:'test',domain:'.skool.com',path:'/'}],key,id);
  let calls=0;
  const check=createMembershipCheck({findOne:async q=>q._id===id?{_id:id,encryptedCookies}:null},key,async(url,options)=>{
    calls++;assert.equal(options.method,undefined);assert.equal(url,`https://www.skool.com/${groupName}/about`);return page({role:calls===1?'pending':'member'});
  });
  const params=new URLSearchParams({accountId:id,groupName});
  assert.equal((await check(params)).status,'pending');assert.equal((await check(params)).status,'joined');
  await assert.rejects(check(new URLSearchParams({accountId:randomUUID(),groupName})),/Account not found/);
  assert.equal(calls,2);
});

test('concurrent clicks for the same account and group share one join request', async () => {
  let posts = 0;
  const { join, body } = setup(async (_url, options) => {
    if (options.method === 'POST') { posts++; return Response.json({}); }
    return page({ role: posts ? 'member' : undefined });
  });
  const results = await Promise.all([join(body), join(body)]);
  assert.equal(posts, 1);
  assert.ok(results.every(result => result.status === 'joined'));
});

test('HTTP join requires a same-origin JSON POST with a bounded body', async () => {
  let calls = 0;
  const config = { port: 0, origins: [], join: async body => { calls++; return { status: 'pending', accountId: body.accountId }; } };
  const server = createServer(createHandler({}, config));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  config.port = server.address().port;
  const url = `http://127.0.0.1:${config.port}/api/communities/join`;
  try {
    assert.equal((await fetch(url)).status, 404);
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 415);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' })).status, 403);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(5000) })).status, 413);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })).status, 400);
    const result = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: 'test' }) });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).accountId, 'test');
    assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
