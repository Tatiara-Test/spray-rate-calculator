import { COMBINED_PREFIX, WORK_NOTES_KEY } from './storage.mjs';
import { getStorage, transactStorage } from './durable-storage.mjs';
import { emptyNotebook, validateNotebook, createNote, addNote } from './notebook-model.mjs';
export const NOTEBOOK_KEY = `${COMBINED_PREFIX}:notebook:v1`;
const RESTORE_EPOCH_KEY = `${COMBINED_PREFIX}:restore-epoch`;
export function readSnapshot(storage=getStorage()) { const raw=storage.getItem(NOTEBOOK_KEY);return {raw,epoch:storage.getItem(RESTORE_EPOCH_KEY),data:raw===null?emptyNotebook():validateNotebook(JSON.parse(raw))}; }
export const readNotebook=(storage=getStorage())=>readSnapshot(storage).data;
export function saveNotebook(next,{expectedRaw,expectedEpoch}={}) {
  const raw=JSON.stringify(validateNotebook(next));
  if(expectedRaw===undefined||expectedEpoch===undefined) return Promise.reject(new Error('Notebook save requires the original snapshot and restore epoch.'));
  return transactStorage(storage=>{if(storage.getItem(NOTEBOOK_KEY)!==expectedRaw||storage.getItem(RESTORE_EPOCH_KEY)!==expectedEpoch)throw new Error('Notebook changed or records were restored. Reload before saving.');storage.setItem(NOTEBOOK_KEY,raw);return {data:JSON.parse(raw),raw,epoch:expectedEpoch};});
}
function diary(storage) {
  const raw=storage.getItem(WORK_NOTES_KEY);const data=raw===null?null:JSON.parse(raw);
  if(data?.version!==1||!Array.isArray(data.followUps))throw new Error('Work Diary tasks could not be read.');
  return data;
}
export function moveTaskToNotebook(taskId,{expectedTask,title}={}) {
  return transactStorage(storage=>{
    const data=readNotebook(storage),work=diary(storage);
    const previous=data.notes.find(note=>note.provenance?.taskId===taskId);
    const index=work.followUps.findIndex(task=>task.id===taskId);
    if(previous) {if(index!==-1)throw new Error('Task identity conflicts with an existing Notebook move.');return {noteId:previous.id,receipt:null,alreadyMoved:true};}
    if(index<0)throw new Error('To-do no longer exists.');
    const task=work.followUps[index];
    if(expectedTask!==undefined&&JSON.stringify(task)!==JSON.stringify(expectedTask))throw new Error('To-do changed. Review it before moving.');
    if(task.status!=='open'||typeof task.description!=='string')throw new Error('Only open to-dos can move to Notebook.');
    if(title!==undefined&&(typeof title!=='string'||!title.trim()))throw new Error('Notebook title must contain text.');
    const note=createNote({title:title??task.description.split(/\r?\n/)[0],body:task.description});
    note.provenance={kind:'work-diary-task',taskId,task:structuredClone(task),movedAt:note.createdAt};
    storage.setItem(NOTEBOOK_KEY,JSON.stringify(addNote(data,note)));
    work.followUps.splice(index,1);storage.setItem(WORK_NOTES_KEY,JSON.stringify(work));
    return {noteId:note.id,receipt:{noteId:note.id,noteRaw:JSON.stringify(note),task:structuredClone(task),index,epoch:storage.getItem(RESTORE_EPOCH_KEY)}};
  });
}
export function undoTaskMove(receipt) {
  return transactStorage(storage=>{
    if(!receipt||typeof receipt.noteId!=='string')throw new Error('Move receipt is unavailable.');
    if(receipt.epoch===undefined||storage.getItem(RESTORE_EPOCH_KEY)!==receipt.epoch)throw new Error('Records were restored. This Undo is no longer available.');
    const data=readNotebook(storage),work=diary(storage);const index=data.notes.findIndex(note=>note.id===receipt.noteId);
    if(index<0||JSON.stringify(data.notes[index])!==receipt.noteRaw)throw new Error('The moved note has changed. Undo cannot discard later edits.');
    const source=data.notes[index].provenance;
    if(!source||JSON.stringify(source.task)!==JSON.stringify(receipt.task))throw new Error('Move receipt does not match the original task.');
    if(work.followUps.some(task=>task.id===source.taskId))throw new Error('A task with this identity already exists. Undo was stopped.');
    work.followUps.splice(Math.min(receipt.index,work.followUps.length),0,structuredClone(source.task));data.notes.splice(index,1);
    storage.setItem(NOTEBOOK_KEY,JSON.stringify(validateNotebook(data)));storage.setItem(WORK_NOTES_KEY,JSON.stringify(work));return {taskId:source.taskId};
  });
}
