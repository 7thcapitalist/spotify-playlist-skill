import type { PlaylistSelection, TrackCandidate } from "../types";
import type { PromptSpec } from "./prompt-spec";
import {
  dedupeCandidates,
  filterExplicitTracks,
  normalizeText,
  totalDurationMs,
  uniqueStrings,
} from "./filters";

const MAX_QUERY_LENGTH = 240;
const LANGUAGE_MARKERS: Record<string, string[]> = {
  portuguese: [
    "amor",
    "saudade",
    "pra",
    "voce",
    "vida",
    "nao",
    "coracao",
    "de",
    "do",
    "da",
  ],
  "brazilian portuguese": [
    "amor",
    "saudade",
    "pra",
    "voce",
    "vida",
    "nao",
    "coracao",
    "de",
    "do",
    "da",
  ],
  portugues: [
    "amor",
    "saudade",
    "pra",
    "voce",
    "vida",
    "nao",
    "coracao",
    "de",
    "do",
    "da",
  ],
  "portugues brasileiro": [
    "amor",
    "saudade",
    "pra",
    "voce",
    "vida",
    "nao",
    "coracao",
    "de",
    "do",
    "da",
  ],
  english: ["love", "the", "you", "night", "heart", "baby", "with", "without"],
  spanish: ["amor", "corazon", "vida", "que", "sin", "con", "para"],
  espanhol: ["amor", "corazon", "vida", "que", "sin", "con", "para"],
};

function clampQueryLength(query: string): string {
  if (query.length <= MAX_QUERY_LENGTH) {
    return query;
  }

  return query.slice(0, MAX_QUERY_LENGTH).trim();
}

export function buildSearchQueries(spec: PromptSpec): string[] {
  const weightedTerms = uniqueStrings([
    ...spec.artists,
    ...spec.styles,
    ...spec.activities,
    ...spec.genres,
    ...spec.languages,
  ]);
  const genreAndLanguageTerms = uniqueStrings([...spec.genres, ...spec.languages]);
  const intentTerms = uniqueStrings([
    ...(spec.preferPopularTracks ? ["top hits", "popular songs"] : []),
    ...(spec.preferRecentTracks ? ["new hits", "recent releases"] : []),
  ]);
  const artistFocusedQueries =
    spec.artists.length > 0
      ? uniqueStrings([
          weightedTerms.slice(0, 6).join(" "),
          uniqueStrings([...spec.artists, ...genreAndLanguageTerms, ...spec.styles]).slice(0, 5).join(" "),
          ...spec.artists.map((artist) =>
            [artist, ...genreAndLanguageTerms.slice(0, 3), ...intentTerms.slice(0, 1)]
              .filter(Boolean)
              .join(" "),
          ),
          ...spec.artists.map((artist) =>
            [artist, "greatest hits", ...genreAndLanguageTerms.slice(0, 2)].filter(Boolean).join(" "),
          ),
          ...spec.artists.map((artist) =>
            [artist, "top hits", ...genreAndLanguageTerms.slice(0, 2)].filter(Boolean).join(" "),
          ),
          ...spec.artists.map((artist) =>
            spec.preferRecentTracks ? `${artist} recent releases` : `${artist} new hits`,
          ),
          spec.seedTerms.slice(0, 6).join(" "),
        ])
      : [];

  if (artistFocusedQueries.length > 0) {
    return artistFocusedQueries.map(clampQueryLength).filter(Boolean).slice(0, 10);
  }

  const queries = uniqueStrings([
    weightedTerms.slice(0, 6).join(" "),
    uniqueStrings([...spec.artists, ...genreAndLanguageTerms, ...spec.styles]).slice(0, 5).join(" "),
    ...spec.artists.map((artist) =>
      [artist, ...genreAndLanguageTerms.slice(0, 3), ...intentTerms.slice(0, 1)].filter(Boolean).join(" "),
    ),
    ...spec.artists.map((artist) =>
      [artist, "greatest hits", ...genreAndLanguageTerms.slice(0, 2)].filter(Boolean).join(" "),
    ),
    ...spec.artists.map((artist) =>
      [artist, "top hits", ...genreAndLanguageTerms.slice(0, 2)].filter(Boolean).join(" "),
    ),
    ...spec.artists.map((artist) =>
      spec.preferRecentTracks ? `${artist} recent releases` : `${artist} new hits`
    ),
    ...spec.activities.map((activity) =>
      [activity, ...spec.styles.slice(0, 2), ...genreAndLanguageTerms.slice(0, 2)].filter(Boolean).join(" "),
    ),
    ...spec.styles.map((style) =>
      [style, ...genreAndLanguageTerms.slice(0, 3), ...intentTerms.slice(0, 1)].filter(Boolean).join(" "),
    ),
    ...genreAndLanguageTerms.map((term) =>
      [term, ...spec.styles.slice(0, 2), ...intentTerms.slice(0, 1)].filter(Boolean).join(" "),
    ),
    spec.seedTerms.slice(0, 6).join(" "),
  ]);

  return queries.map(clampQueryLength).filter(Boolean).slice(0, 10);
}

