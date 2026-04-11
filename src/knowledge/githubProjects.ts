import MiniSearch from 'minisearch';
import githubProjects from './github-projects.generated.json';

export type GithubProjectCard = {
    id: string;
    name: string;
    fullName: string;
    description: string;
    summary: string;
    url: string;
    homepage: string | null;
    primaryLanguage: string | null;
    languages: string[];
    topics: string[];
    stars: number;
    archived: boolean;
    featured: boolean;
    aliases: string[];
    keywords: string[];
    pushedAt: string;
    updatedAt: string;
};

type GithubProjectsFile = {
    meta: {
        username: string;
        lastSyncedAt: string;
        repoCount: number;
    };
    projects: GithubProjectCard[];
};

type LegacyGithubProjectsFile = {
    'projects:github'?: string;
    'projects:github:meta'?: string;
};

type ProjectSearchResult = GithubProjectCard & { score: number };

const STOP_WORDS = new Set([
    'a', 'an', 'about', 'and', 'are', 'built', 'did', 'for', 'have', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'project', 'projects', 'tell', 'that', 'the', 'what', 'with', 'you', 'your',
]);

function normalizeGithubProjectsFile(input: unknown): GithubProjectsFile {
    const parsed = input as Partial<GithubProjectsFile> & LegacyGithubProjectsFile;
    if (Array.isArray(parsed.projects) && parsed.meta) {
        return {
            meta: parsed.meta,
            projects: parsed.projects,
        };
    }

    return {
        meta: {
            username: 'unknown',
            lastSyncedAt: 'not-synced',
            repoCount: 0,
        },
        projects: [],
    };
}

const githubProjectsFile = normalizeGithubProjectsFile(githubProjects);
const projectCards = githubProjectsFile.projects;

const miniSearch = new MiniSearch<GithubProjectCard>({
    fields: ['name', 'fullName', 'aliases', 'description', 'summary', 'topics', 'languages', 'keywords'],
    storeFields: ['id'],
    extractField: (document, fieldName) => {
        const value = document[fieldName as keyof GithubProjectCard];
        if (Array.isArray(value)) return value.join(' ');
        return value ?? '';
    },
});

miniSearch.addAll(projectCards);

function normalizeText(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function getExactMatchProjects(query: string): GithubProjectCard[] {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return [];

    return projectCards.filter((project) => {
        const candidateValues = [project.name, project.fullName, ...project.aliases].map(normalizeText);
        return candidateValues.some((candidate) => candidate.length > 0 && (
            normalizedQuery === candidate
            || normalizedQuery.includes(candidate)
            || candidate.includes(normalizedQuery)
        ));
    });
}

function getMeaningfulQueryTerms(query: string): string[] {
    return normalizeText(query)
        .split(' ')
        .filter((term) => term.length >= 2 && !STOP_WORDS.has(term));
}

function rankProjects(projects: ProjectSearchResult[], queryTerms: string[] = []): GithubProjectCard[] {
    return [...projects]
        .sort((left, right) => {
            const leftKeywords = new Set([normalizeText(left.name), ...left.keywords]);
            const rightKeywords = new Set([normalizeText(right.name), ...right.keywords]);
            const leftQueryBoost = queryTerms.reduce((sum, term) => sum + (leftKeywords.has(term) ? 25 : 0), 0);
            const rightQueryBoost = queryTerms.reduce((sum, term) => sum + (rightKeywords.has(term) ? 25 : 0), 0);
            const leftScore = left.score + leftQueryBoost + (left.featured ? 100 : 0) + Math.min(left.stars, 20);
            const rightScore = right.score + rightQueryBoost + (right.featured ? 100 : 0) + Math.min(right.stars, 20);
            return rightScore - leftScore;
        })
        .map(({ score: _score, ...project }) => project);
}

export function findRelevantGithubProjects(query: string, limit = 3): GithubProjectCard[] {
    const queryTerms = getMeaningfulQueryTerms(query);
    const exactMatches = getExactMatchProjects(query);
    if (exactMatches.length > 0) {
        return rankProjects(exactMatches.map((project) => ({ ...project, score: 1_000 })), queryTerms).slice(0, limit);
    }

    if (!query.trim()) return [];

    const searchQuery = queryTerms.length > 0 ? queryTerms.join(' ') : query;

    const searchResults = miniSearch.search(searchQuery, {
        prefix: true,
        fuzzy: searchQuery.trim().length >= 8 ? 0.15 : false,
        combineWith: 'OR',
        boost: {
            name: 8,
            fullName: 6,
            aliases: 6,
            keywords: 4,
            topics: 3,
            languages: 2,
            summary: 2,
            description: 1,
        },
    }) as Array<{ id: string; score: number }>;

    const matchedProjects = searchResults
        .map((result) => {
            const project = projectCards.find((candidate) => candidate.id === result.id);
            if (!project) return null;
            return { ...project, score: result.score };
        })
        .filter((project): project is ProjectSearchResult => project !== null);

    return rankProjects(matchedProjects, queryTerms).slice(0, limit);
}

export function formatGithubProjectsForPrompt(projects: GithubProjectCard[]): string | null {
    if (projects.length === 0) return null;

    const lines = projects.map((project, index) => {
        const extraSignals: string[] = [];
        if (project.featured) extraSignals.push('featured project');
        if (project.homepage) extraSignals.push('live deployment available');
        if (project.archived) extraSignals.push('archived');

        const tech = Array.from(new Set([project.primaryLanguage, ...project.languages, ...project.topics].filter(Boolean))).slice(0, 6);
        const techText = tech.length > 0 ? ` Tech: ${tech.join(', ')}.` : '';
        const signalsText = extraSignals.length > 0 ? ` Notes: ${extraSignals.join(', ')}.` : '';
        return `${index + 1}. ${project.name}: ${project.summary}${techText}${signalsText}`;
    });

    return `Use this GitHub project context only if it is relevant to the user's current question. Prefer exact project matches and do not invent repo details beyond this context.\n\n${lines.join('\n\n')}`;
}

export function getGithubProjectCatalogMeta(): GithubProjectsFile['meta'] {
    return githubProjectsFile.meta;
}