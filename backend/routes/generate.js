// backend/routes/generate.js
const express = require('express');
const axios = require('axios');
const { db } = require('../database');
const verifyToken = require('../middleware/authMiddleware'); // Import authentication middleware
const router = express.Router();

const CREDITS_PER_SONG = 1; // Define how many credits a song costs

// Store task statuses temporarily (Needs improvement for production/scaling)
// A better approach would use the database or a dedicated cache like Redis
const taskStatusCache = new Map(); // Map suno_task_id -> { status, audioUrl, error }

// Generate lyrics endpoint (Protected)
router.post('/generate-lyrics', verifyToken, async (req, res) => {
    const userId = req.userId; // Get user ID from verified token

    // --- Check Credits ---
    try {
        const user = await new Promise((resolve, reject) => {
            db.get("SELECT credits FROM users WHERE id = ?", [userId], (err, row) => {
                 if (err) reject(new Error("Database error checking credits."));
                 else if (!row) reject(new Error("User not found."));
                 else resolve(row);
            });
        });

        if (user.credits < CREDITS_PER_SONG) {
            return res.status(402).json({ error: "Insufficient credits." }); // Payment Required
        }
    } catch (error) {
         console.error("Credit check error:", error);
         return res.status(500).json({ error: error.message || "Failed to check credits." });
    }
    // --- End Credit Check ---


    // --- Proceed with Lyric Generation ---
    try {
        const { workout, musicStyle, name } = req.body;

        const response = await axios.post(process.env.OPENAI_API_ENDPOINT, {
            model: "gpt-4", // Or your preferred model
            messages: [{
                role: "user",
                content: `Write a short motivational song (around 1-2 minutes reading time) for ${name || 'Athlete'}, who is doing a ${workout}. The song should match the style of ${musicStyle}. Make it energetic and uplifting.` // Adjust prompt as needed
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

// Generate audio endpoint (Protected)
router.post('/generate-audio', verifyToken, async (req, res) => {
    const userId = req.userId;
    const { lyrics, musicStyle, workout, name } = req.body; // Include original inputs

    // --- Double Check Credits & Deduct ---
    let userCredits;
     try {
        await new Promise((resolve, reject) => {
            db.get("SELECT credits FROM users WHERE id = ?", [userId], (err, row) => {
                 if (err) reject(new Error("Database error checking credits."));
                 else if (!row) reject(new Error("User not found."));
                 else {
                     userCredits = row.credits;
                     resolve();
                 }
            });
        });

        if (userCredits < CREDITS_PER_SONG) {
            return res.status(402).json({ error: "Insufficient credits." });
        }

        // --- Deduct credits BEFORE starting generation ---
        await new Promise((resolve, reject) => {
            db.run("UPDATE users SET credits = credits - ? WHERE id = ?", [CREDITS_PER_SONG, userId], function(err) {
                if (err || this.changes === 0) reject(new Error("Failed to deduct credits."));
                else resolve();
            });
        });

    } catch (error) {
         console.error("Credit check/deduction error:", error);
         return res.status(500).json({ error: error.message || "Failed to process credits." });
    }
    // --- End Credit Handling ---


    // --- Create Song Record in DB (Status: Pending) ---
    let songId;
    const defaultTitle = `${workout || 'Workout'} - ${musicStyle || 'Song'}`;
    try {
        songId = await new Promise((resolve, reject) => {
            const sql = `INSERT INTO songs (user_id, workout_input, style_input, name_input, lyrics, title, status)
                         VALUES (?, ?, ?, ?, ?, ?, 'pending')`;
            db.run(sql, [userId, workout, musicStyle, name, lyrics, defaultTitle], function(err) {
                if (err) reject(new Error("Failed to save initial song data."));
                else resolve(this.lastID);
            });
        });
    } catch (dbError) {
        console.error("DB Error saving song:", dbError);
        // Optional: Refund credits here if DB save fails? Complex.
        return res.status(500).json({ error: dbError.message });
    }

    // --- Initiate Suno Generation ---
    try {
        // IMPORTANT: Modify callback URL to include songId or a unique task reference
        const callbackUrl = `${process.env.SUNO_CALLBACK_URL}?songId=${songId}`; // Example

        const sunoResponse = await axios.post(process.env.SUNO_API_ENDPOINT, {
            customMode: true,
            instrumental: false,
            model: "V3_5",
            style: musicStyle.slice(0, 200),
            title: defaultTitle.slice(0, 80),
            prompt: lyrics.slice(0, 3000),
            callBackUrl: callbackUrl // Use modified callback URL
        }, {
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.SUNO_API_KEY}` }
        });

        console.log("Suno API initial response:", sunoResponse.data);

        // Extract Suno Task ID if available (adjust based on actual Suno response structure)
        const sunoTaskId = sunoResponse.data?.data?.taskId || sunoResponse.data?.taskId || null;

        if (sunoTaskId) {
            // Update song record with Suno Task ID and status
            await new Promise((resolve, reject) => {
                db.run("UPDATE songs SET suno_task_id = ?, status = 'processing' WHERE id = ?", [sunoTaskId, songId], (err) => {
                    if (err) console.error("Error updating song with Suno task ID:", err); // Log error but continue
                    resolve();
                });
            });
             // Add task to temporary cache (for polling)
            taskStatusCache.set(sunoTaskId, { status: 'processing', audioUrl: null, error: null });

            res.json({
                message: "Audio generation task submitted.",
                songId: songId, // Send songId back to frontend for polling status
                sunoTaskId: sunoTaskId, // Also send task ID
                remainingCredits: userCredits - CREDITS_PER_SONG // Send updated credits
            });
        } else {
            // Handle unexpected Suno response (no task ID)
            await new Promise((resolve, reject) => { // Mark song as error in DB
                 db.run("UPDATE songs SET status = 'error' WHERE id = ?", [songId], resolve);
            });
             // Optional: Refund credits
            await new Promise((resolve, reject) => {
                 db.run("UPDATE users SET credits = credits + ? WHERE id = ?", [CREDITS_PER_SONG, userId], resolve);
            });
            console.error("Unexpected Suno response:", sunoResponse.data);
            res.status(500).json({ error: "Unexpected response from Suno API." });
        }
    } catch (error) {
         await new Promise((resolve, reject) => { // Mark song as error in DB
             db.run("UPDATE songs SET status = 'error' WHERE id = ?", [songId], resolve);
         });
         // Optional: Refund credits
         await new Promise((resolve, reject) => {
             db.run("UPDATE users SET credits = credits + ? WHERE id = ?", [CREDITS_PER_SONG, userId], resolve);
         });
        if (error.response) console.error('Suno API error:', error.response.status, error.response.data);
        else console.error('Error submitting to Suno:', error.message);
        res.status(500).json({ error: 'Failed to initiate audio generation' });
    }
});

// Callback endpoint to receive Suno's asynchronous response
// NOTE: This needs robust error handling and secure validation in production
router.post('/suno-callback', async (req, res) => {
    console.log("Suno callback received:", JSON.stringify(req.body, null, 2));
    console.log("Callback Query Params:", req.query);

    // --- Extract songId from query param (adjust if needed) ---
    const songId = req.query.songId;
    const sunoTaskIdFromBody = req.body?.data?.taskId; // Or however Suno sends it back

    // Basic validation
    if (!songId && !sunoTaskIdFromBody) {
        console.error("Callback missing songId query param and task ID in body.");
        return res.status(400).send("Missing identifier.");
    }

    let audioUrl = null;
    let status = 'error'; // Default to error unless success
    let sunoTaskId = sunoTaskIdFromBody; // Prioritize ID from body if available

    // Try to find the audio URL in the expected structure
    if (req.body?.code === 200 && req.body?.data?.callbackType === "complete" && Array.isArray(req.body.data.data) && req.body.data.data.length > 0) {
        audioUrl = req.body.data.data[0].audio_url;
        status = 'complete';
        console.log(`Callback SUCCESS for Task ${sunoTaskId || 'N/A'} (Song ${songId || 'N/A'}): Audio URL found.`);
    } else if (req.body?.data?.callbackType === "fail") {
         status = 'error';
         console.error(`Callback FAILURE reported for Task ${sunoTaskId || 'N/A'} (Song ${songId || 'N/A'}):`, req.body.data.msg);
    } else {
         console.warn(`Callback received unknown status/format for Task ${sunoTaskId || 'N/A'} (Song ${songId || 'N/A'}).`);
         // Keep status as 'error' or potentially leave as 'processing' if unsure
    }

    // --- Update Database ---
    try {
        // Find the song record either by songId (from query) or suno_task_id (from body)
        const findSql = songId ? "SELECT id, suno_task_id FROM songs WHERE id = ?" : "SELECT id, suno_task_id FROM songs WHERE suno_task_id = ?";
        const findParam = songId || sunoTaskId;

        const song = await new Promise((resolve, reject) => {
            db.get(findSql, [findParam], (err, row) => {
                if (err) reject(new Error("DB error finding song for callback."));
                else resolve(row);
            });
        });

        if (song) {
            const actualSongId = song.id;
            const actualTaskId = sunoTaskId || song.suno_task_id; // Use ID from body if present, else from DB

            // Update temporary cache
             if (actualTaskId) {
                 taskStatusCache.set(actualTaskId, { status, audioUrl, error: status === 'error' ? (req.body.data?.msg || 'Callback failed') : null });
             }

             // Update the database record
            await new Promise((resolve, reject) => {
                 const updateSql = "UPDATE songs SET audio_url = ?, status = ?, suno_task_id = COALESCE(?, suno_task_id) WHERE id = ?";
                 db.run(updateSql, [audioUrl, status, actualTaskId, actualSongId], function(err) {
                      if (err) reject(new Error(`DB error updating song ${actualSongId}.`));
                      else resolve();
                 });
            });
            console.log(`Database updated for Song ID: ${actualSongId}, Status: ${status}`);

        } else {
            console.error(`Callback received but no matching song found for ID/Task: ${findParam}`);
            // Cannot update DB if no match found
        }

    } catch (dbError) {
        console.error("Database error handling callback:", dbError);
        // Don't send 500 back to Suno, just log the error server-side
    }

    res.sendStatus(200); // Always send 200 OK back to Suno quickly
});


// Endpoint for the client to poll for song status (Protected)
router.get('/song-status/:sunoTaskId', verifyToken, (req, res) => {
    const { sunoTaskId } = req.params;
    const userId = req.userId; // Ensure user owns the song

     // --- Check DB first for persistent status ---
     db.get("SELECT id, user_id, status, audio_url FROM songs WHERE suno_task_id = ?", [sunoTaskId], (err, song) => {
         if (err) {
             console.error("DB error fetching song status:", err);
             return res.status(500).json({ error: "Database error" });
         }
         if (!song) {
             return res.status(404).json({ status: 'not_found', audioUrl: null });
         }
         // Security Check: Ensure the logged-in user owns this song
         if (song.user_id !== userId) {
             return res.status(403).json({ error: "Forbidden" });
         }

         // If status is complete or error in DB, return it directly
         if (song.status === 'complete' || song.status === 'error') {
              console.log(`Polling status for Task ${sunoTaskId}: Returning final status '${song.status}' from DB.`);
              return res.json({ status: song.status, audioUrl: song.audio_url });
         }

         // --- Fallback to cache if still processing (less reliable) ---
         const cachedStatus = taskStatusCache.get(sunoTaskId);
         if (cachedStatus) {
            console.log(`Polling status for Task ${sunoTaskId}: Returning status '${cachedStatus.status}' from cache.`);
             res.json(cachedStatus); // Includes { status, audioUrl, error }
         } else {
             // If not in cache but DB says processing, return processing
             console.log(`Polling status for Task ${sunoTaskId}: Not in cache, DB status is '${song.status}'. Returning '${song.status}'.`);
             res.json({ status: song.status, audioUrl: song.audio_url });
         }
     });
});


module.exports = router;