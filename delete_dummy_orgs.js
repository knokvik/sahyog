require('dotenv').config();
const db = require('./config/db');

const DUMMY_IDS = [
  '00000000-0000-0000-0000-000000000001',
  '2daf3fd0-9684-4787-b183-9f6f1dfb3415',
  '7fbd1572-53a8-4ef6-8d18-93a4b6fad543',
  '989dfeb9-d7ae-45c1-ad07-1c933e0c53bc',
  '9ff52b94-7688-46f9-8bfa-f15e60104cea',
  'a0000001-0000-4000-8000-000000000001',
  'febe33fa-179c-46e1-a05b-0f7840b3b07c',
];

async function del(client, sql, params, label) {
  try {
    const r = await client.query(sql, params);
    if (r.rowCount > 0) console.log(`  ✓ Deleted ${r.rowCount} from ${label}`);
  } catch (err) {
    console.error(`  ✗ FAILED on ${label}: ${err.message}`);
    if (err.detail) console.error(`    Detail: ${err.detail}`);
    throw err; // re-throw to abort transaction
  }
}

async function collectIds(client, sql, params) {
  const r = await client.query(sql, params);
  return r.rows.map(r => r.id);
}

// Get ALL FK deps for a given table recursively
async function getAllFKDeps(client, tableName) {
  const r = await client.query(`
    SELECT tc.constraint_name, tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = $1
  `, [tableName]);
  return r.rows;
}

