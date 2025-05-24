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
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB limit
});

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY || '',
  timeout: 8000 // 8 seconds
});

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  console.log('Root endpoint accessed');
  res.status(200).json({ message: 'SceneFinder backend is running', apiKeySet: !!process.env.OPENAI_API_KEY });
});

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  console.log('Creating Uploads directory');
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.post('/api/upload', upload.single('video'), async (req, res) => {
  let tempFilePath = '';
  try {
    if (!req.file) {
      console.log('No file uploaded');
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    console.log('Uploaded file:', {
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    const allowedTypes = ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/flac', 'audio/ogg'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      console.log('Invalid file type:', req.file.mimetype);
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: `Invalid file type. Only MP3, M4A, WAV, FLAC, OGG supported. Got: ${req.file.mimetype}` });
    }

    const originalExt = path.extname(req.file.originalname).toLowerCase();
    tempFilePath = path.join(uploadDir, `temp-${Date.now()}${originalExt}`);
    console.log('Renaming file to:', tempFilePath);
    fs.renameSync(req.file.path, tempFilePath);

    console.log('Starting Whisper transcription...');
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-1'
    }).catch(err => {
      throw new Error(`Transcription failed: ${err.message}`);
    });
    console.log('Transcription completed:', transcription.text);

    fs.unlinkSync(tempFilePath);

    console.log('Querying GPT-4o...');
    const prompt = `
      You are a movie analyst. Given this dialogue transcript, provide:
      - Movie or series name (or "Unknown")
      - Season and episode (or null)
      - Character names (or "Unknown")
      - Approximate timestamp (or "Unknown")
      - Scene context or summary
      Handle fragmented or noisy transcripts. Return JSON.

      Transcript:
      ${transcription.text}
    `;

    const gptResponse = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    }).catch(err => {
      throw new Error(`GPT-4o failed: ${err.message}`);
    });

    const sceneDetails = JSON.parse(gptResponse.choices[0].message.content);
    console.log('GPT-4o response:', sceneDetails);

    res.status(200).json({
      success: true,
      data: sceneDetails
    });
  } catch (error) {
    console.error('Error processing upload:', error);
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.use((req, res) => {
  console.log(`Unhandled request: ${req.method} ${req.url}`);
  res.status(404).json({ error: 'Endpoint not found', path: req.url });
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(3000, () => {
    console.log('Server running on port 3000');
  });
}

module.exports = app;