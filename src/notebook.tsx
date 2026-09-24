import { useEffect, useState } from 'react';
import { readNotebook, saveNotebook, type Entry, type Notebook } from "./notebookStore";
export function NotebookPanel({initialTab}: {initialTab: Entry["kind"];onClose:()=>void;connected:boolean;onJournal:()=>void;onRestore:()=>void}) {
  const [book,setBook]=useState(readNotebook);
  const [tab,setTab]=useState<Entry['kind']>(initialTab);
  const [error,setError]=useState('');
  const [reviewStatus,setReviewStatus]=useState("");
  useEffect(()=>{const update=(event:Event)=>setReviewStatus(String((event as CustomEvent).detail));window.addEventListener("loa-memory-status",update);return()=>window.removeEventListener("loa-memory-status",update)},[]);

  const [date,setDate]=useState('');
  const [page,setPage]=useState(0);
  const localDay=(value:string)=>{const d=new Date(value);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
  const filtered=book.entries.filter(e=>e.kind===tab && (!date || localDay(e.at)===date)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  const pageCount=Math.max(1,Math.ceil(filtered.length/6));
  const currentPage=Math.min(page,pageCount-1);
  const visible=filtered.slice(currentPage*6,currentPage*6+6);
  useEffect(()=>setPage(0),[tab,date]);
  useEffect(()=>{const sync=()=>setBook(readNotebook()); window.addEventListener('loa-notebook',sync);return()=>window.removeEventListener('loa-notebook',sync)},[]);
  useEffect(() => setTab(initialTab), [initialTab]);
  function commit(next: Notebook) { try {saveNotebook(next);setError('')} catch {setError('Could not save. Your browser storage may be full. Export a backup before continuing.')} }
  function remove(e:Entry) { if(!confirm('Delete this saved entry?'))return; commit({...book,entries:book.entries.filter(x=>x.id!==e.id)}); }
  return <section id="loa-notebook" className="notebook notebookInline" aria-label="Memories and journal">
    <header><div><p className="microLabel">CONTINUITY</p><h2>Memories & journal</h2></div></header>
    <p className="notebookIntro">The moments worth keeping. Stored in this browser, editable by you.</p>
    <nav><button aria-pressed={tab==='memory'} onClick={()=>setTab('memory')}>Memories</button><button aria-pressed={tab==='journal'} onClick={()=>setTab('journal')}>Journal</button></nav>
    <div className="notebookBrowse"><span>{date ? 'Entries for this date' : currentPage === 0 ? 'Latest 6 entries' : 'Earlier entries'}</span><label>Browse by date<input type="date" lang="en" aria-label="Browse entries by date" value={date} onChange={e=>setDate(e.target.value)}/></label>{date&&<button onClick={()=>setDate('')}>Latest</button>}</div>
    {reviewStatus&&<p className="notebookIntro" role="status">{reviewStatus}</p>}{error&&<p role="status">{error}</p>}
    <div className="notebookEntries">{filtered.length===0&&<div className="notebookEmpty">{tab==='journal'?'Every day can have a page.':'Room for what matters.'}<small>{tab==='journal'?'Your daily journal will appear here.':'The moments Loa remembers will appear here.'}</small></div>}
    {visible.map(entry=><article key={entry.id}><time>{new Date(entry.at).toLocaleString('en-US')}</time><h3>{entry.title === 'Earlier memory' ? 'Saved preference' : entry.title}</h3><p className="entryReadText">{entry.text || 'No text yet.'}</p>{entry.kind==='memory'&&<dl className="memoryContext">{([['reason','Meaning'],['feeling','Feeling'],['followUp','Next chapter']] as const).map(([key,label])=>entry[key]?<div key={key}><dt>{label}</dt><dd>{entry[key]}</dd></div>:null)}</dl>}<details><summary>Edit entry</summary><input aria-label="Entry title" value={entry.title} onChange={e=>commit({...book,entries:book.entries.map(x=>x.id===entry.id?{...x,title:e.target.value}:x)})}/><textarea aria-label="Entry text" value={entry.text} onChange={e=>commit({...book,entries:book.entries.map(x=>x.id===entry.id?{...x,text:e.target.value}:x)})}/>{entry.kind==='memory'&&(['reason','feeling','followUp'] as const).map((key,i)=><label key={key}>{['Meaning','Feeling','Next chapter'][i]}<textarea aria-label={['Meaning','Feeling','Next chapter'][i]} value={entry[key]||''} onChange={e=>commit({...book,entries:book.entries.map(x=>x.id===entry.id?{...x,[key]:e.target.value}:x)})}/></label>)}<button onClick={()=>remove(entry)}>Delete entry</button></details></article>)}</div>
    {pageCount>1&&<div className="notebookPagination"><button disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Newer</button><span>{currentPage+1} / {pageCount}</span><button disabled={currentPage===pageCount-1} onClick={()=>setPage(currentPage+1)}>Older</button></div>}
    <footer>Changes are saved locally. Reconnect Live to use your updated notebook.</footer>
  </section>;
}

