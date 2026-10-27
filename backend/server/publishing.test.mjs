import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { encryptCookies } from './accounts.mjs';
import { createPublishing } from './publishing.mjs';
const gid='a'.repeat(32), labelId='b'.repeat(32), postId='c'.repeat(32);
const article={title:'Helpful article',content:'Practical information for this community. '.repeat(10),labelId};
const page=(role='member', minPostLevel=0)=>new Response(`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{currentGroup:{id:gid,name:'test',metadata:{displayName:'Test',minPostLevel},labels:[{id:labelId,metadata:{displayName:'General'}},{id:'d'.repeat(32),metadata:{displayName:'Announcements',postWriteRole:1}}]},self:{id:'user',member:{role},metadata:{}}}}})}</script>`);
function fixture(fetcher) {
  const id=randomUUID(),key=randomBytes(32);
  const account={_id:id,encryptedCookies:encryptCookies(['auth_token','client_id','aws-waf-token'].map(name=>({name,value:'test',domain:'.skool.com',path:'/'})),key,id)};
  return {id,service:createPublishing({findOne:async q=>q._id===id?account:null},key,fetcher)};
}
test('posting prepares member categories without requiring an unused rules API and sends only approved cookies',async()=>{
  const calls=[];
  const {service,id}=fixture(async(url,options)=>{
    calls.push(url);assert.equal(options.headers.Cookie,'auth_token=test; client_id=test'); assert.equal(options.headers.Authorization,undefined);
    assert.equal(options.redirect,'manual');
    if(url.endsWith('/about'))return page();
    if(url.endsWith('/rules'))return Response.json({rules:[{title:'No spam',content:'Stay on topic'}]});
    assert.equal(url,'https://api2.skool.com/posts');
    assert.deepEqual(JSON.parse(options.body),{post_type:'generic',group_id:gid,metadata:{title:article.title,content:article.content,labels:labelId,action:0}});
    return Response.json({id:postId,group_id:gid,name:'helpful-article'});
  });
  const context=await service.prepare({accountId:id,groupName:'test'});
  assert.deepEqual(context.labels,[{id:labelId,name:'General'}]);assert.equal(context.rules,undefined);assert.ok(calls.every(url=>!url.endsWith('/rules')));
  // No label-management API is requested for an ordinary member.
  assert.ok(calls.every(url=>!url.endsWith('/labels')));
  const result=await service.publish({accountId:id,context,article});assert.equal(result.status,'published');assert.equal(result.url,'https://www.skool.com/test/helpful-article');
});
test('pending and banned accounts cannot publish; unknown responses stay unconfirmed',async()=>{
  for(const [role,level] of [['pending',0],['banned',0]]){
    const {service,id}=fixture(async()=>page(role,level));await assert.rejects(service.prepare({accountId:id,groupName:'test'}));
  }
  const {service,id}=fixture(async()=>{throw new Error('Timeout')});
  const context={groupId:gid,groupName:'test',labels:[{id:labelId}]};
  assert.equal((await service.publish({accountId:id,context,article})).status,'unconfirmed');
  await assert.rejects(service.publish({accountId:randomUUID(),context,article}),/Account not found/);
  await assert.rejects(service.publish({accountId:id,context,article:{...article,labelId:'not-allowed'}}),/invalid/);
});

test('a member-writable General category reaches Skool instead of being rejected by a local level estimate',async()=>{
  let posts=0;
  const {service,id}=fixture(async(url,options)=>{
    if(url.endsWith('/about'))return page('member',3);
    if(url.endsWith('/rules'))return Response.json({rules:[]});
    posts++;assert.equal(JSON.parse(options.body).metadata.labels,labelId);
    return Response.json({id:postId,group_id:gid,name:'general-post'});
  });
  const context=await service.prepare({accountId:id,groupName:'test'});
  assert.equal(context.minimumPostLevel,3);
  assert.equal((await service.publish({accountId:id,context,article})).status,'published');assert.equal(posts,1);
});

