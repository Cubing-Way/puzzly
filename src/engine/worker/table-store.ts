// Stored tables: built tables' bytes kept in this browser (IndexedDB), so after a reload (or in a fresh worker) they load in a few ms instead of being rebuilt

// The Rust side's table format number (tables saved by another format are never read)
import { tableFormat } from "../../../search/pkg/puzzly_search.js";

// Object store holding the tables (key: table format / moves / targets, value: the table's bytes)
const DB_STORE = "tables";

// The stored-tables database, or null when there's none (not opened, storing turned off, private window, blocked storage, Node tests…)
let database: Promise<IDBDatabase | null> = Promise.resolve(null);
// Keys (moves + targets) of the tables stored for the current table format
const stored = new Set<string>();

// An IndexedDB request as a promise
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Open (or create) the database with this name; null when IndexedDB isn't there or refuses
function openDatabase(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const open = indexedDB.open(name, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(DB_STORE);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(null);
      open.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// Key of a table in the database: the table format first, so tables saved by an older format are never read as current ones
function storeKey(key: string): string {
  return `${tableFormat()}/${key}`;
}

// Open the store under this database name (null = keep nothing: every table is built when needed)
export function openTableStore(name: string | null): void {
  database = name === null ? Promise.resolve(null) : openDatabase(name);
}

// Note which tables are stored, deleting the ones saved by another table format (they'd never be read again); needs the Rust code loaded
export async function listStored(): Promise<void> {
  const db = await database;
  if (!db) return;
  try {
    const prefix = storeKey("");
    const store = db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE);
    for (const key of await result(store.getAllKeys())) {
      if (String(key).startsWith(prefix)) stored.add(String(key).slice(prefix.length));
      else store.delete(key);
    }
  } catch {
    // Unreadable database: tables are built as if nothing was stored
  }
}

// True when this table's bytes are stored here
export function isStored(key: string): boolean {
  return stored.has(key);
}

// A stored table's bytes (throws when they're missing or can't be read)
export async function readStored(key: string): Promise<Uint8Array> {
  const db = await database;
  if (!db) throw new Error("No table store");
  return result<Uint8Array>(db.transaction(DB_STORE).objectStore(DB_STORE).get(storeKey(key)));
}

// Forget a stored table whose bytes didn't load (it's built again, and the new one stored)
export function forgetStored(key: string): void {
  stored.delete(key);
}

// Store a built table's bytes (in the background: a full disk or blocked storage only means it's built again next time)
export async function storeTable(key: string, bytes: Uint8Array): Promise<void> {
  const db = await database;
  if (!db) return;
  try {
    await result(db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).put(bytes, storeKey(key)));
    stored.add(key);
  } catch {
    // Not stored: nothing else to do
  }
}
