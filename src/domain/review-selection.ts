import type { PlaylistSelection, ResolvedArtist, TrackCandidate } from "../types";
import type { PromptSpec } from "./prompt-spec";
import { normalizeText } from "./filters";
import { selectTracks } from "./select-tracks";

const LANGUAGE_MARKERS: Record<string, string[]> = {
  portuguese: ["amor", "saudade", "pra", "voce", "vida", "nao", "coracao", "de", "do", "da"],
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
  portugues: ["amor", "saudade", "pra", "voce", "vida", "nao", "coracao", "de", "do", "da"],
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

const LOW_QUALITY_ARTIST_NAME_MARKERS = [
  "hits",
  "top",
  "playlist",
  "playlists",
  "mix",
  "mixe",
  "brasil",
  "brazil",
  "viral",
  "tiktok",
  "karaoke",
  "cover",
  "covers",
  "tribute",
  "tributo",
  "dj",
];

function isLowQualityArtistName(name: string): boolean {
  const normalized = normalizeText(name);

  if (!normalized) {
    return true;
  }

  return LOW_QUALITY_ARTIST_NAME_MARKERS.some((marker) => normalized.includes(marker));
}

function trackLooksLikeRealArtistCatalog(track: TrackCandidate): boolean {
  const primaryArtist = track.artistNames[0] ?? "";

  if (!primaryArtist) {
    return false;
  }

  // Only apply this to related/similar tracks; never block explicitly requested artists.
  if (track.seedArtistKind !== "related") {
    return true;
  }

  return !isLowQualityArtistName(primaryArtist);
}

/**
 * Predicate for the "related" track pool that drops obvious compilation / non-artist
 * accounts. Exported so the share-composer can pre-filter the related candidate pool.
 */
export function relatedTrackHasRealArtist(track: TrackCandidate): boolean {
  const primaryArtist = track.artistNames[0] ?? "";

  if (!primaryArtist) {
    return false;
  }

  return !isLowQualityArtistName(primaryArtist);
}

function trackLooksLikeRequestedLanguage(track: TrackCandidate, spec: PromptSpec): boolean {
  if (!spec.strictLanguageMatch || spec.languages.length === 0) {
    return true;
  }

  if (track.requestedArtistId || track.seedArtistKind === "related") {
    return true;
  }

  const candidateText = normalizeText([track.name, track.albumName, ...track.artistNames].join(" "));

  return spec.languages.some((language) => {
    const markers = LANGUAGE_MARKERS[normalizeText(language)] ?? [];

    if (markers.length === 0) {
      return true;
    }

    return markers.some((marker) => candidateText.includes(marker));
  });
}

function trackMatchesArtistPolicy(
  track: TrackCandidate,
  spec: PromptSpec,
  requestedArtistIds: Set<string>,
): boolean {
  if (spec.artists.length === 0) {
    return true;
  }

  if (track.seedArtistKind === "related") {
    return spec.includeSimilarArtists;
  }

  if (requestedArtistIds.size === 0) {
    return Boolean(track.requestedArtist);
  }

  if (spec.strictArtistMatch) {
    return Boolean(track.artistIds[0] && requestedArtistIds.has(track.artistIds[0]));
  }

  return track.artistIds.some((artistId) => requestedArtistIds.has(artistId));
}

function getRejectedTrackUris(
  spec: PromptSpec,
  tracks: TrackCandidate[],
  requestedArtists: ResolvedArtist[],
): Set<string> {
  const requestedArtistIds = new Set(requestedArtists.map((artist) => artist.spotifyArtistId));
  const rejectedUris = new Set<string>();

  for (const track of tracks) {
    if (!trackMatchesArtistPolicy(track, spec, requestedArtistIds)) {
      rejectedUris.add(track.uri);
      continue;
    }

    if (!trackLooksLikeRealArtistCatalog(track)) {
      rejectedUris.add(track.uri);
      continue;
    }

    if (!trackLooksLikeRequestedLanguage(track, spec)) {
      rejectedUris.add(track.uri);
    }
  }

  return rejectedUris;
}

export function reviewAndRepairSelection(
  spec: PromptSpec,
  selection: PlaylistSelection,
  candidates: TrackCandidate[],
  requestedArtists: ResolvedArtist[],
): PlaylistSelection {
  const rejectedUris = getRejectedTrackUris(spec, selection.tracks, requestedArtists);

  if (rejectedUris.size === 0) {
    return selection;
  }

  const remainingCandidates = candidates.filter((candidate) => !rejectedUris.has(candidate.uri));
  return selectTracks(spec, remainingCandidates);
}
