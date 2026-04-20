import { describe, expect, it } from "vitest";

import { composeSelectionWithSimilarArtistShare } from "../src/application/generate-playlist";
import { buildSearchQueries, selectTracks } from "../src/domain/select-tracks";
import { clampSearchLimit } from "../src/spotify/search";
import type { TrackCandidate } from "../src/types";
import type { PromptSpec } from "../src/domain/prompt-spec";

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
    sourceQuery: overrides.sourceQuery ?? "chill rap",
    searchRank: overrides.searchRank ?? 0,
    matchTerms: overrides.matchTerms ?? ["chill"],
    externalUrl: overrides.externalUrl,
  };
}

const promptSpec: PromptSpec = {
  rawPrompt: "Clean chill gym rap mix",
  targetTrackCount: 3,
  targetDurationMinutes: 12,
  allowExplicit: false,
  artists: [],
  languages: [],
  genres: ["rap"],
  styles: ["chill"],
  activities: ["gym"],
  seedTerms: ["chill", "gym", "rap"],
  playlistNameHint: "Chill Gym Rap",
  strictArtistMatch: false,
  strictLanguageMatch: false,
  includeOnlyRequestedArtists: false,
  includeSimilarArtists: false,
  requestedArtistTargetShare: undefined,
  preferPopularTracks: false,
  preferRecentTracks: false,
  interpretationSource: "heuristic",
  isPrivate: true,
};

describe("buildSearchQueries", () => {
  it("builds distinct queries from prompt terms", () => {
    const queries = buildSearchQueries(promptSpec);

    expect(queries[0]).toContain("chill");
    expect(queries.some((query) => query.includes("rap"))).toBe(true);
    expect(new Set(queries).size).toBe(queries.length);
  });
});

describe("clampSearchLimit", () => {
  it("caps large search limits to Spotify's supported maximum", () => {
    expect(clampSearchLimit(99)).toBe(50);
  });

  it("uses the default when no limit is provided", () => {
    expect(clampSearchLimit()).toBe(10);
  });
});

