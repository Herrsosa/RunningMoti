// backend/routes/generate.js
const express = require('express');
const axios = require('axios');
const { query } = require('../database');
const verifyToken = require('../middleware/authMiddleware');
const { logger } = require('../utils/logger');
const { validateSchema, schemas } = require('../middleware/validation');
const { generationLimiter } = require('../middleware/rateLimiter');
const router = express.Router();

const CREDITS_PER_SONG = 1; // Define how many credits a song costs

// Generate lyrics endpoint (Protected) - REFACTORED for Async Lyrics via Cron
router.post('/generate-lyrics', verifyToken, generationLimiter, validateSchema(schemas.songGeneration), async (req, res) => {
    const userId = req.userId; // Get user ID from verified token

    // --- Check Credits ---
    try {
        const creditCheckSql = "SELECT credits FROM users WHERE id = $1";
        const result = await query(creditCheckSql, [userId]);
        const user = result.rows[0];

        if (!user) {
            return res.status(404).json({ error: "User not found." });
        }
        if (user.credits < CREDITS_PER_SONG) {
            return res.status(402).json({ error: "Insufficient credits." }); // Payment Required
        }
    } catch (error) {
         console.error("Credit check error:", error);
         return res.status(500).json({ error: "Failed to check credits." });
    }
    // --- End Credit Check ---

    // --- Create Song Record with 'lyrics_pending' status ---
    try {
        const { workout, musicStyle, customStyle, tone, language, name } = req.body;
        const defaultTitle = `${workout || 'Workout'} - ${musicStyle || 'Song'}`;

        const insertSongSql = `
            INSERT INTO songs (user_id, workout_input, style_input, custom_style,tone_input,language_input, name_input, title, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'lyrics_pending')
            RETURNING id`;
        const insertResult = await query(insertSongSql, [userId, workout, musicStyle, customStyle, tone, language, name, defaultTitle]);
        const songId = insertResult.rows[0].id;
        console.log(`Created song record ID: ${songId} with status 'lyrics_pending'.`);

        res.status(202).json({
            message: "Lyric generation request accepted.",
            songId: songId
        });

    } catch (error) {
        console.error('Error initiating lyric generation (creating song record):', error.message);
        res.status(500).json({ error: 'Server error initiating lyric generation.' });
    }
});

// Generate audio endpoint (Protected) - REFACTORED for Async Audio via Cron
router.post('/generate-audio', verifyToken, async (req, res) => {
    const userId = req.userId;
    const { songId } = req.body;

    if (!songId) {
        return res.status(400).json({ error: "Missing songId." });
    }

    try {
        // --- Verify Song Ownership and Status ---
        const songCheckSql = "SELECT user_id, status FROM songs WHERE id = $1";
        const songCheckResult = await query(songCheckSql, [songId]);
        const song = songCheckResult.rows[0];

        if (!song) {
            return res.status(404).json({ error: "Song record not found." });
        }
        if (song.user_id !== userId) {
            return res.status(403).json({ error: "Forbidden (song ownership mismatch)." });
        }
        if (song.status !== 'lyrics_complete') {
             return res.status(409).json({ error: `Cannot initiate audio generation, song status is '${song.status}' (expected 'lyrics_complete').` });
        }

        // --- Check Credits (but don't deduct yet) ---
        const creditCheckSql = "SELECT credits FROM users WHERE id = $1";
        const creditResult = await query(creditCheckSql, [userId]);
        const user = creditResult.rows[0];

        if (!user) return res.status(404).json({ error: "User not found for credit check." });
        if (user.credits < CREDITS_PER_SONG) return res.status(402).json({ error: "Insufficient credits." });

        // --- Update Song Status to 'audio_pending' ---
        const updateStatusSql = "UPDATE songs SET status = 'audio_pending' WHERE id = $1";
        await query(updateStatusSql, [songId]);
        console.log(`Updated song ${songId} status to 'audio_pending'.`);

        res.status(202).json({
            message: "Audio generation request accepted. Processing will start shortly.",
            songId: songId
        });

    } catch (error) {
        console.error(`Error initiating audio generation for song ${songId}:`, error.message);
        try {
            await query("UPDATE songs SET status = 'error' WHERE id = $1 AND status = 'audio_pending'", [songId]);
        } catch (__) {}
        res.status(500).json({ error: 'Server error initiating audio generation.' });
    }
});

