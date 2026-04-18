import { describe, expect, it } from "vitest";

import { parsePrompt } from "../src/domain/parse-prompt";

describe("parsePrompt", () => {
  it("extracts track count, mood, nationality, and explicit filter", () => {
    const spec = parsePrompt("Make me a 20-song chill Brazilian night drive playlist.");

    expect(spec.targetTrackCount).toBe(20);
    expect(spec.allowExplicit).toBe(true);
    expect(spec.styles).toContain("chill");
    expect(spec.styles).toContain("night drive");
    expect(spec.genres).toContain("brazilian");
  });

  it("derives track count from duration when count is omitted", () => {
    const spec = parsePrompt("Create a 45-minute gym playlist with rap and electronic music.");

    expect(spec.targetDurationMinutes).toBe(45);
    expect(spec.targetTrackCount).toBe(13);
    expect(spec.activities).toContain("gym");
    expect(spec.genres).toEqual(expect.arrayContaining(["rap", "electronic"]));
  });

  it("disables explicit tracks when the prompt asks for clean songs", () => {
    const spec = parsePrompt("Build a study playlist with calm piano and no explicit songs.");

    expect(spec.allowExplicit).toBe(false);
    expect(spec.styles).toEqual(expect.arrayContaining(["study", "calm"]));
    expect(spec.genres).toContain("piano");
  });

  it("extracts an explicit playlist name and listed artists", () => {
    const spec = parsePrompt(`Create a Spotify playlist called "Pecuária 2026" for the concerts I am attending.

Artists included:
- Matheus e Kauan
- Simone Mendes
- Fred e Fabrício
- Alok
`);

    expect(spec.playlistNameHint).toBe("Pecuária 2026");
    expect(spec.artists).toEqual([
      "Matheus e Kauan",
      "Simone Mendes",
      "Fred e Fabrício",
      "Alok",
    ]);
  });

  it("extracts singer lists, language, genre, and popularity/recency preferences", () => {
    const spec = parsePrompt(
      "Create a playlist featuring about 30 songs from the singers: Joao Gomes, Nathan and Nathanzinho Lima. It should have their top and new hits in Brazilian Portuguese forro.",
    );

    expect(spec.targetTrackCount).toBe(30);
    expect(spec.artists).toEqual(["Joao Gomes", "Nathan", "Nathanzinho Lima"]);
    expect(spec.languages).toEqual(expect.arrayContaining(["brazilian portuguese", "portuguese"]));
    expect(spec.genres).toEqual(expect.arrayContaining(["forro"]));
    expect(spec.strictArtistMatch).toBe(true);
    expect(spec.strictLanguageMatch).toBe(true);
    expect(spec.preferPopularTracks).toBe(true);
    expect(spec.preferRecentTracks).toBe(true);
  });

  it("extracts artists from freeform preference language", () => {
    const spec = parsePrompt(
      "Make a playlist of classic rock songs. 50 songs, I really like the Eagles, big fan of Pink Floyd and Led Zeppelin, Robert Plant. Just do their biggest hits.",
    );

    expect(spec.targetTrackCount).toBe(50);
    expect(spec.genres).toContain("rock");
    expect(spec.artists).toEqual(
      expect.arrayContaining(["the Eagles", "Pink Floyd", "Led Zeppelin", "Robert Plant"]),
    );
  });

  it("detects strict artist-only and similar-artist intent separately", () => {
    const strictSpec = parsePrompt(
      "Make a 25-song playlist with only songs from Joao Gomes and Nathanzinho Lima.",
    );
    const similarSpec = parsePrompt(
      "Create a forro playlist with singers such as Joao Gomes and Nathanzinho Lima and similar singers.",
    );

    expect(strictSpec.includeOnlyRequestedArtists).toBe(true);
    expect(strictSpec.strictArtistMatch).toBe(true);
    expect(strictSpec.includeSimilarArtists).toBe(false);
    expect(similarSpec.includeSimilarArtists).toBe(true);
    expect(similarSpec.strictArtistMatch).toBe(false);
  });
});
