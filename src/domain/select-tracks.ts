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

function clampQueryLength(query: string): string {
  if (query.length <= MAX_QUERY_LENGTH) {
    return query;
  }

  return query.slice(0, MAX_QUERY_LENGTH).trim();
}

export function buildSearchQueries(spec: PromptSpec): string[] {
  const weightedTerms = uniqueStrings([...spec.artists, ...spec.styles, ...spec.activities, ...spec.genres]);

  const queries = uniqueStrings([
    weightedTerms.slice(0, 5).join(" "),
    uniqueStrings([...spec.artists, ...spec.styles, ...spec.genres]).slice(0, 4).join(" "),
    ...spec.artists.map((artist) => `${artist} greatest hits`),
    ...spec.artists.map((artist) => `${artist} hits`),
    ...spec.artists.map((artist) => `${artist} ao vivo`),
    ...spec.activities.map((activity) => `${activity} ${spec.genres.slice(0, 2).join(" ")}`.trim()),
    ...spec.styles.map((style) => `${style} ${spec.genres.slice(0, 2).join(" ")}`.trim()),
    ...spec.artists,
    ...spec.genres,
    spec.seedTerms.slice(0, 5).join(" "),
  ]);

  return queries.map(clampQueryLength).filter(Boolean).slice(0, 8);
}

function scoreCandidate(candidate: TrackCandidate, spec: PromptSpec): number {
  const matchScore = candidate.matchTerms.length / Math.max(spec.seedTerms.length, 1);
  const popularityScore = candidate.popularity / 100;
  const searchRankScore = Math.max(0, 1 - candidate.searchRank / 20);

  let durationScore = 0.5;

  if (spec.targetDurationMinutes) {
    const idealTrackLengthMs =
      (spec.targetDurationMinutes * 60_000) / Math.max(spec.targetTrackCount, 1);
    const delta = Math.abs(candidate.durationMs - idealTrackLengthMs);
    durationScore = Math.max(0, 1 - delta / idealTrackLengthMs);
  }

  const requestedArtistBonus = candidate.requestedArtist ? 0.25 : 0;

  return (
    matchScore * 0.35 +
    popularityScore * 0.3 +
    searchRankScore * 0.15 +
    durationScore * 0.1 +
    requestedArtistBonus
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
  const primaryArtist = normalizeArtistIdentity(candidate.artistNames[0] ?? "");

  return requestedArtists.some((requestedArtist) =>
    primaryArtist === requestedArtist ||
    primaryArtist.includes(requestedArtist) ||
    requestedArtist.includes(primaryArtist),
  );
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

export function selectTracks(spec: PromptSpec, candidates: TrackCandidate[]): PlaylistSelection {
  const uniqueCandidates = dedupeCandidates(candidates);
  const { candidates: explicitSafeCandidates, removedCount } = filterExplicitTracks(
    uniqueCandidates,
    spec.allowExplicit,
  );
  const artistMatchedCandidates = explicitSafeCandidates.filter((candidate) =>
    candidateMatchesRequestedArtists(candidate, spec),
  );

  const scored = artistMatchedCandidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, spec) }))
    .sort((left, right) => right.score - left.score);

  const selected = balancedSelectAcrossRequestedArtists(spec, scored);
  const artistCounts = new Map<string, number>();

  for (const candidate of selected) {
    const artistKey = getArtistKey(candidate);
    artistCounts.set(artistKey, (artistCounts.get(artistKey) ?? 0) + 1);
  }

  for (const entry of scored) {
    if (selected.length >= spec.targetTrackCount) {
      break;
    }

    const artistKey = getArtistKey(entry.candidate);
    const artistCount = artistCounts.get(artistKey) ?? 0;

    if (artistCount >= 2 && scored.length > spec.targetTrackCount + 5) {
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

  return {
    tracks: selected,
    totalDurationMs: totalDurationMs(selected),
    diagnostics: {
      candidateCount: candidates.length,
      uniqueCandidateCount: uniqueCandidates.length,
      filteredExplicitCount: removedCount,
      selectedTrackCount: selected.length,
      uniqueArtistCount: new Set(selected.map(getArtistKey)).size,
    },
  };
}
