import { describe, expect, it } from "vitest";

import { reviewAndRepairSelection } from "../src/domain/review-selection";
import type { PromptSpec } from "../src/domain/prompt-spec";
import type { PlaylistSelection, ResolvedArtist, TrackCandidate } from "../src/types";

function makeCandidate(overrides: Partial<TrackCandidate>): TrackCandidate {
  return {
    id: overrides.id ?? `track-${Math.random()}`,
    uri: overrides.uri ?? `spotify:track:${Math.random()}`,
    name: overrides.name ?? "Fallback Song",
    artistNames: overrides.artistNames ?? ["Fallback Artist"],
    artistIds: overrides.artistIds ?? [],
    requestedArtist: overrides.requestedArtist,
    requestedArtistId: overrides.requestedArtistId,
    seedArtistName: overrides.seedArtistName,
    seedArtistKind: overrides.seedArtistKind,
    albumName: overrides.albumName ?? "Fallback Album",
    durationMs: overrides.durationMs ?? 180_000,
    explicit: overrides.explicit ?? false,
    popularity: overrides.popularity ?? 50,
    releaseDate: overrides.releaseDate,
    sourceQuery: overrides.sourceQuery ?? "artist hits",
    searchRank: overrides.searchRank ?? 0,
    matchTerms: overrides.matchTerms ?? ["artist"],
    externalUrl: overrides.externalUrl,
  };
}

const strictPromptSpec: PromptSpec = {
  rawPrompt: "Create a Nattan playlist",
  targetTrackCount: 1,
  allowExplicit: true,
  artists: ["Nattan"],
  languages: ["brazilian portuguese"],
  genres: ["forro"],
  styles: [],
  activities: [],
  seedTerms: ["nattan", "forro", "brazilian portuguese"],
  playlistNameHint: "Nattan Mix",
  strictArtistMatch: true,
  strictLanguageMatch: true,
  includeOnlyRequestedArtists: true,
  includeSimilarArtists: false,
  requestedArtistTargetShare: undefined,
  preferPopularTracks: true,
  preferRecentTracks: true,
  interpretationSource: "merged",
  isPrivate: true,
};

describe("reviewAndRepairSelection", () => {
  it("removes mismatched artists and refills with valid candidates", () => {
    const invalidTrack = makeCandidate({
      id: "dj-nattan",
      uri: "spotify:track:dj-nattan",
      name: "Batida da Madrugada",
      artistNames: ["DJ Nattan"],
      artistIds: ["artist:dj-nattan"],
      popularity: 99,
      matchTerms: ["nattan", "forro"],
    });
    const validTrack = makeCandidate({
      id: "real-nattan",
      uri: "spotify:track:real-nattan",
      name: "Meu Amor",
      artistNames: ["Nattan"],
      artistIds: ["artist:nattan"],
      requestedArtist: "Nattan",
      requestedArtistId: "artist:nattan",
      popularity: 90,
      matchTerms: ["nattan", "forro"],
    });
    const selection: PlaylistSelection = {
      tracks: [invalidTrack],
      totalDurationMs: invalidTrack.durationMs,
      diagnostics: {
        candidateCount: 2,
        uniqueCandidateCount: 2,
        filteredExplicitCount: 0,
        selectedTrackCount: 1,
        uniqueArtistCount: 1,
      },
    };
    const requestedArtists: ResolvedArtist[] = [
      {
        requestedName: "Nattan",
        spotifyArtistId: "artist:nattan",
        matchedName: "Nattan",
        genres: ["forro"],
        isRequested: true,
      },
    ];

    const repaired = reviewAndRepairSelection(
      strictPromptSpec,
      selection,
      [invalidTrack, validTrack],
      requestedArtists,
    );

    expect(repaired.tracks).toHaveLength(1);
    expect(repaired.tracks[0]?.uri).toBe("spotify:track:real-nattan");
  });

  it("prefers real artist catalogs over compilation-style similar tracks", () => {
    const similarPromptSpec: PromptSpec = {
      ...strictPromptSpec,
      artists: ["Joao Gomes"],
      includeSimilarArtists: true,
      includeOnlyRequestedArtists: false,
      strictArtistMatch: false,
      targetTrackCount: 2,
      requestedArtistTargetShare: 0.5,
    };

    const lowQualityRelated = makeCandidate({
      id: "forro-hits",
      uri: "spotify:track:forro-hits",
      name: "Generic Hit",
      artistNames: ["Forró Hits"],
      artistIds: ["artist:forro-hits"],
      seedArtistKind: "related",
      popularity: 95,
    });
    const realRelated = makeCandidate({
      id: "avioes",
      uri: "spotify:track:avioes",
      name: "Real Forro Track",
      artistNames: ["Aviões do Forró"],
      artistIds: ["artist:avioes"],
      seedArtistKind: "related",
      popularity: 80,
    });

    const selection: PlaylistSelection = {
      tracks: [lowQualityRelated, realRelated],
      totalDurationMs: lowQualityRelated.durationMs + realRelated.durationMs,
      diagnostics: {
        candidateCount: 2,
        uniqueCandidateCount: 2,
        filteredExplicitCount: 0,
        selectedTrackCount: 2,
        uniqueArtistCount: 2,
      },
    };

    const repaired = reviewAndRepairSelection(similarPromptSpec, selection, [lowQualityRelated, realRelated], []);

    expect(repaired.tracks.some((track) => track.uri === "spotify:track:forro-hits")).toBe(false);
    expect(repaired.tracks.some((track) => track.uri === "spotify:track:avioes")).toBe(true);
  });
});
