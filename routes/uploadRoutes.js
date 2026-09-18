const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');
const { uploadFile } = require('../config/supabaseStorage');

const router = express.Router();

// Configure multer for in-memory storage (we stream to Supabase, not disk)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB per file
        files: 5,                    // Max 5 files per request
    },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else if (file.mimetype === 'application/octet-stream') {
            // Flutter's http package often sends generic mimetype;
            // accept it and infer real type from extension later
            const ext = path.extname(file.originalname).toLowerCase();
            const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];
            if (imageExts.includes(ext)) {
                // Fix the mimetype based on extension
                const extToMime = {
                    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                    '.png': 'image/png', '.webp': 'image/webp',
                    '.heic': 'image/heic', '.heif': 'image/heic',
                };
                file.mimetype = extToMime[ext] || 'image/jpeg';
                cb(null, true);
            } else {
                cb(new Error(`Unsupported file type: ${file.mimetype} (ext: ${ext})`), false);
            }
        } else {
            cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
        }
    },
});

/**
 * POST /api/v1/uploads/task-proof
 * Body: multipart/form-data with field "images" (1-5 files)
 * Query: ?task_id=<uuid>  (optional, used for folder organization)
 * Returns: { urls: [string] }
 */
router.post(
    '/task-proof',
    verifyToken,
    checkRole(),
    upload.array('images', 5),
    async (req, res) => {
        try {
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ message: 'No images provided' });
            }

            const taskId = req.query.task_id || 'general';
            const urls = [];

            for (const file of req.files) {
                const ext = path.extname(file.originalname) || '.jpg';
                const uniqueName = `${crypto.randomUUID()}${ext}`;
                const storagePath = `tasks/${taskId}/${uniqueName}`;

                const url = await uploadFile(file.buffer, storagePath, file.mimetype);
                urls.push(url);
            }

            res.json({ urls });
        } catch (err) {
            console.error('Upload error:', err);
            res.status(500).json({ message: err.message || 'Upload failed' });
        }
    }
);

module.exports = router;