function getRecentnessScore(candidate: TrackCandidate): number {
  if (!candidate.releaseDate) {
    return 0.25;
  }

  const releaseTime = Date.parse(candidate.releaseDate);

  if (Number.isNaN(releaseTime)) {
    return 0.25;
  }

  const ageInDays = Math.max(0, (Date.now() - releaseTime) / 86_400_000);

  if (ageInDays <= 180) {
    return 1;
  }

  if (ageInDays <= 365) {
    return 0.8;
  }

  if (ageInDays <= 730) {
    return 0.6;
  }

  if (ageInDays <= 1460) {
    return 0.4;
  }

  return 0.2;
}

function scoreCandidate(candidate: TrackCandidate, spec: PromptSpec): number {
  const matchScore = candidate.matchTerms.length / Math.max(spec.seedTerms.length, 1);
  const popularityScore = candidate.popularity / 100;
  const searchRankScore = Math.max(0, 1 - candidate.searchRank / 20);
  const recentScore = getRecentnessScore(candidate);

  let durationScore = 0.5;

  if (spec.targetDurationMinutes) {
    const idealTrackLengthMs =
      (spec.targetDurationMinutes * 60_000) / Math.max(spec.targetTrackCount, 1);
    const delta = Math.abs(candidate.durationMs - idealTrackLengthMs);
    durationScore = Math.max(0, 1 - delta / idealTrackLengthMs);
  }

  const requestedArtistBonus = candidate.requestedArtist ? 0.3 : 0;
  const relatedArtistBonus = candidate.seedArtistKind === "related" ? 0.12 : 0;
  const popularityWeight = spec.preferPopularTracks ? 0.38 : 0.28;
  const recentWeight = spec.preferRecentTracks ? 0.18 : 0.06;

  return (
    matchScore * 0.28 +
    popularityScore * popularityWeight +
    searchRankScore * 0.15 +
    durationScore * 0.1 +
    recentScore * recentWeight +
    requestedArtistBonus +
    relatedArtistBonus
  );
}

function getArtistKey(candidate: TrackCandidate): string {
  return normalizeText(candidate.artistNames[0] ?? candidate.name);
}