async function main() {
  try {
    // First, let's understand the full FK tree for shelters
    const shelterDeps = await getAllFKDeps(db, 'shelters');
    console.log('FK deps on shelters:', shelterDeps.map(r => `${r.table_name}.${r.column_name}`));
    
    const disasterReqDeps = await getAllFKDeps(db, 'disaster_requests');
    console.log('FK deps on disaster_requests:', disasterReqDeps.map(r => `${r.table_name}.${r.column_name}`));

    const issuesDeps = await getAllFKDeps(db, 'issues');
    console.log('FK deps on issues:', issuesDeps.map(r => `${r.table_name}.${r.column_name}`));

    const tasksDeps = await getAllFKDeps(db, 'tasks');
    console.log('FK deps on tasks:', tasksDeps.map(r => `${r.table_name}.${r.column_name}`));

    await db.transaction(async (client) => {
      // 1. Collect user IDs
      const userIds = await collectIds(client, 'SELECT id FROM users WHERE organization_id = ANY($1::uuid[])', [DUMMY_IDS]);
      console.log(`\nFound ${userIds.length} users in dummy orgs\n`);

      if (userIds.length > 0) {
        console.log('--- Phase 1: Clean user-dependent data ---');
        
        // SOS alerts
        await del(client, 'DELETE FROM sos_alerts WHERE reporter_id = ANY($1::uuid[]) OR acknowledged_by = ANY($1::uuid[]) OR assigned_volunteer_id = ANY($1::uuid[])', [userIds], 'sos_alerts (by user)');

        // Disasters activated by these users -> need to clean deep chain
        const disasterIds = await collectIds(client, 'SELECT id FROM disasters WHERE activated_by = ANY($1::uuid[])', [userIds]);
        if (disasterIds.length > 0) {
          console.log(`  Found ${disasterIds.length} disasters to clean`);
          // Zones under these disasters
          const zoneIds = await collectIds(client, 'SELECT id FROM zones WHERE disaster_id = ANY($1::uuid[])', [disasterIds]);
          if (zoneIds.length > 0) {
            console.log(`  Found ${zoneIds.length} zones under those disasters`);
            // Everything referencing these zones - sos_alerts.task_id before tasks
            const zTaskIds = await collectIds(client, 'SELECT id FROM tasks WHERE zone_id = ANY($1::uuid[])', [zoneIds]);
            if (zTaskIds.length > 0) {
              await del(client, 'DELETE FROM sos_alerts WHERE task_id = ANY($1::uuid[])', [zTaskIds], 'sos_alerts (zone tasks)');
            }
            await del(client, 'DELETE FROM tasks WHERE zone_id = ANY($1::uuid[])', [zoneIds], 'tasks (disaster zones)');
            await del(client, 'DELETE FROM needs WHERE zone_id = ANY($1::uuid[])', [zoneIds], 'needs (disaster zones)');
            await del(client, 'UPDATE resources SET current_zone_id = NULL WHERE current_zone_id = ANY($1::uuid[])', [zoneIds], 'resources (nullify zone)');
            await del(client, 'DELETE FROM disaster_coordinator_assignments WHERE zone_id = ANY($1::uuid[])', [zoneIds], 'coord_assignments (zones)');
            await del(client, 'DELETE FROM volunteer_disaster_assignments WHERE zone_id = ANY($1::uuid[])', [zoneIds], 'vol_assignments (zones)');
            await del(client, 'DELETE FROM zones WHERE id = ANY($1::uuid[])', [zoneIds], 'zones');
          }
          // Everything referencing these disasters directly - sos_alerts.task_id before tasks
          const dTaskIds = await collectIds(client, 'SELECT id FROM tasks WHERE disaster_id = ANY($1::uuid[])', [disasterIds]);
          if (dTaskIds.length > 0) {
            await del(client, 'DELETE FROM sos_alerts WHERE task_id = ANY($1::uuid[])', [dTaskIds], 'sos_alerts (disaster tasks)');
          }
          await del(client, 'DELETE FROM tasks WHERE disaster_id = ANY($1::uuid[])', [disasterIds], 'tasks (disasters)');
          await del(client, 'UPDATE resources SET current_disaster_id = NULL WHERE current_disaster_id = ANY($1::uuid[])', [disasterIds], 'resources (nullify disaster)');
          await del(client, 'DELETE FROM needs WHERE disaster_id = ANY($1::uuid[])', [disasterIds], 'needs (disasters)');
          await del(client, 'DELETE FROM sos_alerts WHERE disaster_id = ANY($1::uuid[])', [disasterIds], 'sos_alerts (disasters)');
          await del(client, 'DELETE FROM missing_persons WHERE disaster_id = ANY($1::uuid[])', [disasterIds], 'missing_persons');
          // disaster_requests may have org_request_assignments referencing them
          const drIds = await collectIds(client, 'SELECT id FROM disaster_requests WHERE disaster_id = ANY($1::uuid[])', [disasterIds]);
          if (drIds.length > 0) {
            await del(client, 'DELETE FROM disaster_request_items WHERE request_id = ANY($1::uuid[])', [drIds], 'disaster_request_items');
            await del(client, 'DELETE FROM org_request_assignments WHERE request_id = ANY($1::uuid[])', [drIds], 'org_request_assignments (disaster_requests)');
          }
          await del(client, 'DELETE FROM disaster_requests WHERE disaster_id = ANY($1::uuid[])', [disasterIds], 'disaster_requests (disasters)');
          await del(client, 'DELETE FROM disaster_coordinator_assignments WHERE disaster_id = ANY($1::uuid[])', [disasterIds], 'coord_assignments (disasters)');
          await del(client, 'DELETE FROM volunteer_disaster_assignments WHERE disaster_id = ANY($1::uuid[])', [disasterIds], 'vol_assignments (disasters)');
          await del(client, 'DELETE FROM disasters WHERE id = ANY($1::uuid[])', [disasterIds], 'disasters');
        }
        
        // Zones assigned to these users (not already cleaned)
        const userZoneIds = await collectIds(client, 'SELECT id FROM zones WHERE assigned_coordinator_id = ANY($1::uuid[])', [userIds]);
        if (userZoneIds.length > 0) {
          const uzTaskIds = await collectIds(client, 'SELECT id FROM tasks WHERE zone_id = ANY($1::uuid[])', [userZoneIds]);
          if (uzTaskIds.length > 0) {
            await del(client, 'DELETE FROM sos_alerts WHERE task_id = ANY($1::uuid[])', [uzTaskIds], 'sos_alerts (user zone tasks)');
          }
          await del(client, 'DELETE FROM tasks WHERE zone_id = ANY($1::uuid[])', [userZoneIds], 'tasks (user zones)');
          await del(client, 'DELETE FROM needs WHERE zone_id = ANY($1::uuid[])', [userZoneIds], 'needs (user zones)');
          await del(client, 'UPDATE resources SET current_zone_id = NULL WHERE current_zone_id = ANY($1::uuid[])', [userZoneIds], 'resources (nullify user zone)');
          await del(client, 'DELETE FROM disaster_coordinator_assignments WHERE zone_id = ANY($1::uuid[])', [userZoneIds], 'coord_assignments (user zones)');
          await del(client, 'DELETE FROM volunteer_disaster_assignments WHERE zone_id = ANY($1::uuid[])', [userZoneIds], 'vol_assignments (user zones)');
          await del(client, 'DELETE FROM zones WHERE id = ANY($1::uuid[])', [userZoneIds], 'zones (user)');
        }
        
        // Remaining direct references from users
        // Shelters - use SAVEPOINTs for tables that may not exist
        const shelterIds = await collectIds(client, 'SELECT id FROM shelters WHERE manager_id = ANY($1::uuid[])', [userIds]);
        if (shelterIds.length > 0) {
          // Try shelter_occupants with savepoint
          await client.query('SAVEPOINT sp_shelter_occupants');
          try {
            await del(client, 'DELETE FROM shelter_occupants WHERE shelter_id = ANY($1::uuid[])', [shelterIds], 'shelter_occupants');
            await client.query('RELEASE SAVEPOINT sp_shelter_occupants');
          } catch(_) {
            await client.query('ROLLBACK TO SAVEPOINT sp_shelter_occupants');
          }
          // Try shelter_resources with savepoint
          await client.query('SAVEPOINT sp_shelter_resources');
          try {
            await del(client, 'DELETE FROM shelter_resources WHERE shelter_id = ANY($1::uuid[])', [shelterIds], 'shelter_resources');
            await client.query('RELEASE SAVEPOINT sp_shelter_resources');
          } catch(_) {
            await client.query('ROLLBACK TO SAVEPOINT sp_shelter_resources');
          }
          await del(client, 'DELETE FROM shelters WHERE id = ANY($1::uuid[])', [shelterIds], 'shelters');
        }
        
        // Clean sos_alerts referencing tasks by these users before deleting those tasks
        const uTaskIds = await collectIds(client, 'SELECT id FROM tasks WHERE volunteer_id = ANY($1::uuid[]) OR assigned_by = ANY($1::uuid[])', [userIds]);
        if (uTaskIds.length > 0) {
          await del(client, 'DELETE FROM sos_alerts WHERE task_id = ANY($1::uuid[])', [uTaskIds], 'sos_alerts (user tasks)');
        }
        await del(client, 'DELETE FROM tasks WHERE volunteer_id = ANY($1::uuid[]) OR assigned_by = ANY($1::uuid[])', [userIds], 'tasks (by user)');
        await del(client, 'DELETE FROM needs WHERE assigned_volunteer_id = ANY($1::uuid[])', [userIds], 'needs (by user)');
        await del(client, 'DELETE FROM pending_actions WHERE user_id = ANY($1::uuid[])', [userIds], 'pending_actions');
        
        // disaster_requests by user - clean org_request_assignments first
        const userDrIds = await collectIds(client, 'SELECT id FROM disaster_requests WHERE created_by = ANY($1::uuid[])', [userIds]);
        if (userDrIds.length > 0) {
          await del(client, 'DELETE FROM disaster_request_items WHERE request_id = ANY($1::uuid[])', [userDrIds], 'disaster_request_items (user DR)');
          await del(client, 'DELETE FROM org_request_assignments WHERE request_id = ANY($1::uuid[])', [userDrIds], 'org_request_assignments (user DR)');
        }
        await del(client, 'DELETE FROM disaster_requests WHERE created_by = ANY($1::uuid[])', [userIds], 'disaster_requests (by user)');
        
        await del(client, 'DELETE FROM disaster_coordinator_assignments WHERE coordinator_id = ANY($1::uuid[])', [userIds], 'coord_assignments (by user)');
        await del(client, 'DELETE FROM volunteer_disaster_assignments WHERE coordinator_id = ANY($1::uuid[]) OR volunteer_id = ANY($1::uuid[])', [userIds], 'vol_assignments (by user)');
        await del(client, 'DELETE FROM missing_person_updates WHERE updated_by = ANY($1::uuid[])', [userIds], 'missing_person_updates');
        await del(client, 'DELETE FROM issues WHERE reporter_id = ANY($1::uuid[]) OR assigned_official_id = ANY($1::uuid[])', [userIds], 'issues (by user)');
        await del(client, 'DELETE FROM civic_issues WHERE reporter_id = ANY($1::uuid[]) OR assigned_coordinator_id = ANY($1::uuid[])', [userIds], 'civic_issues');
        await client.query('SAVEPOINT sp_vol_locations');
        try {
          await del(client, 'DELETE FROM volunteer_locations WHERE user_id = ANY($1::uuid[])', [userIds], 'volunteer_locations');
          await client.query('RELEASE SAVEPOINT sp_vol_locations');
        } catch(_) {
          await client.query('ROLLBACK TO SAVEPOINT sp_vol_locations');
        }
      }

      console.log('\n--- Phase 2: Clean org-dependent data ---');
      await del(client, 'DELETE FROM resources WHERE owner_org_id = ANY($1::uuid[])', [DUMMY_IDS], 'resources (by org)');
      await del(client, 'DELETE FROM org_request_assignments WHERE organization_id = ANY($1::uuid[])', [DUMMY_IDS], 'org_request_assignments (by org)');
      await del(client, 'DELETE FROM disaster_coordinator_assignments WHERE organization_id = ANY($1::uuid[])', [DUMMY_IDS], 'coord_assignments (by org)');
      await del(client, 'DELETE FROM issues WHERE department_id = ANY($1::uuid[])', [DUMMY_IDS], 'issues (by org)');

      console.log('\n--- Phase 3: Delete users ---');
      await del(client, 'DELETE FROM users WHERE organization_id = ANY($1::uuid[])', [DUMMY_IDS], 'users');

      console.log('\n--- Phase 4: Delete organizations ---');
      const orgResult = await client.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [DUMMY_IDS]);
      console.log(`  ✓ Deleted ${orgResult.rowCount} dummy organizations`);
    });

    // Verify
    const remaining = await db.query('SELECT id, name, email FROM organizations ORDER BY name');
    console.log('\n=== Remaining Organizations ===');
    remaining.rows.forEach((r, i) => {
      console.log(`${i + 1}. ${r.name} (${r.email})`);
    });

  } catch (err) {
    console.error('\nFATAL Error:', err.message);
    if (err.detail) console.error('Detail:', err.detail);
  } finally {
    process.exit(0);
  }
}

main();
