# SceneFinder Upload Backend

This is the backend for **SceneFinder**, a service that allows users to upload short video or audio clips and attempts to identify the movie or series scene from the transcript using OpenAI and web search tools.

## Features

- **Video/Audio Upload:** Accepts video/audio files (MP4, MOV, MP3, M4A, WAV, FLAC, OGG, WEBM) up to 5MB.
- **Automatic Transcription:** Uses OpenAI Whisper to transcribe uploaded media.
- **Scene Identification:** 
  - First tries to identify the scene using GPT-4o based on the transcript.
  - If uncertain, uses SerpAPI and YouTube search to find matching scenes.
- **YouTube Transcript Fetching:** Attempts to fetch and parse YouTube captions for more context.
- **Modern Stack:** Built with Node.js, Express, Multer, OpenAI, Google APIs, and Axios.

## Directory Structure

```
.
├── server.js                 # Main Express server and API logic
├── package.json              # Project metadata and dependencies
├── package-lock.json         # Dependency lock file
├── .gitignore                # Excludes node_modules, .env, uploads from git
├── oauth2-credentials.json   # Google OAuth2 credentials (DO NOT COMMIT SENSITIVE DATA)
├── uploads/                  # Temporary storage for uploaded files (gitignored)
├── node_modules/             # Installed dependencies (gitignored)
└── .git/                     # Git version control directory
```

## Setup Instructions

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd scenefinder-upload-backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Variables

Create a `.env` file in the root directory with the following variables:

```
OPENAI_API_KEY=your_openai_api_key
SERPAPI_KEY=your_serpapi_key
YOUTUBE_CLIENT_ID=your_google_client_id
YOUTUBE_CLIENT_SECRET=your_google_client_secret
YOUTUBE_REDIRECT_URI=your_google_redirect_uri
YOUTUBE_REFRESH_TOKEN=your_google_refresh_token
PORT=3000
```

- You can obtain Google OAuth2 credentials from the [Google Cloud Console](https://console.cloud.google.com/).
- The `oauth2-credentials.json` file is used for Google API access. **Do not commit this file with real credentials.**

### 4. Start the Server

```bash
npm start
```

The server will run on `http://localhost:3000` by default.

## API Endpoints

### Health Check

- `GET /`
  - Returns: `{ status: 'OK', message: 'SceneFinder backend is running' }`

### Upload and Scene Identification

- `POST /api/upload`
  - **Form Data:** `video` (file)
  - **Accepts:** MP4, MOV, MP3, M4A, WAV, FLAC, OGG, WEBM (max 5MB)
  - **Returns:** JSON with identified scene details or error message.

#### Example Response

```json
{
  "success": true,
  "data": {
    "movie_or_series": "Rim of the World",
    "season": null,
    "episode": null,
    "characters": ["Security Officer", "Camper"],
    "timestamp": "Approx. 00:03:00",
    "context_or_summary": "A comedic misunderstanding about placing a cell phone in a box at summer camp."
  }
}
```

## How It Works

1. **Upload:** User uploads a short video/audio clip.
2. **Transcription:** The backend transcribes the audio using OpenAI Whisper.
3. **Scene Analysis:** 
   - First, GPT-4o tries to identify the scene from the transcript.
   - If not confident, it uses SerpAPI to search Google/YouTube for matching scenes and fetches YouTube captions if available.
   - The backend returns a structured JSON with the best guess for the movie/series, characters, timestamp, and context.

## Notes

- The `uploads/` directory is used for temporary file storage and is gitignored.
- The backend is designed for modern films/series (post-2000), especially those with comedic or lighthearted elements.
- **Sensitive keys and credentials must not be committed to the repository.**

## Dependencies

- express
- multer
- openai
- cors
- dotenv
- axios
- googleapis
- google-auth-library
