import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileSettings, validateProfile, membershipFacts } from './profile-settings.mjs';
import { ownerCollection } from './identity.mjs';
import { createSurveyAnswers } from './ai.mjs';

test('shared profile persists privately and applies to existing and future accounts', async () => {
  const stored = new Map([['alice',{_id:'alice',facts:{a:{city:'Old city',skill:'Beginner'}}}]]);
  const settings={findOne:async q=>structuredClone(stored.get(q._id)||null),updateOne:async(q,u)=>stored.set(q._id,{...(stored.get(q._id)||{_id:q._id}),...structuredClone(u.$set)})};
  const rows=[{_id:'a',ownerId:'alice',displayName:'A',encryptedCookies:'never return'},{_id:'b',ownerId:'alice',displayName:'B'},{_id:'c',ownerId:'bob',displayName:'C'}];
  const accounts={find:q=>({toArray:async()=>rows.filter(a=>a.ownerId===q.ownerId)})};
  const alice=createProfileSettings(settings,ownerCollection(accounts,'alice'),'alice');
  const bob=createProfileSettings(settings,ownerCollection(accounts,'bob'),'bob');
  assert.equal((await alice.get()).replacesLegacy,true);
  await alice.save({profile:{city:'Nagoya',occupation:'Developer',skill:'Beginner',answers:[{question:'What brings you here?',answer:'Learn about automation'}]}});
  const saved=await alice.get();assert.equal(saved.profile.city,'Nagoya');assert.equal(saved.replacesLegacy,false);
  assert.deepEqual(saved.accounts.map(a=>a.id),['a','b']);assert.doesNotMatch(JSON.stringify(saved),/encryptedCookies|never return/);
  for(const id of ['a','b','future-account'])assert.equal(membershipFacts(stored.get('alice'),id).city,'Nagoya');
  assert.deepEqual((await bob.get()).profile,{answers:[]});
  await bob.save({profile:{city:'Different city'}});assert.equal((await alice.get()).profile.city,'Nagoya');
  await alice.save({profile:{answers:[]}});assert.equal(membershipFacts(stored.get('alice'),'a').city,undefined);
});

test('profile validation rejects malformed fields and duplicate custom questions',()=>{
  for(const input of [{email:'invalid'},{website:'javascript:alert(1)'},{skill:'Expert'},{city:'x'.repeat(201)},{occupation:'bad\u0000value'},{ownerId:'foreign'},{answers:[{question:'What city?',answer:''}]},{answers:[{question:' What city? ',answer:'A'},{question:'what city',answer:'B'}]}])assert.throws(()=>validateProfile(input));
  assert.equal(validateProfile({name:'  My name  ',email:'test@example.com'}).name,'My name');
});

test('shared factual answers and custom options stay local and use the supplied information',async()=>{
  const questions=[{question:'What is your occupation?',type:'text'},{question:'Why do you want to join?',type:'text'},{question:'Choose your level',type:'options',options:['Starting','Experienced']},{question:'Email?',type:'email'}];
  const answer=createSurveyAnswers(async(_task,data)=>{
    assert.doesNotMatch(JSON.stringify(data),/PrivateJob|private@example|PrivateGoal|ExperiencedAnswer/);
    assert.deepEqual(data.questions.map(q=>q.index),[0,1]);
    return {answers:[{index:0,field:'occupation',answer:'Invented profession'},{index:1,field:'goal',answer:'Invented goal'}]};
  });
  const result=await answer({group:{name:'test',metadata:{survey:JSON.stringify({survey:questions})}},self:{email:'account@example.com'},facts:{occupation:'PrivateJob',goal:'PrivateGoal',email:'private@example.com',answers:[{question:' Choose your level? ',answer:'Experienced'}]}});
  assert.deepEqual(result.missing,[]);assert.deepEqual(result.survey.map(q=>q.answer),['PrivateJob','PrivateGoal','Experienced','private@example.com']);
});

test('saved answers work without an AI call, unsupported option values remain unanswered',async()=>{
  const answer=createSurveyAnswers(async()=>{throw new Error('AI must not be called');});
  const group={name:'test',metadata:{survey:JSON.stringify({survey:[{question:'Your focus?',type:'options',options:['Learning','Teaching']}]})}};
  const ok=await answer({group,self:{},facts:{answers:[{question:'Your focus?',answer:'Learning'}]}});assert.equal(ok.missing.length,0);
  const invalid=await answer({group,self:{},facts:{answers:[{question:'Your focus?',answer:'An unlisted option'}]}});assert.equal(invalid.missing.length,1);
});
