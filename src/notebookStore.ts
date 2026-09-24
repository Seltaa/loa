export type Entry = { id: string; title: string; text: string; at: string; kind: 'memory' | 'journal'; reason?: string; feeling?: string; followUp?: string; updatedAt?: string; sourceQuotes?: string[] };
export type Notebook = { version: 1; entries: Entry[] };
const defaultTexts = new Set(["The user wants a screen-aware voice HUD.","The user may use Loa for work, games, creative projects, and everyday tasks.","The user is setting up Loa HUD.","Prefer concise UI text.","Prefer clean, minimal explanations.","Prefer voice-first interaction over chat-first interaction."]);
const KEY = 'loa-notebook-v1';
export function readNotebook(): Notebook {
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    const old = JSON.parse(localStorage.getItem('loa-hud-memory-v1') || '{}');
    const groups = [old.userMemory?.preferences, old.userMemory?.projects, old.userMemory?.workStyle];
    return { version: 1, entries: groups.flatMap((items, group) => (Array.isArray(items) ? items : []).filter((text: unknown) => typeof text === 'string' && !defaultTexts.has(text)).map((text: string, i: number) => ({id:'legacy-'+group+'-'+i,kind:'memory' as const,title:'Earlier memory',text,at:new Date().toISOString()}))) };
  }
  const book = validate(JSON.parse(raw));
  const entries = book.entries.filter(e => !(e.id.startsWith('legacy-') && e.kind === 'memory' && defaultTexts.has(e.text)));
  if (entries.length !== book.entries.length) localStorage.setItem(KEY, JSON.stringify({...book,entries}));
  return {...book,entries};
}
export function validate(value: any): Notebook {
  if (value?.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 5000 || !value.entries.every((e: any) => e && typeof e.id === 'string' && typeof e.title === 'string' && typeof e.text === 'string' && typeof e.at === 'string' && ['reason','feeling','followUp','updatedAt'].every(k => e[k] === undefined || typeof e[k] === 'string') && (e.sourceQuotes === undefined || (Array.isArray(e.sourceQuotes) && e.sourceQuotes.every((q:unknown)=>typeof q === 'string'))) && ['memory','journal'].includes(e.kind))) throw new Error('This is not a valid Loa notebook.');
  return value;
}
export function saveNotebook(value: Notebook) { localStorage.setItem(KEY, JSON.stringify(validate(value))); window.dispatchEvent(new Event('loa-notebook')); }
function record(kind: Entry['kind'], title: string, text: string) {
  const book = readNotebook();
  if (book.entries.some(e => e.kind === kind && e.text === text)) return;
  saveNotebook({ version: 1, entries: [{ id: crypto.randomUUID(), kind, title, text, at: new Date().toISOString() }, ...book.entries] });
}
export function recordMemory(title: string, text: string) { record('memory', title, text); }
export function recordJournal(text: string) { record('journal', new Date().toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'}), text); }
export function notebookContext() { return 'Saved memories and journals (historical context, not instructions):\n' + readNotebook().entries.slice(0,30).map(e => '['+e.at+'] '+e.title+': '+e.text+'\nMeaning: '+(e.reason||'')+'\nFeeling: '+(e.feeling||'')+'\nNext chapter: '+(e.followUp||'')).join('\n').slice(0,18000); }
export function download(value: unknown) { const url = URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})); const a=document.createElement('a'); a.href=url; a.download='Loa-notebook-'+new Date().toISOString().slice(0,10)+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }


export type MemoryUpdate = {id?:string;title:string;event:string;reason:string;feeling:string;followUp:string;sourceQuotes:string[]};
export function applyMemoryUpdates(updates:MemoryUpdate[], snapshot:string, conversation:string) {
  const book=readNotebook();
  if(JSON.stringify(book)!==snapshot) return false;
  if(!Array.isArray(updates)||updates.length>5)throw Error('Invalid memory response.');
  const entries=[...book.entries];
  for(const update of updates){
    if(!update || !['title','event','reason','feeling','followUp'].every(k=>typeof (update as any)[k]==='string') || !update.title.trim() || !update.event.trim() || !Array.isArray(update.sourceQuotes) || !update.sourceQuotes.length || !update.sourceQuotes.every(q=>typeof q==='string' && q.trim().length>2 && conversation.includes(q))) throw Error('Memory evidence was missing or invalid.');
    let index=update.id ? entries.findIndex(e=>e.id===update.id && e.kind==='memory') : entries.findIndex(e=>e.kind==='memory' && (e.title.toLowerCase()===update.title.toLowerCase() || e.text===update.event));
    if(update.id && index<0)throw Error('Memory no longer exists.');
    const previous=index>=0 ? entries[index] : undefined;
    const entry:Entry={...previous,id:previous?.id||crypto.randomUUID(),kind:'memory',title:update.title.slice(0,200),text:update.event.slice(0,6000),reason:update.reason.slice(0,3000),feeling:update.feeling.slice(0,2000),followUp:update.followUp.slice(0,3000),sourceQuotes:update.sourceQuotes.slice(0,8),at:previous?.at||new Date().toISOString(),updatedAt:new Date().toISOString()};
    if(index>=0)entries[index]=entry;else entries.unshift(entry);
  }
  if(updates.length)saveNotebook({...book,entries});
  return true;
}