describe("selectTracks", () => {
  it("filters explicit songs and prefers artist diversity", () => {
    const selection = selectTracks(promptSpec, [
      makeCandidate({
        id: "1",
        uri: "spotify:track:1",
        name: "Clean Warmup",
        artistNames: ["Artist One"],
        popularity: 80,
        matchTerms: ["chill", "gym", "rap"],
      }),
      makeCandidate({
        id: "2",
        uri: "spotify:track:2",
        name: "Explicit Skip",
        artistNames: ["Artist Two"],
        explicit: true,
        popularity: 95,
        matchTerms: ["rap"],
      }),
      makeCandidate({
        id: "3",
        uri: "spotify:track:3",
        name: "Drive Forward",
        artistNames: ["Artist Three"],
        popularity: 70,
        matchTerms: ["gym", "rap"],
      }),
      makeCandidate({
        id: "4",
        uri: "spotify:track:4",
        name: "Focus Sprint",
        artistNames: ["Artist One"],
        popularity: 65,
        matchTerms: ["chill"],
        searchRank: 4,
      }),
      makeCandidate({
        id: "5",
        uri: "spotify:track:5",
        name: "Night Session",
        artistNames: ["Artist Four"],
        popularity: 60,
        matchTerms: ["chill", "rap"],
      }),
    ]);

    expect(selection.tracks).toHaveLength(3);
    expect(selection.tracks.some((track) => track.explicit)).toBe(false);
    expect(selection.diagnostics.filteredExplicitCount).toBe(1);
    expect(selection.diagnostics.uniqueArtistCount).toBeGreaterThanOrEqual(2);
  });

  it("filters out tracks whose artists are not in the requested artist list", () => {
    const artistFocusedPromptSpec: PromptSpec = {
      ...promptSpec,
      artists: ["Alok"],
      seedTerms: ["alok", "energetic"],
      playlistNameHint: "Alok Prep",
    };

    const selection = selectTracks(artistFocusedPromptSpec, [
      makeCandidate({
        id: "alok-real",
        uri: "spotify:track:alok-real",
        name: "Hear Me Now",
        artistNames: ["Alok", "Bruno Martini", "Zeeba"],
        artistIds: ["artist:alok", "artist:bruno", "artist:zeeba"],
        requestedArtistId: "artist:alok",
        matchTerms: ["alok"],
      }),
      makeCandidate({
        id: "alok-title-only",
        uri: "spotify:track:alok-title-only",
        name: "Tributo Ao Alok",
        artistNames: ["Another Artist"],
        matchTerms: ["alok"],
      }),
    ]);

    expect(selection.tracks).toHaveLength(1);
    expect(selection.tracks[0]?.artistNames).toContain("Alok");
  });

  it("balances selection across multiple requested artists", () => {
    const multiArtistPromptSpec: PromptSpec = {
      ...promptSpec,
      targetTrackCount: 4,
      artists: ["Alok", "Simone Mendes"],
      seedTerms: ["alok", "simone mendes", "hits"],
      playlistNameHint: "Festival Prep",
    };

    const selection = selectTracks(multiArtistPromptSpec, [
      makeCandidate({
        id: "alok-1",
        uri: "spotify:track:alok-1",
        name: "Alok Hit 1",
        artistNames: ["Alok"],
        requestedArtist: "Alok",
        popularity: 95,
        matchTerms: ["alok"],
      }),
      makeCandidate({
        id: "alok-2",
        uri: "spotify:track:alok-2",
        name: "Alok Hit 2",
        artistNames: ["Alok"],
        requestedArtist: "Alok",
        popularity: 90,
        matchTerms: ["alok"],
      }),
      makeCandidate({
        id: "simone-1",
        uri: "spotify:track:simone-1",
        name: "Simone Hit 1",
        artistNames: ["Simone Mendes"],
        requestedArtist: "Simone Mendes",
        popularity: 92,
        matchTerms: ["simone"],
      }),
      makeCandidate({
        id: "simone-2",
        uri: "spotify:track:simone-2",
        name: "Simone Hit 2",
        artistNames: ["Simone Mendes"],
        requestedArtist: "Simone Mendes",
        popularity: 88,
        matchTerms: ["simone"],
      }),
    ]);

    expect(selection.tracks).toHaveLength(4);
    expect(selection.tracks.some((track) => track.requestedArtist === "Alok")).toBe(true);
    expect(selection.tracks.some((track) => track.requestedArtist === "Simone Mendes")).toBe(true);
  });

  it("allows related artists only when the prompt asks for similar artists", () => {
    const similarArtistPromptSpec: PromptSpec = {
      ...promptSpec,
      targetTrackCount: 2,
      artists: ["Joao Gomes"],
      genres: ["forro"],
      languages: ["brazilian portuguese"],
      seedTerms: ["joao gomes", "forro", "brazilian portuguese"],
      includeSimilarArtists: true,
      requestedArtistTargetShare: 0.5,
      preferPopularTracks: true,
    };

    const selection = selectTracks(similarArtistPromptSpec, [
      makeCandidate({
        id: "joao-1",
        uri: "spotify:track:joao-1",
        name: "Joao Hit",
        artistNames: ["Joao Gomes"],
        artistIds: ["artist:joao"],
        requestedArtist: "Joao Gomes",
        requestedArtistId: "artist:joao",
        seedArtistName: "Joao Gomes",
        seedArtistKind: "requested",
        popularity: 95,
        matchTerms: ["joao", "forro"],
      }),
      makeCandidate({
        id: "related-1",
        uri: "spotify:track:related-1",
        name: "Similar Forro Hit",
        artistNames: ["Tarcisio do Acordeon"],
        seedArtistName: "Tarcisio do Acordeon",
        seedArtistKind: "related",
        popularity: 88,
        matchTerms: ["forro"],
      }),
      makeCandidate({
        id: "random-1",
        uri: "spotify:track:random-1",
        name: "Unrelated Song",
        artistNames: ["Random Artist"],
        popularity: 99,
        matchTerms: ["forro"],
      }),
    ]);

    expect(selection.tracks).toHaveLength(2);
    expect(selection.tracks.some((track) => track.artistNames[0] === "Joao Gomes")).toBe(true);
    expect(selection.tracks.some((track) => track.artistNames[0] === "Tarcisio do Acordeon")).toBe(true);
    expect(selection.tracks.some((track) => track.artistNames[0] === "Random Artist")).toBe(false);
  });

  it("requires the primary artist to match when artist matching is strict", () => {
    const strictArtistPromptSpec: PromptSpec = {
      ...promptSpec,
      artists: ["Joao Gomes"],
      strictArtistMatch: true,
      includeOnlyRequestedArtists: true,
      seedTerms: ["joao gomes", "forro"],
    };

    const selection = selectTracks(strictArtistPromptSpec, [
      makeCandidate({
        id: "primary-match",
        uri: "spotify:track:primary-match",
        name: "Primary Match",
        artistNames: ["Joao Gomes", "Guest Artist"],
        artistIds: ["artist:joao", "artist:guest"],
        requestedArtist: "Joao Gomes",
        requestedArtistId: "artist:joao",
        matchTerms: ["joao", "forro"],
      }),
      makeCandidate({
        id: "feature-only",
        uri: "spotify:track:feature-only",
        name: "Feature Only",
        artistNames: ["Another Artist", "Joao Gomes"],
        artistIds: ["artist:another", "artist:joao"],
        requestedArtist: "Joao Gomes",
        requestedArtistId: "artist:joao",
        matchTerms: ["joao", "forro"],
      }),
    ]);

    expect(selection.tracks).toHaveLength(1);
    expect(selection.tracks[0]?.uri).toBe("spotify:track:primary-match");
  });

  it("does not accept a different artist with a similar name", () => {
    const nattanPromptSpec: PromptSpec = {
      ...promptSpec,
      targetTrackCount: 1,
      artists: ["Nattan"],
      includeSimilarArtists: true,
      requestedArtistTargetShare: 0.5,
      strictArtistMatch: false,
      seedTerms: ["nattan", "forro"],
    };

    const selection = selectTracks(nattanPromptSpec, [
      makeCandidate({
        id: "real-nattan",
        uri: "spotify:track:real-nattan",
        name: "Amor na Praia",
        artistNames: ["Nattan"],
        artistIds: ["artist:nattan"],
        requestedArtist: "Nattan",
        requestedArtistId: "artist:nattan",
        popularity: 90,
        matchTerms: ["nattan", "forro"],
      }),
      makeCandidate({
        id: "dj-nattan",
        uri: "spotify:track:dj-nattan",
        name: "Batida da Madrugada",
        artistNames: ["DJ Nattan"],
        artistIds: ["artist:dj-nattan"],
        popularity: 99,
        matchTerms: ["nattan", "forro"],
      }),
    ]);

    expect(selection.tracks).toHaveLength(1);
    expect(selection.tracks[0]?.uri).toBe("spotify:track:real-nattan");
  });

  it("filters generic candidates that do not look like the requested language", () => {
    const portuguesePromptSpec: PromptSpec = {
      ...promptSpec,
      targetTrackCount: 2,
      languages: ["brazilian portuguese"],
      strictLanguageMatch: true,
      seedTerms: ["forro", "brazilian portuguese"],
      interpretationSource: "merged",
    };

    const selection = selectTracks(portuguesePromptSpec, [
      makeCandidate({
        id: "pt-song",
        uri: "spotify:track:pt-song",
        name: "Meu Amor",
        artistNames: ["Banda Brasileira"],
        albumName: "Coracao Valente",
        matchTerms: ["forro"],
      }),
      makeCandidate({
        id: "en-song",
        uri: "spotify:track:en-song",
        name: "Broken Heart Tonight",
        artistNames: ["Global Pop Star"],
        albumName: "Midnight Love",
        matchTerms: ["forro"],
      }),
    ]);

    expect(selection.tracks).toHaveLength(1);
    expect(selection.tracks[0]?.uri).toBe("spotify:track:pt-song");
  });

  it("caps requested artist share when similar artists are allowed", () => {
    const sharePromptSpec: PromptSpec = {
      ...promptSpec,
      targetTrackCount: 5,
      artists: ["Joao Gomes"],
      includeSimilarArtists: true,
      requestedArtistTargetShare: 0.4,
      seedTerms: ["joao gomes", "forro"],
    };

    const selection = selectTracks(sharePromptSpec, [
      makeCandidate({
        id: "joao-1",
        uri: "spotify:track:joao-1",
        name: "Joao Song One",
        artistNames: ["Joao Gomes"],
        artistIds: ["artist:joao"],
        requestedArtist: "Joao Gomes",
        requestedArtistId: "artist:joao",
        popularity: 95,
      }),
      makeCandidate({
        id: "joao-2",
        uri: "spotify:track:joao-2",
        name: "Joao Song Two",
        artistNames: ["Joao Gomes"],
        artistIds: ["artist:joao"],
        requestedArtist: "Joao Gomes",
        requestedArtistId: "artist:joao",
        popularity: 94,
      }),
      makeCandidate({
        id: "joao-3",
        uri: "spotify:track:joao-3",
        name: "Joao Song Three",
        artistNames: ["Joao Gomes"],
        artistIds: ["artist:joao"],
        requestedArtist: "Joao Gomes",
        requestedArtistId: "artist:joao",
        popularity: 93,
      }),
      makeCandidate({
        id: "related-1",
        uri: "spotify:track:related-1",
        name: "Related Song One",
        artistNames: ["Tarcisio do Acordeon"],
        seedArtistKind: "related",
        popularity: 91,
      }),
      makeCandidate({
        id: "related-2",
        uri: "spotify:track:related-2",
        name: "Related Song Two",
        artistNames: ["Ze Vaqueiro"],
        seedArtistKind: "related",
        popularity: 90,
      }),
      makeCandidate({
        id: "related-3",
        uri: "spotify:track:related-3",
        name: "Related Song Three",
        artistNames: ["Vitor Fernandes"],
        seedArtistKind: "related",
        popularity: 89,
      }),
    ]);

    expect(selection.tracks).toHaveLength(5);
    expect(selection.tracks.filter((track) => track.requestedArtistId === "artist:joao")).toHaveLength(2);
    expect(selection.tracks.filter((track) => track.seedArtistKind === "related").length).toBeGreaterThanOrEqual(3);
  });
});

