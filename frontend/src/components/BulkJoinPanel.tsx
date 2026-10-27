import { CheckCheck, LoaderCircle, Play, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { request } from '../api/accounts';
import { Button } from './Button';
import type { JoinResult } from './DiscoveryCard';

export interface BulkJoinJob {
  id: string; status: string; stage: string; page: number; nextAttemptAt?: string | null;
  filters: { q: string; language: string }; reportedTotal?: number;
  results: (Omit<JoinResult,'status'> & {groupName:string;name:string;status:JoinResult['status']|'joining'|'queued'|'skipped'})[];
}
export const bulkRunning = (job: BulkJoinJob | null) => Boolean(job && ['queued','running','waiting'].includes(job.status));
interface Props {
  filters: {q:string;category:string;type:string;sort:string;language:string};
  minimumMembers: number; enabled: boolean; onJobChange: (job: BulkJoinJob | null) => void;
}

export function BulkJoinPanel({filters,minimumMembers,enabled,onJobChange}:Props) {
  const [job,setJob]=useState<BulkJoinJob|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const alive=useRef(true),generation=useRef(0),loading=useRef(false);
  useEffect(()=>{
    alive.current=true;
    const load=async()=>{
      if(loading.current)return;loading.current=true;const version=generation.current;
      try{const data=await request<{jobs:BulkJoinJob[]}>('/api/communities/bulk-join');
        if(alive.current&&version===generation.current){setJob(data.jobs[0]||null);onJobChange(data.jobs[0]||null);}
      }catch(e){if(alive.current&&version===generation.current)setError(e instanceof Error?e.message:'Could not load automatic joining.');}
      finally{loading.current=false;}
    };
    void load();const timer=window.setInterval(()=>void load(),5000);
    return()=>{alive.current=false;window.clearInterval(timer);};
  },[onJobChange]);
  const start=async()=>{
    if(busy||bulkRunning(job))return;setBusy(true);setError('');generation.current++;
    try{const data=await request<{job:BulkJoinJob}>('/api/communities/bulk-join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...filters,minimumMembers})});
      if(alive.current){generation.current++;setJob(data.job);onJobChange(data.job);}
    }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not start automatic joining.');}
    finally{if(alive.current)setBusy(false);}
  };
  const stop=async()=>{
    if(!job||busy)return;setBusy(true);setError('');
    try{await request(`/api/communities/bulk-join/${job.id}/stop`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});}
    catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not stop automatic joining.');}
    finally{if(alive.current)setBusy(false);}
  };
  const active=bulkRunning(job),joined=job?.results.filter(r=>r.status==='joined').length||0,pending=job?.results.filter(r=>r.status==='pending').length||0;
  const unfinished=job?.results.filter(r=>!['joined','pending','skipped'].includes(r.status)).length||0;
  return <section className="rounded-xl border border-primary/20 bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3"><span className="rounded-lg bg-primary/10 p-2 text-primary"><CheckCheck size={19}/></span><div><h2 className="text-sm font-semibold">Join every free community</h2><p className="mt-1 max-w-xl text-xs leading-5 text-ink-secondary">Automatically work through every page of this search. One account per community, with answers and free-plan selection handled for you.</p></div></div>
      {active?<Button variant="secondary" disabled={busy} icon={<Square size={13}/>} onClick={()=>void stop()}>Stop joining</Button>:<Button disabled={!enabled||busy} icon={busy?<LoaderCircle size={14} className="animate-spin"/>:<Play size={14}/>} onClick={()=>void start()}>Join all free results</Button>}
    </div>
    {job&&<div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs"><span className="font-medium text-success">{joined} joined</span><span className="text-ink-secondary">{pending} awaiting approval</span><span className="text-ink-muted">{unfinished} remaining attempts</span><span className="ml-auto rounded-md bg-elevated px-2 py-1 text-[11px] capitalize text-ink-secondary">{job.status==='waiting'?'Waiting to continue':job.status}</span></div>
      <p role="status" className="mt-3 text-xs leading-5 text-ink-secondary">{active&&<LoaderCircle size={12} className="mr-1.5 inline animate-spin"/>}{job.stage}</p>
      <p className="mt-1 text-[11px] text-ink-muted">Search: {job.filters.q||'All free communities'} · Language: {job.filters.language}{job.nextAttemptAt?` · Next attempt: ${new Date(job.nextAttemptAt).toLocaleTimeString()}`:''}</p>
    </div>}
    {error&&<p role="alert" className="mt-3 text-xs text-primary">{error}</p>}
    <p className="mt-3 text-[10px] leading-4 text-ink-muted">Continues in the backend with saved progress. Rate limits trigger a cooldown. Community owners control approval; Stop cancels further joins.</p>
  </section>;
}
