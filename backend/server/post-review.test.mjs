import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewAsIsPost } from './post-review.mjs';

const context={rules:[],labels:[{id:'general',name:'General discussion'},{id:'jobs',name:'Hiring'}]};
const post={title:'Hiring a developer',content:'Work with me for $1000 per month.'};
test('local checks prefer General over Hiring without rewriting text',()=>{
  assert.deepEqual(reviewAsIsPost(context,post),{suitable:true,reason:'',labelId:'general'});
  assert.equal(reviewAsIsPost(context,{title:'A question',content:'What tools do you use?'}).labelId,'general');
});
test('local checks reject prohibited promotions, recruitment, links and permission requirements',()=>{
  for(const title of ['No self-promotion','No recruitment posts','Advertising requires prior admin approval'])assert.equal(reviewAsIsPost({...context,rules:[{title}]},post).suitable,false);
  assert.equal(reviewAsIsPost({...context,rules:[{title:'No external links'}]},{title:'Website',content:'https://example.com'}).suitable,false);
  assert.equal(reviewAsIsPost({...context,labels:[]},post).suitable,false);
});
test('a user-supplied as-is post is not treated as AI-written content',()=>{
  assert.equal(reviewAsIsPost({...context,rules:[{title:'No AI-generated posts'}]},post).suitable,true);
});
