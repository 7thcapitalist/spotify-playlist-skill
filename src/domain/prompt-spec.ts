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
  genres: string[];
  styles: string[];
  activities: string[];
  seedTerms: string[];
  playlistNameHint: string;
  isPrivate: boolean;
}
