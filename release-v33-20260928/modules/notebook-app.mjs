import { COLORS, createNote, addNote, updateNote, duplicateNote, setNoteStatus, setPinned, toggleItem, addItem, updateItem, reorderItem, searchNotes } from './notebook-model.mjs';
import { readSnapshot, saveNotebook } from './notebook-storage.mjs';
import { saveFileCopy } from './native-files.mjs';
import { handFilesToShareSheet } from './share-files.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const colors = { plain:'#b9c5b6', yellow:'#dac469', green:'#79a278', blue:'#81a5bc', pink:'#c394a5' };
export const readChecklistItemInput = form => form.elements.namedItem('item').value;

export function notebookNoteText(note) {
  const content=note.type==='checklist'?note.items.map(item=>`${item.checked?'[x]':'[ ]'} ${item.text}`).join('\n'):note.body;
  const source=note.provenance?.task;
  const references=source?`\n\nOriginal to-do reference\n${source.description}\n${Object.entries(source).filter(([key,value])=>/(date|due|created|updated)/i.test(key)&&typeof value==='string').map(([key,value])=>`${key}: ${value}`).join('\n')}`:'';
  return `${note.title || 'Untitled'}\n\n${content}${references}\n`;
}
export async function exportNotebookNote(note, { action, save=saveFileCopy, share=handFilesToShareSheet, navigatorLike=globalThis.navigator }={}) {
  const filename=`${(note.title || 'Notebook').replace(/[^a-z0-9 _-]/gi,'').trim().slice(0,70)||'Notebook'}.txt`;
  const file=new File([notebookNoteText(note)],filename,{type:'text/plain'});
  if(action==='save') {
    const result=await save(file,filename);
    if(result.mode==='cancelled') return 'Save cancelled. The note is still here.';
    if(result.mode==='downloaded') return 'Text download started. Check your browser downloads; the saved copy has not been verified.';
    if(result.mode!=='saved'||result.verified!==true) throw new Error('A saved text copy could not be verified. Try Save text copy again.');
    return 'Text copy saved and verified.';
  }
  const result=await share({navigatorLike,files:[file],title:note.title||'Notebook',text:'Notebook text copy'});
  if(result.mode==='cancelled') return 'Sharing cancelled. The note is still here.';
  if(result.mode!=='shared') throw new Error(result.message||'The share chooser could not be opened. Try Save text copy.');
  return 'Text copy handed to the share chooser. Delivery is not confirmed.';
}

// A single writer keeps edits made during a native commit pending for the next
// commit. The expected raw value prevents overwriting a move or restore elsewhere.
export function createNotebookAutosave({ read, save, onStatus = () => {}, delay = 350 }) {
  let { data, raw, epoch = null } = read();
  let edited = 0, committed = 0, timer, running, error = null;
  const state = () => ({ data, dirty: edited !== committed, saving: Boolean(running), error });
  const notify = () => onStatus(state());
  async function flush() {
    clearTimeout(timer);
    if (running) return running;
    if (edited === committed) return true;
    error = null;
    running = Promise.resolve().then(async () => {
      try {
        while (edited !== committed) {
          const version = edited, next = structuredClone(data);
          await save(next, { expectedRaw: raw, expectedEpoch: epoch });
          raw = JSON.stringify(next);
          committed = version;
        }
        return true;
      } catch (cause) { clearTimeout(timer); error = cause; return false; }
      finally { running = null; notify(); }
    });
    notify();
    return running;
  }
  return {
    state,
    edit(next) { data = next; edited++; clearTimeout(timer); notify(); if (!error) timer = setTimeout(flush, delay); },
    flush,
    refresh() { if (edited !== committed || running) return false; ({data, raw, epoch = null} = read()); error = null; notify(); return true; },
    dispose() { clearTimeout(timer); },
  };
}

