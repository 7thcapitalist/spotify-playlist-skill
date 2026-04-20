---
name: spotify-playlist
description: Generate Spotify playlists from natural-language prompts using the local spotify-playlist-skill CLI. Use when the user asks to make, build, create, or generate a Spotify playlist from a text prompt, especially when they mention mood, genre, duration, song count, or clean/no-explicit constraints.
---

# Spotify Playlist

This is the publishable copy of the repo-local skill documented in `.cursor/skills/spotify-playlist/SKILL.md`.

## Quick Start

```bash
npm install
npm run auth
npm run generate -- "Make me a 50-song chill Brazilian night drive playlist"
```

## Notes

- Private playlists are the default.
- If the user prompt does not specify a track count, the app defaults to 50 songs.
- Spotify API access is handled by `spotify-web-api-node`.
- Playlist orchestration stays in the local TypeScript codebase, not in the skill instructions.
