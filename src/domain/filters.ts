import type { TrackCandidate } from "../types";

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(value.trim());
  }

  return result;
}

export function dedupeCandidates(candidates: TrackCandidate[]): TrackCandidate[] {
  const seen = new Set<string>();
  const result: TrackCandidate[] = [];

  for (const candidate of candidates) {
    const compoundKey = [
      candidate.uri,
      normalizeText(candidate.name),
      candidate.artistNames.map(normalizeText).join("|"),
    ].join("::");

    if (seen.has(compoundKey)) {
      continue;
    }

    seen.add(compoundKey);
    result.push(candidate);
  }

  return result;
}

export function filterExplicitTracks(
  candidates: TrackCandidate[],
  allowExplicit: boolean,
): { candidates: TrackCandidate[]; removedCount: number } {
  if (allowExplicit) {
    return { candidates, removedCount: 0 };
  }

  const filtered = candidates.filter((candidate) => !candidate.explicit);

  return {
    candidates: filtered,
    removedCount: candidates.length - filtered.length,
  };
}

export function totalDurationMs(candidates: TrackCandidate[]): number {
  return candidates.reduce((sum, candidate) => sum + candidate.durationMs, 0);
}