test('General is enforced in the outgoing request even if another category is supplied',async()=>{
  const otherId='d'.repeat(32);
  const {service,id}=fixture(async(_url,options)=>{
    assert.equal(JSON.parse(options.body).metadata.labels,labelId);
    return Response.json({id:postId,group_id:gid,name:'general-post'});
  });
  const context={groupId:gid,groupName:'test',labels:[{id:otherId,name:'Hiring'},{id:labelId,name:'💬 General discussion'}]};
  const result=await service.publish({accountId:id,context,article:{...article,labelId:otherId}});
  assert.equal(result.status,'published');assert.equal(result.categoryId,labelId);assert.equal(result.categoryName,'💬 General discussion');
});

test('a restricted General category cannot be selected for an ordinary member',async()=>{
  const {service,id}=fixture(async url=>{
    if(url.endsWith('/rules'))return Response.json({rules:[]});
    return new Response(`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{currentGroup:{id:gid,name:'test',metadata:{},labels:[{id:labelId,metadata:{displayName:'General',postWriteRole:3}},{id:'d'.repeat(32),metadata:{displayName:'Chat',postWriteRole:4}}]},self:{id:'user',member:{role:'member'},metadata:{}}}}})}</script>`);
  });
  const context=await service.prepare({accountId:id,groupName:'test'});
  assert.deepEqual(context.labels,[{id:'d'.repeat(32),name:'Chat'}]);
});

test('Skool rate limits are distinguished from community-specific rejection',async()=>{
  for(const status of [403,429]){
    const {service,id}=fixture(async()=>new Response('',{status}));
    const result=await service.publish({accountId:id,context:{groupId:gid,groupName:'test',labels:[{id:labelId}]},article});
    assert.equal(result.status,'blocked');assert.equal(Boolean(result.rateLimited),status===429);
    if(status===429)await assert.rejects(service.prepare({accountId:id,groupName:'test'}),error=>error.status===429);
  }
});

test('short as-is text and its whitespace reach Skool unchanged',async()=>{
  const supplied={title:'  My title  ',content:'  A short post.\n',labelId};
  const {service,id}=fixture(async(_url,options)=>{
    const body=JSON.parse(options.body);assert.equal(body.metadata.title,supplied.title);assert.equal(body.metadata.content,supplied.content);
    return Response.json({id:postId,group_id:gid,name:'short-post'});
  });
  assert.equal((await service.publish({accountId:id,context:{groupId:gid,groupName:'test',labels:[{id:labelId}]},article:supplied})).status,'published');
});

test('uncertain publication confirmation requires exact author, group, text and a recent timestamp',async()=>{
  const createdAt=new Date();let posts=[];
  const {service,id}=fixture(async(url,options)=>{
    assert.equal(url,'https://www.skool.com/test');assert.equal(options.method,undefined);
    return new Response(`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:{currentGroup:{id:gid,name:'test',metadata:{}},self:{id:'author'},postTrees:posts.map(post=>({post}))}}})}</script>`);
  });
  const receipt={accountId:id,createdAt,context:{groupId:gid,groupName:'test',authorId:'author'},article};
  const post={id:postId,name:'verified-post',userId:'author',groupId:gid,createdAt:createdAt.toISOString(),metadata:{title:article.title,content:article.content}};
  for(const candidate of [null,{...post,userId:'other'},{...post,groupId:'other'},{...post,metadata:{...post.metadata,content:'different'}},{...post,createdAt:'2000-01-01T00:00:00Z'}]){
    posts=candidate?[candidate]:[];assert.equal((await service.reconcile(receipt)).status,'unconfirmed');
  }
  posts=[post];assert.equal((await service.reconcile(receipt)).status,'published');
  posts=[post,{...post,id:'d'.repeat(32)}];assert.equal((await service.reconcile(receipt)).status,'unconfirmed');
});
