import { randomBytes } from "node:crypto";
import { exec } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { URL } from "node:url";

import type SpotifyWebApi from "spotify-web-api-node";

import type { SpotifySkillConfig } from "../config";
import type { StoredSpotifyTokens } from "../types";
import { createSpotifyClient } from "./client";

const TOKEN_REFRESH_BUFFER_MS = 60_000;

function hasRequiredScopes(grantedScope: string | undefined, requiredScopes: string[]): boolean {
  const granted = new Set(
    (grantedScope ?? "")
      .split(/\s+/)
      .map((scope) => scope.trim())
      .filter(Boolean),
  );

  return requiredScopes.every((scope) => granted.has(scope));
}

export async function loadStoredTokens(tokenPath: string): Promise<StoredSpotifyTokens | null> {
  try {
    const contents = await readFile(tokenPath, "utf8");
    return JSON.parse(contents) as StoredSpotifyTokens;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function saveStoredTokens(tokenPath: string, tokens: StoredSpotifyTokens): Promise<void> {
  await mkdir(dirname(tokenPath), { recursive: true });
  await writeFile(tokenPath, `${JSON.stringify(tokens, null, 2)}\n`, "utf8");
}

function isTokenFresh(tokens: StoredSpotifyTokens): boolean {
  return Date.now() < tokens.expiresAt - TOKEN_REFRESH_BUFFER_MS;
}

function toStoredTokens(
  responseBody: AuthorizationCodeGrantResponse | RefreshAccessTokenResponse,
  previous?: StoredSpotifyTokens,
): StoredSpotifyTokens {
  return {
    accessToken: responseBody.access_token,
    refreshToken: responseBody.refresh_token ?? previous?.refreshToken,
    expiresAt: Date.now() + responseBody.expires_in * 1000,
    tokenType: responseBody.token_type,
    scope: responseBody.scope ?? previous?.scope,
  };
}

async function openBrowser(url: string): Promise<void> {
  const command =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;

  await new Promise<void>((resolve) => {
    exec(command, (error) => {
      if (error) {
        console.log(`Open this URL manually to authorize Spotify: ${url}`);
      }

      resolve();
    });
  });
}

async function waitForAuthorizationCode(
  redirectUri: string,
  expectedState: string,
  timeoutMs: number,
): Promise<string> {
  const redirectUrl = new URL(redirectUri);

  if (redirectUrl.protocol !== "http:") {
    throw new Error("Spotify auth redirect URI must use http:// for the local callback server.");
  }

  return new Promise<string>((resolve, reject) => {
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", redirectUri);

      if (requestUrl.pathname !== redirectUrl.pathname) {
        response.statusCode = 404;
        response.end("Not found.");
        return;
      }

      const state = requestUrl.searchParams.get("state");
      const code = requestUrl.searchParams.get("code");
      const authError = requestUrl.searchParams.get("error");

      if (authError) {
        response.statusCode = 400;
        response.end(`Spotify authorization failed: ${authError}`);
        server.close();
        reject(new Error(`Spotify authorization failed: ${authError}`));
        return;
      }

      if (state !== expectedState || !code) {
        response.statusCode = 400;
        response.end("Invalid Spotify authorization callback.");
        server.close();
        reject(new Error("Received an invalid Spotify authorization callback."));
        return;
      }

      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end("<h1>Spotify authorization complete.</h1><p>You can close this tab.</p>");
      server.close();
      resolve(code);
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for the Spotify authorization callback."));
    }, timeoutMs);

    server.once("close", () => clearTimeout(timeout));
    server.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    server.listen(Number(redirectUrl.port), redirectUrl.hostname);
  });
}

async function runAuthorizationCodeFlow(
  spotifyApi: SpotifyWebApi,
  config: SpotifySkillConfig,
): Promise<StoredSpotifyTokens> {
  const state = randomBytes(16).toString("hex");
  const authorizationUrl = spotifyApi.createAuthorizeURL(config.oauthScopes, state, true);
  const codePromise = waitForAuthorizationCode(
    config.spotifyRedirectUri,
    state,
    config.authorizationTimeoutMs,
  );

  console.log("Starting Spotify authorization flow...");
  await openBrowser(authorizationUrl);

  if (!process.env.CI) {
    console.log(`If your browser did not open, visit:\n${authorizationUrl}`);
  }

  const code = await codePromise;
  const response = await spotifyApi.authorizationCodeGrant(code);

  return toStoredTokens(response.body);
}

async function refreshTokens(
  spotifyApi: SpotifyWebApi,
  config: SpotifySkillConfig,
  storedTokens: StoredSpotifyTokens,
): Promise<StoredSpotifyTokens> {
  spotifyApi.setRefreshToken(storedTokens.refreshToken ?? "");

  const response = await spotifyApi.refreshAccessToken();
  const refreshed = toStoredTokens(response.body, storedTokens);
  await saveStoredTokens(config.spotifyTokenPath, refreshed);

  return refreshed;
}

export async function getAuthorizedSpotifyClient(
  config: SpotifySkillConfig,
  options?: { forceLogin?: boolean },
): Promise<SpotifyWebApi> {
  const storedTokens = options?.forceLogin ? null : await loadStoredTokens(config.spotifyTokenPath);
  const spotifyApi = createSpotifyClient(config, storedTokens ?? undefined);
  const missingScopes =
    storedTokens && !hasRequiredScopes(storedTokens.scope, config.oauthScopes);

  if (missingScopes) {
    console.log("Stored Spotify token is missing newly required scopes. Reauthorizing...");
  }

  if (storedTokens && !missingScopes && isTokenFresh(storedTokens)) {
    return spotifyApi;
  }

  if (storedTokens?.refreshToken && !missingScopes) {
    try {
      const refreshed = await refreshTokens(spotifyApi, config, storedTokens);
      spotifyApi.setAccessToken(refreshed.accessToken);

      if (refreshed.refreshToken) {
        spotifyApi.setRefreshToken(refreshed.refreshToken);
      }

      return spotifyApi;
    } catch (error) {
      console.warn("Spotify token refresh failed, falling back to a new browser login.");
      console.warn(error instanceof Error ? error.message : error);
    }
  }

  const authorizedTokens = await runAuthorizationCodeFlow(spotifyApi, config);
  await saveStoredTokens(config.spotifyTokenPath, authorizedTokens);
  spotifyApi.setAccessToken(authorizedTokens.accessToken);

  if (authorizedTokens.refreshToken) {
    spotifyApi.setRefreshToken(authorizedTokens.refreshToken);
  }

  return spotifyApi;
}

interface AuthorizationCodeGrantResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: string;
}

interface RefreshAccessTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
}
