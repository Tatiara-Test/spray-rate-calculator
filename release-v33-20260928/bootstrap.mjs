import { initializeDurableStorage } from './modules/durable-storage.mjs';
import { validateNativeData, createNativeBackup } from './modules/native-backup.mjs';
import { createBrowserStorage } from './modules/browser-storage.mjs';
import { mountStorageConflictRecovery } from './modules/storage-conflict-ui.mjs';

const browserStorage=createBrowserStorage({validateEntries:validateNativeData});
try {
  await initializeDurableStorage({plugin:browserStorage,legacyStorage:() => globalThis.localStorage,validateEntries:validateNativeData});
  await import('./app.js');
} catch (error) {
  const panel = document.createElement('section');
  panel.style.cssText = 'max-width:42rem;margin:3rem auto;padding:1.5rem;font:18px system-ui;background:white;color:#18231b';
  const title = document.createElement('h1'); title.textContent = 'Records could not be opened safely';
  const detail = document.createElement('p'); detail.textContent = `${error.message || 'Browser storage is unavailable.'} Close other tabs and reopen this page. Keep browser data intact; clearing it removes local records.`;
  panel.append(title,detail); document.body.replaceChildren(panel);
  await mountStorageConflictRecovery(panel,{plugin:browserStorage,buildBackup:createNativeBackup});
}
