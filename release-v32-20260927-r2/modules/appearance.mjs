import { getStorage, transactStorage } from './durable-storage.mjs';
export const APPEARANCE_KEY = 'tatiara-test:spray-rate-calculator:v1:appearance';
export function normalizeAppearance(value) {
  if (!value || value.version !== 1 || !['system','light','dark'].includes(value.mode) || !['standard','large'].includes(value.textSize)) throw new Error('Unsupported display preferences.');
  return {version:1,mode:value.mode,textSize:value.textSize};
}
export function loadAppearance(storage = getStorage()) {
  const raw=storage.getItem(APPEARANCE_KEY);
  return raw===null ? {version:1,mode:'system',textSize:'standard'} : normalizeAppearance(JSON.parse(raw));
}
let media;
export function applyAppearance(value=loadAppearance()) {
  const settings=normalizeAppearance(value);
  if (!globalThis.document) return settings;
  media ??= globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  const mode=settings.mode==='system' ? (media?.matches?'dark':'light') : settings.mode;
  const root=document.documentElement;
  root.dataset.appearance=mode;
  root.dataset.textSize=settings.textSize;
  document.querySelectorAll('#spray-host,#settings-host,#work-notes-host,#weather-host,#servicing-host,#service-workspace-host,#notebook-host').forEach(host=>{
    host.dataset.appearance=mode;
    host.dataset.textSize=settings.textSize;
    if(host.shadowRoot && !host.shadowRoot.querySelector('link[data-appearance]')) {
      const link=document.createElement('link');link.rel='stylesheet';link.href='./release-v32-20260927-r2/styles/appearance.css';link.dataset.appearance='';host.shadowRoot.append(link);
    }
  });
  return settings;
}
export async function saveAppearance(value) {
  const settings=normalizeAppearance(value);
  await transactStorage(storage=>storage.setItem(APPEARANCE_KEY,JSON.stringify(settings)));
  applyAppearance(settings);
  globalThis.dispatchEvent?.(new Event('appearancechange'));
  return settings;
}
export function watchAppearance() {
  applyAppearance();
  media?.addEventListener?.('change',()=>applyAppearance());
}
