import test from 'node:test';
import assert from 'node:assert/strict';
import { createAI, createSurveyAnswers, localProfileFacts, surveyQuestions, objectSchema, matchesSchema } from './ai.mjs';

test('OpenRouter uses only its key and fixed endpoint; failures do not leak response secrets', async () => {
  let calls = 0;
  const ai = createAI({ apiKey: 'test-key', fetcher: async (url, options) => {
    calls++; assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-key'); assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.redirect, 'error'); assert.equal(JSON.parse(options.body).response_format.type, 'json_schema');
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] });
  } });
  assert.deepEqual(await ai('Test', { topic: 'test' }, {}), { ok: true }); assert.equal(calls,1);
  const bad = createAI({ apiKey: 'test-key', fetcher: async () => new Response('secret upstream details', { status: 402 }) });
  await assert.rejects(bad('Test', {}, {}), error => /credits|balance/.test(error.message) && !/secret/.test(error.message));
  await assert.rejects(createAI({ apiKey: '' })('Test',{},{}), /Configure/);
});

test('invalid JSON or a provider error inside HTTP 200 retries generation once in validated JSON mode', async () => {
  for (const first of [{error:{code:503,message:'private provider details'}}, {choices:[{finish_reason:'stop',message:{content:'not JSON'}}]}, {choices:[{finish_reason:'length',message:{content:'{"count":1}'}}]}]) {
    const calls=[], retries=[];
    const ai=createAI({apiKey:'synthetic',model:'openrouter/free',retryDelayMs:0,fetcher:async(_url,options)=>{
      const body=JSON.parse(options.body);calls.push(body);
      return calls.length===1?Response.json(first):Response.json({choices:[{finish_reason:'stop',message:{content:'```json\n{"count":1}\n```'}}]});
    }});
    assert.deepEqual(await ai('test',{},objectSchema({count:{type:'integer'}}),{onRetry:async event=>retries.push(event)}),{count:1});
    assert.equal(calls.length,2);assert.equal(calls[1].response_format.type,'json_object');assert.equal(calls[1].model,'openrouter/free');
    assert.match(calls[1].messages[0].content,/"count"/);assert.equal(retries.length,1);assert.doesNotMatch(retries[0].reason,/private/);
  }
});
test('schema-invalid answers, quota errors and cancelled generation never escape validation',async()=>{
  const schema=objectSchema({score:{type:'integer',minimum:0,maximum:100}});
  assert.equal(matchesSchema({score:101},schema),false);assert.equal(matchesSchema({score:'10'},schema),false);assert.equal(matchesSchema({score:10,extra:true},schema),false);
  let calls=0;
  const invalid=createAI({apiKey:'synthetic',retryDelayMs:0,fetcher:async()=>{calls++;return Response.json({choices:[{finish_reason:'stop',message:{content:'{"score":"10"}'}}]});}});
  await assert.rejects(invalid('test',{},schema),/required fields/);assert.equal(calls,3);
  calls=0;await assert.rejects(invalid('test',{},schema,{shouldRetry:async()=>false}));assert.equal(calls,1);
  calls=0;const rate=createAI({apiKey:'synthetic',retryDelayMs:0,fetcher:async()=>{calls++;return Response.json({error:{code:429,message:'secret'}},{status:200});}});
  await assert.rejects(rate('test',{},schema),/request limit/);assert.equal(calls,1);
});

test('unsupported schema format followed by invalid JSON still gets a content retry and remembers compatible mode',async()=>{
  const requests=[];
  const ai=createAI({apiKey:'synthetic',retryDelayMs:0,fetcher:async(_url,options)=>{
    requests.push(JSON.parse(options.body));
    if(requests.length===1)return Response.json({error:{code:400}},{status:400});
    return Response.json({choices:[{finish_reason:'stop',message:{content:requests.length===2?'not JSON':'{"ok":true}'}}]});
  }});
  const retries=[];
  assert.deepEqual(await ai('test',{},objectSchema({ok:{type:'boolean'}}),{onRetry:e=>retries.push(e)}),{ok:true});
  assert.deepEqual(requests.map(r=>r.response_format.type),['json_schema','json_object','json_object']);
  assert.deepEqual(retries.map(r=>r.attempt),[2,3]);
  await ai('next batch',{},objectSchema({ok:{type:'boolean'}}));
  assert.equal(requests[3].response_format.type,'json_object');
});

test('free routing does not include paid fallback models', async () => {
  const ai = createAI({ apiKey: 'synthetic', model: 'openrouter/free', fetcher: async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'openrouter/free'); assert.equal(body.models, undefined);
    assert.deepEqual(body.reasoning, { enabled: false });
    assert.equal(body.response_format.type, 'json_schema');
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }] });
  } });
  assert.deepEqual(await ai('Test', {}, {}), { ok: true });
});

