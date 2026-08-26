require('dotenv').config();
const db = require('./config/db');

async function seedAll() {
  console.log('--- Starting Comprehensive Demo Data Seed ---');

  try {
    // 1. Shelters table check
    console.log('1. Checking shelters table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS shelters (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar NOT NULL,
        location geometry(Point, 4326),
        capacity integer DEFAULT 100,
        current_occupancy integer DEFAULT 0,
        facilities text[],
        manager_id uuid,
        status varchar DEFAULT 'active',
        created_at timestamp DEFAULT now()
      );
    `);

    // 2. Organizations
    console.log('2. Seeding Organizations...');
    const orgRes = await db.query(`
      INSERT INTO organizations (name, registration_number, primary_phone, email, state, district)
      VALUES 
        ('National Disaster Response Force (NDRF)', 'NDRF-IND-01', '+919820011223', 'ops@ndrf.gov.in', 'Maharashtra', 'Mumbai'),
        ('Red Cross Emergency Unit', 'RC-IND-882', '+919820044556', 'emergency@redcross.org.in', 'Maharashtra', 'Mumbai Suburb'),
        ('Sahyog Relief Volunteers Network', 'SRVN-MH-2024', '+919820077889', 'network@sahyog.org', 'Maharashtra', 'Pune')
      ON CONFLICT (registration_number) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name;
    `);
    const orgId = orgRes.rows[0]?.id;

    // 3. Users (volunteers, coordinators, citizens, admins)
    console.log('3. Seeding Users...');
    const usersData = [
      ['clerk_admin_demo', 'admin@sahyog.test', '+919820000001', 'Dr. Rajesh Sharma', 'admin', 19.0760, 72.8777],
      ['clerk_coord_demo_1', 'coord.anita@sahyog.test', '+919820000002', 'Anita Deshmukh', 'coordinator', 19.0790, 72.8820],
      ['clerk_coord_demo_2', 'coord.vikram@sahyog.test', '+919820000003', 'Vikram Patil', 'coordinator', 19.0680, 72.8650],
      ['clerk_vol_demo_1', 'vol.rahul@sahyog.test', '+919820000004', 'Rahul Verma', 'volunteer', 19.0740, 72.8720],
      ['clerk_vol_demo_2', 'vol.sneha@sahyog.test', '+919820000005', 'Sneha Kulkarni', 'volunteer', 19.0830, 72.8890],
      ['clerk_vol_demo_3', 'vol.amit@sahyog.test', '+919820000006', 'Amit Sawant', 'volunteer', 19.0650, 72.8590],
      ['clerk_vol_demo_4', 'vol.priya@sahyog.test', '+919820000007', 'Priya Nair', 'volunteer', 19.0910, 72.8950],
      ['clerk_user_demo_1', 'citizen.sunil@sahyog.test', '+919820000008', 'Sunil Gaikwad', 'user', 19.0750, 72.8760],
      ['clerk_user_demo_2', 'citizen.meera@sahyog.test', '+919820000009', 'Meera Joshi', 'user', 19.0810, 72.8840]
    ];

    for (const [clerkId, email, phone, name, role, lat, lng] of usersData) {
      await db.query(`
        INSERT INTO users (id, clerk_user_id, email, phone, full_name, role, organization_id, is_active, is_verified, current_location, last_active)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, true, true, ST_SetSRID(ST_MakePoint($7, $8), 4326), NOW())
        ON CONFLICT (clerk_user_id) DO UPDATE 
        SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, is_active = true, is_verified = true, current_location = EXCLUDED.current_location, last_active = NOW();
      `, [clerkId, email, phone, name, role, orgId, lng, lat]);
    }

    // Get seeded user IDs
    const usersRes = await db.query('SELECT id, clerk_user_id, role, full_name FROM users');
    const adminUser = usersRes.rows.find(u => u.role === 'admin') || usersRes.rows[0];
    const coordUser = usersRes.rows.find(u => u.role === 'coordinator') || usersRes.rows[0];
    const citizenUser = usersRes.rows.find(u => u.role === 'user') || usersRes.rows[0];
    const volUsers = usersRes.rows.filter(u => u.role === 'volunteer');

    // 4. Disasters
    console.log('4. Seeding Disasters...');
    const disRes = await db.query(`
      INSERT INTO disasters (id, name, type, status, severity, activated_by, activated_at)
      VALUES 
        (gen_random_uuid(), 'Mumbai Central Urban Flash Floods', 'flood', 'active', 8, $1, NOW() - INTERVAL '6 hours'),
        (gen_random_uuid(), 'Coastal High Tide & Cyclone Alert', 'cyclone', 'active', 6, $1, NOW() - INTERVAL '1 day'),
        (gen_random_uuid(), 'Pune Mula-Mutha River Overflow', 'flood', 'monitoring', 4, $1, NOW() - INTERVAL '2 days')
      RETURNING id, name;
    `, [adminUser.id]);
    const activeDisasterId = disRes.rows[0]?.id;
    const cycloneDisasterId = disRes.rows[1]?.id;

    // 5. Zones
    console.log('5. Seeding Relief Zones...');
    const zoneQueries = [
      ['Zone 1: Kurla Lowlands Evacuation Sector', 'Z-KURLA-01', activeDisasterId, coordUser.id, 72.8777, 19.0760],
      ['Zone 2: Dadar Medical & Logistics Base', 'Z-DADAR-02', activeDisasterId, coordUser.id, 72.8420, 19.0180],
      ['Zone 3: Andheri East Transit & Shelter Hub', 'Z-ANDH-03', activeDisasterId, coordUser.id, 72.8690, 19.1136],
      ['Zone 4: Bandra Coastal Alert Line', 'Z-BNDR-04', cycloneDisasterId, coordUser.id, 72.8258, 19.0596],
    ];

    for (const [name, code, disId, coordId, lng, lat] of zoneQueries) {
      await db.query(`
        INSERT INTO zones (id, disaster_id, name, code, assigned_coordinator_id, status, boundary)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, 'active', ST_Buffer(ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography, 1200)::geometry)
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, disaster_id = EXCLUDED.disaster_id, status = 'active';
      `, [disId, name, code, coordId, lng, lat]);
    }

    const zonesRes = await db.query('SELECT id, name, code FROM zones');
    const zKurla = zonesRes.rows.find(z => z.code === 'Z-KURLA-01') || zonesRes.rows[0];
    const zDadar = zonesRes.rows.find(z => z.code === 'Z-DADAR-02') || zonesRes.rows[0];

    // 6. Needs
    console.log('6. Seeding Needs...');
    const needsData = [
      ['REQ-901', 'Sunil Gaikwad', '+919820000008', 72.8780, 19.0765, 'rescue', 4, 'Family stranded on first floor due to rising water level', 'high', activeDisasterId, zKurla.id, 'unassigned'],
      ['REQ-902', 'Kavita Roy', '+919820000010', 72.8795, 19.0780, 'medical', 2, 'Elderly cardiac patient requires immediate oxygen supply and transport', 'critical', activeDisasterId, zKurla.id, 'assigned'],
      ['REQ-903', 'Meera Joshi', '+919820000009', 72.8760, 19.0740, 'food_water', 15, 'Community center stranded without drinking water for 12 hours', 'medium', activeDisasterId, zKurla.id, 'assigned'],
      ['REQ-904', 'Deepak Patil', '+919820000011', 72.8430, 19.0190, 'shelter', 8, 'Roof collapsed in heavy rain, need temporary safe shelter transfer', 'high', activeDisasterId, zDadar.id, 'unassigned'],
      ['REQ-905', 'Rohan Mane', '+919820000012', 72.8680, 19.1120, 'medical', 1, 'Child injured by fallen tree branch, first aid required', 'high', activeDisasterId, zKurla.id, 'resolved']
    ];

    for (const [code, rName, phone, lng, lat, type, pCount, desc, urgency, disId, zId, status] of needsData) {
      await db.query(`
        INSERT INTO needs (id, request_code, reporter_name, reporter_phone, location, type, persons_count, description, urgency, disaster_id, zone_id, status, reported_at)
        VALUES (gen_random_uuid(), $1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, $8, $9, $10, $11, $12, NOW() - INTERVAL '30 minutes')
        ON CONFLICT (request_code) DO UPDATE SET status = EXCLUDED.status, description = EXCLUDED.description;
      `, [code, rName, phone, lng, lat, type, pCount, desc, urgency, disId, zId, status]);
    }

    // 7. SOS Alerts
    console.log('7. Seeding SOS Alerts...');
    const sosData = [
      [citizenUser.id, volUsers[0]?.id, activeDisasterId, 72.8785, 19.0772, 'triggered', 'medical', 'Severe chest pain during evacuation', 9.2, 'critical', true, 0.94],
      [citizenUser.id, volUsers[1]?.id, activeDisasterId, 72.8800, 19.0750, 'acknowledged', 'rescue', 'Water entered ground floor, trapped inside', 8.5, 'high', false, 0.88],
      [citizenUser.id, volUsers[2]?.id, activeDisasterId, 72.8440, 19.0210, 'resolved', 'supplies', 'Emergency dry ration required', 5.0, 'medium', false, 0.65],
      [citizenUser.id, volUsers[3]?.id, activeDisasterId, 72.8710, 19.0730, 'triggered', 'rescue', 'Building basement flooded with power outage', 9.0, 'critical', true, 0.91]
    ];

    for (const [rId, vId, disId, lng, lat, status, type, desc, score, escLvl, mesh, tfScore] of sosData) {
      await db.query(`
        INSERT INTO sos_alerts (id, reporter_id, assigned_volunteer_id, disaster_id, location, status, type, description, priority_score, escalation_level, relayed_via_mesh, tflite_score, ai_assessment, created_at)
        VALUES (gen_random_uuid(), $1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, $8, $9, $10, $11, $12, 
          $13,
          NOW() - INTERVAL '15 minutes')
      `, [rId, vId, disId, lng, lat, status, type, desc, score, escLvl, mesh, tfScore, JSON.stringify({ risk_level: escLvl, confidence: tfScore, injury_assessment_en: desc })]);
    }

    // 8. Tasks & Escalations
    console.log('8. Seeding Tasks & Escalations...');
    const tasksData = [
      [activeDisasterId, zKurla.id, volUsers[0]?.id, adminUser.id, 'rescue', 'Evacuate 4 Residents from Block C Kurla', 'Rapid inflatable boat deployment required', 'in_progress', "NOW() - INTERVAL '90 minutes'"],
      [activeDisasterId, zKurla.id, volUsers[1]?.id, adminUser.id, 'medical', 'Deliver Emergency Oxygen & First Aid to Sector 2', 'Critical delivery for elderly cardiac patient', 'pending', "NOW() - INTERVAL '120 minutes'"],
      [activeDisasterId, zDadar.id, volUsers[2]?.id, adminUser.id, 'supplies', 'Distribute 50 Ration & Water Kits at Dadar Center', 'Distribution underway at ground shelter', 'completed', "NOW() - INTERVAL '3 hours'"],
      [activeDisasterId, zKurla.id, volUsers[3]?.id, adminUser.id, 'shelter_transfer', 'Transport 8 Evacuees to Central Relief Camp', 'Transfer via designated rescue mini-bus', 'pending', "NOW() - INTERVAL '75 minutes'"]
    ];

    for (const [disId, zId, vId, aById, type, title, desc, status, createdAtSql] of tasksData) {
      await db.query(`
        INSERT INTO tasks (id, disaster_id, zone_id, volunteer_id, assigned_by, type, title, description, status, created_at)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, ${createdAtSql})
      `, [disId, zId, vId, aById, type, title, desc, status]);
    }

    // 9. Shelters
    console.log('9. Seeding Shelters...');
    const sheltersData = [
      ['Central Municipal Relief Camp 1', 72.8730, 19.0720, 300, 142, ['Medical Care', 'Hot Meals', 'Clean Water', 'Beds'], adminUser.id, 'active'],
      ['Dadar St. Paul Community Shelter', 72.8450, 19.0200, 200, 85, ['Clean Water', 'Beds', 'First Aid'], adminUser.id, 'active'],
      ['Andheri Sports Complex Mega Shelter', 72.8650, 19.1150, 500, 210, ['Medical Unit', 'Power Generator', 'Dry Ration', 'Beds'], adminUser.id, 'active'],
      ['Bandra Coast Guard Evacuation Base', 72.8280, 19.0610, 150, 40, ['Helipad Access', 'Medical Care', 'Inflatable Boats'], adminUser.id, 'active']
    ];

    for (const [name, lng, lat, cap, occ, fac, mgrId, status] of sheltersData) {
      await db.query(`
        INSERT INTO shelters (id, name, location, capacity, current_occupancy, facilities, manager_id, status)
        VALUES (gen_random_uuid(), $1, ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, $5, $6, $7, $8)
      `, [name, lng, lat, cap, occ, fac, mgrId, status]);
    }

    // 10. Missing Persons
    console.log('10. Seeding Missing Persons...');
    const missingData = [
      ['+919820000008', 'Ramesh Kulkarni', 68, 72.8770, 19.0755, 'missing', activeDisasterId],
      ['+919820000009', 'Aarav Deshpande', 9, 72.8790, 19.0785, 'missing', activeDisasterId],
      ['+919820000010', 'Sunita Rao', 42, 72.8410, 19.0170, 'found', activeDisasterId],
      ['+919820000011', 'Vikram Shinde', 35, 72.8670, 19.1110, 'found', activeDisasterId]
    ];

    for (const [phone, name, age, lng, lat, status, disId] of missingData) {
      await db.query(`
        INSERT INTO missing_persons (id, reporter_phone, name, age, last_seen_location, status, disaster_id, created_at)
        VALUES (gen_random_uuid(), $1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, NOW() - INTERVAL '1 day')
      `, [phone, name, age, lng, lat, status, disId]);
    }

    console.log('=== Demo Data Successfully Seeded Across All Tables! ===');
    process.exit(0);
  } catch (err) {
    console.error('Error seeding demo data:', err);
    process.exit(1);
  }
}

seedAll();
