import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublishedPosts } from './published-posts.mjs';

const clone = value => structuredClone(value);
function collection(rows) {
  const matches = (row, query) => Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(part => matches(row, part));
    if (value instanceof Date) return new Date(row[key]).getTime() === value.getTime();
    if (value && typeof value === 'object' && '$lt' in value) return row[key] < value.$lt;
    return row[key] === value;
  });
  return {
    async findOne(query) { return clone(rows.find(row => matches(row, query)) || null); },
    find(query) {
      let found = rows.filter(row => matches(row, query));
      return {
        sort(fields) { found.sort((a,b) => { for (const [field, direction] of Object.entries(fields)) { if (a[field] < b[field]) return -direction; if (a[field] > b[field]) return direction; } return 0; }); return this; },
        limit(n) { found = found.slice(0,n); return this; },
        async toArray() { return clone(found); },
      };
    },
  };
}
const receipt = (n, extra = {}) => ({ _id: n.toString(16).padStart(64,'0'), ownerId:'owner-a', status:'published', runId:'run-a', accountId:'account-a', groupName:`community-${n}`, article:{title:`Title ${n}`,content:`Content ${n}`}, createdAt:new Date('2026-10-27T00:00:00Z'), ...extra });
function fixture(receipts, runRows = []) {
  return createPublishedPosts({ ownerId:'owner-a', publications:collection(receipts), runs:collection(runRows), accounts:collection([{_id:'account-a',displayName:'Account A',encryptedCookies:'PRIVATE_COOKIES'}]) });
}

test('published posts show only confirmed owned receipts and expose display fields without credentials',async()=>{
  const list=fixture([receipt(1,{accountName:'Snapshot name',communityName:'My community',categoryName:'General',postMode:'as_is',context:{authorId:'PRIVATE_AUTHOR'}}),receipt(2,{ownerId:'other'}),receipt(3,{status:'unconfirmed'}),receipt(4,{status:'blocked'}),receipt(5,{status:'sending'})]);
  const result=await list();assert.equal(result.posts.length,1);assert.equal(result.nextCursor,null);
  assert.equal(result.posts[0].title,'Title 1');assert.equal(result.posts[0].accountName,'Snapshot name');assert.equal(result.posts[0].communityName,'My community');
  assert.equal(result.posts[0].categoryName,'General');assert.equal(result.posts[0].url,'https://www.skool.com/community-1');
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|ownerId|authorId|accountId|runId|context|encryptedCookies/);
});

test('older receipts use owned run metadata, remain visible without run history, and reject foreign run metadata',async()=>{
  const rows=[receipt(1),receipt(2,{runId:'foreign-run',accountId:'removed'}),receipt(3,{runId:'deleted-run'})];
  const list=fixture(rows,[{_id:'run-a',ownerId:'owner-a',results:[{groupName:'community-1',status:'published',name:'Original community',account:{displayName:'Original account'},categoryName:'General',postMode:'refined'}]},{_id:'foreign-run',ownerId:'other',results:[{groupName:'community-2',status:'published',name:'PRIVATE_FOREIGN'}]}]);
  const {posts}=await list();assert.equal(posts.length,3);
  const old=posts.find(p=>p.id===rows[0]._id);assert.equal(old.communityName,'Original community');assert.equal(old.accountName,'Original account');assert.equal(old.postMode,'refined');
  assert.equal(posts.find(p=>p.id===rows[1]._id).accountName,'Removed account');
  assert.equal(posts.find(p=>p.id===rows[2]._id).title,'Title 3');
  assert.doesNotMatch(JSON.stringify(posts),/PRIVATE_FOREIGN/);
});

test('cursor pagination reaches every successful post with stable timestamp ties and no duplicates',async()=>{
  const list=fixture(Array.from({length:65},(_,i)=>receipt(i+1)));
  const first=await list();assert.equal(first.posts.length,30);assert.ok(first.nextCursor);
  const second=await list(new URLSearchParams({cursor:first.nextCursor}));assert.equal(second.posts.length,30);
  const third=await list(new URLSearchParams({cursor:second.nextCursor}));assert.equal(third.posts.length,5);assert.equal(third.nextCursor,null);
  const ids=[...first.posts,...second.posts,...third.posts].map(p=>p.id);assert.equal(new Set(ids).size,65);
  assert.equal(first.posts[0].title,'Title 65');assert.equal(third.posts.at(-1).title,'Title 1');
});

test('pagination follows dates as well as IDs and cursor input cannot override workspace scope',async()=>{
  const rows=Array.from({length:35},(_,i)=>receipt(i+1,{createdAt:new Date(Date.UTC(2026,9,27,0,i))}));
  rows.push(receipt(99,{ownerId:'other',createdAt:new Date('2026-10-01')}));
  const list=fixture(rows),first=await list(),next=await list(new URLSearchParams({cursor:first.nextCursor,ownerId:'other',status:'blocked'}));
  assert.equal(next.posts.length,5);assert.ok(next.posts.every(post=>post.title!=='Title 99'));
  for(const cursor of ['not-json','a'.repeat(513),Buffer.from(JSON.stringify({at:'bad',id:'f'.repeat(64)})).toString('base64url'),Buffer.from(JSON.stringify({at:'2026-10-27',id:{$ne:null}})).toString('base64url')])await assert.rejects(list(new URLSearchParams({cursor})),/Invalid posts page/);
});

test('post links are restricted to the actual Skool community',async()=>{
  const list=fixture([receipt(1,{url:'https://evil.example/steal'}),receipt(2,{url:'https://www.skool.com/other/post'}),receipt(3,{url:'https://www.skool.com/community-3/my-post'}),receipt(4,{groupName:'../bad',url:'javascript:alert(1)'})]);
  const {posts}=await list();assert.equal(posts.find(p=>p.title==='Title 1').url,'https://www.skool.com/community-1');assert.equal(posts.find(p=>p.title==='Title 2').url,'https://www.skool.com/community-2');
  assert.equal(posts.find(p=>p.title==='Title 3').url,'https://www.skool.com/community-3/my-post');assert.equal(posts.find(p=>p.title==='Title 4').url,null);
});
