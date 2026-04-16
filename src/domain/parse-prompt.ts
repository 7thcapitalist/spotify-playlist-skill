import {
  DEFAULT_ESTIMATED_TRACK_MINUTES,
  DEFAULT_TARGET_TRACK_COUNT,
  MAX_TARGET_TRACK_COUNT,
  MIN_TARGET_TRACK_COUNT,
  type PromptSpec,
} from "./prompt-spec";
import { uniqueStrings } from "./filters";

const GENRE_KEYWORDS = [
  "rap",
  "hip hop",
  "electronic",
  "edm",
  "house",
  "techno",
  "trap",
  "drill",
  "pop",
  "rock",
  "indie",
  "ambient",
  "jazz",
  "piano",
  "classical",
  "lofi",
  "lo-fi",
  "brazilian",
  "samba",
  "bossa nova",
  "latin",
  "r&b",
];

const STYLE_KEYWORDS = [
  "chill",
  "calm",
  "night drive",
  "study",
  "focus",
  "gym",
  "workout",
  "energetic",
  "upbeat",
  "party",
  "sleep",
  "cinematic",
  "melancholic",
  "romantic",
  "driving",
];

const ACTIVITY_KEYWORDS = ["study", "focus", "gym", "workout", "night drive", "driving"];
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "build",
  "create",
  "for",
  "make",
  "me",
  "music",
  "playlist",
  "songs",
  "song",
  "the",
  "tracks",
  "track",
  "with",
]);

function clampTrackCount(value: number): number {
  return Math.min(MAX_TARGET_TRACK_COUNT, Math.max(MIN_TARGET_TRACK_COUNT, value));
}

function extractNumber(regexes: RegExp[], prompt: string): number | undefined {
  for (const regex of regexes) {
    const match = prompt.match(regex);

    if (match) {
      return Number(match[1]);
    }
  }

  return undefined;
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function extractKeywords(prompt: string, keywords: string[]): string[] {
  const normalized = prompt.toLowerCase();
  return uniqueStrings(keywords.filter((keyword) => normalized.includes(keyword)));
}

function extractArtists(prompt: string): string[] {
  const sectionMatch = prompt.match(/artists included:\s*([\s\S]*?)(?:goal:|instructions:|$)/i);
  const structuredArtists = sectionMatch
    ? sectionMatch[1]
        .split(/\r?\n|,/)
        .map((part) => part.replace(/^[\s\-•]+/, "").trim())
        .map((part) => part.replace(/\..*$/, "").trim())
        .map((part) => part.replace(/[.;]+$/, "").trim())
        .filter((part) => part.length > 1)
    : [];

  const preferencePrompt = prompt.replace(
    /\b(?:artists included:|i really like|i like|i love|big fan of|fan of)\b/gi,
    "|",
  );
  const preferenceArtists = preferencePrompt
    .split("|")
    .slice(1)
    .flatMap((segment) => segment.split(/[.!?]/).slice(0, 1))
    .flatMap((segment) => segment.split(/,|\sand\s/))
    .map((part) => part.replace(/^[\s\-•]+/, "").trim())
    .map((part) => part.replace(/\b(?:just do|please do|do)\b.*$/i, "").trim())
    .map((part) => part.replace(/[.;]+$/, "").trim())
    .filter((part) => part.length > 1);

  return uniqueStrings([...structuredArtists, ...preferenceArtists]);
}

function extractPlaylistName(prompt: string): string | undefined {
  const quotedMatch = prompt.match(/playlist called\s+"([^"]+)"/i);

  if (quotedMatch) {
    return quotedMatch[1].trim();
  }

  const plainMatch = prompt.match(/playlist called\s+(.+?)(?:\s+for\b|\.|$)/i);

  return plainMatch?.[1]?.trim();
}

function extractFallbackTerms(prompt: string): string[] {
  return uniqueStrings(
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((part) => part.length > 2 && !STOPWORDS.has(part) && Number.isNaN(Number(part))),
  ).slice(0, 6);
}

export function parsePrompt(prompt: string): PromptSpec {
  const normalizedPrompt = prompt.trim();

  if (!normalizedPrompt) {
    throw new Error("A playlist prompt is required.");
  }

  const lowerPrompt = normalizedPrompt.toLowerCase();
  const explicitOff = /(no explicit|non explicit|clean playlist|clean songs|without explicit|no swearing)/i.test(
    lowerPrompt,
  );
  const explicitOn = /\bexplicit\b/i.test(lowerPrompt);

  const targetDurationMinutes = extractNumber(
    [
      /(\d+)\s*-\s*minute/i,
      /(\d+)\s*(minute|minutes|min|mins)\b/i,
    ],
    normalizedPrompt,
  );

  const targetTrackCount = extractNumber(
    [
      /(\d+)\s*-\s*(song|songs|track|tracks)\b/i,
      /(\d+)\s*(song|songs|track|tracks)\b/i,
    ],
    normalizedPrompt,
  );

  const genres = extractKeywords(lowerPrompt, GENRE_KEYWORDS);
  const styles = extractKeywords(lowerPrompt, STYLE_KEYWORDS);
  const activities = extractKeywords(lowerPrompt, ACTIVITY_KEYWORDS);
  const artists = extractArtists(normalizedPrompt);
  const explicitPlaylistName = extractPlaylistName(normalizedPrompt);
  const seedTerms = uniqueStrings([
    ...artists,
    ...styles,
    ...activities,
    ...genres,
    ...extractFallbackTerms(lowerPrompt),
  ]);

  const derivedTrackCount =
    targetTrackCount ??
    (targetDurationMinutes
      ? Math.round(targetDurationMinutes / DEFAULT_ESTIMATED_TRACK_MINUTES)
      : DEFAULT_TARGET_TRACK_COUNT);

  const playlistNameHint =
    explicitPlaylistName ??
    (uniqueStrings([...artists, ...styles, ...activities, ...genres])
      .slice(0, 4)
      .map(toTitleCase)
      .join(" ") || "Custom Prompt");

  return {
    rawPrompt: normalizedPrompt,
    targetTrackCount: clampTrackCount(derivedTrackCount),
    targetDurationMinutes,
    allowExplicit: explicitOn ? !explicitOff : !explicitOff,
    artists,
    genres,
    styles,
    activities,
    seedTerms,
    playlistNameHint,
    isPrivate: true,
  };
}
