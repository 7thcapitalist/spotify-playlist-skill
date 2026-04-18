import type SpotifyWebApi from "spotify-web-api-node";

import type { ResolvedArtist, TrackCandidate } from "../types";
import { normalizeText } from "../domain/filters";

const DEFAULT_SEARCH_LIMIT = 10;
/** Spotify allows up to 50 per track search. */
const MAX_SEARCH_LIMIT = 50;

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

function clampSeedLimit(values: string[], limit: number): string[] {
  return values.filter(Boolean).slice(0, limit);
}

function mapTrack(
  track: SpotifyApi.TrackObjectFull | SpotifyApi.RecommendationTrackObject,
  sourceQuery: string,
  searchRank: number,
  requestedArtist?: string,
  requestedArtistId?: string,
  seedArtistName?: string,
  seedArtistKind?: "requested" | "related",
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
    artistIds: track.artists.map((artist) => artist.id),
    requestedArtist,
    requestedArtistId,
    seedArtistName,
    seedArtistKind,
    albumName: track.album.name,
    durationMs: track.duration_ms,
    explicit: track.explicit,
    popularity: track.popularity ?? 0,
    releaseDate: track.album.release_date,
    sourceQuery,
    searchRank,
    matchTerms: queryTerms.filter((term) => searchableText.includes(term)),
    externalUrl: track.external_urls?.spotify,
  };
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

function matchRequestedArtist(
  trackArtists: SpotifyApi.ArtistObjectSimplified[],
  requestedArtists: ResolvedArtist[],
): { requestedArtist?: string; requestedArtistId?: string } {
  for (const requestedArtist of requestedArtists) {
    if (trackArtists.some((artist) => artist.id === requestedArtist.spotifyArtistId)) {
      return {
        requestedArtist: requestedArtist.requestedName,
        requestedArtistId: requestedArtist.spotifyArtistId,
      };
    }
  }

  const normalizedArtistNames = trackArtists.map((artist) => normalizeArtistIdentity(artist.name));

  for (const requestedArtist of requestedArtists) {
    const normalizedRequestedArtist = normalizeArtistIdentity(requestedArtist.requestedName);

    if (
      normalizedArtistNames.some(
        (artistName) =>
          artistName === normalizedRequestedArtist ||
          artistName.includes(normalizedRequestedArtist) ||
          normalizedRequestedArtist.includes(artistName),
      )
    ) {
      return {
        requestedArtist: requestedArtist.requestedName,
        requestedArtistId: requestedArtist.spotifyArtistId,
      };
    }
  }

  return {};
}

