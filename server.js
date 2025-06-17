const express = require('express');
const multer = require('multer');
const { OpenAI } = require('openai');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');

require('dotenv').config();

const app = express();

// Configure multer for memory storage instead of disk storage
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'SceneFinder backend is running' });
});

// SerpAPI setup
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const SERPAPI_BASE_URL = 'https://serpapi.com/search';

// Function to search web using SerpAPI
const searchWeb = async (query) => {
  try {
    console.log('SerpAPI Query:', query);
    const searchResponse = await axios.get(SERPAPI_BASE_URL, {
      params: {
        api_key: SERPAPI_KEY,
        q: query,
        engine: 'google',
        num: 5,
      },
    });

    const results = searchResponse.data.organic_results || [];
    console.log('SerpAPI Results:', results);

    return JSON.stringify({
      results: results.map(result => ({
        title: result.title,
        link: result.link,
        snippet: result.snippet
      }))
    });
  } catch (error) {
    console.error('SerpAPI error:', error.message);
    if (error.response && (error.response.status === 403 || error.response.status === 429)) {
      console.log('SerpAPI quota likely exhausted. Skipping SerpAPI search.');
      return JSON.stringify({ quota_exhausted: true });
    }
    return JSON.stringify({ results: [] });
  }
};

// Upload endpoint
app.post('/api/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    console.log('Uploaded file:', {
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    const allowedTypes = ['video/mp4', 'video/quicktime', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/flac', 'audio/ogg', 'video/webm'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ error: `Invalid file type. Only MP4, MOV, MP3, M4A, WAV, FLAC, OGG, and WEBM are supported. Got: ${req.file.mimetype}` });
    }

    // Create a temporary file from the buffer using os.tmpdir()
    const tempFilePath = path.join(os.tmpdir(), `temp-${Date.now()}-${req.file.originalname}`);
    fs.writeFileSync(tempFilePath, req.file.buffer);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-1',
    });
    console.log('Whisper Transcription:', transcription.text);

    // Clean up the temporary file
    fs.unlinkSync(tempFilePath);

    // First attempt: Try to identify the scene using GPT-4 without web search
    const initialCompletion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant that identifies movie or TV show scenes from transcripts. 
          You must respond with a valid JSON object in EXACTLY this format:
          {
            "movie_or_series": "<movie or series name, or 'Unknown' if not identifiable>",
            "season": <season number as integer, or null if not a series or unknown>,
            "episode": <episode number as integer, or null if not a series or unknown>,
            "characters": [<array of character names as strings, or "Unknown" if not identifiable>],
            "timestamp": "<approximate timestamp in 'Approx. HH:MM:SS' format, or 'Unknown' if not identifiable>",
            "context_or_summary": "<brief summary of the scene, including its role in the story, or a best guess>"
          }
          Important rules:
          1. For movies, set season and episode to null
          2. For TV shows, provide season and episode numbers as integers
          3. Timestamp must be in 'Approx. HH:MM:SS' format or 'Unknown'
          4. If you cannot identify the movie/series with high confidence, set movie_or_series to "Unknown"
          5. Do not include any text outside the JSON object`
        },
        {
          role: "user",
          content: `Please identify this scene from the following transcript: ${transcription.text}`
        }
      ]
    });

    let sceneDetails = JSON.parse(initialCompletion.choices[0].message.content);
    console.log('Initial GPT-4 Response:', sceneDetails);

    // Only use SerpAPI if GPT-4 couldn't identify the movie/series with high confidence
    if (sceneDetails.confidence === "low" || sceneDetails.movie_or_series === "Unknown") {
      console.log('GPT-4 could not identify with high confidence. Using SerpAPI as fallback...');
      
      const searchQuery = `${transcription.text} movie scene`;
      const searchResults = await searchWeb(searchQuery);
      const parsedResults = JSON.parse(searchResults);

      // Second attempt: Use GPT-4 with search results
      const finalCompletion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: `You are a helpful assistant that identifies movie or TV show scenes from transcripts. 
            Use the provided search results to help identify the scene. You must respond with a valid JSON object in EXACTLY this format:
            {
              "movie_or_series": "<movie or series name, or 'Unknown' if not identifiable>",
              "season": <season number as integer, or null if not a series or unknown>,
              "episode": <episode number as integer, or null if not a series or unknown>,
              "characters": [<array of character names as strings, or "Unknown" if not identifiable>],
              "timestamp": "<approximate timestamp in 'Approx. HH:MM:SS' format, or 'Unknown' if not identifiable>",
              "context_or_summary": "<brief summary of the scene, including its role in the story, or a best guess>"
            }
            Important rules:
            1. For movies, set season and episode to null
            2. For TV shows, provide season and episode numbers as integers
            3. Timestamp must be in 'Approx. HH:MM:SS' format or 'Unknown'
            4. If you cannot identify the movie/series with high confidence, set movie_or_series to "Unknown"
            5. Do not include any text outside the JSON object`
          },
          {
            role: "user",
            content: `Please identify this scene from the following transcript: ${transcription.text}`
          },
          {
            role: "assistant",
            content: JSON.stringify(sceneDetails)
          },
          {
            role: "user",
            content: `Here are some search results that might help: ${JSON.stringify(parsedResults)}`
          }
        ]
      });

      sceneDetails = JSON.parse(finalCompletion.choices[0].message.content);
      console.log('Final GPT-4 Response with Search Results:', sceneDetails);
    }

    res.json({
      success: true,
      data: sceneDetails
    });

  } catch (error) {
    console.error('Error processing upload:', error);
    res.status(500).json({ error: 'Error processing upload' });
  }
});

// For local development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

// Export the Express app for Vercel
module.exports = app;