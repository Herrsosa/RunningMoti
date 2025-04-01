const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const router = express.Router();

// For demonstration, we store the latest audio URL in memory.
let latestAudioUrl = null;

// Helper function to upload a file stream to Box (unchanged)
async function uploadToBox(fileStream, fileName) {
  try {
    const form = new FormData();
    const attributes = JSON.stringify({
      name: fileName,
      parent: { id: process.env.BOX_UPLOAD_FOLDER_ID || '0' }
    });
    form.append('attributes', attributes);
    form.append('file', fileStream, fileName);

    const response = await axios.post('https://upload.box.com/api/2.0/files/content', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${process.env.BOX_ACCESS_TOKEN}`
      }
    });
    return response.data;
  } catch (err) {
    console.error('Error uploading to Box:', err);
    throw err;
  }
}

// Generate lyrics endpoint (unchanged)
router.post('/generate-lyrics', async (req, res) => {
  try {
    const { workout, musicStyle, name } = req.body;
    
    const response = await axios.post(process.env.OPENAI_API_ENDPOINT, {
      model: "gpt-3.5-turbo",
      messages: [{
        role: "user",
        content: `Write a short motivational song for ${name || 'Runner'}, who is doing a ${workout}. The song should match the style of ${musicStyle}. Make it energetic, uplifting, and fun.`
      }],
      temperature: 0.7
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      }
    });

    const lyrics = response.data.choices[0].message.content.trim();
    res.json({ lyrics });
  } catch (error) {
    console.error('Error generating lyrics:', error);
    res.status(500).json({ error: 'Failed to generate lyrics' });
  }
});

// Generate audio endpoint using Suno's Custom Mode
router.post('/generate-audio', async (req, res) => {
  try {
    const { lyrics, musicStyle } = req.body;
    const sunoResponse = await axios.post(process.env.SUNO_API_ENDPOINT, {
      customMode: true,
      instrumental: false,                             // false: include vocals; true: instrumental only
      model: "V3_5",
      style: musicStyle.slice(0, 200),                 // Ensure within 200 characters
      title: "Running Motivation".slice(0, 80),        // Ensure within 80 characters
      prompt: lyrics.slice(0, 3000),                   // Use your lyrics (max 3000 characters)
      callBackUrl: process.env.SUNO_CALLBACK_URL || "https://webhook.site/your-real-id-here" // Replace with your callback URL
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SUNO_API_KEY}`
      }
    });

    console.log("Suno API response:", sunoResponse.data);

    // Since Suno works asynchronously, we expect a taskId.
    if (sunoResponse.data.code === 200 && sunoResponse.data.data && sunoResponse.data.data.taskId) {
      res.json({
        taskId: sunoResponse.data.data.taskId,
        message: "Audio generation task submitted. Please wait for the callback."
      });
    } else {
      console.error("Unexpected Suno response:", sunoResponse.data);
      res.status(500).json({ error: "Unexpected response from Suno API." });
    }
  } catch (error) {
    if (error.response) {
      console.error('Suno API error:', error.response.status, error.response.data);
    } else {
      console.error('General error:', error.message);
    }
    res.status(500).json({ error: 'Failed to generate audio' });
  }
});

// Callback endpoint to receive Suno's asynchronous response
router.post('/suno-callback', (req, res) => {
  console.log("Suno callback received:", req.body);
  // Example expected payload structure (adjust if needed):
  // { code: 200, msg: "success", data: { callbackType: "complete", taskId: "...", data: [ { audio_url: "https://..." } ] } }
  if (req.body && req.body.data && Array.isArray(req.body.data.data) && req.body.data.data.length > 0) {
    latestAudioUrl = req.body.data.data[0].audio_url;
    console.log("Updated latestAudioUrl:", latestAudioUrl);
  } else {
    console.error("Invalid callback payload:", req.body);
  }
  res.sendStatus(200);
});

// Endpoint for the client to poll for the latest audio URL
router.get('/latest-audio', (req, res) => {
  res.json({ audioUrl: latestAudioUrl });
});

module.exports = router;