export function mountNotebookApp(host, options = {}) {
  host.classList.add('notebook-app');
  let selected = null, view = 'active', query = '', hideChecked = false, creating = false, draftDirty = false;
  const itemDrafts = new Map();
  const rejectedFields = new Set();
  let exportBusy=false, writer;
  function readFailure(error) {
    host.innerHTML='<h2>Notebook unavailable</h2><p role="alert"></p><p>The stored Notebook has not been changed. You can return using Main menu. Reopen the app after resolving the storage problem.</p>';
    host.querySelector('[role=alert]').textContent=error.message || 'Notebook could not be read safely.';
  }
  try { writer = createNotebookAutosave({ read: options.readSnapshot || readSnapshot, save: options.saveNotebook || saveNotebook, onStatus: status, delay: options.saveDelay ?? 350 }); }
  catch(error) { readFailure(error); return {show(){},refresh:()=>false,openNote:()=>false,hasUnsavedChanges:()=>false,getUnsavedBlocker:()=>null,flush:async()=>false}; }
  const data = () => writer.state().data;
  const note = () => data().notes.find(item => item.id === selected);
  const find = selector => host.querySelector(selector);
  function status() {
    const target = find('[data-save-status]');
    if (!target) return;
    const state = writer.state();
    target.textContent = exportBusy ? 'Preparing text copy…' : rejectedFields.size ? 'This edit was not saved. Correct the highlighted field before leaving.' : state.error ? 'Not saved. Your changes are still here. Retry before leaving.' : state.saving ? 'Saving…' : state.dirty ? 'Changes waiting to save…' : draftDirty || itemDrafts.size ? 'Unfinished entry — not saved yet' : 'Saved on this device';
    const retry = find('[data-action="retry"]');
    if (retry) retry.hidden = !state.error;
    options.onDirtyChange?.(hasUnsavedChanges());
  }
  function hasUnsavedChanges() { const state = writer.state(); return exportBusy || rejectedFields.size > 0 || draftDirty || itemDrafts.size > 0 || state.dirty || state.saving; }
  function getUnsavedBlocker() { return hasUnsavedChanges() ? (exportBusy ? 'Finish the Notebook file action before leaving.' : rejectedFields.size ? 'Correct the unsaved Notebook edit before leaving.' : draftDirty ? 'Finish or cancel the new Notebook entry before leaving.' : itemDrafts.size ? 'Add or clear the unfinished checklist item before leaving.' : 'Notebook changes are not saved yet. Wait for Saved or use Retry before leaving.') : null; }
  function mutate(transform, redraw = true) {
    try { writer.edit(transform(data())); if (redraw) render(); }
    catch (error) { find('[data-message]').textContent = error.message; }
  }
  function editField(target, transform) {
    const key=target.dataset.field || target.dataset.item;
    try { const next=transform(data()); rejectedFields.delete(key); target.removeAttribute('aria-invalid'); writer.edit(next); }
    catch(error) { rejectedFields.add(key); target.setAttribute('aria-invalid','true'); find('[data-message]').textContent=error.message; status(); }
  }
  async function exportCurrent(action) {
    if(hasUnsavedChanges()) { find('[data-message]').textContent=getUnsavedBlocker(); return; }
    exportBusy=true; status();
    const controls=[...host.querySelectorAll('button,input,textarea,select')].map(control=>({control,disabled:control.disabled}));
    controls.forEach(({control})=>{control.disabled=true;});
    try { find('[data-message]').textContent=await exportNotebookNote(structuredClone(note()),{action}); }
    catch(error) { find('[data-message]').textContent=`${error.message} The note is still here; you can try again.`; }
    finally { exportBusy=false; controls.forEach(({control,disabled})=>{control.disabled=disabled;}); status(); }
  }
  function render() {
    host.innerHTML = `<div class="nb-heading"><h2>Notebook</h2><span data-save-status role="status" aria-live="polite"></span><button data-action="retry" hidden>Retry save</button></div><p data-message role="alert"></p><div data-content></div>`;
    if (creating) renderCreate();
    else if (selected && note()) renderNote();
    else { selected = null; renderOverview(); }
    status();
  }
  function renderOverview() {
    find('[data-content]').innerHTML = `<p>Information to keep. Lists to use your way.</p><div class="nb-toolbar"><h3>Your notes</h3><button data-action="new">＋ New</button></div><input class="nb-search" type="search" data-search aria-label="Search notes and checklist items" placeholder="Search notes and list items" value="${esc(query)}"><nav class="nb-filters" aria-label="Notebook views">${[['active','All notes'],['pinned','Pinned'],['archived','Archive'],['bin','Bin']].map(([id,label])=>`<button data-view="${id}" aria-pressed="${view===id}">${label}</button>`).join('')}</nav><p class="nb-help">Search covers ${view==='active'?'active notes':view==='archived'?'Archive':view==='bin'?'Bin':'pinned notes'} only.${view==='bin'?' Items stay here until restored.':''}</p><div data-results></div>`;
    renderCards();
  }
  function renderCards() {
    const notes = searchNotes(data(), {view, query});
    find('[data-results]').innerHTML = `<div class="nb-cards">${notes.map(n => `<article class="nb-card" style="--nb-accent:${colors[n.color]}"><button class="nb-open" data-open="${esc(n.id)}"><small>${n.type==='text'?'Note':'Checklist'}${n.pinned?' · Pinned':''}</small><h3>${esc(n.title || 'Untitled')}</h3><p>${esc(n.type==='text'?n.body.slice(0,160):n.items.filter(i=>!i.checked).slice(0,3).map(i=>'□ '+i.text).join('\n'))}</p>${n.type==='checklist'?`<small>${n.items.filter(i=>i.checked).length} of ${n.items.length} checked</small>`:''}</button></article>`).join('')}</div>${notes.length?'':'<p class="nb-empty">No notes here'+(query?' match your search.':'.')+'</p>'}`;
  }
  function renderCreate() {
    find('[data-content]').innerHTML = `<form data-create><h3>New note or checklist</h3><label>Type<select name="type"><option value="text">Text note</option><option value="checklist">Checklist</option></select></label><label>Title<input name="title" required maxlength="120" placeholder="For example, Parts to buy"></label><label><span data-body-label>Note</span><textarea name="body" placeholder="Write here…"></textarea></label><p class="nb-help" data-list-help hidden>Paste a list with one item per line. You can edit each item separately after saving.</p><label>Colour<select name="color">${colorOptions('plain')}</select></label><div class="nb-toolbar"><button type="button" data-action="cancel-new">Cancel</button><button type="submit">Create and save</button></div></form>`;
    find('[name=title]').focus();
  }
  function colorOptions(value) { return COLORS.map(color=>`<option value="${color}" ${color===value?'selected':''}>${color[0].toUpperCase()+color.slice(1)}</option>`).join(''); }
  function provenanceMarkup(source) {
    const task=source.task || {};
    const dates=Object.entries(task).filter(([key,value])=>/(date|due|created|updated)/i.test(key) && typeof value==='string');
    return `<details class="nb-provenance"><summary>Original to-do reference</summary><p>${esc(task.description)}</p>${dates.map(([key,value])=>`<p>${esc(key.replace(/([A-Z])/g,' $1').replace(/Iso$/,'').trim())}: ${esc(value)}</p>`).join('')}</details>`;
  }
  function renderNote() {
    const n = note(), writable = n.status === 'active';
    find('[data-content]').innerHTML = `<button data-action="back">← Notebook</button><p class="nb-help">${n.type==='text'?'Text note':'Checklist'}${n.status==='archived'?' · Archived':n.status==='bin'?' · In Bin':''}${n.pinned?' · Pinned':''}</p><label>Title<input data-field="title" value="${esc(n.title)}" maxlength="120" ${writable?'':'disabled'}></label>${n.provenance?provenanceMarkup(n.provenance):''}${n.type==='text'?`<label>Note<textarea data-field="body" ${writable?'':'disabled'}>${esc(n.body)}</textarea></label>`:`<div class="nb-toolbar"><strong>${n.items.filter(i=>i.checked).length} of ${n.items.length} checked</strong><button data-action="hide">${hideChecked?'Show':'Hide'} checked</button>${writable?'<button data-action="quick-add">＋ Add item</button>':''}</div><div class="nb-items">${n.items.map((item,index)=>hideChecked&&item.checked?'':`<div class="nb-item ${item.checked?'nb-checked':''}"><input type="checkbox" data-tick="${esc(item.id)}" aria-label="Check ${esc(item.text)}" ${item.checked?'checked':''} ${writable?'':'disabled'}><input class="nb-item-text" data-item="${esc(item.id)}" aria-label="Item text" value="${esc(item.text)}" ${writable?'':'disabled'}>${writable?`<button data-up="${esc(item.id)}" aria-label="Move ${esc(item.text)} up" ${index===0?'disabled':''}>↑</button><button data-down="${esc(item.id)}" aria-label="Move ${esc(item.text)} down" ${index===n.items.length-1?'disabled':''}>↓</button>`:''}</div>`).join('')}</div>${writable?'<form class="nb-add" data-add><input name="item" aria-label="New checklist item" placeholder="Add an item, then press Enter" required><button>Add</button></form>':''}`}
    <details class="nb-more"><summary>More</summary><div class="nb-secondary"><button data-action="share-text">Share text</button><button data-action="save-text">Save text copy</button>${writable?`<label>Colour<select data-field="color">${colorOptions(n.color)}</select></label><button data-action="pin">${n.pinned?'Unpin':'Pin'}</button><button data-action="duplicate">${n.type==='checklist'?'Duplicate with ticks cleared':'Duplicate note'}</button><button data-action="archive">Archive</button><button data-action="bin">Move to Bin</button>`:`<button data-action="restore">Restore to Notebook</button>${n.status==='archived'?'<button data-action="bin">Move to Bin</button>':''}`}</div></details>`;
    if (find('[data-add] input')) find('[data-add] input').value=itemDrafts.get(selected)||'';
  }
  host.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !host.contains(button)) return;
    const d = button.dataset;
    if(exportBusy) return;
    if(rejectedFields.size) { find('[data-message]').textContent=getUnsavedBlocker(); return; }
    if (itemDrafts.size && (d.open || d.view || ['new','back','archive','bin','duplicate'].includes(d.action))) { find('[data-message]').textContent=getUnsavedBlocker(); return; }
    if (d.open) { selected = d.open; hideChecked = false; render(); }
    else if (d.view) { view = d.view; render(); }
    else if (d.up || d.down) mutate(data => reorderItem(data, selected, d.up || d.down, d.up ? -1 : 1));
    else switch(d.action) {
      case 'share-text': void exportCurrent('share'); break;
      case 'save-text': void exportCurrent('save'); break;
      case 'retry': void writer.flush(); break;
      case 'new': creating = true; draftDirty = false; render(); break;
      case 'cancel-new': creating = false; draftDirty = false; render(); break;
      case 'back': selected = null; render(); break;
      case 'hide': hideChecked = !hideChecked; render(); break;
      case 'quick-add': find('[data-add] input')?.focus(); find('[data-add]')?.scrollIntoView({block:'center'}); break;
      case 'pin': mutate(data=>setPinned(data,selected,!note().pinned)); break;
      case 'duplicate': mutate(data=>{ const next=duplicateNote(data,selected); selected=next.notes.find(n=>!data.notes.some(old=>old.id===n.id)).id; return next; }); break;
      case 'archive': case 'bin': case 'restore': mutate(data=>setNoteStatus(data,selected,d.action==='archive'?'archived':d.action==='bin'?'bin':'active')); break;
    }
  });
  host.addEventListener('input', event => {
    const target = event.target;
    if (target.matches('[data-search]')) { query=target.value; renderCards(); }
    else if (target.closest('[data-create]')) { draftDirty=true; status(); }
    else if (target.closest('[data-add]')) { if(target.value) itemDrafts.set(selected,target.value); else itemDrafts.delete(selected); status(); }
    else if (target.dataset.field && target.tagName !== 'SELECT') editField(target,data=>updateNote(data,selected,{[target.dataset.field]:target.value}));
    else if (target.dataset.item) editField(target,data=>updateItem(data,selected,target.dataset.item,target.value));
  });
  host.addEventListener('change', event => {
    const target = event.target;
    if (target.dataset.tick) mutate(data=>toggleItem(data,selected,target.dataset.tick));
    else if (target.dataset.field === 'color') editField(target,data=>updateNote(data,selected,{color:target.value}));
    else if (target.name==='type' && creating) { find('[data-body-label]').textContent=target.value==='checklist'?'Items — one per line':'Note'; find('[data-list-help]').hidden=target.value!=='checklist'; }
  });
  host.addEventListener('submit', event => {
    const form=event.target;
    if (form.matches('[data-create]')) {
      event.preventDefault();
      const fields = new FormData(form), type=fields.get('type'), body=String(fields.get('body'));
      mutate(data=>{ const n=createNote({type,title:String(fields.get('title')).trim(),body:type==='text'?body:'',items:type==='checklist'?body.split(/\r?\n/).filter(t=>t.trim()):[],color:fields.get('color')}); selected=n.id; creating=false; draftDirty=false; return addNote(data,n); });
      void writer.flush();
    } else if (form.matches('[data-add]')) { event.preventDefault(); const text=readChecklistItemInput(form); if (!text.trim()) return; mutate(data=>{const next=addItem(data,selected,text); itemDrafts.delete(selected); return next;}); find('[data-add] input')?.focus(); }
  });
  const unload = event => { if (hasUnsavedChanges()) { event.preventDefault(); event.returnValue=''; } };
  globalThis.addEventListener?.('beforeunload',unload);
  render();
  return {
    show() { if (exportBusy || rejectedFields.size) return; try { if (!hasUnsavedChanges()) writer.refresh(); if (!creating) render(); } catch(error) {readFailure(error);} },
    refresh() { if (hasUnsavedChanges()) return false; try { if(!writer.refresh())return false; render(); return true; } catch(error) {readFailure(error);return false;} },
    openNote(id) { if (exportBusy || rejectedFields.size || draftDirty || itemDrafts.size) return false; try { if (!hasUnsavedChanges()) writer.refresh(); } catch(error) {readFailure(error);return false;} if (!data().notes.some(n=>n.id===id)) return false; selected=id; creating=false; hideChecked=false; render(); return true; },
    hasUnsavedChanges, getUnsavedBlocker, flush: writer.flush,
  };
}


