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

    // --- Proceed with Lyric Generation (OpenAI call remains the same) ---
    try {
        const { workout, musicStyle, name } = req.body;

        // *** OpenAI API Call - No changes needed here ***
        const response = await axios.post(process.env.OPENAI_API_ENDPOINT, {
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
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            }
        });

        const lyrics = response.data.choices[0].message.content.trim();
        res.json({ lyrics }); // Send lyrics back

    } catch (error) {
        console.error('Error generating lyrics:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Failed to generate lyrics' });
    }
});

// Generate audio endpoint (Protected) - REFACTORED for PostgreSQL
router.post('/generate-audio', verifyToken, async (req, res) => {
    const userId = req.userId;
    const { lyrics, musicStyle, workout, name } = req.body;

    let userCredits;
    let songId;
    const defaultTitle = `${workout || 'Workout'} - ${musicStyle || 'Song'}`;

    // --- Wrap DB operations and Suno call in a try block for potential rollback/refund ---
    try {
        // --- Double Check Credits ---
        const creditCheckSql = "SELECT credits FROM users WHERE id = $1";
        const creditResult = await query(creditCheckSql, [userId]);
        const user = creditResult.rows[0];

        if (!user) return res.status(404).json({ error: "User not found." });
        if (user.credits < CREDITS_PER_SONG) return res.status(402).json({ error: "Insufficient credits." });
        userCredits = user.credits; // Store current credits

        // --- Deduct credits BEFORE starting generation ---
        const deductSql = "UPDATE users SET credits = credits - $1 WHERE id = $2";
        const deductResult = await query(deductSql, [CREDITS_PER_SONG, userId]);
        if (deductResult.rowCount === 0) {
            // Should not happen if user was found, but safeguard
            throw new Error("Failed to deduct credits (user not found or concurrent update).");
        }
        console.log(`Credits deducted for user ${userId}. New balance (potential): ${userCredits - CREDITS_PER_SONG}`);

        // --- Create Song Record in DB (Status: Pending) ---
        const insertSongSql = `
            INSERT INTO songs (user_id, workout_input, style_input, name_input, lyrics, title, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'pending')
            RETURNING id`;
        const insertResult = await query(insertSongSql, [userId, workout, musicStyle, name, lyrics, defaultTitle]);
        songId = insertResult.rows[0].id;
        console.log(`Initial song record created with ID: ${songId}`);

        // --- Initiate Suno Generation ---
        // *** Suno API Call - No changes needed here, assuming callback includes songId ***
        const callbackUrl = `${process.env.SUNO_CALLBACK_URL}?songId=${songId}`;
        const sunoResponse = await axios.post(process.env.SUNO_API_ENDPOINT, {
            customMode: true, instrumental: false, model: "V3_5",
            style: musicStyle.slice(0, 200), title: defaultTitle.slice(0, 80),
            prompt: lyrics.slice(0, 3000), callBackUrl: callbackUrl
        }, {
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.SUNO_API_KEY}` }
        });
        console.log("Suno API initial response:", sunoResponse.data);

        // Extract Suno Task ID
        const sunoTaskId = sunoResponse.data?.data?.taskId || sunoResponse.data?.taskId || null;

        if (sunoTaskId) {
            // Update song record with Suno Task ID and status 'processing'
            const updateTaskSql = "UPDATE songs SET suno_task_id = $1, status = 'processing' WHERE id = $2";
            await query(updateTaskSql, [sunoTaskId, songId]);
            console.log(`Updated song ${songId} with Suno Task ID ${sunoTaskId}`);

            res.json({
                message: "Audio generation task submitted.",
                songId: songId,
                sunoTaskId: sunoTaskId,
                remainingCredits: userCredits - CREDITS_PER_SONG
            });
        } else {
            // If Suno didn't return a task ID, mark song as error and refund credits
            console.error("Unexpected Suno response (missing task ID):", sunoResponse.data);
            throw new Error("Unexpected response from Suno API (missing task ID)."); // Trigger catch block for refund
        }

    } catch (error) {
        console.error("Error during audio generation/submission:", error.message);

        // --- Attempt to Rollback/Handle Error ---
        // 1. Mark song as error (if songId was created)
        if (songId) {
            try {
                const errorSql = "UPDATE songs SET status = 'error' WHERE id = $1";
                await query(errorSql, [songId]);
                console.log(`Marked song ${songId} as error due to generation failure.`);
            } catch (dbErr) {
                console.error(`Failed to mark song ${songId} as error:`, dbErr);
            }
        }
        // 2. Refund credits (if they were likely deducted)
        if (userCredits !== undefined) { // Check if credit check succeeded
             try {
                 const refundSql = "UPDATE users SET credits = credits + $1 WHERE id = $2";
                 await query(refundSql, [CREDITS_PER_SONG, userId]);
                 console.log(`Refunded ${CREDITS_PER_SONG} credit(s) to user ${userId}.`);
             } catch (dbErr) {
                 console.error(`CRITICAL: Failed to refund credits to user ${userId}:`, dbErr);
                 // Log this critical failure prominently
             }
        }
        // 3. Send error response
        res.status(500).json({ error: error.message || 'Failed to initiate audio generation' });
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

module.exports = router;
