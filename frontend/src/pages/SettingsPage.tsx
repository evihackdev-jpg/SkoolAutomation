import { Check, LoaderCircle, Plus, Save, Trash2, UserRound, Users } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { request } from '../api/accounts';
import { Button } from '../components/Button';
import { PageHeader } from '../components/PageHeader';

type Field = 'name' | 'email' | 'phone' | 'city' | 'country' | 'occupation' | 'company' | 'website' | 'experience' | 'goal' | 'skill';
type Profile = Partial<Record<Field,string>> & { answers: { question: string; answer: string }[] };
interface Settings { profile: Profile; updatedAt: string | null; replacesLegacy: boolean; accounts: { id: string; displayName: string; identifier: string; status: string }[] }
const control = 'mt-1.5 w-full rounded-lg border border-line bg-app px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-primary focus:ring-2 focus:ring-primary/20';
const fields: { key: Field; label: string; placeholder: string; type?: string }[] = [
  { key:'name', label:'Name', placeholder:'Use each account’s Skool name' },
  { key:'email', label:'Contact email', placeholder:'Use each account’s Skool email', type:'email' },
  { key:'phone', label:'Phone number', placeholder:'Optional, including country code', type:'tel' },
  { key:'city', label:'City', placeholder:'Use each account’s profile location' },
  { key:'country', label:'Country', placeholder:'Your country' },
  { key:'occupation', label:'Occupation / role', placeholder:'What you do' },
  { key:'company', label:'Company / business', placeholder:'Your business name, if applicable' },
  { key:'website', label:'Website / portfolio', placeholder:'https://example.com', type:'url' },
];

