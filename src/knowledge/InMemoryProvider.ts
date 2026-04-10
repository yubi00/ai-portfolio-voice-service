import { KnowledgeProvider } from './KnowledgeProvider';
import data from './data.json';

// In-memory knowledge store seeded from data.json.
// Replace with RedisProvider when Redis is available — same interface, zero other changes.
export class InMemoryProvider implements KnowledgeProvider {
    private readonly store = new Map<string, string>(Object.entries(data));

    async get(key: string): Promise<string | null> {
        return this.store.get(key) ?? null;
    }
}
