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
        const defaultTitle = `${workout || 'Workout'} - ${musicStyle || 'Song'}`; // Generate a default title

        // Insert record with inputs and 'lyrics_pending' status. Lyrics column will be NULL initially.
        const insertSongSql = `
            INSERT INTO songs (user_id, workout_input, style_input, name_input, title, status)
            VALUES ($1, $2, $3, $4, $5, 'lyrics_pending')
            RETURNING id`;
        const insertResult = await query(insertSongSql, [userId, workout, musicStyle, name, defaultTitle]);
        const songId = insertResult.rows[0].id;
        console.log(`Created song record ID: ${songId} with status 'lyrics_pending'.`);

        // Respond immediately to the frontend with the songId, indicating async processing
        res.status(202).json({ // 202 Accepted
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
    // Expect songId (lyrics should already be in DB from the lyrics cron job)
    const { songId } = req.body;

    if (!songId) {
        return res.status(400).json({ error: "Missing songId." });
    }

    try {
        // --- Verify Song Ownership and Status ---
        // Ensure lyrics are complete before proceeding
        const songCheckSql = "SELECT user_id, status FROM songs WHERE id = $1";
        const songCheckResult = await query(songCheckSql, [songId]);
        const song = songCheckResult.rows[0];

        if (!song) {
            return res.status(404).json({ error: "Song record not found." });
        }
        if (song.user_id !== userId) {
            return res.status(403).json({ error: "Forbidden (song ownership mismatch)." });
        }
        // Can only start audio generation if lyrics are complete
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
        // This signals the audio processing cron job to pick it up.
        const updateStatusSql = "UPDATE songs SET status = 'audio_pending' WHERE id = $1";
        await query(updateStatusSql, [songId]);
        console.log(`Updated song ${songId} status to 'audio_pending'.`);

        // --- Respond Immediately ---
        res.status(202).json({
            message: "Audio generation request accepted. Processing will start shortly.",
            songId: songId
            // No sunoTaskId or remainingCredits returned here yet.
        });

    } catch (error) {
        console.error(`Error initiating audio generation for song ${songId}:`, error.message);
        // Attempt to mark song as error if something failed before responding
        try { await query("UPDATE songs SET status = 'error' WHERE id = $1 AND status = 'audio_pending'", [songId]); } catch(e) {/* ignore */}
        res.status(500).json({ error: 'Server error initiating audio generation.' });
    }
});


// Callback endpoint - REFACTORED for PostgreSQL
router.post('/suno-callback', async (req, res) => {
    console.log("Suno callback received:", JSON.stringify(req.body, null, 2));
    console.log("Callback Query Params:", req.query);

    const songId = req.query.songId; // Expect songId from the callback URL we sent
    const sunoTaskIdFromBody = req.body?.data?.taskId; // Task ID might also be in body

    if (!songId) {
        console.error("Callback missing expected songId query parameter.");
        return res.sendStatus(200); // Acknowledge Suno even if we can't process
    }

    let audioUrl = null;
    let status = 'error'; // Default status
    let errorMsg = 'Unknown callback status or format.'; // Default error message

    // Determine status and audio URL from callback body
    if (req.body?.code === 200 && req.body?.data?.callbackType === "complete" && Array.isArray(req.body.data.data) && req.body.data.data.length > 0) {
        audioUrl = req.body.data.data[0].audio_url;
        status = 'complete';
        errorMsg = null; // No error on success
        console.log(`Callback SUCCESS for Song ${songId}: Audio URL found.`);
    } else if (req.body?.data?.callbackType === "fail") {
        status = 'error';
        errorMsg = req.body.data.msg || 'Suno generation failed (no specific message).';
        console.error(`Callback FAILURE reported for Song ${songId}:`, errorMsg);
    } else {
        console.warn(`Callback received unknown status/format for Song ${songId}.`);
        // Keep status as 'error' and default errorMsg
    }

    // --- Update Database ---
    try {
        // Update the song record based on songId
        const updateSql = `
            UPDATE songs
            SET audio_url = $1, status = $2, suno_task_id = COALESCE($3, suno_task_id)
            WHERE id = $4`;
        // Use COALESCE for task ID in case it wasn't in the body but we have it already
        const result = await query(updateSql, [audioUrl, status, sunoTaskIdFromBody, songId]);

        if (result.rowCount > 0) {
            console.log(`Database updated for Song ID: ${songId}, Status: ${status}`);
        } else {
            console.error(`Callback received for Song ID ${songId}, but no matching record found in DB to update.`);
        }
    } catch (dbError) {
        console.error(`Database error handling callback for Song ID ${songId}:`, dbError);
    }

    res.sendStatus(200); // Always acknowledge Suno quickly
});


