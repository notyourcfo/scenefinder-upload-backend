const express = require('express');
const multer = require('multer');
const { OpenAI } = require('openai');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

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
const uploadDir = path.join(__dirname, 'Uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Upload endpoint
app.post('/api/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    // Log file details for debugging
    console.log('Uploaded file:', {
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path
    });

    // Validate file type
    const allowedTypes = ['video/mp4', 'video/quicktime', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/flac', 'audio/ogg', 'video/webm'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      fs.unlinkSync(req.file.path); // Clean up invalid file
      return res.status(400).json({ error: `Invalid file type. Only MP4, MOV, MP3, M4A, WAV, FLAC, OGG, and WEBM are supported. Got: ${req.file.mimetype}` });
    }

    // Create a temporary file with the original extension
    const originalExt = path.extname(req.file.originalname).toLowerCase();
    const tempFilePath = path.join(uploadDir, `temp-${Date.now()}${originalExt}`);
    fs.renameSync(req.file.path, tempFilePath);

    // Transcribe audio using Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-1',
    });

    // Clean up temporary file
    fs.unlinkSync(tempFilePath);

   // Query GPT for scene details
    const prompt = `
      You are a movie analyst with expertise in identifying scenes from short video or audio clips. Given the following dialogue transcript, which may be fragmented, incomplete, or contain background noise, provide:
      - The name of the movie or series (or "Unknown" if not identifiable)
      - Season and episode number (if applicable, or null if not a series or unknown)
      - Character names involved (or "Unknown" if not identifiable)
      - Approximate timestamp of the scene (if identifiable, or "Unknown")
      - A short context or summary of the scene (or a best guess based on available information)
      If the transcript is unclear or lacks sufficient dialogue, make an educated guess based on context clues or indicate uncertainty. Return the response in JSON format.

      Transcript:
      ${transcription.text}
    `;

    const gptResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const sceneDetails = JSON.parse(gptResponse.choices[0].message.content);

    res.status(200).json({
      success: true,
      data: sceneDetails,
    });
  } catch (error) {
    console.error('Error processing upload:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server locally if not in Vercel
if (process.env.NODE_ENV !== 'production') {
  app.listen(3000, () => {
    console.log('Server running on port 3000');
  });
}

module.exports = app;