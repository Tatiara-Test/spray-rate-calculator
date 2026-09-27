export const COLORS = Object.freeze(['plain', 'yellow', 'green', 'blue', 'pink']);
export const emptyNotebook = () => ({ version: 1, notes: [] });
const clone = value => structuredClone(value);
const id = () => globalThis.crypto.randomUUID();
const now = () => new Date().toISOString();
function object(value, fields) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value,key))) throw new Error('Unsupported or malformed Notebook fields. Original data must be retained.');
}
function text(value) { if (typeof value !== 'string') throw new Error('Notebook text must be a string.'); }
function identity(value) { text(value); if (!value.trim()) throw new Error('Notebook identity is missing.'); }
function timestamp(value) { text(value); if (!Number.isFinite(Date.parse(value))) throw new Error('Notebook timestamp is invalid.'); }
function jsonValue(value, ancestors=new Set()) {
  if(value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))return;
  if(!value||typeof value!=='object'||ancestors.has(value)||(!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype))throw new Error('Task metadata must be lossless JSON.');
  const next=new Set(ancestors).add(value);for(const item of Object.values(value))jsonValue(item,next);
}
export function validateNotebook(data) {
  object(data,['version','notes']);
  if (data.version !== 1 || !Array.isArray(data.notes)) throw new Error('Unsupported Notebook version or notes.');
  const ids = new Set();
  for (const note of data.notes) {
    object(note,['id','type','title','body','items','color','pinned','status','createdAt','updatedAt','provenance']);
    identity(note.id); if (ids.has(note.id)) throw new Error('Duplicate Notebook identity.'); ids.add(note.id);
    text(note.title); text(note.body); timestamp(note.createdAt); timestamp(note.updatedAt);
    if (!['text','checklist'].includes(note.type) || !COLORS.includes(note.color) || typeof note.pinned !== 'boolean' || !['active','archived','bin'].includes(note.status) || !Array.isArray(note.items)) throw new Error('Malformed Notebook note.');
    if ((note.type === 'text' && note.items.length) || (note.type === 'checklist' && note.body !== '')) throw new Error('Notebook conversion would lose structure.');
    const itemIds = new Set();
    for (const item of note.items) {
      object(item,['id','text','checked']); identity(item.id); text(item.text);
      if (itemIds.has(item.id) || typeof item.checked !== 'boolean') throw new Error('Malformed Notebook checklist item.'); itemIds.add(item.id);
    }
    if (note.provenance !== null) {
      object(note.provenance,['kind','taskId','task','movedAt']);
      if (note.provenance.kind !== 'work-diary-task') throw new Error('Unsupported Notebook provenance.');
      identity(note.provenance.taskId); timestamp(note.provenance.movedAt);
      const task = note.provenance.task;
      if (!task || Object.getPrototypeOf(task) !== Object.prototype || task.id !== note.provenance.taskId || typeof task.description !== 'string') throw new Error('Invalid Notebook task provenance.');
      // Preserve every JSON task metadata field, including future non-reminder fields.
      jsonValue(task);
    }
  }
  return data;
}
export function createNote({type='text',title='',body='',items=[],color='plain'} = {}) {
  const stamp=now();
  const note={id:id(),type,title,body,items:items.map(item=>typeof item==='string'?{id:id(),text:item,checked:false}:clone(item)),color,pinned:false,status:'active',createdAt:stamp,updatedAt:stamp,provenance:null};
  validateNotebook({version:1,notes:[note]}); return note;
}
export function addNote(data,note) { validateNotebook(data); return validateNotebook({...clone(data),notes:[...clone(data.notes),clone(note)]}); }
function transform(data,noteId,fn) {
  validateNotebook(data); const next=clone(data); const note=next.notes.find(note=>note.id===noteId);
  if (!note) throw new Error('Notebook note no longer exists.'); fn(note); note.updatedAt=now(); return validateNotebook(next);
}
export function updateNote(data,noteId,patch) {
  if (!patch || Object.keys(patch).some(key=>!['title','body','items','color'].includes(key))) throw new Error('Unsupported Notebook edit.');
  return transform(data,noteId,note=>Object.assign(note,clone(patch)));
}
export const setNoteStatus=(data,noteId,status)=>transform(data,noteId,note=>{note.status=status;});
export const setPinned=(data,noteId,pinned)=>transform(data,noteId,note=>{note.pinned=pinned;});
export function duplicateNote(data,noteId) {
  validateNotebook(data); const source=data.notes.find(note=>note.id===noteId); if(!source) throw new Error('Notebook note no longer exists.');
  const note=createNote({...source,title:`${source.title} — copy`,items:source.items.map(item=>({...item,id:id(),checked:false}))});
  return addNote(data,note);
}
function itemTransform(data,noteId,itemId,fn) { return transform(data,noteId,note=>{const index=note.items.findIndex(item=>item.id===itemId);if(index<0)throw new Error('Checklist item no longer exists.');fn(note.items[index],note,index);}); }
export const toggleItem=(data,noteId,itemId)=>itemTransform(data,noteId,itemId,item=>{item.checked=!item.checked;});
export const updateItem=(data,noteId,itemId,value)=>itemTransform(data,noteId,itemId,item=>{item.text=value;});
export const addItem=(data,noteId,value)=>transform(data,noteId,note=>{if(note.type!=='checklist')throw new Error('Only checklists accept items.');note.items.push({id:id(),text:value,checked:false});});
export const reorderItem=(data,noteId,itemId,delta)=>itemTransform(data,noteId,itemId,(_,note,index)=>{if(!Number.isInteger(delta))throw new Error('Invalid checklist position.');const target=Math.max(0,Math.min(note.items.length-1,index+delta));const [item]=note.items.splice(index,1);note.items.splice(target,0,item);});
export function searchNotes(data,{view='active',query=''}={}) {
  validateNotebook(data);const needle=query.toLocaleLowerCase();
  return clone(data.notes.filter(note=>(view==='pinned'?note.status==='active'&&note.pinned:note.status===view)&&[note.title,note.body,...note.items.map(item=>item.text)].some(value=>value.toLocaleLowerCase().includes(needle))).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt)));
}
