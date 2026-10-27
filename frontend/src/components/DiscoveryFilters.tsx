type FilterKey = 'price' | 'type' | 'sort' | 'language';
interface FiltersProps {
  price: string; type: string; sort: string; language: string;
  languages: { id: string; name: string }[];
  keywordSearch: boolean;
  onChange: (key: FilterKey, value: string) => void;
  onReset: () => void;
}

export function DiscoveryFilters(props: FiltersProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const active = Boolean(props.price || props.type || props.sort !== 'trending' || props.language !== 'english');
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    const focusOutside = (event: FocusEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    document.addEventListener('focusin', focusOutside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); document.removeEventListener('focusin', focusOutside); };
  }, [open]);
  const groups: { key: 'price' | 'type' | 'sort'; label: string; options: [string, string][] }[] = [
    { key: 'price', label: 'Price', options: [['free', 'Free'], ['paid', 'Paid'], ['free-trial', 'Free trial']] },
    { key: 'type', label: 'Type', options: [['private', 'Private'], ['public', 'Public']] },
    { key: 'sort', label: 'Sort', options: [['trending', 'Trending'], ['top', 'Top']] },
  ];
  return <div ref={root} className="relative ml-auto self-end">
    <button ref={trigger} type="button" aria-expanded={open} aria-controls={panelId} aria-haspopup="dialog" onClick={() => setOpen(value => !value)} className={`inline-flex h-10 items-center gap-2 rounded-full border px-4 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${open || active ? 'border-primary/40 bg-primary/10 text-ink' : 'border-line bg-card text-ink-secondary hover:bg-elevated hover:text-ink'}`}>Filter<SlidersHorizontal size={14} aria-hidden="true" />{active && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="Filters applied" />}</button>
    {open && <div ref={panel} id={panelId} role="dialog" aria-label="Discovery filters" tabIndex={-1} className="absolute right-0 top-full z-40 mt-2 w-[340px] max-w-[calc(100vw-32px)] rounded-xl border border-line bg-card p-4 shadow-2xl outline-none">
    <div className="grid grid-cols-3 divide-x divide-line">
      {groups.map(group => <fieldset key={group.key} disabled={group.key === 'sort' && props.keywordSearch} className="min-w-0 space-y-2 px-3 first:pl-0 last:pr-0 disabled:opacity-50">
        <legend className="mb-2 text-xs font-medium text-ink-secondary">{group.label}</legend>
        {group.options.map(([value, label]) => <label key={value} className="flex w-fit cursor-pointer items-center gap-2 whitespace-nowrap text-xs text-ink-secondary"><input type="radio" name={`discovery-${group.key}`} value={value} checked={props[group.key] === value} onClick={() => { if (group.key !== 'sort' && props[group.key] === value) props.onChange(group.key, ''); }} onChange={() => props.onChange(group.key, value)} className="h-4 w-4 shrink-0 accent-primary focus-visible:ring-2 focus-visible:ring-primary" />{label}</label>)}
      </fieldset>)}
    </div>
    {props.keywordSearch && <p className="mt-3 text-xs leading-5 text-ink-muted">Keyword searches use relevance. Clear the keywords for Trending or Top.</p>}
    <div className="mt-4 flex flex-wrap items-center justify-end gap-2"><button type="button" onClick={props.onReset} className="mr-auto text-xs text-ink-muted hover:text-ink">Reset</button><label htmlFor={`${panelId}-language`} className="text-xs font-medium text-ink-secondary">Language</label><select id={`${panelId}-language`} value={props.language} onChange={event => props.onChange('language', event.target.value)} className="h-8 max-w-32 rounded-lg border-0 bg-card px-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-primary/40"><option value="all">All languages</option>{!props.languages.some(item => item.id === props.language) && props.language !== 'all' && <option value={props.language}>{props.language === 'english' ? 'English' : props.language}</option>}{props.languages.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    </div>}
  </div>;
}
import { SlidersHorizontal } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

