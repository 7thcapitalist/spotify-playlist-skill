---
name: spotify-playlist
description: Generate Spotify playlists from natural-language prompts using the local spotify-playlist-skill CLI. Use when the user asks to make, build, create, or generate a Spotify playlist from a text prompt, especially when they mention mood, genre, duration, song count, or clean/no-explicit constraints.
---

# Spotify Playlist

## When To Use

Use this skill when a user wants a Spotify playlist created from a prompt such as:

- `Make me a 50-song chill Brazilian night drive playlist`
- `Create a 45-minute gym playlist with rap and electronic music`
- `Build a study playlist with calm piano and no explicit songs`

## Prerequisites

- The repo must have a valid `.env` with Spotify credentials.
- The user must have completed `npm run auth` at least once, or be willing to authorize in the browser.

## Workflow

1. From the project root, ensure dependencies are installed.
2. If auth has not been completed yet, run:

```bash
npm run auth
```

3. Generate the playlist with:

```bash
npm run generate -- "<user prompt>"
```

4. Return the playlist name, track count, approximate duration, and Spotify URL to the user.

## Notes

- The tool creates private playlists by default.
- If no count is requested, generation defaults to 50 songs.
- The orchestration is local and custom; Spotify auth/search/playlist calls go through `spotify-web-api-node`.
- If the prompt is too narrow and no tracks are found, suggest broadening the genre or mood terms.
