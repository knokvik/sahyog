const db = require('../config/db');
const { logActivity } = require('./logger');

/**
 * Sleeps for ms milliseconds (useful for UI tracking visibility)
 */
const delay = (ms) => new Promise(res => setTimeout(res, ms));

/**
 * Recursively processes the sequence of NGO assignments for a given request.
 * It allocates resources based on the organization's ai_allocation_preference.
 */
async function runOrgAgentSequence(requestId, io) {
    try {
        console.log(`[Org Agent Sequence] Starting/Resuming sequence for request: ${requestId}`);

        // Fetch request details
        const reqResult = await db.query(`SELECT id, disaster_id, status FROM disaster_requests WHERE id = $1`, [requestId]);
        if (reqResult.rowCount === 0) return;
        const request = reqResult.rows[0];

        // If request is already fulfilled, cancel remaining assignments
        if (request.status === 'fulfilled') {
            await cancelRemainingAssignments(requestId, io);
            emitOrgProgress(io, requestId, null, 'COMPLETED', {
                org_name: null,
                message: 'All required resources have been fulfilled!',
                fulfilled: true
            });
            return;
        }

        // Check if all items are already fulfilled
        const itemsResult = await db.query(`SELECT id, resource_type, quantity_needed, quantity_fulfilled FROM disaster_request_items WHERE request_id = $1`, [requestId]);
        const items = itemsResult.rows;
        const isFullyFulfilled = items.every(item => (item.quantity_fulfilled || 0) >= item.quantity_needed);

        if (isFullyFulfilled) {
            await db.query(`UPDATE disaster_requests SET status = 'fulfilled' WHERE id = $1`, [requestId]);
            console.log(`[Org Agent Sequence] Request ${requestId} is fully fulfilled!`);
            await cancelRemainingAssignments(requestId, io);
            emitOrgProgress(io, requestId, null, 'COMPLETED', {
                org_name: null,
                message: 'All required resources have been fulfilled!',
                fulfilled: true,
                summary: items.map(it => ({
                    resource_type: it.resource_type,
                    needed: it.quantity_needed,
                    fulfilled: it.quantity_fulfilled || 0
                }))
            });
            return;
        }

        // Find the active assignment (if none, pick the first pending)
        let assignmentResult = await db.query(`
            SELECT ora.id, ora.organization_id, ora.status, o.name, o.ai_allocation_preference 
            FROM org_request_assignments ora
            JOIN organizations o ON ora.organization_id = o.id
            WHERE ora.request_id = $1 AND ora.status IN ('active', 'pending')
            ORDER BY ora.created_at ASC
            LIMIT 1
        `, [requestId]);

        if (assignmentResult.rowCount === 0) {
            console.log(`[Org Agent Sequence] No active or pending assignments left for request: ${requestId}`);
            // All orgs exhausted but request not fully fulfilled
            const fulfillmentSummary = items.map(it => ({
                resource_type: it.resource_type,
                needed: it.quantity_needed,
                fulfilled: it.quantity_fulfilled || 0
            }));
            emitOrgProgress(io, requestId, null, 'EXHAUSTED', {
                org_name: null,
                message: 'All organizations processed. Some resources may still be needed.',
                fulfilled: false,
                summary: fulfillmentSummary
            });
            return;
        }

        const assignment = assignmentResult.rows[0];
        const orgName = assignment.name || 'Unknown Org';

        // If it's pending, make it active
        if (assignment.status === 'pending') {
            await db.query(`UPDATE org_request_assignments SET status = 'active' WHERE id = $1`, [assignment.id]);
            assignment.status = 'active';
            emitOrgProgress(io, requestId, assignment.organization_id, 'ACTIVE', {
                org_name: orgName,
                message: `Agent activated for ${orgName}.`
            });
            await delay(2000); // UI visual delay
        }

        // Process allocation based on AI preference
        const preference = assignment.ai_allocation_preference || 'full';
        console.log(`[Org Agent] Org ${orgName} processing with mode: ${preference}`);

        if (preference === 'none') {
            await db.query(`UPDATE org_request_assignments SET status = 'rejected' WHERE id = $1`, [assignment.id]);
            emitOrgProgress(io, requestId, assignment.organization_id, 'SKIPPED', {
                org_name: orgName,
                message: `${orgName} opted out (No Send) — skipping.`
            });
            await logActivity({
                action_type: 'WARNING',
                entity_type: 'AGENT',
                entity_id: requestId,
                description: `AI Agent skipped organization ${orgName} because their AI preference is set to 'No Send'.`,
                organization_id: assignment.organization_id
            });
            await delay(1500);
            return runOrgAgentSequence(requestId, io).catch(console.error);
        }

        emitOrgProgress(io, requestId, assignment.organization_id, 'PROCESSING', {
            org_name: orgName,
            message: `Allocating resources from ${orgName} (${preference} mode)...`
        });

        // Calculate and insert contributions
        const contributions = [];
        for (const item of items) {
            let remaining = item.quantity_needed - (item.quantity_fulfilled || 0);
            if (remaining > 0) {
                let toAllocate = 0;
                if (preference === 'full') {
                    toAllocate = remaining;
                } else if (preference === 'partial') {
                    // E.g. allocate 30% of remaining need, at least 1 if remaining > 0
                    toAllocate = Math.max(1, Math.floor(remaining * 0.3));
                }

                if (toAllocate > 0) {
                    // Record contribution
                    await db.query(`
                        INSERT INTO org_request_contributions (assignment_id, item_id, quantity_committed)
                        VALUES ($1, $2, $3)
                    `, [assignment.id, item.id, toAllocate]);

                    // Update item fulfillment
                    await db.query(`
                        UPDATE disaster_request_items 
                        SET quantity_fulfilled = COALESCE(quantity_fulfilled, 0) + $1
                        WHERE id = $2
                    `, [toAllocate, item.id]);

                    contributions.push({
                        resource_type: item.resource_type,
                        quantity: toAllocate
                    });
                }
            }
        }

        // Mark this assignment as allocated
        await db.query(`UPDATE org_request_assignments SET status = 'allocated' WHERE id = $1`, [assignment.id]);
        
        emitOrgProgress(io, requestId, assignment.organization_id, 'ALLOCATED', { 
            org_name: orgName,
            message: `${orgName} allocated resources successfully.`, 
            contributions 
        });

        await logActivity({
            action_type: 'SUCCESS',
            entity_type: 'AGENT',
            entity_id: assignment.id,
            description: `AI Agent successfully allocated resources from ${orgName} using '${preference}' mode.`,
            organization_id: assignment.organization_id,
            metadata: { contributions }
        });

        // Wait a few seconds so UI can breathe
        await delay(3000);

        // Recursively trigger next
        runOrgAgentSequence(requestId, io).catch(console.error);

    } catch (err) {
        console.error('[Org Agent Sequence] Error:', err);
        emitOrgProgress(io, requestId, null, 'ERROR', {
            org_name: null,
            message: `Agent error: ${err.message}`
        });
    }
}

/**
 * Helper to emit socket events — now always includes org_name
 */
function emitOrgProgress(io, requestId, organizationId, stage, data = {}) {
    if (io) {
        io.emit('org_agent_progress', {
            requestId,
            organizationId,
            stage,
            org_name: data.org_name || null,
            ...data
        });
    }
}

/**
 * Cancel/skip remaining assignments — now includes org names
 */
async function cancelRemainingAssignments(requestId, io) {
    const result = await db.query(`
        UPDATE org_request_assignments ora
        SET status = 'skipped' 
        FROM organizations o
        WHERE ora.organization_id = o.id
          AND ora.request_id = $1 
          AND ora.status IN ('pending', 'active')
        RETURNING ora.organization_id, o.name
    `, [requestId]);

    for (const row of result.rows) {
        emitOrgProgress(io, requestId, row.organization_id, 'SKIPPED', {
            org_name: row.name || 'Unknown Org',
            message: `${row.name || 'Organization'} skipped — request already fulfilled.`
        });
        await delay(500); // Small delay so frontend can render each skip
    }
}

module.exports = {
    runOrgAgentSequence
};
