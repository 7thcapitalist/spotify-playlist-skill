#!/usr/bin/env node
import { getConfig } from "./config";
import { generatePlaylistFromPrompt } from "./application/generate-playlist";
import { getAuthorizedSpotifyClient } from "./spotify/auth";

function formatMinutes(durationMs: number): string {
  return `${(durationMs / 60_000).toFixed(1)} min`;
}

function printUsage(): void {
  console.log(`spotify-playlist-skill

Usage:
  npm run auth
  npm run generate -- "Make me a 20-song chill Brazilian night drive playlist"
  npm run smoke
`);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    return JSON.stringify(error, null, 2);
  }

  return String(error);
}

async function run(): Promise<void> {
  const [, , rawCommand, ...rest] = process.argv;
  const command = rawCommand ?? "help";

  if (command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  const config = getConfig();

  if (command === "auth") {
    await getAuthorizedSpotifyClient(config, { forceLogin: true });
    console.log(`Spotify auth complete. Tokens saved to ${config.spotifyTokenPath}`);
    return;
  }

  const prompt =
    command === "generate"
      ? rest.join(" ").trim()
      : command === "smoke"
        ? "Make me a 12-song chill focus playlist with calm piano and no explicit songs."
        : [command, ...rest].join(" ").trim();

  if (!prompt) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const result = await generatePlaylistFromPrompt(prompt, config);

  console.log(`Playlist: ${result.playlistName}`);
  console.log(`Tracks: ${result.selectedTracks.length}`);
  console.log(`Duration: ${formatMinutes(result.totalDurationMs)}`);
  console.log(`Queries: ${result.queries.join(" | ")}`);
  console.log(`URL: ${result.playlistUrl ?? "created successfully (no URL returned)"}`);
}

run().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
