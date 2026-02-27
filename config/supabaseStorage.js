const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.warn(
        '⚠️  SUPABASE_URL or SUPABASE_SERVICE_KEY not set — file uploads will fail.'
    );
}

const supabase = createClient(SUPABASE_URL || '', SUPABASE_SERVICE_KEY || '');

const BUCKET_NAME = 'task-proofs';

/**
 * Upload a buffer to Supabase Storage.
 * @param {Buffer} fileBuffer
 * @param {string} fileName - e.g. 'tasks/abc-123/proof-1.jpg'
 * @param {string} mimeType - e.g. 'image/jpeg'
 * @returns {Promise<string>} public URL of the uploaded file
 */
async function uploadFile(fileBuffer, fileName, mimeType) {
    const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(fileName, fileBuffer, {
            contentType: mimeType,
            upsert: true,
        });

    if (error) {
        console.error('Supabase upload error:', error);
        throw new Error(`Storage upload failed: ${error.message}`);
    }

    const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(fileName);

    return urlData.publicUrl;
}

module.exports = { supabase, uploadFile, BUCKET_NAME };
