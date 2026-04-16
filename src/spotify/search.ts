import type SpotifyWebApi from "spotify-web-api-node";

import type { ResolvedArtist, TrackCandidate } from "../types";
import { normalizeText } from "../domain/filters";

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 10;

function tokenizeQuery(query: string): string[] {
  return normalizeText(query)
    .split(" ")
    .filter((part) => part.length > 2);
}

export function clampSearchLimit(limitPerQuery?: number): number {
  if (!limitPerQuery) {
    return DEFAULT_SEARCH_LIMIT;
  }

  return Math.max(1, Math.min(MAX_SEARCH_LIMIT, limitPerQuery));
}

function mapTrack(
  track: SpotifyApi.TrackObjectFull,
  sourceQuery: string,
  searchRank: number,
  requestedArtist?: string,
): TrackCandidate {
  const searchableText = normalizeText(
    [track.name, track.album.name, ...track.artists.map((artist) => artist.name)].join(" "),
  );
  const queryTerms = tokenizeQuery(sourceQuery);

  return {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artistNames: track.artists.map((artist) => artist.name),
    requestedArtist,
    albumName: track.album.name,
    durationMs: track.duration_ms,
    explicit: track.explicit,
    popularity: track.popularity ?? 0,
    sourceQuery,
    searchRank,
    matchTerms: queryTerms.filter((term) => searchableText.includes(term)),
    externalUrl: track.external_urls?.spotify,
  };
}

export async function searchTrackCandidates(
  spotifyApi: SpotifyWebApi,
  queries: string[],
  options: { market: string; limitPerQuery?: number },
): Promise<TrackCandidate[]> {
  const limit = clampSearchLimit(options.limitPerQuery);

  const results = await Promise.all(
    queries.map(async (query) => {
      const response = await spotifyApi.searchTracks(query, {
        market: options.market,
        limit,
      });

      return (response.body.tracks?.items ?? []).map((track, index) =>
        mapTrack(track, query, index),
      );
    }),
  );

  return results.flat();
}

function scoreResolvedArtistMatch(
  requestedArtist: string,
  spotifyArtist: SpotifyApi.ArtistObjectFull,
): number {
  const requested = normalizeText(requestedArtist);
  const candidate = normalizeText(spotifyArtist.name);

  if (requested === candidate) {
    return 1000 + (spotifyArtist.popularity ?? 0);
  }

  if (candidate.includes(requested) || requested.includes(candidate)) {
    return 500 + (spotifyArtist.popularity ?? 0);
  }

  return spotifyArtist.popularity ?? 0;
}

export async function resolveRequestedArtists(
  spotifyApi: SpotifyWebApi,
  requestedArtists: string[],
): Promise<ResolvedArtist[]> {
  const results = await Promise.all(
    requestedArtists.map(async (requestedArtist) => {
      const response = await spotifyApi.searchArtists(requestedArtist, { limit: 10 });
      const artist = [...(response.body.artists?.items ?? [])]
        .sort(
          (left, right) =>
            scoreResolvedArtistMatch(requestedArtist, right) -
            scoreResolvedArtistMatch(requestedArtist, left),
        )[0];

      if (!artist) {
        return null;
      }

      return {
        requestedName: requestedArtist,
        spotifyArtistId: artist.id,
        matchedName: artist.name,
      } satisfies ResolvedArtist;
    }),
  );

  return results.filter((result): result is ResolvedArtist => result !== null);
}

export async function fetchArtistTrackCandidates(
  spotifyApi: SpotifyWebApi,
  resolvedArtists: ResolvedArtist[],
  options: { market: string },
): Promise<TrackCandidate[]> {
  const results = await Promise.all(
    resolvedArtists.map(async (artist) => {
      const searchPlans = [
        { query: `artist:"${artist.matchedName}"`, offset: 0, source: "artist-search" },
        { query: `artist:"${artist.matchedName}"`, offset: 10, source: "artist-search" },
        { query: `artist:"${artist.matchedName}" hits`, offset: 0, source: "artist-hits" },
        { query: `artist:"${artist.matchedName}" greatest hits`, offset: 0, source: "artist-greatest-hits" },
        { query: `artist:"${artist.matchedName}" ao vivo`, offset: 0, source: "artist-live" },
      ] as const;

      const responses = await Promise.all(
        searchPlans.map(async (plan) => {
          const response = await spotifyApi.searchTracks(plan.query, {
            market: options.market,
            limit: 10,
            offset: plan.offset,
          });

          return { plan, response };
        }),
      );

      const tracks = responses.flatMap(({ plan, response }) =>
        (response.body.tracks?.items ?? []).map((track, index) =>
          mapTrack(
            track,
            `${plan.source}:${artist.matchedName}:offset-${plan.offset}`,
            index + plan.offset,
            artist.requestedName,
          ),
        ),
      );

      return tracks;
    }),
  );

  return results.flat();
}
