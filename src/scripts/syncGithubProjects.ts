import dotenv from 'dotenv';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import syncConfig from '../knowledge/github-projects.config.json';

dotenv.config();

type GithubRepo = {
    name: string;
    full_name: string;
    private: boolean;
    fork: boolean;
    archived: boolean;
    description: string | null;
    html_url: string;
    homepage: string | null;
    language: string | null;
    topics?: string[];
    stargazers_count: number;
    pushed_at: string;
    created_at: string;
    updated_at: string;
};

type GithubLanguages = Record<string, number>;

type GithubProjectCard = {
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

type SyncConfig = {
    featuredRepos?: string[];
    aliases?: Record<string, string[]>;
    excludedRepos?: string[];
};

const GITHUB_API_BASE = 'https://api.github.com';
const OUTPUT_PATH = path.resolve(process.cwd(), 'src/knowledge/github-projects.generated.json');
const GITHUB_USERNAME = process.env.GITHUB_USERNAME ?? 'yubi00';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const projectSyncConfig = syncConfig as SyncConfig;

if (!GITHUB_TOKEN) {
    throw new Error('Missing required environment variable: GITHUB_TOKEN');
}

async function fetchGithubJson<T>(pathname: string): Promise<T> {
    const response = await fetch(`${GITHUB_API_BASE}${pathname}`, {
        headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'yubi-portfolio-voice-service',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    });

    if (!response.ok) {
        throw new Error(`GitHub API request failed (${response.status} ${response.statusText}) for ${pathname}`);
    }

    return response.json() as Promise<T>;
}

async function listUserRepos(username: string): Promise<GithubRepo[]> {
    const repos: GithubRepo[] = [];

    for (let page = 1; ; page += 1) {
        const batch = await fetchGithubJson<GithubRepo[]>(
            `/users/${username}/repos?per_page=100&page=${page}&sort=updated&type=owner`,
        );

        if (batch.length === 0) break;
        repos.push(...batch);

        if (batch.length < 100) break;
    }

    return repos;
}

async function getRepoLanguages(owner: string, repo: string): Promise<string[]> {
    const languages = await fetchGithubJson<GithubLanguages>(`/repos/${owner}/${repo}/languages`);
    return Object.entries(languages)
        .sort((left, right) => right[1] - left[1])
        .map(([language]) => language)
        .slice(0, 4);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let index = 0;

    async function worker(): Promise<void> {
        while (index < items.length) {
            const currentIndex = index;
            index += 1;
            const item = items[currentIndex];
            if (item === undefined) continue;
            results[currentIndex] = await mapper(item);
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
    return results;
}

function summarizeRepo(repo: GithubRepo, languages: string[]): string {
    const summaryParts: string[] = [];

    if (repo.description?.trim()) {
        summaryParts.push(repo.description.trim().replace(/\.$/, ''));
    } else {
        summaryParts.push('Portfolio repository');
    }

    const tech = Array.from(new Set([repo.language, ...languages, ...(repo.topics ?? [])].filter(Boolean as unknown as <T>(value: T | null | undefined) => value is T)));
    if (tech.length > 0) {
        summaryParts.push(`Tech: ${tech.slice(0, 6).join(', ')}`);
    }

    if (repo.archived) {
        summaryParts.push('Archived project');
    }

    if (repo.stargazers_count > 0) {
        summaryParts.push(`Stars: ${repo.stargazers_count}`);
    }

    return `${repo.name}: ${summaryParts.join('. ')}.`;
}

function normalizeText(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function extractKeywords(repo: GithubRepo, languages: string[], aliases: string[]): string[] {
    const descriptionTokens = (repo.description ?? '')
        .toLowerCase()
        .split(/[^a-z0-9+#.-]+/)
        .filter((token) => token.length >= 3);

    return Array.from(new Set([
        ...(repo.topics ?? []),
        ...languages,
        ...(repo.language ? [repo.language] : []),
        ...aliases,
        ...descriptionTokens,
    ].map((value) => normalizeText(value)).filter(Boolean)));
}

function toProjectCard(repo: GithubRepo, languages: string[]): GithubProjectCard {
    const aliases = projectSyncConfig.aliases?.[repo.name] ?? [];
    const featuredRepoSet = new Set(projectSyncConfig.featuredRepos ?? []);
    return {
        id: repo.full_name,
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description?.trim() ?? 'Portfolio repository',
        summary: summarizeRepo(repo, languages),
        url: repo.html_url,
        homepage: repo.homepage,
        primaryLanguage: repo.language,
        languages,
        topics: repo.topics ?? [],
        stars: repo.stargazers_count,
        archived: repo.archived,
        featured: featuredRepoSet.has(repo.name),
        aliases,
        keywords: extractKeywords(repo, languages, aliases),
        pushedAt: repo.pushed_at,
        updatedAt: repo.updated_at,
    };
}

async function main(): Promise<void> {
    console.log(`Syncing GitHub projects for ${GITHUB_USERNAME}...`);
    const repos = await listUserRepos(GITHUB_USERNAME);
    const excludedRepoSet = new Set(projectSyncConfig.excludedRepos ?? []);

    const relevantRepos = repos
        .filter((repo) => !repo.private && !repo.fork && !excludedRepoSet.has(repo.name))
        .sort((left, right) => Date.parse(right.pushed_at) - Date.parse(left.pushed_at));

    const projectCards = await mapWithConcurrency(relevantRepos, 5, async (repo) => {
        const languages = await getRepoLanguages(GITHUB_USERNAME, repo.name);
        return toProjectCard(repo, languages);
    });

    const output = {
        meta: {
            username: GITHUB_USERNAME,
            lastSyncedAt: new Date().toISOString(),
            repoCount: projectCards.length,
        },
        projects: projectCards,
    };

    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${projectCards.length} repositories to ${OUTPUT_PATH}`);
}

main().catch((error) => {
    console.error('GitHub sync failed:', error);
    process.exitCode = 1;
});