// Endpoint for the client to poll for FINAL song status (Protected) - REFACTORED for PostgreSQL
// This endpoint is now primarily used AFTER a sunoTaskId is known
router.get('/song-status/:sunoTaskId', verifyToken, async (req, res) => {
    const { sunoTaskId } = req.params;
    const userId = req.userId; // Ensure user owns the song

    try {
        // Query the database directly for the latest status using task ID
        const sql = "SELECT id, user_id, status, audio_url FROM songs WHERE suno_task_id = $1";
        const result = await query(sql, [sunoTaskId]);
        const song = result.rows[0];

        if (!song) {
            console.warn(`Polling status for Task ${sunoTaskId}: Song not found in DB.`);
            return res.status(404).json({ status: 'not_found', audioUrl: null });
        }

        // Security Check: Ensure the logged-in user owns this song
        if (song.user_id !== userId) {
            console.warn(`Polling attempt for Task ${sunoTaskId} by unauthorized user ${userId}.`);
            return res.status(403).json({ error: "Forbidden" });
        }

        // Return the status directly from the database
        console.log(`Polling status for Task ${sunoTaskId}: Returning status '${song.status}' from DB.`);
        res.json({ status: song.status, audioUrl: song.audio_url });

    } catch (err) {
        console.error(`Error fetching status for Task ${sunoTaskId}:`, err);
        return res.status(500).json({ error: "Database error fetching song status." });
    }
});

// NEW Endpoint: Get Lyric Generation Status (Protected) - For Frontend Polling
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
        // Verify ownership
        if (song.user_id !== userId) {
            return res.status(403).json({ error: "Forbidden." });
        }

        res.json({
            status: song.status,
            lyrics: song.lyrics // Will be null until status is 'lyrics_complete'
        });

    } catch (error) {
        console.error(`Error fetching lyrics status for song ${songId}:`, error.message);
        res.status(500).json({ error: "Server error fetching status." });
    }
});


