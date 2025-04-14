// backend/routes/generate.js
const express = require('express');
const axios = require('axios');
// Import the new query function
const { query } = require('../database');
const verifyToken = require('../middleware/authMiddleware'); // Import authentication middleware
const router = express.Router();

const CREDITS_PER_SONG = 1; // Define how many credits a song costs

// Generate lyrics endpoint (Protected) - REFACTORED for PostgreSQL
router.post('/generate-lyrics', verifyToken, async (req, res) => {
    const userId = req.userId; // Get user ID from verified token

    // --- Check Credits ---
    try {
        const creditCheckSql = "SELECT credits FROM users WHERE id = $1";
        const result = await query(creditCheckSql, [userId]);
        const user = result.rows[0];

        if (!user) {
            // This shouldn't happen if verifyToken works correctly, but good check
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

// Generate audio endpoint (Protected) - REFACTORED for Async Lyrics Flow
router.post('/generate-audio', verifyToken, async (req, res) => {
    const userId = req.userId;
    // Expect songId, lyrics, musicStyle, workout, name in the body
    const { songId, lyrics, musicStyle, workout, name } = req.body;

    if (!songId || !lyrics) {
        return res.status(400).json({ error: "Missing songId or lyrics." });
    }

    let userCredits;
    const defaultTitle = `${workout || 'Workout'} - ${musicStyle || 'Song'}`; // Use inputs for title consistency

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
        // Ensure lyrics are complete before proceeding
        if (song.status !== 'lyrics_complete') {
             return res.status(409).json({ error: `Cannot generate audio, song status is '${song.status}' (expected 'lyrics_complete').` });
        }

        // --- Check Credits & Deduct ---
        const creditCheckSql = "SELECT credits FROM users WHERE id = $1";
        const creditResult = await query(creditCheckSql, [userId]);
        const user = creditResult.rows[0];

        if (!user) return res.status(404).json({ error: "User not found for credit check." }); // Should not happen
        if (user.credits < CREDITS_PER_SONG) return res.status(402).json({ error: "Insufficient credits." });
        userCredits = user.credits;

        // Deduct credits
        const deductSql = "UPDATE users SET credits = credits - $1 WHERE id = $2";
        const deductResult = await query(deductSql, [CREDITS_PER_SONG, userId]);
        if (deductResult.rowCount === 0) {
            throw new Error("Failed to deduct credits (user not found or concurrent update).");
        }
        console.log(`Credits deducted for user ${userId} for song ${songId}. New balance: ${userCredits - CREDITS_PER_SONG}`);

        // --- Initiate Suno Generation (using existing songId) ---
        // *** Suno API Call - Keep timeout and specific error handling ***
        const callbackUrl = `${process.env.SUNO_CALLBACK_URL}?songId=${songId}`; // Use the existing songId
        let sunoResponse;
        const sunoRequestConfig = {
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.SUNO_API_KEY}` },
            timeout: 8000 // 8 seconds timeout
        };
        const sunoPayload = {
            customMode: true, instrumental: false, model: "V3_5",
            style: musicStyle.slice(0, 200), title: defaultTitle.slice(0, 80), // Use consistent title
            prompt: lyrics.slice(0, 3000), callBackUrl: callbackUrl
        };

        try {
            console.log(`Submitting audio job to Suno for song ${songId}...`);
            sunoResponse = await axios.post(process.env.SUNO_API_ENDPOINT, sunoPayload, sunoRequestConfig);
            console.log(`Suno API initial response for song ${songId}:`, sunoResponse.data);
        } catch (axiosError) {
            if (axiosError.code === 'ECONNABORTED' || axiosError.message.includes('timeout')) {
                console.warn(`Suno API submission call timed out after ${sunoRequestConfig.timeout}ms for song ${songId}. Assuming task might be processing.`);
                // Update status to 'pending' (audio pending), but don't throw error
                await query("UPDATE songs SET status = 'pending' WHERE id = $1", [songId]);
                sunoResponse = { data: {} }; // Simulate empty response
            } else {
                console.error(`Suno API request failed for song ${songId}:`, axiosError.response ? axiosError.response.data : axiosError.message);
                throw new Error(`Suno API request failed: ${axiosError.message}`); // Trigger main catch block for refund
            }
        }

        const sunoTaskId = sunoResponse?.data?.data?.taskId || sunoResponse?.data?.taskId || null;

        if (sunoTaskId) {
            // Update existing song record with Suno Task ID and status 'processing'
            const updateTaskSql = "UPDATE songs SET suno_task_id = $1, status = 'processing' WHERE id = $2";
            await query(updateTaskSql, [sunoTaskId, songId]);
            console.log(`Updated song ${songId} status to 'processing' with Suno Task ID ${sunoTaskId}`);
            // Respond with task ID
            res.json({
                message: "Audio generation task submitted successfully.",
                songId: songId, // Return the same songId
                sunoTaskId: sunoTaskId,
                remainingCredits: userCredits - CREDITS_PER_SONG
            });
        } else {
            // If Suno submission timed out (status already set to 'pending' in timeout catch block)
            console.warn(`Did not receive Suno Task ID for song ${songId} (due to timeout). Status is 'pending'.`);
            res.json({
                message: "Audio generation submitted, status pending confirmation.", // Inform frontend
                songId: songId, // Return the same songId
                sunoTaskId: null,
                remainingCredits: userCredits - CREDITS_PER_SONG // Credits were already deducted
            });
        }

    } catch (error) {
        // This catch block handles DB errors, credit deduction errors, or non-timeout Suno API errors
        console.error(`Error during audio generation submission for song ${songId}:`, error.message);

        // Attempt to Rollback: Mark song as error and refund credits
        try {
            // Mark song as error (use the songId from the request body)
            const errorSql = "UPDATE songs SET status = 'error' WHERE id = $1";
            await query(errorSql, [songId]);
            console.log(`Marked song ${songId} as error due to audio generation failure.`);

            // Refund credits only if they were successfully checked/stored before the error
            if (userCredits !== undefined) {
                 const refundSql = "UPDATE users SET credits = credits + $1 WHERE id = $2";
                 await query(refundSql, [CREDITS_PER_SONG, userId]);
                 console.log(`Refunded ${CREDITS_PER_SONG} credit(s) to user ${userId} for failed audio generation.`);
            }
        } catch (rollbackError) {
             console.error(`CRITICAL: Failed during error handling/rollback for song ${songId}:`, rollbackError);
        }

        // Send error response
        res.status(500).json({ error: error.message || 'Failed to initiate audio generation.' });
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
        // Still send 200 to Suno, but log the error.
        return res.sendStatus(200);
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
            // This is problematic - callback received for a song ID not in DB?
            console.error(`Callback received for Song ID ${songId}, but no matching record found in DB to update.`);
        }
    } catch (dbError) {
        console.error(`Database error handling callback for Song ID ${songId}:`, dbError);
        // Log error, but still send 200 to Suno
    }

    res.sendStatus(200); // Always acknowledge Suno quickly
});


// Endpoint for the client to poll for song status (Protected) - REFACTORED for PostgreSQL
router.get('/song-status/:sunoTaskId', verifyToken, async (req, res) => { // Make async
    const { sunoTaskId } = req.params;
    const userId = req.userId; // Ensure user owns the song

    try {
        // Query the database directly for the latest status
        const sql = "SELECT id, user_id, status, audio_url FROM songs WHERE suno_task_id = $1";
        const result = await query(sql, [sunoTaskId]);
        const song = result.rows[0];

        if (!song) {
            // If not found by task ID, maybe it errored before task ID was saved?
            // This case is harder to handle reliably without more info.
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

// NEW Endpoint: Process Lyrics Generation (Protected)
router.post('/process-lyrics/:songId', verifyToken, async (req, res) => {
    const userId = req.userId;
    const songId = req.params.songId;

    console.log(`Processing lyrics request for song ID: ${songId} by user ID: ${userId}`);

    try {
        // 1. Fetch song details (including inputs) and verify ownership
        const selectSql = `
            SELECT user_id, workout_input, style_input, name_input, status
            FROM songs
            WHERE id = $1`;
        const selectResult = await query(selectSql, [songId]);
        const song = selectResult.rows[0];

        if (!song) {
            console.error(`Process lyrics: Song ID ${songId} not found.`);
            return res.status(404).json({ error: "Song record not found." });
        }
        if (song.user_id !== userId) {
            console.error(`Process lyrics: User ${userId} does not own song ${songId}.`);
            return res.status(403).json({ error: "Forbidden." });
        }
        // Check if lyrics already generated or if status is wrong
        if (song.status !== 'lyrics_pending') {
             console.warn(`Process lyrics: Song ${songId} has status ${song.status}, expected 'lyrics_pending'.`);
             // If lyrics are already complete, return them to avoid re-generation
             if (song.status === 'lyrics_complete' || song.status === 'processing' || song.status === 'complete' || song.status === 'error') {
                 const existingLyricsResult = await query("SELECT lyrics FROM songs WHERE id = $1", [songId]);
                 if (existingLyricsResult.rows[0]?.lyrics) {
                     console.log(`Lyrics for song ${songId} already exist, returning existing lyrics.`);
                     return res.json({ lyrics: existingLyricsResult.rows[0].lyrics });
                 }
             }
             // Otherwise, it's an unexpected state
             return res.status(409).json({ error: `Cannot generate lyrics, song status is ${song.status}.` });
        }

        // 2. Call OpenAI API (with timeout)
        const { workout_input: workout, style_input: musicStyle, name_input: name } = song;
        const openAiPayload = {
            model: "gpt-4",
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
            // Use a longer timeout here if needed, as this function can run longer
            // Vercel Pro plan allows up to 5 minutes, Hobby plan might still timeout here
            // Increase timeout to 60 seconds.
            timeout: 60000
        };

        let openAiResponse;
        try {
            console.log(`Requesting lyrics from OpenAI for song ${songId}...`);
            openAiResponse = await axios.post(process.env.OPENAI_API_ENDPOINT, openAiPayload, openAiConfig);
            console.log(`Received lyrics response from OpenAI for song ${songId}.`);
        } catch (axiosError) {
            // Handle OpenAI timeout or other errors
            let errorMessage = 'Failed to generate lyrics.';
            if (axiosError.code === 'ECONNABORTED' || axiosError.message.includes('timeout')) {
                errorMessage = `Lyric generation timed out after ${openAiConfig.timeout / 1000} seconds.`;
                console.error(`OpenAI API call timed out for song ${songId}.`);
                // Mark song as error? Or leave as pending for retry? Let's mark as error.
                await query("UPDATE songs SET status = 'lyrics_error' WHERE id = $1", [songId]);
                return res.status(504).json({ error: errorMessage }); // Gateway Timeout
            } else {
                errorMessage = `OpenAI API request failed: ${axiosError.message}`;
                console.error(`OpenAI API request failed for song ${songId}:`, axiosError.response ? axiosError.response.data : axiosError.message);
                await query("UPDATE songs SET status = 'lyrics_error' WHERE id = $1", [songId]);
                // Don't throw, send specific error
                return res.status(502).json({ error: errorMessage }); // Bad Gateway
            }
        }

        // 3. Validate OpenAI response
        if (!openAiResponse?.data?.choices?.[0]?.message?.content) {
            console.error(`Invalid or unexpected response structure from OpenAI for song ${songId}:`, openAiResponse?.data);
            await query("UPDATE songs SET status = 'lyrics_error' WHERE id = $1", [songId]);
            return res.status(502).json({ error: 'Invalid response received from lyric generation service.' }); // Bad Gateway
        }
        const lyrics = openAiResponse.data.choices[0].message.content.trim();

        // 4. Update song record with lyrics and new status
        const updateSql = `UPDATE songs SET lyrics = $1, status = 'lyrics_complete' WHERE id = $2`;
        await query(updateSql, [lyrics, songId]);
        console.log(`Updated song ${songId} with generated lyrics and status 'lyrics_complete'.`);

        // 5. Respond to frontend with lyrics
        res.json({ lyrics });

    } catch (error) {
        // Catch errors from DB lookups or unexpected issues
        console.error(`Error processing lyrics for song ${songId}:`, error.message);
        // Attempt to mark song as error if possible
        try { await query("UPDATE songs SET status = 'lyrics_error' WHERE id = $1", [songId]); } catch (e) { /* ignore */ }
        res.status(500).json({ error: 'Server error processing lyrics generation.' });
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
// IMPORTANT: Add protection (e.g., check secret header) if making this public-facing
// For Vercel Cron, it's called internally, but good practice to secure.
router.post('/cron/process-lyrics-queue', async (req, res) => {
    // Optional: Add secret validation if needed
    // const cronSecret = req.headers['x-vercel-cron-secret'];
    // if (cronSecret !== process.env.CRON_SECRET) {
    //     return res.status(401).send('Unauthorized');
    // }

    console.log("Cron Job: Checking for pending lyrics...");
    let songToProcess = null;

    try {
        // 1. Find one song that is pending lyrics generation
        // Use FOR UPDATE SKIP LOCKED to handle potential concurrency if cron runs frequently
        const findSql = `
            SELECT id, user_id, workout_input, style_input, name_input
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

        // 2. Mark song as processing immediately
        await query("UPDATE songs SET status = 'lyrics_processing' WHERE id = $1", [songId]);
        console.log(`Cron Job: Marked song ${songId} as 'lyrics_processing'.`);

        // 3. Call OpenAI API (with timeout)
        const openAiPayload = {
            model: "gpt-4",
            messages: [{
                role: "user",
                content: `Write a high-quality motivational song (3–4 minutes long) for athlete ${name || 'the athlete'}, who is preparing for the event: a major athletic challenge... [Your full prompt here]` // Truncated for brevity
            }],
            temperature: 0.7
        };
        const openAiConfig = {
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
            timeout: 60000 // 60 seconds timeout for the cron job context
        };

        let openAiResponse;
        let lyrics;
        let finalStatus = 'lyrics_error'; // Default to error

        try {
            console.log(`Cron Job: Requesting lyrics from OpenAI for song ${songId}...`);
            openAiResponse = await axios.post(process.env.OPENAI_API_ENDPOINT, openAiPayload, openAiConfig);

            if (openAiResponse?.data?.choices?.[0]?.message?.content) {
                lyrics = openAiResponse.data.choices[0].message.content.trim();
                finalStatus = 'lyrics_complete';
                console.log(`Cron Job: Successfully generated lyrics for song ${songId}.`);
            } else {
                console.error(`Cron Job: Invalid response structure from OpenAI for song ${songId}:`, openAiResponse?.data);
                // Keep finalStatus as 'lyrics_error'
            }
        } catch (axiosError) {
            console.error(`Cron Job: OpenAI API call failed for song ${songId}:`, axiosError.message);
            // Keep finalStatus as 'lyrics_error'
            if (axiosError.code === 'ECONNABORTED' || axiosError.message.includes('timeout')) {
                 console.error(`Cron Job: OpenAI API call timed out for song ${songId}.`);
            }
        }

        // 4. Update song record with lyrics and final status
        const updateSql = `UPDATE songs SET lyrics = $1, status = $2 WHERE id = $3`;
        await query(updateSql, [lyrics, finalStatus, songId]);
        console.log(`Cron Job: Updated song ${songId} with status '${finalStatus}'.`);

        res.status(200).json({ message: `Processed song ${songId} with status ${finalStatus}.` });

    } catch (error) {
        console.error("Cron Job: Error processing lyrics queue:", error.message);
        // If we managed to mark the song as processing, try to mark it as error
        if (songToProcess?.id) {
            try {
                await query("UPDATE songs SET status = 'lyrics_error' WHERE id = $1 AND status = 'lyrics_processing'", [songToProcess.id]);
                console.log(`Cron Job: Marked song ${songToProcess.id} as 'lyrics_error' due to processing failure.`);
            } catch (updateErr) {
                console.error(`Cron Job: Failed to mark song ${songToProcess.id} as error after failure:`, updateErr);
            }
        }
        // Respond with error, but cron should ideally not fail completely
        res.status(500).json({ error: 'Cron job failed during processing.' });
    }
});


module.exports = router;
