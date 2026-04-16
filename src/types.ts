import type { PromptSpec } from "./domain/prompt-spec";

export interface StoredSpotifyTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType: string;
  scope?: string;
}

export interface TrackCandidate {
  id: string;
  uri: string;
  name: string;
  artistNames: string[];
  requestedArtist?: string;
  albumName: string;
  durationMs: number;
  explicit: boolean;
  popularity: number;
  sourceQuery: string;
  searchRank: number;
  matchTerms: string[];
  externalUrl?: string;
}

export interface ResolvedArtist {
  requestedName: string;
  spotifyArtistId: string;
  matchedName: string;
}

export interface PlaylistSelectionDiagnostics {
  candidateCount: number;
  uniqueCandidateCount: number;
  filteredExplicitCount: number;
  selectedTrackCount: number;
  uniqueArtistCount: number;
}

export interface PlaylistSelection {
  tracks: TrackCandidate[];
  totalDurationMs: number;
  diagnostics: PlaylistSelectionDiagnostics;
}

export interface PlaylistGenerationResult {
  promptSpec: PromptSpec;
  playlistId: string;
  playlistName: string;
  playlistUrl?: string;
  queries: string[];
  selectedTracks: TrackCandidate[];
  totalDurationMs: number;
  diagnostics: PlaylistSelectionDiagnostics;
}
