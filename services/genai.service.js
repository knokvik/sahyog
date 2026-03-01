/**
 * GenAI Service — Gemini 2.5 Flash Multimodal Integration
 * 
 * Analyses emergency photos + descriptions + TFLite scores to produce
 * structured injury assessments and risk classifications in Hindi + English.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-2.5-flash-preview-05-20';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=`;

// ── Prompt Template ──────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an emergency medical triage AI for India's National Emergency Communication System (Sahyog ResQConnect).

You receive distress signal data (photo, description, on-device TFLite severity score) and MUST return a structured JSON assessment.

RULES:
1. Analyse the photo for visible injuries, environmental hazards, crowd density, structural damage.
2. Cross-reference with the TFLite score (0.0 = safe, 1.0 = critical) and text description.
3. Output Hindi + English for field responders.
4. Be concise but actionable. No disclaimers.

OUTPUT FORMAT (strict JSON, no markdown):
{
  "risk_level": "low" | "medium" | "high" | "critical",
  "injury_assessment_en": "2-3 sentence assessment in English",
  "injury_assessment_hi": "Same assessment in Hindi",
  "recommended_actions_en": ["action 1", "action 2", ...],
  "recommended_actions_hi": ["कार्रवाई 1", "कार्रवाई 2", ...],
  "requires_ambulance": true/false,
  "requires_fire_brigade": true/false,
  "requires_police": true/false,
  "estimated_victims": number or null,
  "urgency_minutes": number (estimated time window for response)
}`;

// ── Main Analysis Function ───────────────────────────────────────────

/**
 * Analyse an emergency packet using Gemini multimodal.
 * @param {Object} params
 * @param {string} [params.photoUrl] - URL to the emergency photo
 * @param {string} [params.description] - Text description of the emergency
 * @param {number} [params.tfliteScore] - On-device TFLite severity (0-1)
 * @param {string} [params.type] - Emergency type (Medical, Fire, etc.)
 * @param {number} [params.lat] - Latitude
 * @param {number} [params.lng] - Longitude
 * @returns {Object} Structured AI assessment
 */
async function analyseEmergency({ photoUrl, description, tfliteScore, type, lat, lng }) {
    if (!GEMINI_API_KEY) {
        console.warn('[GenAI] No GEMINI_API_KEY set — returning fallback assessment');
        return buildFallback(tfliteScore, type, description);
    }

    try {
        const userPrompt = buildUserPrompt({ photoUrl, description, tfliteScore, type, lat, lng });
        const parts = [{ text: userPrompt }];

        // If photo URL is provided, include it as an image part
        if (photoUrl) {
            parts.unshift({
                fileData: {
                    mimeType: 'image/jpeg',
                    fileUri: photoUrl,
                }
            });
        }

        const requestBody = {
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: 'user', parts }],
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 1024,
                responseMimeType: 'application/json',
            },
        };

        const response = await fetch(`${GEMINI_URL}${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[GenAI] Gemini API error ${response.status}:`, errText);
            return buildFallback(tfliteScore, type, description);
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
            console.warn('[GenAI] Empty response from Gemini');
            return buildFallback(tfliteScore, type, description);
        }

        // Parse the JSON response
        const assessment = JSON.parse(text);
        return {
            risk_level: assessment.risk_level || classifyFromTflite(tfliteScore),
            injury_assessment_en: assessment.injury_assessment_en || '',
            injury_assessment_hi: assessment.injury_assessment_hi || '',
            recommended_actions_en: assessment.recommended_actions_en || [],
            recommended_actions_hi: assessment.recommended_actions_hi || [],
            requires_ambulance: assessment.requires_ambulance || false,
            requires_fire_brigade: assessment.requires_fire_brigade || false,
            requires_police: assessment.requires_police || false,
            estimated_victims: assessment.estimated_victims || null,
            urgency_minutes: assessment.urgency_minutes || 30,
            source: 'gemini',
        };
    } catch (err) {
        console.error('[GenAI] Analysis failed:', err.message);
        return buildFallback(tfliteScore, type, description);
    }
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildUserPrompt({ photoUrl, description, tfliteScore, type, lat, lng }) {
    return `EMERGENCY DISTRESS SIGNAL RECEIVED:

Type: ${type || 'Unknown'}
Location: ${lat ? `${lat}, ${lng}` : 'Unknown'}
On-Device TFLite Severity Score: ${tfliteScore != null ? tfliteScore.toFixed(2) : 'N/A'} (0=safe, 1=critical)
Description: ${description || 'No description provided'}
Photo: ${photoUrl ? 'Attached for analysis' : 'Not available'}

Analyse and return the structured JSON assessment.`;
}

function classifyFromTflite(score) {
    if (score == null) return 'medium';
    if (score >= 0.8) return 'critical';
    if (score >= 0.6) return 'high';
    if (score >= 0.3) return 'medium';
    return 'low';
}

function buildFallback(tfliteScore, type, description) {
    const risk = classifyFromTflite(tfliteScore);
    const typeStr = type || 'Emergency';

    return {
        risk_level: risk,
        injury_assessment_en: `${typeStr} reported. TFLite severity: ${tfliteScore != null ? (tfliteScore * 100).toFixed(0) + '%' : 'unknown'}. ${description || 'No details available.'}`,
        injury_assessment_hi: `${typeStr} की सूचना। TFLite गंभीरता: ${tfliteScore != null ? (tfliteScore * 100).toFixed(0) + '%' : 'अज्ञात'}. ${description || 'कोई विवरण उपलब्ध नहीं।'}`,
        recommended_actions_en: ['Dispatch nearest responder', 'Confirm situation on ground'],
        recommended_actions_hi: ['निकटतम प्रतिक्रियाकर्ता भेजें', 'स्थिति की पुष्टि करें'],
        requires_ambulance: risk === 'critical' || risk === 'high',
        requires_fire_brigade: typeStr.toLowerCase().includes('fire'),
        requires_police: typeStr.toLowerCase().includes('security') || typeStr.toLowerCase().includes('crime'),
        estimated_victims: null,
        urgency_minutes: risk === 'critical' ? 5 : risk === 'high' ? 15 : 30,
        source: 'fallback',
    };
}

module.exports = {
    analyseEmergency,
    classifyFromTflite,
    SYSTEM_PROMPT,
};
