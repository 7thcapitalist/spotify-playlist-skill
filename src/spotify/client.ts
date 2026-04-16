import SpotifyWebApi from "spotify-web-api-node";

import type { SpotifySkillConfig } from "../config";
import type { StoredSpotifyTokens } from "../types";

export function createSpotifyClient(
  config: SpotifySkillConfig,
  tokens?: StoredSpotifyTokens,
): SpotifyWebApi {
  const client = new SpotifyWebApi({
    clientId: config.spotifyClientId,
    clientSecret: config.spotifyClientSecret,
    redirectUri: config.spotifyRedirectUri,
  });

  if (tokens) {
    client.setAccessToken(tokens.accessToken);

    if (tokens.refreshToken) {
      client.setRefreshToken(tokens.refreshToken);
    }
  }

  return client;
}
