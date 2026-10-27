const categoryName = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();

// Only pass member-writable labels here. Never create or guess a category ID.
export function generalCategory(labels = []) {
  const candidates = labels.map(label=>({label,name:categoryName(label.name)}));
  return candidates.find(c=>c.name==='general')?.label
    || candidates.find(c=>c.name==='general discussion')?.label
    || candidates.find(c=>/^general (?:discussions?|chat|community)$/.test(c.name))?.label
    || null;
}

export function defaultPostCategory(labels = []) {
  return generalCategory(labels) || labels[0] || null;
}