// NEW Endpoint: Process Pending Lyrics (Called by Cron Job - Needs Protection)
router.post('/cron/process-lyrics-queue', async (req, res) => {
    // Optional: Add secret validation
    // const cronSecret = req.headers['x-vercel-cron-secret'];
    // if (cronSecret !== process.env.CRON_SECRET) return res.status(401).send('Unauthorized');

    console.log("Cron Job: Checking for pending lyrics...");
    let songToProcess = null;

    try {
        // Find one song that is pending lyrics generation
        const findSql = `
            SELECT id, user_id, workout_input, style_input, name_input
            FROM songs
            WHERE status = 'lyrics_pending'
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED`; // Handle concurrency
        const findResult = await query(findSql);
        songToProcess = findResult.rows[0];

        if (!songToProcess) {
            console.log("Cron Job: No pending lyrics found.");
            return res.status(200).json({ message: "No pending lyrics found." });
        }

        const { id: songId, workout_input: workout, style_input: musicStyle, name_input: name } = songToProcess;
        console.log(`Cron Job: Found pending song ID: ${songId}. Attempting to process.`);

        // Mark song as processing
        await query("UPDATE songs SET status = 'lyrics_processing' WHERE id = $1", [songId]);
        console.log(`Cron Job: Marked song ${songId} as 'lyrics_processing'.`);

        // Call OpenAI API (Restore Payload & Config)
        const openAiPayload = {
            model: "gpt-4", // Or your preferred model
            messages: [{
                role: "user",
                content: `Write a high-quality motivational song (3–4 minutes long) for athlete ${name || 'the athlete'}, who is preparing for the event: a major athletic challenge.

The emotional tone should be inspiring.

The song should follow the style of ${musicStyle}, with intense energy, emotionally resonant imagery, and a strong lyrical rhythm. The delivery should include powerful metaphors about endurance, pain, and victory.

Structure the song with:
- An intro (spoken or low-energy to build anticipation)
- 2–3 verses exploring struggle, focus, and mental strength
- A bold, repeatable chorus
- A bridge that deepens the emotional stakes
- A final chorus that pushes intensity even further

Avoid cliché lines or generic rhymes. Make the lyrics feel personal, visceral, and worthy of a true champion. This is a lyrical war cry — something that gets in their head and fuels their performance.`
            }],
            temperature: 0.7
        };
        const openAiConfig = {
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
            timeout: 60000 // 60 seconds timeout suitable for cron job
        };

        let openAiResponse;
        let lyrics;
        let finalStatus = 'lyrics_error';

        try {
            console.log(`Cron Job: Requesting lyrics from OpenAI for song ${songId}...`);
            openAiResponse = await axios.post(process.env.OPENAI_API_ENDPOINT, openAiPayload, openAiConfig);

            if (openAiResponse?.data?.choices?.[0]?.message?.content) {
                lyrics = openAiResponse.data.choices[0].message.content.trim();
                finalStatus = 'lyrics_complete';
                console.log(`Cron Job: Successfully generated lyrics for song ${songId}.`);
            } else {
                console.error(`Cron Job: Invalid response structure from OpenAI for song ${songId}:`, openAiResponse?.data);
            }
        } catch (axiosError) {
            console.error(`Cron Job: OpenAI API call failed for song ${songId}:`, axiosError.message);
            if (axiosError.code === 'ECONNABORTED' || axiosError.message.includes('timeout')) {
                 console.error(`Cron Job: OpenAI API call timed out for song ${songId}.`);
            }
        }

        // Update song record
        const updateSql = `UPDATE songs SET lyrics = $1, status = $2 WHERE id = $3`;
        await query(updateSql, [lyrics, finalStatus, songId]);
        console.log(`Cron Job: Updated song ${songId} with status '${finalStatus}'.`);

        res.status(200).json({ message: `Processed song ${songId} with status ${finalStatus}.` });

    } catch (error) {
        console.error("Cron Job: Error processing lyrics queue:", error.message);
        if (songToProcess?.id) {
            try {
                await query("UPDATE songs SET status = 'lyrics_error' WHERE id = $1 AND status = 'lyrics_processing'", [songToProcess.id]);
                console.log(`Cron Job: Marked song ${songToProcess.id} as 'lyrics_error' due to processing failure.`);
            } catch (updateErr) {
                console.error(`Cron Job: Failed to mark song ${songToProcess.id} as error after failure:`, updateErr);
            }
        }
        res.status(500).json({ error: 'Cron job failed during processing.' });
    }
});