// Callback endpoint - REFACTORED for PostgreSQL
router.post('/suno-callback', async (req, res) => {
    console.log("Suno callback received:", JSON.stringify(req.body, null, 2));
    console.log("Callback Query Params:", req.query);

    const songId = req.query.songId;
    const sunoTaskIdFromBody = req.body?.data?.taskId;

    if (!songId) {
        console.error("Callback missing expected songId query parameter.");
        return res.sendStatus(200);
    }

    let audioUrl = null;
    let status = 'error';
    let errorMsg = 'Unknown callback status or format.';

    if (req.body?.code === 200 && req.body?.data?.callbackType === "complete" && Array.isArray(req.body.data.data) && req.body.data.data.length > 0) {
        // Get the audio URL from the callback
        let receivedAudioUrl = req.body.data.data[0].audio_url;

        // Check if the URL has the erroneous '/https:/' prefix and remove it
        if (receivedAudioUrl && receivedAudioUrl.startsWith('/https:/')) {
            audioUrl = 'https://' + receivedAudioUrl.substring('/https:/'.length);
            console.warn(`Corrected malformed audio URL for Song ${songId}: ${receivedAudioUrl} -> ${audioUrl}`);
        } else {
            audioUrl = receivedAudioUrl;
        }

        status = 'complete';
        errorMsg = null;
        console.log(`Callback SUCCESS for Song ${songId}: Audio URL found.`);
    } else if (req.body?.data?.callbackType === "fail") {
        status = 'error';
        errorMsg = req.body.data.msg || 'Suno generation failed (no specific message).';
        console.error(`Callback FAILURE reported for Song ${songId}:`, errorMsg);
    } else {
        console.warn(`Callback received unknown status/format for Song ${songId}.`);
    }

    try {
        const updateSql = `
            UPDATE songs
            SET audio_url = $1, status = $2, suno_task_id = COALESCE($3, suno_task_id)
            WHERE id = $4`;
        const result = await query(updateSql, [audioUrl, status, sunoTaskIdFromBody, songId]);

        if (result.rowCount > 0) {
            console.log(`Database updated for Song ID: ${songId}, Status: ${status}`);
        } else {
            console.error(`Callback received for Song ID ${songId}, but no matching record found in DB to update.`);
        }
    } catch (dbError) {
        console.error(`Database error handling callback for Song ID ${songId}:`, dbError);
    }

    res.sendStatus(200);
});

// Client polling for finalized audio status
router.get('/song-status/:sunoTaskId', verifyToken, async (req, res) => {
    const { sunoTaskId } = req.params;
    const userId = req.userId;

    try {
        const sql = "SELECT id, user_id, status, audio_url FROM songs WHERE suno_task_id = $1";
        const result = await query(sql, [sunoTaskId]);
        const song = result.rows[0];

        if (!song) {
            console.warn(`Polling status for Task ${sunoTaskId}: Song not found in DB.`);
            return res.status(404).json({ status: 'not_found', audioUrl: null });
        }

        if (song.user_id !== userId) {
            console.warn(`Polling attempt for Task ${sunoTaskId} by unauthorized user ${userId}.`);
            return res.status(403).json({ error: "Forbidden" });
        }

        console.log(`Polling status for Task ${sunoTaskId}: Returning status '${song.status}' from DB.`);
        res.json({ status: song.status, audioUrl: song.audio_url });

    } catch (err) {
        console.error(`Error fetching status for Task ${sunoTaskId}:`, err);
        return res.status(500).json({ error: "Database error fetching song status." });
    }
});

// Client polling for lyrics status
router.get('/lyrics-status/:songId', verifyToken, async (req, res) => {
    const userId = req.userId;
    const songId = req.params.songId;

    try {
        const sql = "SELECT user_id, status, lyrics FROM songs WHERE id = $1";
        const result = await query(sql, [songId]);
        const song = result.rows[0];

        if (!song) {
            return res.status(404).json({ error: "Song not found." });
        }
        if (song.user_id !== userId) {
            return res.status(403).json({ error: "Forbidden." });
        }

        res.json({ status: song.status, lyrics: song.lyrics });

    } catch (error) {
        console.error(`Error fetching lyrics status for song ${songId}:`, error.message);
        res.status(500).json({ error: "Server error fetching status." });
    }
});
// NEW Endpoint: Get Audio Status by Song ID
router.get('/audio-status/:songId', verifyToken, async (req, res) => {
  const userId = req.userId;
  const songId = req.params.songId;

  try {
    const result = await query(
      `SELECT user_id, status, suno_task_id AS sunoTaskId, audio_url AS audioUrl
         FROM songs
         WHERE id = $1`,
      [songId]
    );
    const song = result.rows[0];

    if (!song) return res.status(404).json({ error: "Song not found." });
    if (song.user_id !== userId) return res.status(403).json({ error: "Forbidden." });

    return res.json({
      status: song.status,
      sunoTaskId: song.sunoTaskId,
      audioUrl: song.audioUrl
    });
  } catch (err) {
    console.error("Error fetching audio status:", err);
    return res.status(500).json({ error: "Server error fetching audio status." });
  }
});