const questions = [{ question: 'What city do you live in?', type: 'text' }, { question: 'What skill level roller skater are you?', type: 'options', options: ['Beginner (starting)', 'Advanced (experienced)'] }, { question: 'What is your email?', type: 'email' }, { question: 'Why do you want to join?', type: 'text' }];
const group = { name: 'skating', metadata: { displayName: 'Skating', survey: JSON.stringify({ survey: questions }) } };
const self = { firstName: 'Test', lastName: 'Member', email: 'private@example.test', metadata: { location: 'SecretCity', bio: 'PrivateBio', auth_token: 'secret' } };
test('membership facts stay local; unknown skating skill is never defaulted or invented', async () => {
  const answer = createSurveyAnswers(async (_task, data) => {
    assert.doesNotMatch(JSON.stringify(data), /SecretCity|PrivateBio|private@example|auth_token/);
    return { answers: [{ index: 0, field: 'city', answer: 'invented city ignored' }, { index: 1, field: 'skill', answer: 'Advanced (experienced)' }, { index: 3, field: 'intent', answer: 'I would like to learn and participate.' }] };
  });
  const result = await answer({ group, self });
  assert.equal(localProfileFacts(self).skill, undefined);
  assert.deepEqual(result.missing, [questions[1].question]);
  assert.equal(result.survey[0].answer,'SecretCity'); assert.equal(result.survey[1].answer,''); assert.equal(result.survey[2].answer,self.email);
  const supplied = await answer({ group, self, facts: { skill: 'Beginner' } });
  assert.deepEqual(supplied.missing, []); assert.equal(supplied.survey[1].answer,'Beginner (starting)');
});
test('unsupported questionnaires and invented intent classifications fail closed', async () => {
  assert.deepEqual(surveyQuestions({ metadata: { survey: JSON.stringify({ survey: [{ question: 'x', type: 'unexpected' }] }) } }), []);
  const answer = createSurveyAnswers(async () => ({ answers: [{ index: 0, field: 'intent', answer: 'I live in invented city' }] }));
  const result = await answer({ group, self: {} });
  assert.ok(!result.missing.includes(questions[0].question)); assert.equal(result.survey[0].answer, "I haven't provided that information yet.");
});

test('common membership questions use saved information without depending on AI',async()=>{
  const answer=createSurveyAnswers(async()=>{throw new Error('Common questions should not need AI');});
  const survey=[
    {question:'What is your name?',type:'text'},
    {question:'What is your email?',type:'text'},
    {question:'What city do you live in?',type:'text'},
    {question:'What is your occupation?',type:'text'},
    {question:'Why do you want to join?',type:'text'},
    {question:'What would building consistent online income change for you or your family, and what are you ultimately working toward?',type:'text'},
    {question:'Tell us about your experience',type:'text'},
  ];
  const result=await answer({group:{name:'test',metadata:{survey:JSON.stringify({survey})}},self,facts:{name:'Saved name',occupation:'Developer',goal:'Connect with collaborators',experience:'I build websites'}});
  assert.deepEqual(result.missing,[]);
  assert.deepEqual(result.survey.map(q=>q.answer),['Saved name',self.email,'SecretCity','Developer','Connect with collaborators','Connect with collaborators','I build websites']);
});

test('reworded background questions classify using question text but fill only the actual saved experience',async()=>{
  const survey=[{question:'Tell us about something you worked hard to make happen—even outside business. What did you do when it became difficult?',type:'text'},
    {question:'We use market research to position around real demand. What’s your experience with it? How do you feel about doing it before pursuing clients?',type:'text'}];
  const answer=createSurveyAnswers(async(task,data)=>{
    assert.match(task,/examples of past effort/);assert.doesNotMatch(JSON.stringify(data),/PRIVATE_BACKGROUND/);
    return {answers:data.questions.map(q=>({index:q.index,field:'experience',answer:'Invented story ignored'}))};
  });
  const result=await answer({group:{name:'test',metadata:{survey:JSON.stringify({survey})}},facts:{experience:'PRIVATE_BACKGROUND'}});
  assert.deepEqual(result.missing,[]);assert.ok(result.survey.every(q=>q.answer==='PRIVATE_BACKGROUND'));
});

test('a rate-limited or format-incompatible provider cannot prevent local membership answers',async()=>{
  for(const error of ['OpenRouter request limit reached','Unsupported structured-output format']){
    let calls=0;
    const answer=createSurveyAnswers(async()=>{calls++;throw new Error(error);});
    const group={name:'test',metadata:{survey:JSON.stringify({survey:[{question:'Your Email Address (we verify to protect our members)',type:'text'},{question:'Why join?',type:'text'},{question:'Unknown private credential?',type:'text'}]})}};
    for(let attempt=0;attempt<2;attempt++){
      const result=await answer({group,self,facts:{goal:'Learn and connect'}});
      assert.equal(result.survey[0].answer,self.email);assert.equal(result.survey[1].answer,'Learn and connect');
      assert.deepEqual(result.missing,['Unknown private credential?']);assert.equal(result.usedLocalFallback,true);
    }
    assert.equal(calls,1,'Provider cooldown prevents repeated quota failures');
  }
});

test('the affected communities resolve routine questionnaires without any OpenRouter request',async()=>{
  const answer=createSurveyAnswers(async()=>{throw new Error('OpenRouter unavailable');});
  const surveys=[
    [{question:'Owner / Member',type:'options',options:['Community Owner','Community Member']},{question:'Mail',type:'email'}],
    [{question:'Your Email Address (we verify to protect our members)',type:'text'},{question:'What type of clients or referral partners are you most interested in connecting with?',type:'text'},{question:'What would you most like to improve in your business over the next 90 days?',type:'text'}],
    [{question:'What do you promote or sell?',type:'text'},{question:'Free members can promote Tues & Sat. Premium members can promote all week. Do you agree to follow the promo schedule for your membership?',type:'text'},{question:'Optional: What email would you like to use for Promo Lounge updates, opportunities, and important community news?',type:'text'}],
    [{question:'What are you hoping to learn inside Peptide Index?',type:'text'},{question:'Where did you hear about us (Facebook group name, friend, search, etc.)?',type:'text'},{question:'Do you agree not to promote other groups, Discords, Telegrams, or vendors here? Type YES.',type:'text'}]
  ];
  for(const survey of surveys){
    const result=await answer({group:{name:'test',metadata:{survey:JSON.stringify({survey})}},self,facts:{goal:'Learn and connect',occupation:'Developer'}});
    assert.deepEqual(result.missing,[]);assert.ok(result.survey.every(q=>q.answer));
    assert.equal(result.usedLocalFallback,undefined,'All these questions are resolved before AI is called');
  }
});
