const db = require('../config/db');

async function processZoneResources(disasterId, zoneId, disasterName, severity, radiusMeters, io) {
    const emitProgress = (stage, data = {}) => {
        if (io) {
            io.emit('ai_agent_progress', {
                zoneId,
                stage,
                ...data
            });
        }
    };

    try {
        console.log(`[AI Agent] Starting resource assessment for zone ${zoneId} (Disaster: ${disasterName})`);
        emitProgress('STARTING', { message: 'Analyzing disaster severity and radius...' });

        // Construct the prompt
        const prompt = `You are an expert disaster relief AI agent. 
A new disaster relief zone has been declared.
Disaster Name: ${disasterName}
Severity: ${severity} (can be red/emergency, yellow/delayed, blue/risk)
Zone Radius: ${radiusMeters} meters

Based on this information, determine the required resources and their quantities to support this zone.
You MUST respond with a valid JSON object containing a "resources" key which is an array of objects.
Each object must have exactly two keys: "resource_type" (string) and "quantity_needed" (integer).
Keep the list focused to 3-5 critical resource types (e.g., Water Bottles, Food Packets, Medical Kits, Blankets, Tents).

Example structure:
{
  "resources": [
    {"resource_type": "Water Bottles", "quantity_needed": 1000},
    {"resource_type": "Food Packets", "quantity_needed": 500},
    {"resource_type": "Medical Kits", "quantity_needed": 50}
  ]
}
`;

        // Call local Ollama API
        const response = await fetch('http://127.0.0.1:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'qwen2.5:7b',
                prompt: prompt,
                stream: false,
                format: 'json'
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        let responseStr = data.response;
        console.log('[AI Agent] Raw response from Ollama:', responseStr);

        // Clean markdown code blocks if present
        if (responseStr.includes('```json')) {
            responseStr = responseStr.split('```json')[1].split('```')[0].trim();
        } else if (responseStr.includes('```')) {
            responseStr = responseStr.split('```')[1].split('```')[0].trim();
        }

        let items = [];
        try {
            const parsed = JSON.parse(responseStr);
            if (Array.isArray(parsed)) {
                items = parsed;
            } else if (parsed && typeof parsed === 'object') {
                if (Array.isArray(parsed.resources)) {
                    items = parsed.resources;
                } else if (parsed.resource_type && parsed.quantity_needed) {
                    items = [parsed];
                } else {
                    // Check if any property is an array
                    for (const key of Object.keys(parsed)) {
                        if (Array.isArray(parsed[key])) {
                            items = parsed[key];
                            break;
                        }
                    }
                    // If still empty, check if it's key-value map like { "Water Bottles": 1000 }
                    if (items.length === 0) {
                        for (const [key, val] of Object.entries(parsed)) {
                            if (typeof val === 'number' || !isNaN(Number(val))) {
                                items.push({ resource_type: key, quantity_needed: Number(val) });
                            }
                        }
                    }
                }
            }
        } catch (parseError) {
            console.error('[AI Agent] Failed to parse JSON from Ollama:', parseError.message, 'Raw:', responseStr);
        }

        // Normalize items array
        items = items.filter(item => item && (item.resource_type || item.type || item.name))
                     .map(item => ({
                         resource_type: String(item.resource_type || item.type || item.name).trim(),
                         quantity_needed: parseInt(item.quantity_needed || item.quantity || item.qty || 100, 10) || 100
                     }));

        // Fallback default resources if AI returned empty or unparseable result
        if (items.length === 0) {
            console.warn('[AI Agent] AI response was empty or unparseable. Using default disaster resource fallback.');
            const scale = severity === 'red' ? 2 : severity === 'yellow' ? 1 : 0.5;
            items = [
                { resource_type: 'Water Bottles', quantity_needed: Math.round(1000 * scale) },
                { resource_type: 'Food Packets', quantity_needed: Math.round(500 * scale) },
                { resource_type: 'Medical Kits', quantity_needed: Math.round(50 * scale) },
                { resource_type: 'Emergency Blankets', quantity_needed: Math.round(200 * scale) }
            ];
        }

        emitProgress('REQUIREMENTS_DONE', { items });

        // Fetch all NGOs
        const orgsResult = await db.query("SELECT id, name FROM organizations");
        const orgs = orgsResult.rows;
        const orgIds = orgs.map(r => r.id);

        if (orgIds.length === 0) {
            console.warn('[AI Agent] No organizations available to send requests to.');
            emitProgress('ERROR', { message: 'No NGOs available in the system', step: 'NGOS' });
            return;
        }

        emitProgress('NGO_SELECTION_DONE', { orgs });

        // 1. Create the request
        const notes = `Automated AI request for zone severity ${severity} (radius: ${radiusMeters}m).`;
        const reqResult = await db.query(
            `INSERT INTO disaster_requests (disaster_id, created_by, notes)
             VALUES ($1, $2, $3) RETURNING id`,
            [disasterId, null, notes]
        );
        const requestId = reqResult.rows[0].id;

        // 2. Create request items
        for (const item of items) {
            const type = item.resource_type || 'Unknown Resource';
            const qty = item.quantity_needed || 100;
            await db.query(
                `INSERT INTO disaster_request_items (request_id, resource_type, quantity_needed, is_default)
                 VALUES ($1, $2, $3, $4)`,
                [requestId, type, qty, false]
            );
        }

        // 3. Create org assignments
        for (let i = 0; i < orgIds.length; i++) {
            const orgId = orgIds[i];
            const status = i === 0 ? 'active' : 'pending';
            await db.query(
                `INSERT INTO org_request_assignments (request_id, organization_id, status)
                 VALUES ($1, $2, $3)`,
                [requestId, orgId, status]
            );
        }

        emitProgress('COMPLETED', { message: 'Requests successfully dispatched to NGOs' });
        console.log(`[AI Agent] Successfully dispatched AI resource requests for zone ${zoneId} to ${orgIds.length} organizations.`);

        // 4. Trigger the organizational multi-agent sequence
        const { runOrgAgentSequence } = require('./orgResourceAgent');
        // We delay it slightly so the frontend can catch up before the first NGO starts allocating
        setTimeout(() => {
            runOrgAgentSequence(requestId, io).catch(console.error);
        }, 3000);

    } catch (err) {
        console.error('[AI Agent] Error processing zone resources:', err);
        emitProgress('ERROR', { message: err.message || 'Internal AI Error', step: 'DISPATCH' });
    }
}

module.exports = {
    processZoneResources
};
