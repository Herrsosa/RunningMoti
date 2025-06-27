// backend/routes/library.js
const express = require('express');
// Import the new query function
const { query } = require('../database');
const verifyToken = require('../middleware/authMiddleware');
const router = express.Router();

// Get User Profile (Username & Credits) - REFACTORED for PostgreSQL
router.get('/profile', verifyToken, async (req, res) => { // Make async
    const userId = req.userId;
    const sql = "SELECT username, credits FROM users WHERE id = $1"; // Use $1

    try {
        const result = await query(sql, [userId]);
        const user = result.rows[0]; // Get first row

        if (!user) {
            return res.status(404).json({ error: "User not found." });
        }
        res.json(user);
    } catch (err) {
        console.error("Error fetching profile:", err);
        return res.status(500).json({ error: "Database error fetching profile." });
    }
});


// Get User's Song Library - REFACTORED for PostgreSQL
router.get('/songs', verifyToken, async (req, res) => { // Make async
    const userId = req.userId;
    const sql = `
        SELECT id, title, track_name, workout_input, style_input, audio_url, status, created_at
        FROM songs
        WHERE user_id = $1
        ORDER BY created_at DESC`; // Use $1

    try {
        const result = await query(sql, [userId]);
        res.json(result.rows || []); // Return rows (already an array) or empty array
    } catch (err) {
        console.error("Error fetching library:", err);
        return res.status(500).json({ error: "Database error fetching library." });
    }
});


// Optional: Delete a song - REFACTORED for PostgreSQL
router.delete('/songs/:songId', verifyToken, async (req, res) => { // Make async
    const userId = req.userId;
    const songId = req.params.songId;

    try {
        // Verify user owns the song before deleting
        const checkSql = "SELECT user_id FROM songs WHERE id = $1"; // Use $1
        const checkResult = await query(checkSql, [songId]);
        const song = checkResult.rows[0];

        if (!song) {
            return res.status(404).json({ error: "Song not found" });
        }
        if (song.user_id !== userId) {
            return res.status(403).json({ error: "Forbidden" });
        }

        // Proceed with deletion
        const deleteSql = "DELETE FROM songs WHERE id = $1"; // Use $1
        const deleteResult = await query(deleteSql, [songId]);

        if (deleteResult.rowCount === 0) {
            // Should not happen if previous check passed, but good safeguard
            console.warn(`Attempted to delete song ID ${songId} but no rows were affected.`);
            return res.status(404).json({ error: "Song not found during delete operation" });
        }

        res.sendStatus(204); // No Content success

    } catch (err) {
        console.error(`Error deleting song ID ${songId}:`, err);
        return res.status(500).json({ error: "Failed to delete song." });
    }
});

module.exports = router;
