export const DEFAULT_TARGET_TRACK_COUNT = 20;
export const MIN_TARGET_TRACK_COUNT = 5;
export const MAX_TARGET_TRACK_COUNT = 50;
export const DEFAULT_ESTIMATED_TRACK_MINUTES = 3.5;

export interface PromptSpec {
  rawPrompt: string;
  targetTrackCount: number;
  targetDurationMinutes?: number;
  allowExplicit: boolean;
  artists: string[];
  /**
   * Artist names the AI (or caller) considers stylistically similar to the named `artists`.
   * These are treated as soft seeds: we fetch their catalogs and include their tracks under
   * the `seedArtistKind === "related"` bucket, never as strict "requestedArtist".
   */
  similarArtists: string[];
  languages: string[];
  genres: string[];
  styles: string[];
  activities: string[];
  seedTerms: string[];
  playlistNameHint: string;
  strictArtistMatch: boolean;
  strictLanguageMatch: boolean;
  includeOnlyRequestedArtists: boolean;
  includeSimilarArtists: boolean;
  requestedArtistTargetShare?: number;
  /**
   * If true, tracks from the similar/related artist catalogs that also feature any of the
   * primary `artists` are dropped. Keeps the "similar artists" quota genuinely other-artist.
   */
  excludeSimilarArtistCollabsWithRequested: boolean;
  preferPopularTracks: boolean;
  preferRecentTracks: boolean;
  interpretationSource: "heuristic" | "ai" | "merged";
  isPrivate: boolean;
}
