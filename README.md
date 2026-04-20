# spotify-playlist-skill

Generate Spotify playlists from natural-language prompts with a local TypeScript CLI and a repo-local Cursor/OpenClaw skill.

## What It Does

`spotify-playlist-skill` turns prompts like:

- `Make me a 50-song chill Brazilian night drive playlist.`
- `Create a 45-minute gym playlist with rap and electronic music.`
- `Build a study playlist with calm piano and no explicit songs.`
- `Create a Spotify playlist called Pecuária 2026 with Matheus e Kauan, Simone Mendes, Fred e Fabrício, and Alok.`

into real Spotify playlists using your own Spotify account and app credentials.

## Features

- Natural-language parsing for playlist name, song count, duration, mood, genre, and clean-only requests
- Optional AI-backed prompt interpretation before Spotify search
- Explicit artist extraction from both structured and freeform prompts
- Multi-artist balancing so requested artists are all represented
- **AI-driven similar-artist expansion**: when the prompt says "and similar artists", the AI proposes concrete artist names (e.g. for Brazilian trap: Teto, WIU, Chefin, Orochi, KayBlack, L7NNON, Djonga…), each is resolved against Spotify and filtered by genre overlap to avoid mismatches
- **Requested-vs-similar target share**: control what fraction of the playlist comes from the named artists vs. the scene (defaults to 40/60 when similar artists are included)
- **No-collab mode**: when asked for "songs from other artists without a feature with \<primary\>", tracks in the similar-artist bucket that feature the primary artists are filtered out
- Duplicate-release collapsing (same song across single / album / reissue URIs is counted once)
- Compilation-account filtering (drops low-quality uploads like "Top Hits", "TikTok Hits", karaoke, tributes, cover accounts) from the similar-artist pool
- Spotify OAuth bootstrap with local token persistence
- SDK-backed Spotify integration via `spotify-web-api-node`
- Local CLI workflow plus a repo-local Cursor/OpenClaw skill
- Focused tests for parsing, selection, and artist filtering logic

## Requirements

- Node.js 20+
- npm
- A Spotify account
- Your own Spotify Developer app credentials

## Spotify App Setup

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Create an app.
3. Set the redirect URI to:

```text
http://127.0.0.1:8888/callback
```

4. Enable `Web API`.
5. Copy your `Client ID` and `Client Secret`.

## Environment Variables

Copy `.env.example` to `.env`.

PowerShell:

```powershell
Copy-Item .env.example .env
```

macOS/Linux:

```bash
cp .env.example .env
```

Then fill in your real values in `.env`.

Example template:

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback
SPOTIFY_DEFAULT_MARKET=BR
SPOTIFY_TOKEN_PATH=.spotify-playlist-skill.tokens.json
AI_INTERPRETATION_ENABLED=true
AI_API_KEY=your_ai_api_key
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4.1-mini
AI_TIMEOUT_MS=15000
```

AI variables are optional. If `AI_API_KEY` is missing or `AI_INTERPRETATION_ENABLED=false`, the app falls back to the built-in heuristic parser.

## Installation

```bash
npm install
```

## Usage

Authorize once:

```bash
npm run auth
```

Generate a playlist:

```bash
npm run generate -- "Create a 45-minute gym playlist with rap and electronic music"
```

Run the smoke prompt:

```bash
npm run smoke
```

## AI Interpretation

When AI interpretation is enabled, the app asks the model to normalize the raw prompt into a structured request before Spotify search. This is especially useful for:

- Strict artist prompts
- Fixed-language requests such as Brazilian Portuguese
- Genre + similar-artist prompts
- "Top hits" vs "new hits" intent
- **Similar-artist expansion**: the model proposes a concrete list of scene-matching artists (e.g. for Brazilian trap around Matuê and Veigh the model may suggest Teto, WIU, Chefin, Orochi, L7NNON, Djonga, MC Ryan SP, KayBlack…). These get resolved on Spotify and filtered by genre overlap with the primary artists before their catalogs are searched.

The AI layer only interprets the prompt and proposes similar-artist names. Spotify search, filtering, scoring, and playlist creation still run locally in the app.

### Prompting tips

- Use phrases like **"and similar artists"**, **"top artists in the X scene"**, or **"other rappers like …"** to opt into similar-artist expansion.
- Use **"songs only from the other similar artists, no features with \<primary\>"** to exclude collabs from the similar-artist share.
- If you omit a count, the default is now **50 songs**.
- Use **"50 songs from …"** / **"20-song playlist"** to pin a custom track count.
- To disable the AI layer for a run and use only the built-in heuristic parser:

  ```powershell
  $env:AI_INTERPRETATION_ENABLED = "false"
  npm run generate -- "<prompt>"
  ```

  ```bash
  AI_INTERPRETATION_ENABLED=false npm run generate -- "<prompt>"
  ```

## Cursor / OpenClaw Usage

This repo also includes a local skill at `.cursor/skills/spotify-playlist/SKILL.md`.

Once the repo is open in Cursor, you can ask in chat:

- `Create me a 50-song chill Brazilian night drive playlist`
- `Make a playlist of classic rock songs. 50 songs, I really like the Eagles, Pink Floyd, Led Zeppelin, and Robert Plant.`

## Project Structure

```text
src/
  application/   playlist generation orchestration
  domain/        prompt parsing, filtering, and selection rules
  spotify/       auth, search, and playlist adapters