// ——— CRON ENDPOINTS ——— //


// Process pending lyrics (now responds to GET **and** POST)
router.all('/cron/process-lyrics-queue', async (req, res) => {
    console.log("Cron Job: Checking for pending lyrics...");
    let songToProcess = null;
  
    try {
      // 1) Fetch one pending song
      const findSql = `
        SELECT id, workout_input, style_input, custom_style, tone_input, language_input, name_input
        FROM songs
        WHERE status = 'lyrics_pending'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`;
      const findResult = await query(findSql);
      songToProcess = findResult.rows[0];
  
      if (!songToProcess) {
        console.log("Cron Job: No pending lyrics found.");
        return res.status(200).json({ message: "No pending lyrics found." });
      }
  
      const {
        id: songId,
        workout_input: workout,
        style_input: styleInput,
        custom_style: customStyleStored,
        tone_input: toneStored,
        language_input: languageStored,
        name_input: name
      } = songToProcess;

      // fallback logic
      const styleToUse    = customStyleStored || styleInput;
      const toneToUse     = toneStored      || 'Inspiring';
      const languageToUse = languageStored  || 'English';

      console.log(`Cron Job: Found pending song ID: ${songId}. Attempting to process.`);
  
      // 2) Mark as processing
      await query("UPDATE songs SET status = 'lyrics_processing' WHERE id = $1", [songId]);
      console.log(`Cron Job: Marked song ${songId} as 'lyrics_processing'.`);
  
      // 3) Prepare & send OpenAI request
      const openAiPayload = {
        model: "gpt-4",
        messages: [{
          role: "user",
          content: `Write a high-quality ${languageToUse}-language motivational song (3–4 minutes long) for athlete ${name || 'the athlete'}, who is preparing for the event: ${workout || 'a major athletic challenge'}. 

The emotional tone should be ${toneToUse}, 'cinematic, and inspiring'.

The song should follow the style of ${styleToUse}, with intense energy, emotionally resonant imagery, and a strong lyrical rhythm. 

Structure the song with:
- An intro (spoken or low-energy to build anticipation)
- 2–3 verses exploring struggle, focus, and mental strength
- A bold, repeatable chorus
- A bridge that deepens the emotional stakes
- A final chorus that pushes intensity even further

Avoid cliché lines or generic rhymes. Make the lyrics feel personal, visceral, and worthy of a true champion. This is a lyrical war cry — something that gets in their head and fuels their performance.`
        }],
        temperature: 0.7,
        max_tokens: 700
      };
      const openAiConfig = {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
        },
        timeout: 60000
      };
  
      console.log(`Cron Job: Requesting lyrics from OpenAI for song ${songId}…`);
      const openAiResponse = await axios.post(
        process.env.OPENAI_API_ENDPOINT,
        openAiPayload,
        openAiConfig
      );
  
      // 4) Extract and save lyrics
      const lyrics = openAiResponse.data.choices?.[0]?.message?.content?.trim() || null;
      const finalStatus = lyrics ? "lyrics_complete" : "lyrics_error";
      console.log(
        `Cron Job: ${
          lyrics ? "Successfully generated" : "Failed to generate"
        } lyrics for song ${songId}.`
      );
  
      await query(
        "UPDATE songs SET lyrics = $1, status = $2 WHERE id = $3",
        [lyrics, finalStatus, songId]
      );
      console.log(`Cron Job: Updated song ${songId} with status '${finalStatus}'.`);
  
      // 5) Send a response so Vercel doesn't timeout
      return res
        .status(200)
        .json({ message: `Processed song ${songId} with status ${finalStatus}.` });
  
    } catch (error) {
      console.error("Cron Job: Error processing lyrics queue:", error);
  
      if (songToProcess?.id) {
        await query(
          "UPDATE songs SET status = 'lyrics_error' WHERE id = $1",
          [songToProcess.id]
        );
        console.log(`Cron Job: Marked song ${songToProcess.id} as 'lyrics_error'.`);
      }
  
      return res.status(500).json({ error: "Cron job failed during processing." });
    }
  });
  

