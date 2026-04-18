import type { SpotifySkillConfig } from "../config";
import { normalizeText, uniqueStrings } from "../domain/filters";
import { parsePrompt } from "../domain/parse-prompt";
import {
  DEFAULT_TARGET_TRACK_COUNT,
  MAX_TARGET_TRACK_COUNT,
  MIN_TARGET_TRACK_COUNT,
  type PromptSpec,
} from "../domain/prompt-spec";

interface AiPromptInterpretation {
  playlistNameHint?: string;
  targetTrackCount?: number;
  targetDurationMinutes?: number;
  allowExplicit?: boolean;
  artists?: string[];
  /** Concrete artist names the AI proposes as stylistically similar to `artists`. */
  similarArtists?: string[];
  languages?: string[];
  genres?: string[];
  styles?: string[];
  activities?: string[];
  includeSimilarArtists?: boolean;
  requestedArtistTargetShare?: number;
  excludeSimilarArtistCollabsWithRequested?: boolean;
  strictArtistMatch?: boolean;
  strictLanguageMatch?: boolean;
  preferPopularTracks?: boolean;
  preferRecentTracks?: boolean;
  isPrivate?: boolean;
  seedTerms?: string[];
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

function clampTrackCount(value?: number): number {
  if (!value || Number.isNaN(value)) {
    return DEFAULT_TARGET_TRACK_COUNT;
  }

  return Math.min(MAX_TARGET_TRACK_COUNT, Math.max(MIN_TARGET_TRACK_COUNT, Math.round(value)));
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return uniqueStrings(
    values
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");

  if (start === -1) {
    return null;
  }

  let depth = 0;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function parseAiInterpretation(rawContent: string): AiPromptInterpretation | null {
  const jsonBlock = extractJsonObject(rawContent);

  if (!jsonBlock) {
    return null;
  }

  const parsed = JSON.parse(jsonBlock) as Record<string, unknown>;

  return {
    playlistNameHint:
      typeof parsed.playlistNameHint === "string" ? parsed.playlistNameHint.trim() : undefined,
    targetTrackCount: normalizeNumber(parsed.targetTrackCount),
    targetDurationMinutes: normalizeNumber(parsed.targetDurationMinutes),
    allowExplicit: normalizeBoolean(parsed.allowExplicit),
    artists: normalizeStringArray(parsed.artists),
    similarArtists: normalizeStringArray(parsed.similarArtists),
    languages: normalizeStringArray(parsed.languages),
    genres: normalizeStringArray(parsed.genres),
    styles: normalizeStringArray(parsed.styles),
    activities: normalizeStringArray(parsed.activities),
    includeSimilarArtists: normalizeBoolean(parsed.includeSimilarArtists),
    requestedArtistTargetShare: normalizeNumber(parsed.requestedArtistTargetShare),
    excludeSimilarArtistCollabsWithRequested: normalizeBoolean(
      parsed.excludeSimilarArtistCollabsWithRequested,
    ),
    strictArtistMatch: normalizeBoolean(parsed.strictArtistMatch),
    strictLanguageMatch: normalizeBoolean(parsed.strictLanguageMatch),
    preferPopularTracks: normalizeBoolean(parsed.preferPopularTracks),
    preferRecentTracks: normalizeBoolean(parsed.preferRecentTracks),
    isPrivate: normalizeBoolean(parsed.isPrivate),
    seedTerms: normalizeStringArray(parsed.seedTerms),
  };
}

function mergePromptSpec(baseSpec: PromptSpec, aiSpec: AiPromptInterpretation): PromptSpec {
  const artists = aiSpec.artists && aiSpec.artists.length > 0 ? aiSpec.artists : baseSpec.artists;
  const languages =
    aiSpec.languages && aiSpec.languages.length > 0 ? aiSpec.languages : baseSpec.languages;
  const genres = aiSpec.genres && aiSpec.genres.length > 0 ? aiSpec.genres : baseSpec.genres;
  const styles = aiSpec.styles && aiSpec.styles.length > 0 ? aiSpec.styles : baseSpec.styles;
  const activities =
    aiSpec.activities && aiSpec.activities.length > 0 ? aiSpec.activities : baseSpec.activities;
  const includeSimilarArtists = aiSpec.includeSimilarArtists ?? baseSpec.includeSimilarArtists;

  // Artists listed by the AI as "similar" — must not duplicate the primary artists.
  // Compare after stripping diacritics so "Matuê" matches "Matue".
  const normalizeArtistKey = (value: string): string =>
    normalizeText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  const primaryArtistsNormalized = new Set(artists.map(normalizeArtistKey));
  const similarArtists = includeSimilarArtists
    ? uniqueStrings(
        (aiSpec.similarArtists ?? [])
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
          .filter((value) => !primaryArtistsNormalized.has(normalizeArtistKey(value))),
      )
    : [];

  const requestedArtistTargetShare =
    aiSpec.requestedArtistTargetShare ??
    (includeSimilarArtists && artists.length >= 1 ? 0.4 : undefined);
  const strictArtistMatch =
    aiSpec.strictArtistMatch ?? (artists.length > 0 && !includeSimilarArtists);
  const strictLanguageMatch = aiSpec.strictLanguageMatch ?? (languages.length > 0);

  return {
    rawPrompt: baseSpec.rawPrompt,
    targetTrackCount: clampTrackCount(aiSpec.targetTrackCount ?? baseSpec.targetTrackCount),
    targetDurationMinutes: aiSpec.targetDurationMinutes ?? baseSpec.targetDurationMinutes,
    allowExplicit: aiSpec.allowExplicit ?? baseSpec.allowExplicit,
    artists,
    similarArtists,
    languages,
    genres,
    styles,
    activities,
    seedTerms: uniqueStrings([
      ...artists,
      ...similarArtists,
      ...languages,
      ...genres,
      ...styles,
      ...activities,
      ...(aiSpec.seedTerms ?? []),
      ...baseSpec.seedTerms,
    ]),
    playlistNameHint: aiSpec.playlistNameHint || baseSpec.playlistNameHint,
    strictArtistMatch,
    strictLanguageMatch,
    includeOnlyRequestedArtists: strictArtistMatch && !includeSimilarArtists,
    includeSimilarArtists,
    requestedArtistTargetShare,
    excludeSimilarArtistCollabsWithRequested:
      aiSpec.excludeSimilarArtistCollabsWithRequested ??
      baseSpec.excludeSimilarArtistCollabsWithRequested,
    preferPopularTracks: aiSpec.preferPopularTracks ?? baseSpec.preferPopularTracks,
    preferRecentTracks: aiSpec.preferRecentTracks ?? baseSpec.preferRecentTracks,
    interpretationSource: "merged",
    isPrivate: aiSpec.isPrivate ?? baseSpec.isPrivate,
  };
}

function getChatCompletionText(response: OpenAiChatCompletionResponse): string {
  const content = response.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" ? part.text ?? "" : ""))
      .join("")
      .trim();
  }

  return "";
}

async function requestAiInterpretation(
  prompt: string,
  heuristicSpec: PromptSpec,
  config: SpotifySkillConfig,
): Promise<AiPromptInterpretation | null> {
  if (!config.aiInterpretationEnabled || !config.aiApiKey) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.aiTimeoutMs);

  try {
    const response = await fetch(`${config.aiBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.aiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.aiModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You normalize music-playlist prompts into structured JSON.",
              "Return JSON only.",
              "Honor these rules strictly:",
              "- If the user specifies a language, copy it into `languages` and set `strictLanguageMatch` to true.",
              "- If the user names artists, keep them in `artists`. Never invent artists here.",
              "- Treat named artists as strict by default: set `strictArtistMatch` to true unless the user explicitly asks for similar artists.",
              "- Set `includeSimilarArtists` to true whenever the user asks for 'similar artists', 'top artists like', 'other trap/rap/etc. artists', or expresses an open genre/scene intent around their named artists.",
              "- When `includeSimilarArtists` is true, populate `similarArtists` with 8-15 concrete, real, popular artist names that fit the same genre/scene/market/era as the named `artists`. These MUST be different real artists, never the primary artists, and never generic labels like 'TikTok Hits'. For Brazilian trap around Matue and Veigh, examples could include Teto, WIU, Chefin, Kayblack, Orochi, Derek, L7NNON, Djonga, MC Ryan SP — pick whoever is currently popular in that scene.",
              "- Set `requestedArtistTargetShare` between 0 and 1 to indicate how much of the playlist should come from the named `artists` vs. `similarArtists`. Default to 0.4 when the prompt says 'include similar artists', 0.3 when the user emphasises the scene over the names, 0.6 when they emphasise the names.",
              "- Set `excludeSimilarArtistCollabsWithRequested` to true when the user asks for songs from OTHER artists / without features of the named ones (e.g. 'songs only from the other artists without a feature with Matue or Veigh').",
              "- Infer genre, style, popularity-vs-recency intent, and approximate track count when clear.",
              "- Do not invent the primary `artists` themselves. `similarArtists` MUST be populated by you when `includeSimilarArtists` is true.",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              prompt,
              heuristicSpec,
              desiredShape: {
                playlistNameHint: "string",
                targetTrackCount: "number",
                targetDurationMinutes: "number",
                allowExplicit: "boolean",
                artists: ["string"],
                similarArtists: ["string"],
                languages: ["string"],
                genres: ["string"],
                styles: ["string"],
                activities: ["string"],
                includeSimilarArtists: "boolean",
                requestedArtistTargetShare: "number",
                excludeSimilarArtistCollabsWithRequested: "boolean",
                strictArtistMatch: "boolean",
                strictLanguageMatch: "boolean",
                preferPopularTracks: "boolean",
                preferRecentTracks: "boolean",
                isPrivate: "boolean",
                seedTerms: ["string"],
              },
            }),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as OpenAiChatCompletionResponse;
    const rawText = getChatCompletionText(payload);

    if (!rawText) {
      return null;
    }

    return parseAiInterpretation(rawText);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function interpretPrompt(
  prompt: string,
  config: SpotifySkillConfig,
): Promise<PromptSpec> {
  const heuristicSpec = parsePrompt(prompt);
  const aiSpec = await requestAiInterpretation(prompt, heuristicSpec, config);

  if (!aiSpec) {
    return heuristicSpec;
  }

  const merged = mergePromptSpec(heuristicSpec, aiSpec);
  const hasMeaningfulDifference =
    normalizeText(JSON.stringify(merged)) !== normalizeText(JSON.stringify(heuristicSpec));

  return hasMeaningfulDifference
    ? merged
    : {
        ...heuristicSpec,
        interpretationSource: "ai",
      };
}
