import data from './data.json';
import { hasExplicitGithubProjectMatch } from './githubProjects';

const PROFILE_SUMMARY = data['profile:summary'] ?? '';
const PROFILE_SKILLS = data['profile:skills'] ?? '';
const PROFILE_EXPERIENCE = data['profile:experience'] ?? '';

function normalizeText(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function shouldUseProfileContext(query: string): boolean {
    const normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return false;
    if (hasExplicitGithubProjectMatch(query)) return false;

    const identityPatterns = [
        'who are you',
        'tell me about yourself',
        'introduce yourself',
        'what do you do',
        'what kind of engineer',
        'what is your background',
        'what is your experience',
        'where are you based',
        'what are your skills',
        'what do you work on',
    ];

    return identityPatterns.some((pattern) => normalizedQuery.includes(pattern));
}

export function formatProfileContextForPrompt(query: string): string | null {
    if (!shouldUseProfileContext(query) || !PROFILE_SUMMARY.trim()) {
        return null;
    }

    return [
        'Use this profile context for the current question.',
        'Answer in first person as Yubi, not as a generic AI assistant.',
        'If the user asks who you are, introduce yourself as Yubi, a Senior Software and AI Engineer, using only the facts in this context.',
        'Do not describe yourself as a general assistant who can chat about anything.',
        '',
        `Summary: ${PROFILE_SUMMARY}`,
        '',
        `Skills: ${PROFILE_SKILLS}`,
        '',
        `Experience: ${PROFILE_EXPERIENCE}`,
    ].join('\n');
}