// NEW Endpoint: Process Pending Audio (Called by Cron Job - Needs Protection)
router.post('/cron/process-audio-queue', async (req, res) => {
    // Optional: Add secret validation
    // const cronSecret = req.headers['x-vercel-cron-secret'];
    // if (cronSecret !== process.env.CRON_SECRET) return res.status(401).send('Unauthorized');

    console.log("Cron Job: Checking for pending audio generation...");
    let songToProcess = null;
    let userCredits = undefined; // To track if credit check was done

    try {
        // 1. Find one song that is pending audio generation
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

        // 2. Check Credits & Deduct (Moved here from /generate-audio)
        const creditCheckSql = "SELECT credits FROM users WHERE id = $1";
        const creditResult = await query(creditCheckSql, [userId]);
        const user = creditResult.rows[0];

        if (!user) throw new Error(`User ${userId} not found for credit check.`);
        if (user.credits < CREDITS_PER_SONG) {
            console.warn(`Cron Job: Insufficient credits for user ${userId} to process song ${songId}. Setting status to error.`);
            await query("UPDATE songs SET status = 'error' WHERE id = $1", [songId]); // Mark as error due to credits
            return res.status(200).json({ message: `Skipped song ${songId} due to insufficient credits.` });
        }
        userCredits = user.credits; // Store for potential refund

        const deductSql = "UPDATE users SET credits = credits - $1 WHERE id = $2";
        await query(deductSql, [CREDITS_PER_SONG, userId]);
        console.log(`Cron Job: Deducted ${CREDITS_PER_SONG} credit(s) from user ${userId} for song ${songId}.`);


        // 3. Mark song as 'audio_processing'
        await query("UPDATE songs SET status = 'audio_processing' WHERE id = $1", [songId]);
        console.log(`Cron Job: Marked song ${songId} as 'audio_processing'.`);

        // 4. Call Suno API (with timeout)
        const callbackUrl = `${process.env.SUNO_CALLBACK_URL}?songId=${songId}`;
        let sunoResponse;
        const sunoRequestConfig = {
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.SUNO_API_KEY}` },
            timeout: 8000 // Short timeout for submission
        };
        const sunoPayload = {
            customMode: true, instrumental: false, model: "V3_5",
            style: musicStyle?.slice(0, 200) || '', // Handle potential null
            title: defaultTitle?.slice(0, 80) || 'Untitled', // Handle potential null
            prompt: lyrics?.slice(0, 3000) || '', // Handle potential null
            callBackUrl: callbackUrl
        };

        let sunoTaskId = null;
        let nextStatus = 'error'; // Default to error

        try {
            console.log(`Cron Job: Submitting audio job to Suno for song ${songId}...`);
            sunoResponse = await axios.post(process.env.SUNO_API_ENDPOINT, sunoPayload, sunoRequestConfig);
            console.log(`Cron Job: Suno API initial response for song ${songId}:`, sunoResponse.data);
            sunoTaskId = sunoResponse?.data?.data?.taskId || sunoResponse?.data?.taskId || null;
            if (sunoTaskId) {
                nextStatus = 'processing'; // Suno accepted the job, has task ID
            } else {
                console.error(`Cron Job: Suno response missing task ID for song ${songId}.`);
                nextStatus = 'error'; // Treat missing task ID as an error
            }
        } catch (axiosError) {
            if (axiosError.code === 'ECONNABORTED' || axiosError.message.includes('timeout')) {
                console.warn(`Cron Job: Suno API submission timed out for song ${songId}. Setting status back to 'audio_pending' for retry.`);
                nextStatus = 'audio_pending'; // Set back to pending for next cron run
            } else {
                console.error(`Cron Job: Suno API request failed for song ${songId}:`, axiosError.message);
                nextStatus = 'error'; // Mark as error on other API failures
            }
        }

        // 5. Update song record with Suno Task ID (if available) and status
        const updateTaskSql = "UPDATE songs SET suno_task_id = $1, status = $2 WHERE id = $3";
        await query(updateTaskSql, [sunoTaskId, nextStatus, songId]);
        console.log(`Cron Job: Updated song ${songId} with Task ID '${sunoTaskId || 'N/A'}' and status '${nextStatus}'.`);

        res.status(200).json({ message: `Processed audio request for song ${songId} with final status ${nextStatus}.` });

    } catch (error) {
        console.error("Cron Job: Error processing audio queue:", error.message);
        // If we managed to mark the song as processing, try to mark it as error
        // Also attempt to refund credits if they were likely deducted
        if (songToProcess?.id) {
            try {
                await query("UPDATE songs SET status = 'error' WHERE id = $1 AND status = 'audio_processing'", [songToProcess.id]);
                console.log(`Cron Job: Marked song ${songToProcess.id} as 'error' due to audio processing failure.`);
                if (userCredits !== undefined) { // Check if credit check was done
                    await query("UPDATE users SET credits = credits + $1 WHERE id = $2", [CREDITS_PER_SONG, songToProcess.user_id]);
                    console.log(`Cron Job: Refunded ${CREDITS_PER_SONG} credit(s) to user ${songToProcess.user_id}.`);
                }
            } catch (updateErr) {
                console.error(`Cron Job: Failed to mark song ${songToProcess.id} as error or refund credits after failure:`, updateErr);
            }
        }
        res.status(500).json({ error: 'Cron job failed during audio processing.' });
    }
});

// NEW Endpoint: Get Audio Generation Status by Song ID (Protected) - For Frontend Polling BEFORE Task ID is known
router.get('/audio-status/:songId', verifyToken, async (req, res) => {
    const userId = req.userId;
    const songId = req.params.songId;

    try {
        const sql = "SELECT user_id, status, suno_task_id, audio_url FROM songs WHERE id = $1";
        const result = await query(sql, [songId]);
        const song = result.rows[0];

        if (!song) {
            return res.status(404).json({ error: "Song not found." });
        }
        // Verify ownership
        if (song.user_id !== userId) {
            return res.status(403).json({ error: "Forbidden." });
        }

        // Return relevant info for polling
        res.json({
            status: song.status,
            suno_task_id: song.suno_task_id, // Will be null until audio cron assigns it
            audio_url: song.audio_url // Will be null until complete
        });

    } catch (error) {
        console.error(`Error fetching audio status for song ${songId}:`, error.message);
        res.status(500).json({ error: "Server error fetching status." });
    }
});


module.exports = router;
