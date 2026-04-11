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
    signals: ProjectSignals;
    initiative: ProjectInitiative | null;
    aliases: string[];
    keywords: string[];
    pushedAt: string;
    updatedAt: string;
};

type ProjectInitiative = {
    name: string;
    role: string;
    summary: string;
};

type ProjectSignals = {
    proudOf: number;
    recommendedFirstLook: number;
    aiShowcase: number;
    orchestration: number;
    backendShowcase: number;
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

type QueryIntent = {
    proudOf: boolean;
    recommendedFirstLook: boolean;
    aiShowcase: boolean;
    orchestration: boolean;
    backendShowcase: boolean;
};

export function shouldUseGithubProjectContext(query: string): boolean {
    const queryTerms = getMeaningfulQueryTerms(query);
    const queryIntent = inferQueryIntent(query, queryTerms);
    const exactMatches = getExactMatchProjects(query);

    if (exactMatches.length > 0) return true;
    if (queryIntent.proudOf || queryIntent.recommendedFirstLook) return false;
    return true;
}

export function hasExplicitGithubProjectMatch(query: string): boolean {
    return getExactMatchProjects(query).length > 0;
}

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

    const exactMatches = projectCards.filter((project) => {
        const candidateValues = [project.name, project.fullName, ...project.aliases].map(normalizeText);
        return candidateValues.some((candidate) => candidate.length > 0 && normalizedQuery === candidate);
    });

    if (exactMatches.length > 0) {
        return exactMatches;
    }

    const partialMatches = projectCards
        .map((project) => {
            const candidateValues = [project.name, project.fullName, ...project.aliases].map(normalizeText);
            const bestMatchLength = candidateValues.reduce((longest, candidate) => {
                if (!candidate.length) return longest;
                if (normalizedQuery.includes(candidate) || candidate.includes(normalizedQuery)) {
                    return Math.max(longest, candidate.length);
                }
                return longest;
            }, 0);

            if (bestMatchLength === 0) return null;
            return { project, bestMatchLength };
        })
        .filter((match): match is { project: GithubProjectCard; bestMatchLength: number } => match !== null);

    if (partialMatches.length === 0) {
        return [];
    }

    const maxMatchLength = Math.max(...partialMatches.map((match) => match.bestMatchLength));
    return partialMatches
        .filter((match) => match.bestMatchLength === maxMatchLength)
        .map((match) => match.project);
}

function getMeaningfulQueryTerms(query: string): string[] {
    return normalizeText(query)
        .split(' ')
        .filter((term) => term.length >= 2 && !STOP_WORDS.has(term));
}

function inferQueryIntent(query: string, queryTerms: string[]): QueryIntent {
    const normalizedQuery = normalizeText(query);
    const hasAny = (terms: string[]) => terms.some((term) => normalizedQuery.includes(term) || queryTerms.includes(term));

    return {
        proudOf: hasAny(['proud', 'favorite', 'favourite', 'best project', 'most proud']),
        recommendedFirstLook: hasAny(['start with', 'look at first', 'should i look at', 'recommend', 'best project']),
        aiShowcase: hasAny(['ai', 'llm', 'agent', 'agents', 'rag', 'openai', 'bedrock', 'voice']),
        orchestration: hasAny(['orchestration', 'multi agent', 'multi-agent', 'agentic', 'workflow', 'planner', 'executor']),
        backendShowcase: hasAny(['backend', 'architecture', 'serverless', 'api', 'graphql', 'distributed']),
    };
}

