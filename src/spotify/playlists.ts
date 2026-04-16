import type SpotifyWebApi from "spotify-web-api-node";

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }

  return result;
}

export async function createPlaylistWithTracks(
  spotifyApi: SpotifyWebApi,
  options: {
    name: string;
    description: string;
    isPrivate: boolean;
    trackUris: string[];
  },
): Promise<{ id: string; url?: string }> {
  if (options.trackUris.length === 0) {
    throw new Error("Cannot create a Spotify playlist without any tracks.");
  }

  const playlistResponse = await spotifyApi.createPlaylist(options.name, {
    description: options.description,
    collaborative: false,
    public: !options.isPrivate,
  });

  const accessToken = spotifyApi.getAccessToken();

  if (!accessToken) {
    throw new Error("Spotify access token is missing before adding playlist items.");
  }

  for (const batch of chunk(options.trackUris, 100)) {
    const response = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistResponse.body.id}/items`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uris: batch }),
      },
    );

    if (!response.ok) {
      const responseText = await response.text();

      throw new Error(
        `Failed to add items to playlist ${playlistResponse.body.id}: ${response.status} ${response.statusText} ${responseText}`,
      );
    }
  }

  return {
    id: playlistResponse.body.id,
    url: playlistResponse.body.external_urls?.spotify,
  };
}
