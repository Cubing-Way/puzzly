// Lookup caches: results of pure lookups, kept so a method search's many step starts don't redo them

// Most entries a lookup cache holds before it starts over
const MAX_REMEMBERED = 10_000;

// Caches whose entries belong to the loaded cube definition
const caches: Map<string, unknown>[] = [];

// A new lookup cache, emptied whenever the cube definition is loaded again
export function lookupCache<T>(): Map<string, T> {
  const cache = new Map<string, T>();
  caches.push(cache);
  return cache;
}

// Empty every lookup cache (their entries belong to the old cube definition)
export function clearLookupCaches(): void {
  for (const cache of caches) cache.clear();
}

// A cached value, made on first use (the cache starts over once it's full)
export function remember<T>(cache: Map<string, T>, key: string, make: () => T): T {
  let value = cache.get(key);
  if (value === undefined) {
    if (cache.size >= MAX_REMEMBERED) cache.clear();
    value = make();
    cache.set(key, value);
  }
  return value;
}
