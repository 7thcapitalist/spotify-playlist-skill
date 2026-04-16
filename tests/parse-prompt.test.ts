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
});
