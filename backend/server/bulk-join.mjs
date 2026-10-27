import { randomInt, randomUUID } from 'node:crypto';
import { InputError } from './cookies.mjs';
import { SessionError } from './skool.mjs';
import { discoveryQuery } from './discovery.mjs';

const terminal = status => ['joined','pending','skipped'].includes(status);
const publicJob = job => { if (!job) return null; const {ownerId,active,existing,...rest}=job;return{...rest,id:job._id}; };
const message = error => error instanceof SessionError || error instanceof InputError ? error.message : 'Temporary backend failure. Retrying automatically.';
const groupName = url => { const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.hostname!=='www.skool.com'||!/^\/[a-z0-9_-]+\/?$/i.test(parsed.pathname))throw new InputError('Invalid community URL.');return parsed.pathname.split('/')[1]; };

export function validateBulkJoin(body) {
  if (!body || typeof body!=='object' || Array.isArray(body))throw new InputError('Choose a community search.');
  const filters={q:body.q||'',category:body.category||'',type:body.type||'',sort:body.sort||'trending',language:body.language||'all',price:'free'};
  if(Object.values(filters).some(v=>typeof v!=='string'))throw new InputError('Invalid search filters.');
  discoveryQuery(new URLSearchParams({...filters,page:'1'}));
  const minimumMembers=body.minimumMembers??0;
  if(!Number.isSafeInteger(minimumMembers)||minimumMembers<0||minimumMembers>1e9)throw new InputError('Enter a valid minimum member count.');
  return {filters,minimumMembers};
}

