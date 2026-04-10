// Exports the active KnowledgeProvider singleton.
// To switch to Redis: replace InMemoryProvider with RedisProvider here.
// Nothing else in the codebase needs to change.

import { InMemoryProvider } from './InMemoryProvider';

export { buildSystemPrompt } from './buildSystemPrompt';
export type { KnowledgeProvider } from './KnowledgeProvider';

export const knowledgeProvider = new InMemoryProvider();