export async function searchTrackCandidates(
  spotifyApi: SpotifyWebApi,
  queries: string[],
  options: { market: string; limitPerQuery?: number; requestedArtists?: ResolvedArtist[] },
): Promise<TrackCandidate[]> {
  const limit = clampSearchLimit(options.limitPerQuery);

  const results = await Promise.all(
    queries.map(async (query) => {
      const response = await spotifyApi.searchTracks(query, {
        market: options.market,
        limit,
      }).catch(() => null);

      if (!response) {
        return [];
      }

      return (response.body.tracks?.items ?? []).map((track, index) =>
        {
          const artistMatch = matchRequestedArtist(track.artists, options.requestedArtists ?? []);

          return mapTrack(
            track,
            query,
            index,
            artistMatch.requestedArtist,
            artistMatch.requestedArtistId,
          );
        },
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
    requestedArtists.map(async (requestedArtist): Promise<ResolvedArtist | null> => {
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
        genres: artist.genres ?? [],
        isRequested: true,
      } satisfies ResolvedArtist;
    }),
  );

  return results.filter((result): result is ResolvedArtist => result !== null);
}

function scoreGenreOverlap(
  genres: string[],
  preferredGenres: string[],
): number {
  if (preferredGenres.length === 0 || genres.length === 0) {
    return 0;
  }

  const normalizedGenres = genres.map(normalizeText);
  const normalizedPreferredGenres = preferredGenres.map(normalizeText);

  let score = 0;

  for (const preferredGenre of normalizedPreferredGenres) {
    if (
      normalizedGenres.some(
        (genre) =>
          genre === preferredGenre ||
          genre.includes(preferredGenre) ||
          preferredGenre.includes(genre),
      )
    ) {
      score += 1;
    }
  }

  return score;
}

export async function resolveSimilarArtists(
  spotifyApi: SpotifyWebApi,
  requestedArtists: ResolvedArtist[],
  options: { preferredGenres: string[]; limit?: number },
): Promise<ResolvedArtist[]> {
  const limit = options.limit ?? Math.max(2, requestedArtists.length * 2);
  const seenIds = new Set(requestedArtists.map((artist) => artist.spotifyArtistId));
  const seenNames = new Set(requestedArtists.map((artist) => normalizeText(artist.matchedName)));
  const relatedResults = await Promise.all(
    requestedArtists.map(async (artist) => {
      try {
        const response = await spotifyApi.getArtistRelatedArtists(artist.spotifyArtistId);

        return (response.body.artists ?? []).map((relatedArtist) => ({
          requestedName: relatedArtist.name,
          spotifyArtistId: relatedArtist.id,
          matchedName: relatedArtist.name,
          genres: relatedArtist.genres ?? [],
          isRequested: false,
          score:
            (relatedArtist.popularity ?? 0) +
            scoreGenreOverlap(relatedArtist.genres ?? [], options.preferredGenres) * 25,
        }));
      } catch {
        return [];
      }
    }),
  );

  return relatedResults
    .flat()
    .filter((artist) => {
      const normalizedName = normalizeText(artist.matchedName);
      return !seenIds.has(artist.spotifyArtistId) && !seenNames.has(normalizedName);
    })
    .filter((artist) =>
      options.preferredGenres.length === 0
        ? true
        : scoreGenreOverlap(artist.genres, options.preferredGenres) > 0,
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((artist) => ({
      requestedName: artist.requestedName,
      spotifyArtistId: artist.spotifyArtistId,
      matchedName: artist.matchedName,
      genres: artist.genres,
      isRequested: artist.isRequested,
    }));
}

export async function fetchArtistTrackCandidates(
  spotifyApi: SpotifyWebApi,
  resolvedArtists: ResolvedArtist[],
  options: { market: string; includeRecentTracks?: boolean },
): Promise<TrackCandidate[]> {
  const currentYear = new Date().getFullYear();
  const results = await Promise.all(
    resolvedArtists.map(async (artist) => {
      // Primary (user-named) artists get deeper pagination so we can fill long playlists
      // without blowing past Spotify's rate limit. Similar/related seed artists only need a
      // few pages of results because the final selection is limited to a share of the total.
      const deepSearchPlans = [
        { query: `artist:"${artist.matchedName}"`, offset: 0, source: "artist-search" },
        { query: `artist:"${artist.matchedName}"`, offset: 10, source: "artist-search" },
        { query: `artist:"${artist.matchedName}"`, offset: 20, source: "artist-search" },
        { query: `artist:"${artist.matchedName}"`, offset: 30, source: "artist-search" },
        { query: `artist:"${artist.matchedName}" hits`, offset: 0, source: "artist-hits" },
        { query: `artist:"${artist.matchedName}" hits`, offset: 10, source: "artist-hits" },
        {
          query: `artist:"${artist.matchedName}" greatest hits`,
          offset: 0,
          source: "artist-greatest-hits",
        },
        {
          query: `artist:"${artist.matchedName}" greatest hits`,
          offset: 10,
          source: "artist-greatest-hits",
        },
      ];
      const shallowSearchPlans = [
        { query: `artist:"${artist.matchedName}"`, offset: 0, source: "artist-search" },
        { query: `artist:"${artist.matchedName}" hits`, offset: 0, source: "artist-hits" },
      ];
      const searchPlans = [
        ...(artist.isRequested ? deepSearchPlans : shallowSearchPlans),
        ...(options.includeRecentTracks
          ? [
              {
                query: `artist:"${artist.matchedName}" year:${currentYear - 1}-${currentYear}`,
                offset: 0,
                source: "artist-recent",
              },
            ]
          : []),
      ] as const;

      const topTracksResponse = await spotifyApi
        .getArtistTopTracks(artist.spotifyArtistId, options.market)
        .catch(() => null);
      const responses = await Promise.all(
        searchPlans.map(async (plan) => {
          const response = await spotifyApi.searchTracks(plan.query, {
            market: options.market,
            limit: 10,
            offset: plan.offset,
          }).catch(() => null);

          if (!response) {
            return null;
          }

          return { plan, response };
        }),
      );

      const topTracks = (topTracksResponse?.body.tracks ?? []).map((track, index) =>
        {
          const exactArtistMatch = track.artists.some(
            (trackArtist) => trackArtist.id === artist.spotifyArtistId,
          );

          return mapTrack(
            track,
            `artist-top:${artist.matchedName}`,
            index,
            artist.isRequested && exactArtistMatch ? artist.requestedName : undefined,
            artist.isRequested && exactArtistMatch ? artist.spotifyArtistId : undefined,
            artist.matchedName,
            artist.isRequested ? "requested" : "related",
          );
        },
      );
      const searchedTracks = responses.flatMap((entry) =>
        !entry
          ? []
          : (
              entry.response.body.tracks?.items ?? []
            ).map((track, index) =>
              {
                const exactArtistMatch = track.artists.some(
                  (trackArtist) => trackArtist.id === artist.spotifyArtistId,
                );

                return mapTrack(
                  track,
                  `${entry.plan.source}:${artist.matchedName}:offset-${entry.plan.offset}`,
                  index + entry.plan.offset,
                  artist.isRequested && exactArtistMatch ? artist.requestedName : undefined,
                  artist.isRequested && exactArtistMatch ? artist.spotifyArtistId : undefined,
                  artist.matchedName,
                  artist.isRequested ? "requested" : "related",
                );
              },
            ),
      );

      return [...topTracks, ...searchedTracks];
    }),
  );

  return results.flat();
}

export async function fetchRecommendationTrackCandidates(
  spotifyApi: SpotifyWebApi,
  requestedArtists: ResolvedArtist[],
  options: {
    market: string;
    preferredGenres: string[];
    limit?: number;
  },
): Promise<TrackCandidate[]> {
  const seedArtists = clampSeedLimit(
    requestedArtists.map((artist) => artist.spotifyArtistId),
    3,
  );
  const seedGenres = clampSeedLimit(
    options.preferredGenres.map((genre) => normalizeText(genre).replace(/\s+/g, "-")),
    2,
  );

  if (seedArtists.length === 0 && seedGenres.length === 0) {
    return [];
  }

  const response = await spotifyApi
    .getRecommendations({
      market: options.market,
      limit: Math.max(10, Math.min(options.limit ?? 20, 100)),
      seed_artists: seedArtists,
      seed_genres: seedGenres,
    })
    .catch(() => null);

  if (!response) {
    return [];
  }

  return (response.body.tracks ?? []).map((track, index) =>
    mapTrack(
      track,
      `recommendations:${seedArtists.join(",")}:${seedGenres.join(",")}:${options.preferredGenres.join(" ")}`,
      index,
      undefined,
      undefined,
      "recommendations",
      "related",
    ),
  );
}

export async function fetchGenreSimilarArtistCandidates(
  spotifyApi: SpotifyWebApi,
  requestedArtists: ResolvedArtist[],
  options: {
    market: string;
    preferredGenres: string[];
    limit?: number;
  },
): Promise<TrackCandidate[]> {
  const genreQueries = clampSeedLimit(
    options.preferredGenres.length > 0 ? options.preferredGenres : requestedArtists.flatMap((artist) => artist.genres),
    3,
  );

  if (genreQueries.length === 0) {
    return [];
  }

  const requestedArtistIds = new Set(requestedArtists.map((artist) => artist.spotifyArtistId));
  const trackResponses = await Promise.all(
    genreQueries.map(async (genre) => {
      const response = await spotifyApi
        .searchTracks(`${genre} brasil hits`, {
          market: options.market,
          limit: Math.max(10, Math.min(options.limit ?? 10, 50)),
        })
        .catch(() => null);

      return response?.body.tracks?.items ?? [];
    }),
  );

  return trackResponses
    .flat()
    .filter(
      (track) => !track.artists.some((artist) => requestedArtistIds.has(artist.id)),
    )
    .map((track, index) =>
      mapTrack(
        track,
        `genre-fallback:${genreQueries.join(" ")}`,
        index,
        undefined,
        undefined,
        track.artists[0]?.name,
        "related",
      ),
    );
}
