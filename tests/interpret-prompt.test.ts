import { afterEach, describe, expect, it, vi } from "vitest";

import type { SpotifySkillConfig } from "../src/config";
import { interpretPrompt } from "../src/ai/interpret-prompt";

const baseConfig: SpotifySkillConfig = {
  spotifyClientId: "spotify-client-id",
  spotifyClientSecret: "spotify-client-secret",
  spotifyRedirectUri: "http://127.0.0.1:8888/callback",
  spotifyTokenPath: ".spotify-playlist-skill.tokens.json",
  spotifyDefaultMarket: "BR",
  oauthScopes: ["playlist-modify-private", "playlist-modify-public"],
  authorizationTimeoutMs: 120_000,
  aiInterpretationEnabled: false,
  aiProvider: "openai-compatible",
  aiApiKey: undefined,
  aiBaseUrl: "https://api.openai.com/v1",
  aiModel: "gpt-4.1-mini",
  aiTimeoutMs: 15_000,
};

describe("interpretPrompt", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to the heuristic parser when AI interpretation is disabled", async () => {
    const spec = await interpretPrompt(
      "Create a forro playlist in Brazilian Portuguese with singers such as Joao Gomes and Natanzinho Lima.",
      baseConfig,
    );

    expect(spec.interpretationSource).toBe("heuristic");
    expect(spec.artists).toEqual(expect.arrayContaining(["Joao Gomes", "Natanzinho Lima"]));
    expect(spec.languages).toContain("brazilian portuguese");
  });

  it("merges AI interpretation output when a provider response is available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  artists: ["Joao Gomes", "Nattan"],
                  languages: ["brazilian portuguese"],
                  genres: ["forro"],
                  targetTrackCount: 30,
                  includeSimilarArtists: true,
                  requestedArtistTargetShare: 0.4,
                  strictArtistMatch: false,
                  strictLanguageMatch: true,
                  preferPopularTracks: true,
                  preferRecentTracks: true,
                  seedTerms: ["joao gomes", "nattan", "forro", "brazilian portuguese"],
                }),
              },
            },
          ],
        }),
      })) as typeof fetch,
    );

    const spec = await interpretPrompt(
      "Create a Forro playlist in Brazilian portuguese with singers such as Joao Gomes and Nattan and similar singers. I want their most popular and new hits.",
      {
        ...baseConfig,
        aiInterpretationEnabled: true,
        aiApiKey: "test-key",
      },
    );

    expect(spec.interpretationSource).toBe("merged");
    expect(spec.targetTrackCount).toBe(30);
    expect(spec.artists).toEqual(["Joao Gomes", "Nattan"]);
    expect(spec.languages).toEqual(["brazilian portuguese"]);
    expect(spec.includeSimilarArtists).toBe(true);
    expect(spec.requestedArtistTargetShare).toBe(0.4);
    expect(spec.strictArtistMatch).toBe(false);
    expect(spec.strictLanguageMatch).toBe(true);
  });
});
