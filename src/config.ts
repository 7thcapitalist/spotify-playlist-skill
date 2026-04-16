import dotenv from "dotenv";
import path from "node:path";

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
  quiet: true,
  override: true,
});

const DEFAULT_SCOPES = ["playlist-modify-private", "playlist-modify-public"];

export interface SpotifySkillConfig {
  spotifyClientId: string;
  spotifyClientSecret: string;
  spotifyRedirectUri: string;
  spotifyTokenPath: string;
  spotifyDefaultMarket: string;
  oauthScopes: string[];
  authorizationTimeoutMs: number;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }

  if (value.startsWith("your_spotify_")) {
    throw new Error(
      `Environment variable ${name} is still using a placeholder value. Update .env with your real Spotify app credentials.`,
    );
  }

  return value;
}

export function getConfig(): SpotifySkillConfig {
  const tokenPath = process.env.SPOTIFY_TOKEN_PATH?.trim() || ".spotify-playlist-skill.tokens.json";

  return {
    spotifyClientId: requireEnv("SPOTIFY_CLIENT_ID"),
    spotifyClientSecret: requireEnv("SPOTIFY_CLIENT_SECRET"),
    spotifyRedirectUri: requireEnv("SPOTIFY_REDIRECT_URI"),
    spotifyTokenPath: path.resolve(process.cwd(), tokenPath),
    spotifyDefaultMarket: process.env.SPOTIFY_DEFAULT_MARKET?.trim() || "US",
    oauthScopes: DEFAULT_SCOPES,
    authorizationTimeoutMs: 120_000,
  };
}