function normalizeArtistIdentity(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/\be\b/g, " ")
    .replace(/\band\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function candidateMatchesRequestedArtists(candidate: TrackCandidate, spec: PromptSpec): boolean {
  if (spec.artists.length === 0) {
    return true;
  }

  const requestedArtists = spec.artists.map(normalizeArtistIdentity);
  const candidateArtists = candidate.artistNames.map(normalizeArtistIdentity);
  const primaryArtist = candidateArtists[0] ?? "";
  const primaryArtistId = candidate.artistIds[0];

  if (candidate.requestedArtistId) {
    return spec.strictArtistMatch
      ? primaryArtistId === candidate.requestedArtistId
      : candidate.artistIds.includes(candidate.requestedArtistId);
  }

  if (spec.strictArtistMatch) {
    return requestedArtists.some(
      (requestedArtist) =>
        primaryArtist === requestedArtist ||
        primaryArtist.includes(requestedArtist) ||
        requestedArtist.includes(primaryArtist),
    );
  }

  return candidateArtists.some((candidateArtist) =>
    requestedArtists.some(
      (requestedArtist) =>
        candidateArtist === requestedArtist ||
        candidateArtist.includes(requestedArtist) ||
        requestedArtist.includes(candidateArtist),
    ),
  );
}

function isRequestedArtistTrack(candidate: TrackCandidate, spec: PromptSpec): boolean {
  if (spec.artists.length === 0) {
    return false;
  }

  if (candidateMatchesRequestedArtists(candidate, spec)) {
    return true;
  }

  const requestedArtists = spec.artists.map(normalizeArtistIdentity);
  const candidateArtists = candidate.artistNames.map(normalizeArtistIdentity);

  return candidateArtists.some((candidateArtist) =>
    requestedArtists.some(
      (requestedArtist) =>
        candidateArtist === requestedArtist ||
        candidateArtist.includes(requestedArtist) ||
        requestedArtist.includes(candidateArtist),
    ),
  );
}

function candidateMatchesArtistIntent(candidate: TrackCandidate, spec: PromptSpec): boolean {
  if (spec.artists.length === 0) {
    return true;
  }

  if (candidateMatchesRequestedArtists(candidate, spec)) {
    return true;
  }

  if (spec.includeSimilarArtists && candidate.seedArtistKind === "related") {
    return true;
  }

  return !spec.includeOnlyRequestedArtists && spec.artists.length === 0;
}

function candidateMatchesLanguageIntent(candidate: TrackCandidate, spec: PromptSpec): boolean {
  if (!spec.strictLanguageMatch || spec.languages.length === 0) {
    return true;
  }

  if (candidate.requestedArtist || candidate.seedArtistKind === "related") {
    return true;
  }

  const candidateText = normalizeText(
    [candidate.name, candidate.albumName, ...candidate.artistNames].join(" "),
  );

  return spec.languages.some((language) => {
    const markers = LANGUAGE_MARKERS[normalizeText(language)] ?? [];

    if (markers.length === 0) {
      return true;
    }

    return markers.some((marker) => candidateText.includes(marker));
  });
}

function balancedSelectAcrossRequestedArtists(
  spec: PromptSpec,
  scored: Array<{ candidate: TrackCandidate; score: number }>,
): TrackCandidate[] {
  if (spec.artists.length === 0) {
    return [];
  }

  const byRequestedArtist = new Map<string, Array<{ candidate: TrackCandidate; score: number }>>();

  for (const entry of scored) {
    const requestedArtist = entry.candidate.requestedArtist;

    if (!requestedArtist) {
      continue;
    }

    const bucket = byRequestedArtist.get(requestedArtist) ?? [];
    bucket.push(entry);
    byRequestedArtist.set(requestedArtist, bucket);
  }

  const selected: TrackCandidate[] = [];
  const seenUris = new Set<string>();
  let exhaustedArtistsInPass = 0;

  while (selected.length < spec.targetTrackCount && exhaustedArtistsInPass < spec.artists.length) {
    exhaustedArtistsInPass = 0;

    for (const artist of spec.artists) {
      const bucket = byRequestedArtist.get(artist) ?? [];

      while (bucket.length > 0 && seenUris.has(bucket[0].candidate.uri)) {
        bucket.shift();
      }

      if (bucket.length === 0) {
        exhaustedArtistsInPass += 1;
        continue;
      }

      const next = bucket.shift();

      if (!next) {
        exhaustedArtistsInPass += 1;
        continue;
      }

      selected.push(next.candidate);
      seenUris.add(next.candidate.uri);

      if (selected.length >= spec.targetTrackCount) {
        break;
      }
    }
  }

  return selected;
}

function enforceRequestedArtistTargetShare(
  spec: PromptSpec,
  scored: Array<{ candidate: TrackCandidate; score: number }>,
  selected: TrackCandidate[],
): TrackCandidate[] {
  if (
    !spec.includeSimilarArtists ||
    spec.artists.length !== 1 ||
    spec.requestedArtistTargetShare === undefined
  ) {
    return selected;
  }

  const targetRequestedCount = Math.round(spec.targetTrackCount * spec.requestedArtistTargetShare);
  const requestedTracks = selected.filter((candidate) => isRequestedArtistTrack(candidate, spec));
  const relatedTracks = selected.filter((candidate) => candidate.seedArtistKind === "related");

  if (requestedTracks.length <= targetRequestedCount || relatedTracks.length === 0) {
    return selected;
  }

  const selectedUris = new Set(selected.map((candidate) => candidate.uri));
  const replacementPool = scored
    .map((entry) => entry.candidate)
    .filter(
      (candidate) =>
        !selectedUris.has(candidate.uri) &&
        candidate.seedArtistKind === "related",
    );

  const trimmedRequested = [...requestedTracks]
    .sort((left, right) => right.popularity - left.popularity)
    .slice(0, targetRequestedCount);
  const preservedOther = selected.filter(
    (candidate) => !isRequestedArtistTrack(candidate, spec) || candidate.seedArtistKind === "related",
  );
  const repaired = [...trimmedRequested, ...preservedOther];

  for (const candidate of replacementPool) {
    if (repaired.length >= spec.targetTrackCount) {
      break;
    }

    if (repaired.some((track) => track.uri === candidate.uri)) {
      continue;
    }

    repaired.push(candidate);
  }

  return repaired.slice(0, spec.targetTrackCount);
}

export function selectTracks(spec: PromptSpec, candidates: TrackCandidate[]): PlaylistSelection {
  const uniqueCandidates = dedupeCandidates(candidates);
  const { candidates: explicitSafeCandidates, removedCount } = filterExplicitTracks(
    uniqueCandidates,
    spec.allowExplicit,
  );
  const artistMatchedCandidates = explicitSafeCandidates.filter((candidate) =>
    candidateMatchesArtistIntent(candidate, spec),
  );
  const languageMatchedCandidates = artistMatchedCandidates.filter((candidate) =>
    candidateMatchesLanguageIntent(candidate, spec),
  );

  const scored = languageMatchedCandidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, spec) }))
    .sort((left, right) => right.score - left.score);

  const selected = balancedSelectAcrossRequestedArtists(spec, scored);
  const artistCounts = new Map<string, number>();

  for (const candidate of selected) {
    const artistKey = getArtistKey(candidate);
    artistCounts.set(artistKey, (artistCounts.get(artistKey) ?? 0) + 1);
  }

  // Allow enough tracks per primary artist to reach long playlists; the old cap of 2
  // blocked filling when users asked many songs from a few named artists.
  const maxTracksPerArtistForDiversity =
    spec.artists.length > 0
      ? Math.max(2, Math.ceil(spec.targetTrackCount / spec.artists.length))
      : 2;

  for (const entry of scored) {
    if (selected.length >= spec.targetTrackCount) {
      break;
    }

    const artistKey = getArtistKey(entry.candidate);
    const artistCount = artistCounts.get(artistKey) ?? 0;

    if (
      artistCount >= maxTracksPerArtistForDiversity &&
      scored.length > spec.targetTrackCount + 5
    ) {
      continue;
    }

    if (selected.some((candidate) => candidate.uri === entry.candidate.uri)) {
      continue;
    }

    selected.push(entry.candidate);
    artistCounts.set(artistKey, artistCount + 1);
  }

  if (selected.length < spec.targetTrackCount) {
    for (const entry of scored) {
      if (selected.length >= spec.targetTrackCount) {
        break;
      }

      if (selected.some((candidate) => candidate.uri === entry.candidate.uri)) {
        continue;
      }

      selected.push(entry.candidate);
    }
  }

  const repairedSelection = enforceRequestedArtistTargetShare(spec, scored, selected).slice(
    0,
    spec.targetTrackCount,
  );

  return {
    tracks: repairedSelection,
    totalDurationMs: totalDurationMs(repairedSelection),
    diagnostics: {
      candidateCount: candidates.length,
      uniqueCandidateCount: uniqueCandidates.length,
      filteredExplicitCount: removedCount,
      selectedTrackCount: repairedSelection.length,
      uniqueArtistCount: new Set(repairedSelection.map(getArtistKey)).size,
    },
  };
}