describe("composeSelectionWithSimilarArtistShare", () => {
  const sharePromptSpec: PromptSpec = {
    ...promptSpec,
    targetTrackCount: 10,
    artists: ["Artist A"],
    includeSimilarArtists: true,
    requestedArtistTargetShare: 0.4,
    similarArtists: [],
    excludeSimilarArtistCollabsWithRequested: true,
    languages: [],
    strictLanguageMatch: false,
    genres: [],
    styles: [],
    activities: [],
    seedTerms: ["artist a"],
    playlistNameHint: "Artist A Mix",
    strictArtistMatch: false,
    includeOnlyRequestedArtists: false,
  };

  it("keeps the requested vs related share when both sub-pools have enough candidates", () => {
    const requestedCandidates = Array.from({ length: 10 }).map((_, i) =>
      makeCandidate({
        id: `req-${i}`,
        uri: `spotify:track:req-${i}`,
        name: `Artist A song ${i}`,
        artistNames: ["Artist A"],
        artistIds: ["artist:a"],
        requestedArtist: "Artist A",
        requestedArtistId: "artist:a",
        seedArtistKind: "requested",
        popularity: 95 - i,
      }),
    );
    const relatedCandidates = Array.from({ length: 12 }).map((_, i) =>
      makeCandidate({
        id: `rel-${i}`,
        uri: `spotify:track:rel-${i}`,
        name: `Similar ${i % 3} song ${i}`,
        artistNames: [`Similar${i % 3}`],
        artistIds: [`artist:sim${i % 3}`],
        seedArtistKind: "related",
        popularity: 80 - i,
      }),
    );

    const result = composeSelectionWithSimilarArtistShare(
      sharePromptSpec,
      [...requestedCandidates, ...relatedCandidates],
      [],
    );

    expect(result).toHaveLength(10);

    const relatedCount = result.filter((track) => track.seedArtistKind === "related").length;

    expect(relatedCount).toBeGreaterThanOrEqual(6);
  });

  it("does not fill the related quota with text-search candidates that lack seedArtistKind", () => {
    const primary = Array.from({ length: 10 }).map((_, i) =>
      makeCandidate({
        id: `req-${i}`,
        uri: `spotify:track:req-${i}`,
        name: `Artist A song ${i}`,
        artistNames: ["Artist A"],
        artistIds: ["artist:a"],
        requestedArtist: "Artist A",
        requestedArtistId: "artist:a",
        seedArtistKind: "requested",
        popularity: 95 - i,
      }),
    );
    const leakyTextSearchCollabs = Array.from({ length: 8 }).map((_, i) =>
      makeCandidate({
        id: `leak-${i}`,
        uri: `spotify:track:leak-${i}`,
        name: `Artist A feat Artist X ${i}`,
        artistNames: ["Artist A", "Artist X"],
        artistIds: ["artist:a", "artist:x"],
        requestedArtist: "Artist A",
        requestedArtistId: "artist:a",
        popularity: 50 - i,
      }),
    );
    const related = Array.from({ length: 12 }).map((_, i) =>
      makeCandidate({
        id: `rel-${i}`,
        uri: `spotify:track:rel-${i}`,
        name: `Similar ${i % 3} song ${i}`,
        artistNames: [`Similar${i % 3}`],
        artistIds: [`artist:sim${i % 3}`],
        seedArtistKind: "related",
        popularity: 80 - i,
      }),
    );

    const result = composeSelectionWithSimilarArtistShare(
      sharePromptSpec,
      [...primary, ...leakyTextSearchCollabs, ...related],
      [],
    );

    expect(result).toHaveLength(10);

    const relatedCount = result.filter((track) => track.seedArtistKind === "related").length;
    const leakyCount = result.filter((track) => track.id.startsWith("leak-")).length;

    expect(relatedCount).toBeGreaterThanOrEqual(6);
    expect(leakyCount).toBe(0);
  });
});