export function createBulkJoin({jobs,ownerId,accounts,discovery,memberships,join,shouldYield=async()=>false,choose=randomInt,schedule=task=>setImmediate(task),defer=(task,ms)=>{const timer=setTimeout(task,ms);timer.unref?.();},cooldownMs=900000}) {
  const queued=new Set(),executing=new Set();
  const update=async(job,values)=>{await jobs.updateOne({_id:job._id,ownerId},{$set:{...values,updatedAt:new Date()}});Object.assign(job,values);};
  const enqueue=(job,delay=0)=>{
    if(queued.has(job._id))return;queued.add(job._id);
    const task=async()=>{queued.delete(job._id);if(executing.has(job._id))return;executing.add(job._id);
      try{const saved=await jobs.findOne({_id:job._id,ownerId});if(saved?.active)await execute(saved);}
      catch{enqueue(job,cooldownMs);}finally{executing.delete(job._id);}
    };if(delay)defer(task,delay);else schedule(task);
  };
  const execute=async job=>{
    const stopped=async()=>{const saved=await jobs.findOne({_id:job._id,ownerId});if(saved?.active&&!saved.cancelRequested)return false;await update(job,{active:false,status:'stopped',stage:'Stopped by you.',nextAttemptAt:null,finishedAt:new Date()});return true;};
    const wait=async(reason,delay=cooldownMs)=>{if(await stopped())return;await update(job,{status:'waiting',active:true,stage:reason,nextAttemptAt:new Date(Date.now()+delay)});enqueue(job,delay);};
    const yieldToPosting=async()=>{if(!(await shouldYield()))return false;await wait('Auto Mode has priority. Bulk joining will continue after the posting run.',60000);return true;};
    try{
      if(await stopped())return;
      if(await yieldToPosting())return;
      await update(job,{status:'running',nextAttemptAt:null,stage:'Checking saved account memberships'});
      const all=await accounts.find({}).toArray(),active=all.filter(a=>a.status==='active');
      if(!active.length)throw new InputError('Verify a Skool account in Accounts. Automatic joining will resume afterward.');
      // Sync before each round, so owner approvals and manual joins are respected.
      const existing=new Map();
      for(const account of all){
        if(await stopped())return;
        if(await yieldToPosting())return;
        try{let offset=0;for(let page=0;page<100;page++){
          const response=await memberships(new URLSearchParams({accountId:account._id,offset:String(offset)}));
          for(const community of response.communities){
            if(!['joined','pending'].includes(community.membershipStatus))continue;
            const name=groupName(community.url),prior=existing.get(name);
            if(!prior||community.membershipStatus==='joined')existing.set(name,{status:community.membershipStatus,account:{id:account._id,displayName:account.displayName}});
          }
          if(!response.hasMore)break;
          if(response.nextOffset<=offset||page===99)throw new InputError('Membership pagination could not be completed.');
          offset=response.nextOffset;if(await stopped())return;
        }}catch(error){if(error.status===429)throw error;}
      }
      const attempt=async item=>{
        if(await stopped())return false;
        if(await yieldToPosting())return false;
        const membership=existing.get(item.groupName);
        if(membership){Object.assign(item,membership,{message:membership.status==='joined'?'Already joined in this workspace.':'Membership request awaiting owner approval.'});await update(job,{results:job.results});return true;}
        const account=active.find(a=>a._id===item.account?.id)||active[choose(active.length)];
        item.account={id:account._id,displayName:account.displayName};item.status='joining';
        await update(job,{results:job.results,stage:`Joining ${item.name}`});
        try{
          const result=await join({accountId:account._id,groupName:item.groupName});
          Object.assign(item,{status:result.code==='free_join_unavailable'?'skipped':result.status,message:String(result.message||'').slice(0,1000),updatedAt:new Date()});
          if(result.missingQuestions?.length)item.missingQuestions=result.missingQuestions;else delete item.missingQuestions;
        }catch(error){Object.assign(item,{status:'error',message:message(error),updatedAt:new Date()});await update(job,{results:job.results});if(error.status===429)throw error;}
        await update(job,{results:job.results});return true;
      };
      // Retry unfinished targets from previous rounds before advancing discovery.
      for(const item of job.results.filter(r=>!terminal(r.status)))if(!(await attempt(item)))return;
      while(!job.scanFinished){
        if(await stopped())return;
        await update(job,{stage:`Finding free communities · page ${job.page}`});
        const response=await discovery(new URLSearchParams({...job.filters,page:String(job.page)}));
        if(response.total!==null&&response.total!==undefined)await update(job,{reportedTotal:response.total});
        for(const community of response.communities){
          const name=groupName(community.url);
          if(job.results.some(r=>r.groupName===name))continue;
          // Prices are checked again by the join service before any mutation.
          if(community.price && community.price!=='Free')continue;
          if(job.minimumMembers&&(community.members===null||community.members<job.minimumMembers))continue;
          job.results.push({groupName:name,name:community.name,url:community.url,status:'queued',message:'Waiting to join.'});
        }
        // Persist the full page before attempting it. A restart cannot lose the
        // remainder or select different accounts for in-flight registrations.
        await update(job,{results:job.results});
        for(const item of job.results.filter(r=>r.status==='queued'))if(!(await attempt(item)))return;
        if(response.hasMore&&job.page>=100){await wait('Skool reports results beyond its supported 100-page search limit. Narrow the search to continue without claiming those results were processed.');return;}
        await update(job,{page:job.page+1,scanFinished:!response.hasMore||job.page>=100});
      }
      if(await stopped())return;
      const outstanding=job.results.filter(r=>!terminal(r.status)).length;
      if(outstanding){await wait(`${outstanding} communities need another attempt. Retrying after cooldown.`);return;}
      await update(job,{active:false,status:'completed',stage:`Processed all ${job.results.length} free communities found across ${job.page-1} search pages.`,nextAttemptAt:null,finishedAt:new Date()});
    }catch(error){await wait(`${message(error)} Continuing automatically after cooldown.`);}
  };
  return {
    async list(){return{jobs:(await jobs.find({ownerId}).sort({createdAt:-1}).limit(5).toArray()).map(publicJob)};},
    async start(body){
      const input=validateBulkJoin(body);
      if(!(await accounts.find({status:'active'}).toArray()).length)throw new InputError('Connect a verified Skool account first.');
      const job={_id:randomUUID(),ownerId,...input,active:true,status:'queued',stage:'Waiting to start',page:1,scanFinished:false,results:[],cancelRequested:false,createdAt:new Date(),updatedAt:new Date()};
      try{await jobs.insertOne(job);}catch(error){if(error.code===11000)throw new InputError('A bulk join is already active in this workspace.');throw error;}
      enqueue(job);return{job:publicJob(job)};
    },
    async resume(job){if(job.ownerId===ownerId&&job.active)enqueue(job,Math.max(0,new Date(job.nextAttemptAt||0).getTime()-Date.now()));},
    async stop(id){
      const saved=await jobs.findOne({_id:id,ownerId});if(!saved)throw new InputError('Bulk join not found in this workspace.');
      if(!saved.active)return{stopped:true};
      await update(saved,{cancelRequested:true,...(['queued','waiting'].includes(saved.status)?{active:false,status:'stopped',stage:'Stopped by you.',nextAttemptAt:null,finishedAt:new Date()}: {})});
      return{stopped:true};
    }
  };
}
