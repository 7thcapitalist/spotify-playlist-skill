import { describe, expect, it } from "vitest";

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
    requestedArtist: overrides.requestedArtist,
    albumName: overrides.albumName ?? "Fallback Album",
    durationMs: overrides.durationMs ?? 180_000,
    explicit: overrides.explicit ?? false,
    popularity: overrides.popularity ?? 50,
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
  genres: ["rap"],
  styles: ["chill"],
  activities: ["gym"],
  seedTerms: ["chill", "gym", "rap"],
  playlistNameHint: "Chill Gym Rap",
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
    expect(clampSearchLimit(99)).toBe(10);
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
});
