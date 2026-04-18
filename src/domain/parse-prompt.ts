import {
  DEFAULT_ESTIMATED_TRACK_MINUTES,
  DEFAULT_TARGET_TRACK_COUNT,
  MAX_TARGET_TRACK_COUNT,
  MIN_TARGET_TRACK_COUNT,
  type PromptSpec,
} from "./prompt-spec";
import { normalizeText, uniqueStrings } from "./filters";

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
  "forro",
  "forró",
  "piseiro",
  "sertanejo",
  "arrocha",
  "pagode",
  "funk",
  "funk brasil",
  "mpb",
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
const LANGUAGE_KEYWORDS = [
  "portuguese",
  "brazilian portuguese",
  "portugues",
  "português",
  "portugues brasileiro",
  "português brasileiro",
  "english",
  "spanish",
  "espanhol",
];
const STOPWORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "artistas",
  "artist",
  "artists",
  "build",
  "by",
  "cantores",
  "create",
  "creator",
  "desired",
  "featuring",
  "for",
  "from",
  "genre",
  "greatest",
  "have",
  "hits",
  "like",
  "make",
  "me",
  "music",
  "new",
  "only",
  "playlist",
  "popular",
  "similar",
  "singer",
  "singers",
  "songs",
  "song",
  "the",
  "top",
  "tracks",
  "track",
  "with",
]);

const ARTIST_SECTION_PATTERNS = [
  /\b(?:artists?\s+included|artists?|singers?|cantores?)\s*:\s*([\s\S]*?)(?:\n\s*\n|goal:|instructions:|prompt:|$)/gi,
  /\b(?:songs?|tracks?|playlist)\s+(?:from|by)\s+(?:the\s+)?(?:artists?|singers?|cantores?)?\s*:?\s*([^.!?\n]+)/gi,
];

const ARTIST_INLINE_PATTERNS = [
  /\b(?:artists?|singers?|cantores?)\s+(?:such as|like|including)\s+([^.!?\n]+)/gi,
  /\b(?:i really like|i like|i love|big fan of|fan of)\s+([^.!?\n]+)/gi,
  /\bfeaturing\s+([^.!?\n]+)/gi,
];

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
  const normalizedPrompt = normalizeText(prompt);
  return uniqueStrings(
    keywords.filter((keyword) => normalizedPrompt.includes(normalizeText(keyword))),
  );
}

function stripArtistTail(segment: string): string {
  return segment
    .replace(
      /\b(?:and|with)?\s*(?:similar artists?|similar singers?|artistas parecidos?|cantores parecidos?)\b.*$/i,
      "",
    )
    .replace(
      /\b(?:it should|they should|i want|quero|com|with|that has|which has|having)\b.*$/i,
      "",
    )
    .replace(/\b(?:their|its)\s+(?:top|biggest|greatest|most popular|new|recent)\b.*$/i, "")
    .trim();
}

function splitArtistList(value: string): string[] {
  const cleaned = stripArtistTail(value)
    .replace(/\r?\n/g, ",")
    .replace(/^[\s\-•]+/, "")
    .replace(/[()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned
    .split(/,|\band\b/gi)
    .map((part) => part.replace(/^[\s\-•]+/, "").trim())
    .map((part) =>
      part.replace(
        /^(?:about\s+\d+\s+songs?\s+from\s+(?:the\s+)?(?:artists?|singers?|cantores?)\s*:?\s*)/i,
        "",
      ),
    )
    .map((part) =>
      part.replace(
        /^(?:the\s+)?(?:artists?|singers?|cantores?|songs?|tracks?|playlist)\s+(?:from|by)\s+/i,
        "",
      ),
    )
    .map((part) => part.replace(/^(?:big fan of|fan of|i really like|i like|i love)\s+/i, ""))
    .map((part) => part.replace(/^(?:artists?|singers?|cantores?)\s+/i, ""))
    .map((part) => part.replace(/[.;:!?]+$/, "").trim())
    .filter((part) => part.length > 1);
}

function extractArtists(prompt: string): string[] {
  const segments: string[] = [];

  for (const pattern of ARTIST_SECTION_PATTERNS) {
    for (const match of prompt.matchAll(pattern)) {
      const captured = match[1]?.trim();

      if (captured) {
        segments.push(captured);
      }
    }
  }

  for (const pattern of ARTIST_INLINE_PATTERNS) {
    for (const match of prompt.matchAll(pattern)) {
      const captured = match[1]?.trim();

      if (captured) {
        segments.push(captured);
      }
    }
  }

  return uniqueStrings(segments.flatMap(splitArtistList));
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
    normalizeText(prompt)
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
  const includeOnlyRequestedArtists =
    /\b(?:only|just|exclusively)\b[\s\S]{0,40}\b(?:songs?|tracks?)\b[\s\S]{0,20}\b(?:from|by)\b/i.test(
      normalizedPrompt,
    ) || /\bonly (?:the )?(?:requested|desired) artists\b/i.test(normalizedPrompt);
  const includeSimilarArtists =
    /\b(?:similar artists?|similar singers?|artistas parecidos?|cantores parecidos?)\b/i.test(
      normalizedPrompt,
    ) ||
    /\b(?:artists?|singers?|cantores?)\s+(?:such as|like)\b/i.test(normalizedPrompt);
  const preferPopularTracks =
    /\b(?:top hits?|biggest hits?|greatest hits?|most popular|popular songs?|maiores sucessos|sucessos)\b/i.test(
      normalizedPrompt,
    ) || /\btop\b[\s\S]{0,20}\bhits?\b/i.test(normalizedPrompt);
  const preferRecentTracks =
    /\b(?:new hits?|latest hits?|recent hits?|new songs?|latest songs?|recent songs?|hits? novos?|novos sucessos|lancamentos|lançamentos)\b/i.test(
      normalizedPrompt,
    );

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

  const languages = extractKeywords(lowerPrompt, LANGUAGE_KEYWORDS);
  const genres = extractKeywords(lowerPrompt, GENRE_KEYWORDS);
  const styles = extractKeywords(lowerPrompt, STYLE_KEYWORDS);
  const activities = extractKeywords(lowerPrompt, ACTIVITY_KEYWORDS);
  const artists = extractArtists(normalizedPrompt);
  const strictArtistMatch = artists.length > 0 && !includeSimilarArtists;
  const strictLanguageMatch = languages.length > 0;
  const explicitPlaylistName = extractPlaylistName(normalizedPrompt);
  const seedTerms = uniqueStrings([
    ...artists,
    ...languages,
    ...styles,
    ...activities,
    ...genres,
    ...(preferPopularTracks ? ["top hits", "popular"] : []),
    ...(preferRecentTracks ? ["new hits", "recent"] : []),
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
    similarArtists: [],
    languages,
    genres,
    styles,
    activities,
    seedTerms,
    playlistNameHint,
    strictArtistMatch,
    strictLanguageMatch,
    includeOnlyRequestedArtists,
    excludeSimilarArtistCollabsWithRequested: true,
    includeSimilarArtists: includeSimilarArtists && !includeOnlyRequestedArtists,
    requestedArtistTargetShare: undefined,
    preferPopularTracks,
    preferRecentTracks,
    interpretationSource: "heuristic",
    isPrivate: true,
  };
}
