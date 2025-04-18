// backend/routes/generate.js
const express = require('express');
const axios = require('axios');
// Import the new query function
const { query } = require('../database');
const verifyToken = require('../middleware/authMiddleware'); // Import authentication middleware
const router = express.Router();

const CREDITS_PER_SONG = 1; // Define how many credits a song costs

// Generate lyrics endpoint (Protected) - REFACTORED for Async Lyrics via Cron
router.post('/generate-lyrics', verifyToken, async (req, res) => {
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
        const { workout, musicStyle, name } = req.body;
        const defaultTitle = `${workout || 'Workout'} - ${musicStyle || 'Song'}`;

        const insertSongSql = `
            INSERT INTO songs (user_id, workout_input, style_input, name_input, title, status)
            VALUES ($1, $2, $3, $4, $5, 'lyrics_pending')
            RETURNING id`;
        const insertResult = await query(insertSongSql, [userId, workout, musicStyle, name, defaultTitle]);
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
        audioUrl = req.body.data.data[0].audio_url;
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


// ——— CRON ENDPOINTS ——— //


// Process pending lyrics (now responds to GET **and** POST)
router.all('/cron/process-lyrics-queue', async (req, res) => {
    console.log("Cron Job: Checking for pending lyrics...");
    let songToProcess = null;
  
    try {
      // 1) Fetch one pending song
      const findSql = `
        SELECT id, workout_input, style_input, name_input
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
  
      const { id: songId, workout_input: workout, style_input: musicStyle, name_input: name } = songToProcess;
      console.log(`Cron Job: Found pending song ID: ${songId}. Attempting to process.`);
  
      // 2) Mark as processing
      await query("UPDATE songs SET status = 'lyrics_processing' WHERE id = $1", [songId]);
      console.log(`Cron Job: Marked song ${songId} as 'lyrics_processing'.`);
  
      // 3) Prepare & send OpenAI request
      const openAiPayload = {
        model: "gpt-3.5-turbo",
        messages: [{
          role: "user",
          content: `Write a 3–4 minute motivational song for athlete ${
            name || 'the athlete'
          } preparing for a major athletic event, in the style of ${
            musicStyle || 'motivational'
          }. Include 2–3 verses, a chorus, and vivid imagery.`
        }],
        temperature: 0.7,
        max_tokens: 1200
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
  
      // 5) Send a response so Vercel doesn’t timeout
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
        const findSql = `
            SELECT id, user_id, workout_input, style_input, name_input, lyrics, title
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

        const { id: songId, user_id: userId, lyrics, style_input: musicStyle, title: defaultTitle } = songToProcess;
        console.log(`Cron Job: Found pending audio song ID: ${songId}. Attempting to process.`);

        // … credit checks, deduction, Suno submission, DB updates as per your existing code …

        // example snippet:
        // await query("UPDATE users SET credits=credits-$1 WHERE id=$2", [CREDITS_PER_SONG, userId]);
        // await query("UPDATE songs SET status='audio_processing' WHERE id=$1", [songId]);
        // const sunoResponse = await axios.post(…);
        // await query("UPDATE songs SET suno_task_id=$1, status=$2 WHERE id=$3", [sunoTaskId, nextStatus, songId]);
        // res.status(200).json({ message: `Processed audio request for song ${songId} with final status ${nextStatus}.` });

    } catch (error) {
        console.error("Cron Job: Error processing audio queue:", error.message);
        if (songToProcess?.id) {
            await query("UPDATE songs SET status = 'error' WHERE id = $1 AND status = 'audio_processing'", [songToProcess.id]);
            if (userCredits !== undefined) {
                await query("UPDATE users SET credits = credits + $1 WHERE id = $2", [CREDITS_PER_SONG, songToProcess.user_id]);
                console.log(`Cron Job: Refunded ${CREDITS_PER_SONG} credit(s) to user ${songToProcess.user_id}.`);
            }
        }
        res.status(500).json({ error: 'Cron job failed during audio processing.' });
    }
});

module.exports = router;