function rankProjects(projects: ProjectSearchResult[], queryTerms: string[] = [], intent?: QueryIntent): GithubProjectCard[] {
    return [...projects]
        .sort((left, right) => {
            const leftKeywords = new Set([normalizeText(left.name), ...left.keywords]);
            const rightKeywords = new Set([normalizeText(right.name), ...right.keywords]);
            const leftQueryBoost = queryTerms.reduce((sum, term) => sum + (leftKeywords.has(term) ? 25 : 0), 0);
            const rightQueryBoost = queryTerms.reduce((sum, term) => sum + (rightKeywords.has(term) ? 25 : 0), 0);
            const leftIntentBoost = getIntentBoost(left.signals, intent);
            const rightIntentBoost = getIntentBoost(right.signals, intent);
            const leftScore = left.score + leftQueryBoost + leftIntentBoost + (left.featured ? 100 : 0) + Math.min(left.stars, 20);
            const rightScore = right.score + rightQueryBoost + rightIntentBoost + (right.featured ? 100 : 0) + Math.min(right.stars, 20);
            return rightScore - leftScore;
        })
        .map(({ score: _score, ...project }) => project);
}

function getIntentBoost(signals: ProjectSignals, intent?: QueryIntent): number {
    if (!intent) return 0;

    let boost = 0;
    if (intent.proudOf) boost += signals.proudOf * 30;
    if (intent.recommendedFirstLook) boost += signals.recommendedFirstLook * 25;
    if (intent.aiShowcase) boost += signals.aiShowcase * 18;
    if (intent.orchestration) boost += signals.orchestration * 20;
    if (intent.backendShowcase) boost += signals.backendShowcase * 16;
    return boost;
}

function getIntentSeedProjects(intent: QueryIntent): ProjectSearchResult[] {
    const hasIntent = Object.values(intent).some(Boolean);
    if (!hasIntent) return [];

    return projectCards
        .map((project) => ({
            ...project,
            score: getIntentBoost(project.signals, intent),
        }))
        .filter((project) => project.score > 0);
}

export function findRelevantGithubProjects(query: string, limit = 3): GithubProjectCard[] {
    const queryTerms = getMeaningfulQueryTerms(query);
    const queryIntent = inferQueryIntent(query, queryTerms);
    const exactMatches = getExactMatchProjects(query);
    if (exactMatches.length > 0) {
        return rankProjects(exactMatches.map((project) => ({ ...project, score: 1_000 })), queryTerms, queryIntent).slice(0, limit);
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

    const mergedProjects = new Map<string, ProjectSearchResult>();
    for (const project of [...matchedProjects, ...getIntentSeedProjects(queryIntent)]) {
        const existing = mergedProjects.get(project.id);
        if (!existing || project.score > existing.score) {
            mergedProjects.set(project.id, project);
        }
    }

    return rankProjects([...mergedProjects.values()], queryTerms, queryIntent).slice(0, limit);
}

export function formatGithubProjectsForPrompt(projects: GithubProjectCard[]): string | null {
    if (projects.length === 0) return null;

    const lines = projects.map((project, index) => {
        const extraSignals: string[] = [];
        if (project.featured) extraSignals.push('featured project');
        if (project.homepage) extraSignals.push('live deployment available');
        if (project.archived) extraSignals.push('archived');
        if (project.initiative) extraSignals.push(`part of ${project.initiative.name} (${project.initiative.role})`);

        const tech = Array.from(new Set([project.primaryLanguage, ...project.languages, ...project.topics].filter(Boolean))).slice(0, 6);
        const techText = tech.length > 0 ? ` Tech: ${tech.join(', ')}.` : '';
        const initiativeText = project.initiative ? ` Initiative: ${project.initiative.name} — ${project.initiative.summary}.` : '';
        const signalsText = extraSignals.length > 0 ? ` Notes: ${extraSignals.join(', ')}.` : '';
        return `${index + 1}. ${project.name}: ${project.summary}${initiativeText}${techText}${signalsText}`;
    });

    return `Use this GitHub project context only if it is relevant to the user's current question. Prefer exact project matches and do not invent repo details beyond this context.\n\n${lines.join('\n\n')}`;
}

export function getGithubProjectCatalogMeta(): GithubProjectsFile['meta'] {
    return githubProjectsFile.meta;
}