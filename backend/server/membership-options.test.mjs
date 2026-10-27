import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticMembershipAnswer, defaultMembershipAnswer } from './membership-options.mjs';
import { createSurveyAnswers } from './ai.mjs';

const option = (question,options)=>({question,type:'options',options});
test('ordinary interest choices select automatically, using a matching goal or the first option',()=>{
  const q=option('What are you most excited to learn?',['Marketing','Development','Design']);
  assert.equal(automaticMembershipAnswer(q,{goal:'Learn development'}),'Development');
  assert.equal(automaticMembershipAnswer(q,{}),'Marketing');
  assert.equal(automaticMembershipAnswer(option('Which topic interests you?',['$100 paid plan','Design']),{}),'Design');
});
test('source, ordinary rule acknowledgement and optional marketing questions resolve locally',()=>{
  assert.equal(automaticMembershipAnswer(option('How did you find this community?',['Instagram','Skool discovery','Friend']),{}),'Skool discovery');
  assert.equal(automaticMembershipAnswer({question:'What platform did you find the community through?',type:'text'},{}),'I found this community on Skool.');
  assert.equal(automaticMembershipAnswer(option('Do you understand and agree to follow the community rules?',['No','Yes, I understand']),{}),'Yes, I understand');
  assert.equal(automaticMembershipAnswer(option('Would you like to subscribe to the weekly newsletter?',['Yes please','No thanks']),{}),'No thanks');
  assert.equal(automaticMembershipAnswer(option('Do you agree to the rules and confirm your real name and profile photo?',['Yes','No']),{}),undefined);
});
test('known profile values select decorated options and factual choices are never guessed',()=>{
  assert.equal(automaticMembershipAnswer(option('Skating level?',['Beginner — starting out','Advanced']),{},'Beginner'),'Beginner — starting out');
  assert.equal(automaticMembershipAnswer(option('Where do you live?',['Japan','United States']),{},'japan'),'Japan');
  const q=option('Do you live in the United States or one of its territories?',['Yes','No']);
  assert.equal(automaticMembershipAnswer(q,{country:'Japan'}),'No');
  assert.equal(automaticMembershipAnswer(q,{country:'United States'}),'Yes');
  assert.equal(automaticMembershipAnswer(q,{}),undefined);
  for(const question of ['Which best describes your experience level?','What is your current status?','Have you completed the paid course?','What is the access password?']){
    assert.equal(automaticMembershipAnswer(option(question,['First option','Second option']),{}),undefined);
  }
});
test('automatic preference choices need no AI and always use an actual offered option',async()=>{
  const survey=[option('What topic are you interested in?',['Development','Sales']),option('Do you agree to follow the rules?',['Yes','No']),option('Would you like our newsletter?',['Yes','No'])];
  const answer=createSurveyAnswers(async()=>{throw new Error('No AI needed');});
  const result=await answer({group:{name:'test',metadata:{survey:JSON.stringify({survey})}},self:{},facts:{goal:'Learn development'}});
  assert.deepEqual(result.missing,[]);assert.deepEqual(result.survey.map(q=>q.answer),['Development','Yes','No']);
});

test('saved option answers take priority over default selection and invalid answers are not silently replaced',()=>{
  const q=option('Which topic interests you?',['Design','Sales']);
  assert.equal(automaticMembershipAnswer(q,{},'Sales'),'Sales');
  assert.equal(automaticMembershipAnswer(q,{},'Unavailable option'),'');
  assert.equal(automaticMembershipAnswer(option('Why do you want to join?',['Learn','Network']),{}),'Learn');
});

test('missing routine text uses non-disclosure, protected access checks never get invented answers',()=>{
  assert.equal(defaultMembershipAnswer({question:'Which tools do you use?',type:'text'}),"I haven't provided that information yet.");
  assert.equal(defaultMembershipAnswer(option('Where are you at with your painting right now?',['Just starting or restarting','Advanced'])),'Just starting or restarting');
  assert.equal(defaultMembershipAnswer(option('What type of minis do you paint?',['Warhammer 40K','Historical, display, or other'])),'Historical, display, or other');
  assert.equal(defaultMembershipAnswer(option('How much sales income do you earn?',['$0–$1000','$5000+'])),'');
  for(const question of ['What is the access password?','What is your licence certification?','Have you completed the paid course?'])assert.equal(defaultMembershipAnswer({question,type:'text'}),'');
});

test('the painting questionnaire is answered automatically with offered defaults and no AI',async()=>{
  const survey=[option('Where are you at with your painting right now?',['Just starting or restarting','I’ve painted a bit but feel inconsistent','Solid, but stuck at the same level','Advanced and pushing for the next tier']),option('What type of minis do you paint?',['Warhammer 40K','Age of Sigmar & Fantasy','D&D & RPG minis','Historical, display, or other']),option("What's your #1 painting goal right now?",['Paint my army to a solid tabletop standard','Get noticeably better and more consistent','Win competitions or take commissions','Just enjoy the hobby and learn new techniques'])];
  const answer=createSurveyAnswers(async()=>{throw new Error('AI must not be required');});
  const result=await answer({group:{name:'brushandbanner',metadata:{survey:JSON.stringify({survey})}},self:{}});
  assert.deepEqual(result.missing,[]);assert.equal(result.survey[0].answer,survey[0].options[0]);assert.equal(result.survey[1].answer,survey[1].options[3]);
  assert.ok(result.survey.every(q=>q.options.includes(q.answer)));
});