export function SettingsPage() {
  const [data,setData] = useState<Settings | null>(null);
  const [profile,setProfile] = useState<Profile>({answers:[]});
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [dirty,setDirty] = useState(false);
  const [error,setError] = useState('');
  const [saved,setSaved] = useState(false);
  const [reload,setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setError('');
    request<Settings>('/api/settings',{signal:controller.signal}).then(result => {
      if (active) { setData(result); setProfile({...result.profile,answers:result.profile.answers || []}); setDirty(false); }
    }).catch(e => {if(active)setError(e instanceof Error ? e.message : 'Could not load settings.');}).finally(() => {if(active)setLoading(false);});
    return () => {active=false;controller.abort();};
  },[reload]);
  const change = (next: Profile) => {setProfile(next);setDirty(true);setSaved(false);};
  const updateAnswer = (index:number, field:'question'|'answer',value:string) => change({...profile,answers:profile.answers.map((item,i)=>i===index?{...item,[field]:value}:item)});
  const save = async (event:FormEvent) => {
    event.preventDefault(); if(saving||loading||!data)return;
    setSaving(true);setError('');setSaved(false);
    try {
      const result=await request<{profile:Profile;updatedAt:string}>('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({profile})});
      setProfile(result.profile);setData({...data,...result,replacesLegacy:false});setSaved(true);setDirty(false);
    } catch(e) {setError(e instanceof Error?e.message:'Could not save settings.');}
    finally {setSaving(false);}
  };
  return <div className="space-y-6">
    <PageHeader title="Settings" subtitle="Save your information once. Automatic joins use it across all accounts in your workspace." />
    {error && <div role="alert" className="rounded-xl border border-primary/30 bg-card p-4 text-sm text-primary">{error}{!data&&<Button className="ml-3" variant="secondary" onClick={()=>setReload(v=>v+1)}>Retry</Button>}</div>}
    {loading ? <p role="status" className="py-12 text-center text-sm text-ink-muted">Loading your information…</p> : data && <form onSubmit={save} className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <fieldset disabled={saving} className="min-w-0 space-y-5">
        <section className="rounded-xl border border-line bg-card p-5 sm:p-6">
          <div className="mb-5 flex items-center gap-3"><span className="rounded-lg bg-primary/10 p-2.5 text-primary"><UserRound size={21}/></span><div><h2 className="font-semibold">Your information</h2><p className="mt-1 text-xs text-ink-muted">Used to answer community membership questions automatically.</p></div></div>
          <p className="mb-5 rounded-lg border border-line bg-app/40 p-3 text-xs leading-5 text-ink-secondary">Interest questions select a matching option automatically, or the first available interest. Saved answers take priority. Optional newsletters are declined; factual choices use your information below.</p>
          <div className="grid gap-4 sm:grid-cols-2">{fields.map(field=><label key={field.key} className="block text-xs font-medium text-ink-secondary">{field.label}<input type={field.type || 'text'} maxLength={200} value={profile[field.key] || ''} onChange={e=>change({...profile,[field.key]:e.target.value})} placeholder={field.placeholder} className={control}/></label>)}</div>
          <div className="mt-4 space-y-4"><label className="block text-xs font-medium text-ink-secondary">Experience and background<textarea value={profile.experience || ''} onChange={e=>change({...profile,experience:e.target.value})} maxLength={1000} rows={3} placeholder="Describe your actual skills and relevant experience." className={`${control} resize-y`}/></label>
            <label className="block text-xs font-medium text-ink-secondary">Goals / reason for joining<textarea value={profile.goal || ''} onChange={e=>change({...profile,goal:e.target.value})} maxLength={1000} rows={3} placeholder="What you want to learn, contribute, or achieve in communities." className={`${control} resize-y`}/></label>
            <label className="block text-xs font-medium text-ink-secondary">Roller-skating level <span className="font-normal text-ink-muted">(for communities such as SK8SHOT)</span><select value={profile.skill || ''} onChange={e=>change({...profile,skill:e.target.value})} className={control}><option value="">Not specified</option>{['Beginner','Intermediate','Advanced','Professional'].map(value=><option key={value}>{value}</option>)}</select></label>
          </div>
        </section>
        <section className="rounded-xl border border-line bg-card p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Saved question answers</h2><Button variant="secondary" disabled={profile.answers.length>=20} icon={<Plus size={14}/>} onClick={()=>change({...profile,answers:[...profile.answers,{question:'',answer:''}]})}>Add answer</Button></div><p className="mt-2 text-xs leading-5 text-ink-muted">Save answers for specific questions once and reuse them across accounts. Match the question text; for multiple-choice questions, copy the exact option you want selected.</p>
          {!profile.answers.length&&<p className="mt-5 rounded-lg border border-dashed border-line p-4 text-center text-xs text-ink-muted">No custom answers yet. The profile above handles common questions.</p>}
          <div className="mt-4 space-y-4">{profile.answers.map((item,index)=><div key={index} className="space-y-3 rounded-lg border border-line bg-app/40 p-4"><div className="flex items-center justify-between"><span className="text-xs font-medium text-ink-muted">Answer {index+1}</span><button type="button" aria-label={`Remove answer ${index+1}`} className="rounded p-1.5 text-ink-muted hover:bg-primary/10 hover:text-primary" onClick={()=>change({...profile,answers:profile.answers.filter((_,i)=>i!==index)})}><Trash2 size={15}/></button></div><label className="block text-xs text-ink-secondary">Community question<input required maxLength={1000} value={item.question} onChange={e=>updateAnswer(index,'question',e.target.value)} placeholder="Copy the membership question here" className={control}/></label><label className="block text-xs text-ink-secondary">Your answer<textarea required maxLength={1000} rows={2} value={item.answer} onChange={e=>updateAnswer(index,'answer',e.target.value)} className={control}/></label></div>)}</div>
        </section>
      </fieldset>
      <aside className="space-y-5 xl:sticky xl:top-24">
        <section className="rounded-xl border border-primary/25 bg-card p-5"><div className="mb-3 flex items-center gap-2"><Users size={18} className="text-primary"/><h2 className="font-semibold">Applies to all accounts</h2></div><p className="text-xs leading-5 text-ink-secondary">These details apply to all {data.accounts.length} saved accounts and any accounts you add later. Empty name, email, and city fields use each account’s Skool profile.</p>
          <ul className="my-4 max-h-60 space-y-2 overflow-y-auto">{data.accounts.map(account=><li key={account.id} className="rounded-lg border border-line bg-app px-3 py-2"><p className="text-sm">{account.displayName}</p><p className="text-[11px] text-ink-muted">{account.identifier}</p></li>)}</ul>
          {!data.accounts.length&&<Link to="/accounts" className="mb-4 block text-xs text-primary">Add your first account →</Link>}
          {data.replacesLegacy&&<p className="mb-4 text-xs leading-5 text-warning">Saving here replaces previous per-account membership-answer details with this shared information.</p>}
          <Button type="submit" fullWidth disabled={saving||!dirty} icon={saving?<LoaderCircle size={15} className="animate-spin"/>:<Save size={15}/>}>{saving?'Saving…':'Save for all accounts'}</Button>
          {saved&&<p role="status" className="mt-3 text-xs text-success"><Check size={13} className="mr-1 inline"/>Saved. Future join questions use this information.</p>}
          {data.updatedAt&&!dirty&&<p className="mt-3 text-[11px] text-ink-muted">Saved {new Date(data.updatedAt).toLocaleString()}</p>}
        </section>
        <p className="px-1 text-xs leading-6 text-ink-muted">Discover and Auto Mode use these settings. Personal answers are filled on the backend and sent to Skool when required; they are not sent to the AI provider. Saving does not change your Skool profiles or submit any membership requests.</p>
      </aside>
    </form>}
  </div>;
}
