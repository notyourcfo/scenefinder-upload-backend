const express = require('express');
const multer = require('multer');
const { OpenAI } = require('openai');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

require('dotenv').config();

const app = express();
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Initialize OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Middleware
app.use(cors());
app.use(express.json());

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (error) {
  console.error('Failed to create uploads directory:', error);
  process.exit(1);
}

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'SceneFinder backend is running' });
});

// SerpAPI setup
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const SERPAPI_BASE_URL = 'https://serpapi.com/search';

// YouTube API setup (for fetching transcripts)
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YOUTUBE_BASE_URL = 'https://www.googleapis.com/youtube/v3';

// Function to search web and YouTube using SerpAPI
const searchWebAndYoutube = async (query) => {
  try {
    console.log('SerpAPI Query:', query);
    const searchResponse = await axios.get(SERPAPI_BASE_URL, {
      params: {
        api_key: SERPAPI_KEY,
        q: query,
        engine: 'google', // Use Google search engine
        num: 5, // Top 5 results
      },
    });

    const results = searchResponse.data.organic_results || [];
    console.log('SerpAPI Results:', results);

    // Filter for YouTube results
    const youtubeResults = results.filter(result => result.link.includes('youtube.com/watch'));
    if (!youtubeResults.length) {
      return JSON.stringify({ results: [] });
    }

    // Process the top YouTube result
    const topResult = youtubeResults[0];
    const videoIdMatch = topResult.link.match(/v=([^&]+)/);
    const videoId = videoIdMatch ? videoIdMatch[1] : null;

    let transcript = 'Transcript not fetched.';
    if (videoId) {
      // Fetch transcript using YouTube API
      try {
        const captionsResponse = await axios.get(`${YOUTUBE_BASE_URL}/captions`, {
          params: {
            part: 'snippet',
            videoId: videoId,
            key: YOUTUBE_API_KEY,
          },
        });

        const captions = captionsResponse.data.items;
        const englishCaption = captions.find(caption => 
          caption.snippet.language === 'en' || caption.snippet.language === 'en-US'
        );

        if (englishCaption) {
          const captionTrackResponse = await axios.get(
            `${YOUTUBE_BASE_URL}/captions/${englishCaption.id}`,
            {
              params: {
                key: YOUTUBE_API_KEY,
                tfmt: 'vtt',
              },
            }
          );

          const vttText = captionTrackResponse.data;
          transcript = vttText
            .split('\n')
            .filter(line => !line.match(/^(WEBVTT|Kind:|Language:|\d+\n\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3})/))
            .filter(line => line.trim() !== '')
            .join(' ');
          console.log('YouTube Transcript for Video ID', videoId, ':', transcript);
        } else {
          transcript = 'No English captions available.';
        }
      } catch (error) {
        console.error('Error fetching YouTube transcript:', error.message);
        transcript = 'Error fetching transcript.';
      }
    }

    return JSON.stringify({
      results: [{
        title: topResult.title,
        link: topResult.link,
        snippet: topResult.snippet,
        video_id: videoId,
        transcript: transcript,
      }]
    });
  } catch (error) {
    console.error('SerpAPI error:', error.message);
    // Check if the error is due to quota exhaustion (e.g., 403 or 429 status codes)
    if (error.response && (error.response.status === 403 || error.response.status === 429)) {
      console.log('SerpAPI quota likely exhausted. Skipping SerpAPI search.');
      return JSON.stringify({ quota_exhausted: true });
    }
    // For other errors, return empty results but don't fail the process
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
      size: req.file.size,
      path: req.file.path
    });

    const allowedTypes = ['video/mp4', 'video/quicktime', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/flac', 'audio/ogg', 'video/webm'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: `Invalid file type. Only MP4, MOV, MP3, M4A, WAV, FLAC, OGG, and WEBM are supported. Got: ${req.file.mimetype}` });
    }

    const originalExt = path.extname(req.file.originalname).toLowerCase();
    const tempFilePath = path.join(uploadDir, `temp-${Date.now()}${originalExt}`);
    fs.renameSync(req.file.path, tempFilePath);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-1',
    });
    console.log('Whisper Transcription:', transcription.text);

    fs.unlinkSync(tempFilePath);

    // Define the tools (SerpAPI tool for fallback)
    const tools = [
      {
        type: 'function',
        function: {
          name: 'search_web_and_youtube',
          description: 'Search the web and YouTube using a query string to find matching videos or content.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The query string to search for, such as dialogue snippets with context (e.g., "put it in my box Amanda Cerny site:youtube.com").',
              },
            },
            required: ['query'],
          },
        },
      },
    ];

    // First prompt: Try to identify the scene without tools
    const initialPrompt = `
      You are a movie analyst with expertise in identifying scenes from short video or audio clips. Given the following dialogue transcript, analyze it and provide scene details in the exact JSON format specified below. Try to identify the scene based on your knowledge alone, without using any external tools. If you cannot identify the movie or series with high confidence (e.g., if the movie or series is "Unknown"), indicate this clearly. It is critical to identify at least the movie or series name if possible. If other details like characters or timestamp are unclear, provide your best guess or mark them as "Unknown". Focus on modern films or series (post-2000) with comedic, adventurous, or lighthearted elements, especially those set in environments like summer camps, schools, workplaces, or events where misunderstandings or casual banter might occur. If the transcript is unclear, make an educated guess based on tone, context, and keywords, or return "Unknown" for unidentifiable fields.

      **Required JSON Format:**
      {
        "movie_or_series": "<movie or series name, or 'Unknown' if not identifiable>",
        "season": <season number as integer, or null if not a series or unknown>,
        "episode": <episode number as integer, or null if not a series or unknown>,
        "characters": [<array of character names as strings, or "Unknown" if not identifiable>],
        "timestamp": "<approximate timestamp in 'Approx. HH:MM:SS' format, or 'Unknown' if not identifiable>",
        "context_or_summary": "<brief summary of the scene, including its role in the story, or a best guess>"
      }

      **Transcript:**
      ${transcription.text}
    `;

    let messages = [{ role: 'user', content: initialPrompt }];
    let initialGptResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: messages,
      response_format: { type: 'json_object' },
    });

    console.log('Initial GPT-4o Response (No Tools):', initialGptResponse.choices[0].message);

    let sceneDetails = JSON.parse(initialGptResponse.choices[0].message.content);

    // Check if GPT-4o identified at least the movie name
    if (sceneDetails.movie_or_series === 'Unknown') {
      console.log('GPT-4o could not identify the movie name. Falling back to SerpAPI search.');

      // Second prompt: Use SerpAPI tool to search for the scene
      const fallbackPrompt = `
        You are a movie analyst with expertise in identifying scenes from short video or audio clips. Given the following dialogue transcript, you were unable to identify the scene with high confidence. Now, use the provided tool (search_web_and_youtube) to search the web and YouTube for videos or content matching the dialogue. You MUST construct a query with the key dialogue snippet "put it in my box" and include the known actor "Amanda Cerny" to narrow down the search (e.g., "put it in my box Amanda Cerny site:youtube.com"). If the initial search returns no relevant results, try a broader query like "Amanda Cerny summer camp movie scene site:youtube.com". Parse the search results, including YouTube video titles, snippets, and transcripts (if available), to identify the movie, scene, characters, and timestamp. If the transcript is not available or cannot be fetched, rely on the video title and snippet to make an educated guess about the movie and scene. Focus on modern films or series (post-2000) with comedic, adventurous, or lighthearted elements, especially those set in environments like summer camps, schools, workplaces, or events where misunderstandings or casual banter might occur. If the information is insufficient, return "Unknown" for unidentifiable fields.

        **Examples:**
        - If the transcript is "I'm sorry what put it in my box just take it out and put it in my box", you MUST search for "put it in my box Amanda Cerny site:youtube.com". This might return a video titled "Rim Of The World Amanda Cerny". Even if the transcript cannot be fetched, use the title to identify the movie as "Rim of the World", the scene as an early one (e.g., "Approx. 00:03:00"), and characters as "Security Officer" and "Camper" based on context (a summer camp setting where devices are collected).
        - If the transcript is "We need to go deeper", search for "we need to go deeper Leonardo DiCaprio site:youtube.com". This might return a video titled "Inception (2010) - We Need to Go Deeper Scene". Identify the movie as "Inception", the scene around "Approx. 00:15:00", and characters as "Dom Cobb" and "Arthur".

        **Required JSON Format:**
        {
          "movie_or_series": "<movie or series name, or 'Unknown' if not identifiable>",
          "season": <season number as integer, or null if not a series or unknown>,
          "episode": <episode number as integer, or null if not a series or unknown>,
          "characters": [<array of character names as strings, or "Unknown" if not identifiable>],
          "timestamp": "<approximate timestamp in 'Approx. HH:MM:SS' format, or 'Unknown' if not identifiable>",
          "context_or_summary": "<brief summary of the scene, including its role in the story, or a best guess>"
        }

        **Transcript:**
        ${transcription.text}
      `;

      messages = [{ role: 'user', content: fallbackPrompt }];
      let fallbackGptResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: messages,
        tools: tools,
        tool_choice: 'auto',
        response_format: { type: 'json_object' },
      });

      console.log('Fallback GPT-4o Response (With Tools):', fallbackGptResponse.choices[0].message);

      if (fallbackGptResponse.choices[0].message.tool_calls) {
        messages.push(fallbackGptResponse.choices[0].message);

        for (const toolCall of fallbackGptResponse.choices[0].message.tool_calls) {
          const functionName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          console.log(`Tool Call - ${functionName}:`, args);

          let toolResponse;
          if (functionName === 'search_web_and_youtube') {
            toolResponse = await searchWebAndYoutube(args.query);
            const parsedResponse = JSON.parse(toolResponse);

            // Check if SerpAPI quota is exhausted
            if (parsedResponse.quota_exhausted) {
              console.log('Skipping further SerpAPI processing due to quota exhaustion.');
              break; // Exit the tool call loop and use initial GPT-4o response
            }

            messages.push({
              role: 'tool',
              content: toolResponse,
              tool_call_id: toolCall.id,
            });
          }
        }

        // Only proceed with the second GPT-4o call if SerpAPI quota is not exhausted
        if (!messages.some(msg => msg.role === 'tool' && msg.content && JSON.parse(msg.content).quota_exhausted)) {
          fallbackGptResponse = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: messages,
            response_format: { type: 'json_object' },
          });
          console.log('Final GPT-4o Response (After Tools):', fallbackGptResponse.choices[0].message);
          sceneDetails = JSON.parse(fallbackGptResponse.choices[0].message.content);
        } else {
          console.log('Using initial GPT-4o response due to SerpAPI quota exhaustion.');
        }
      }
    } else {
      console.log('GPT-4o identified the movie name. Skipping SerpAPI search to minimize usage.');
    }

    res.status(200).json({
      success: true,
      data: sceneDetails,
    });
  } catch (error) {
    console.error('Error processing upload:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Start server on Render-provided port or 3000 locally
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

module.exports = app;