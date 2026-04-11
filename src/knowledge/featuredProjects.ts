import data from './data.json';
import { hasExplicitGithubProjectMatch } from './githubProjects';

const FEATURED_PROJECTS_TEXT = data['projects:top'] ?? '';

function normalizeText(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function shouldUseFeaturedProjectsContext(query: string): boolean {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return false;
    if (hasExplicitGithubProjectMatch(query)) return false;

    const broadProjectPatterns = [
        'most proud',
        'proud of',
        'flagship',
        'look at first',
        'start with',
        'best project',
        'favorite project',
        'favourite project',
        'your project',
        'the project',
        'about the project',
        'tell me about the project',
        'can you tell me about the project',
        'what project',
    ];

    return broadProjectPatterns.some((pattern) => normalizedQuery.includes(pattern));
}

export function formatFeaturedProjectsForPrompt(query: string): string | null {
    if (!shouldUseFeaturedProjectsContext(query) || !FEATURED_PROJECTS_TEXT.trim()) {
        return null;
    }

    return [
        'Use this featured portfolio context for the current question.',
        'Only mention projects that appear in this curated list.',
        'If the user asks broadly about "the project" or asks which project I am most proud of, default to Yubi AI Portfolio Terminal unless they specify a different project.',
        'For Yubi AI Portfolio Terminal, lead with the main user-facing goal: it is an interactive portfolio where visitors can learn about Yubi\'s skills, projects, and experience through natural conversation.',
        'Avoid phrasing it as an "AI version of me" unless the user explicitly asks about that framing.',
        'Do not lead with backend architecture, internal services, or implementation details unless the user explicitly asks for them.',
        'Do not invent project names, community initiatives, or motivations beyond this context.',
        '',
        FEATURED_PROJECTS_TEXT,
    ].join('\n');
}