// Process pending audio (now responds to GET **and** POST)
router.all('/cron/process-audio-queue', async (req, res) => {
    console.log("Cron Job: Checking for pending audio generation...");
    let songToProcess = null;
    let userCredits;
  
    try {
      // 1. Find a song that is pending audio generation
      const findSql = `
        SELECT id, user_id, lyrics, title, workout_input, style_input, custom_style, tone_input, language_input, name_input
        FROM songs
        WHERE status = 'audio_pending'
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`;
      const findResult = await query(findSql);
      songToProcess = findResult.rows[0];
  
      if (!songToProcess) {
        console.log("Cron Job: No pending audio found.");
        return res.status(200).json({ message: "No pending audio found." });
      }
  
      const {
        id: songId,
        user_id: userId,
        lyrics,
        style_input: musicStyle,
        title: defaultTitle
      } = songToProcess;
  
      console.log(`Cron Job: Found pending song ID: ${songId}.`);
  
      // 2. Check credits
      const creditCheckSql = "SELECT credits FROM users WHERE id = $1";
      const creditResult = await query(creditCheckSql, [userId]);
      const user = creditResult.rows[0];
  
      if (!user || user.credits < 1) {
        console.warn(`User ${userId} has insufficient credits.`);
        await query("UPDATE songs SET status = 'error' WHERE id = $1", [songId]);
        return res.status(200).json({ message: "Skipped due to insufficient credits." });
      }
  
      // Store current credit count in case of refund
      userCredits = user.credits;
  
      // 3. Deduct credit
      await query("UPDATE users SET credits = credits - 1 WHERE id = $1", [userId]);
      console.log(`Deducted 1 credit from user ${userId}.`);
  
      // 4. Mark song as processing
      await query("UPDATE songs SET status = 'audio_processing' WHERE id = $1", [songId]);
      console.log(`Marked song ${songId} as 'audio_processing'.`);
  
      // 5. Submit to Suno
      const callbackUrl = `${process.env.SUNO_CALLBACK_URL}?songId=${songId}`;
      const sunoPayload = {
        customMode: true,
        instrumental: false,
        model: "V4",
        style: musicStyle?.slice(0, 200) || '',
        title: defaultTitle?.slice(0, 80) || 'Untitled',
        prompt: lyrics?.slice(0, 3000) || '',
        callbackUrl: callbackUrl
      };
  
      const sunoConfig = {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.SUNO_API_KEY}`
        },
        timeout: 10000 // 10s timeout to avoid blocking the function
      };
  
      let sunoResponse;
      let sunoTaskId = null;
      let nextStatus = 'processing';
  
      try {
        console.log(`Submitting to Suno for song ${songId}...`);
        sunoResponse = await axios.post(process.env.SUNO_API_ENDPOINT, sunoPayload, sunoConfig);
        console.log(`Suno response for song ${songId}:`, sunoResponse.data);
  
        sunoTaskId = sunoResponse?.data?.data?.taskId || sunoResponse?.data?.taskId || null;
        nextStatus = sunoTaskId ? 'processing' : 'processing';
      } catch (err) {
        console.error(`Suno API request failed for song ${songId}:`, err.message);
  
        // If timeout or network error: retry later
        if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
          nextStatus = 'audio_pending'; // retry later
        }
      }
      
      console.log(`🎵 AUDIO CRON: About to set song ${songId} to status '${nextStatus}'`);
      console.log(`🎵 AUDIO CRON: sunoTaskId = '${sunoTaskId}'`);

      // 6. Update song with Suno task ID and final status
      await query(
        "UPDATE songs SET suno_task_id = $1, status = $2 WHERE id = $3",
        [sunoTaskId, nextStatus, songId]
      );
      console.log(`Updated song ${songId} to status '${nextStatus}' with task ID '${sunoTaskId || 'N/A'}'.`);
  
      return res.status(200).json({
        message: `Audio job submitted for song ${songId}`,
        status: nextStatus
      });
  
    } catch (error) {
      console.error("Error in audio cron:", error.message);
  
      // Rollback & refund if possible
      if (songToProcess?.id) {
        try {
          await query(
            "UPDATE songs SET status = 'error' WHERE id = $1 AND status = 'audio_processing'",
            [songToProcess.id]
          );
  
          if (userCredits !== undefined) {
            await query(
              "UPDATE users SET credits = credits + 1 WHERE id = $1",
              [songToProcess.user_id]
            );
            console.log(`Refunded 1 credit to user ${songToProcess.user_id}.`);
          }
        } catch (rollbackErr) {
          console.error("Failed to rollback or refund after error:", rollbackErr.message);
        }
      }
  
      return res.status(500).json({ error: "Cron job failed during audio processing." });
    }
  });
  

module.exports = router;
