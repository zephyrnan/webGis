import type { GeoSurgicalAst } from '../types/ast';

const DB_NAME = 'geosurgical-templates';
const DB_VERSION = 1;
const STORE_NAME = 'templates';

export type AstTemplate = {
  id: string;
  name: string;
  ast: GeoSurgicalAst;
  command: string;
  createdAt: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveTemplate(template: AstTemplate): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(template);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadTemplates(): Promise<AstTemplate[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as AstTemplate[]);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function exportTemplates(templates: AstTemplate[]): string {
  return JSON.stringify(templates, null, 2);
}

export function importTemplates(json: string): AstTemplate[] {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('Expected a JSON array');
  return parsed.map((item) => ({
    id: item.id ?? crypto.randomUUID(),
    name: String(item.name ?? 'Imported'),
    ast: item.ast,
    command: String(item.command ?? ''),
    createdAt: Number(item.createdAt ?? Date.now()),
  }));
}
