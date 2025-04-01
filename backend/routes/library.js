// backend/routes/library.js
const express = require('express');
const { db } = require('../database');
const verifyToken = require('../middleware/authMiddleware');
const router = express.Router();

// Get User Profile (Username & Credits)
router.get('/profile', verifyToken, (req, res) => {
    const userId = req.userId;
    const sql = "SELECT username, credits FROM users WHERE id = ?";

    db.get(sql, [userId], (err, user) => {
        if (err) {
            console.error("Error fetching profile:", err);
            return res.status(500).json({ error: "Database error fetching profile." });
        }
        if (!user) {
            return res.status(404).json({ error: "User not found." });
        }
        res.json(user);
    });
});


// Get User's Song Library
router.get('/songs', verifyToken, (req, res) => {
    const userId = req.userId;
    // Fetch songs, newest first, exclude pending/processing? Or include with status?
    // Let's include all for now, frontend can filter display if needed
    const sql = `SELECT id, title, workout_input, style_input, audio_url, status, created_at
                 FROM songs
                 WHERE user_id = ?
                 ORDER BY created_at DESC`;

    db.all(sql, [userId], (err, songs) => {
        if (err) {
            console.error("Error fetching library:", err);
            return res.status(500).json({ error: "Database error fetching library." });
        }
        res.json(songs || []); // Return empty array if no songs
    });
});


// Optional: Delete a song (Example)
router.delete('/songs/:songId', verifyToken, (req, res) => {
    const userId = req.userId;
    const songId = req.params.songId;

    // Verify user owns the song before deleting
     db.get("SELECT user_id FROM songs WHERE id = ?", [songId], (err, song) => {
         if (err) return res.status(500).json({ error: "Database error" });
         if (!song) return res.status(404).json({ error: "Song not found" });
         if (song.user_id !== userId) return res.status(403).json({ error: "Forbidden" });

         // Proceed with deletion
         db.run("DELETE FROM songs WHERE id = ?", [songId], function(err) {
             if (err) {
                 console.error("Error deleting song:", err);
                 return res.status(500).json({ error: "Failed to delete song." });
             }
             if (this.changes === 0) {
                  return res.status(404).json({ error: "Song not found" }); // Should not happen if previous check passed
             }
             res.sendStatus(204); // No Content success
         });
     });
});


module.exports = router;