tests/           prompt and track selection tests
.cursor/skills/  repo-local skill instructions
```

## Architecture

The project keeps custom logic in the domain/application layers and pushes Spotify SDK calls behind a thin gateway:

- `src/domain/parse-prompt.ts`: heuristic prompt interpretation
- `src/ai/interpret-prompt.ts`: optional AI normalization plus heuristic fallback, including similar-artist expansion
- `src/domain/prompt-spec.ts`: the structured `PromptSpec` consumed by the rest of the pipeline
- `src/domain/select-tracks.ts`: query building, filtering, balancing, and ranking
- `src/domain/review-selection.ts`: post-selection review (language match, compilation-account filter, artist policy)
- `src/domain/filters.ts`: dedup / explicit / duration utilities
- `src/application/generate-playlist.ts`: orchestrates AI interpretation, artist resolution, candidate fetching, share composition, and playlist creation
- `src/spotify/auth.ts`: OAuth flow, refresh, and token persistence
- `src/spotify/search.ts`: Spotify search and artist resolution helpers
- `src/spotify/playlists.ts`: playlist creation and item insertion

### How similar-artist expansion works

1. The AI layer returns `artists` (user-named) plus a `similarArtists` list of concrete, scene-matching names.
2. Each proposed similar artist is resolved on Spotify (capped at 8 to respect Spotify rate limits).
3. Resolved matches whose Spotify genres don't overlap with the primary artists' scene are dropped (prevents ambiguous names like "Derek" from matching unrelated artists).
4. Each artist's catalog is searched; user-named artists get deeper pagination, similar artists get a lighter plan.
5. Related-pool tracks are pre-filtered to drop compilation accounts and optionally drop collabs with the primary artists.
6. The final selection respects `requestedArtistTargetShare` (e.g. 0.4 → 40% primary / 60% similar) and runs `reviewAndRepairSelection` before the share split so the balance survives.

## Quality Checks

```bash
npm run check
```

## Security

- Do **not** commit `.env`
- Do **not** commit `.spotify-playlist-skill.tokens.json`
- Do **not** share your real Spotify client secret
- This repo should only publish `.env.example` with placeholder values

If your client secret was exposed during development, rotate it in the Spotify Developer Dashboard before publishing.

## Limitations

- The fallback parser is still heuristic, not a full LLM planner
- AI interpretation is optional and depends on your configured provider/API key
- "Likely live songs" is approximated through Spotify search and popularity signals, not official live setlists
- The tool creates private playlists by default
- Results depend on Spotify's current catalog, market availability, and API behavior
- Spotify's `getArtistRelatedArtists` endpoint was deprecated in late 2024; similar-artist expansion now relies on the AI layer. Without an AI key the "similar artists" feature falls back to a best-effort genre search and may be sparser
- Repeated back-to-back generations can trigger Spotify's per-app rate limit (HTTP 429). If you hit this, wait for the `retry-after` window to pass

## Publishing

This repo is designed so other people can use it with their own Spotify app credentials. After cloning, they should:

1. Run `npm install`
2. Copy `.env.example` to `.env`
3. Add their own Spotify credentials
4. Run `npm run auth`
5. Run `npm run generate -- "<their prompt>"`

## License

MIT
