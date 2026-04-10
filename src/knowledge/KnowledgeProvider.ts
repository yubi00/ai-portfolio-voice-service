// Interface contract for knowledge stores.
// Swap InMemoryProvider for RedisProvider without changing any callers.

export interface KnowledgeProvider {
    /** Retrieve a knowledge entry by key. Returns null if not found. */
    get(key: string): Promise<string | null>;
}
