<p align="center">
  <img src="assets/sahyog-logo.png" alt="Sahyog" width="96" />
</p>

<p align="center"><strong>Sahyog Server</strong></p>

This is the server behind JanRakshak. Phones, the coordinator desk, beacons, and a phone keypad all send reports here. The server stores them, scores them, and tells the live desk what changed.

It is decision support. A coordinator still chooses what happens next. The server does not call the police, a hospital, or NDMA on its own.

**What it keeps**

- People, roles, and organizations, signed in with Clerk
- SOS alerts, needs, missing people, tasks, and shelters
- Disasters and relief zones on a map
- Live locations in Redis, so nearby volunteers can be found
- A written reason for urgency, in English and Hindi, when Gemini is available
- Photos uploaded for reports and task proof

**How to run it**

- Node.js and a Postgres database with PostGIS
- Redis for live locations
- Copy the environment values you need: database URL, Redis, Clerk, and optionally Gemini, Twilio, and Supabase
- Start with `npm start` on port 3000

**Who can call what**

Most routes ask for a Clerk token. A few intake routes are open so a phone with no session, a mesh hop, or a keypad call can still file an alert. Treat those as trusted only on a private network.

**Sign-in and people**

- `GET /api/auth/me` and `POST /api/auth/sync` — who is signed in, and make sure they exist in the database
- `GET /api/users/me`, `PUT /api/users/me` — read or update your own profile
- `PUT /api/users/me/location` and `PATCH /api/users/me/availability` — where you are, and whether you can take work
- `POST /api/users/onboard` — finish a new profile
- `GET /api/users` and `PUT /api/users/:uid/role` — admins listing people and changing a role
- `GET /api/users/volunteers/live` — coordinators seeing volunteers who are on duty

**SOS**

The same SOS routes exist under `/api/sos` and `/api/v1/sos`.

- `POST /` — file an SOS
- `GET /` — list alerts
- `GET /nearby` — alerts near a point
- `GET /:id` — one alert
- `GET /:id/tasks` — tasks tied to that alert
- `PATCH /:id/status` — move it forward
- `PUT /:id/cancel` — the reporter cancels
- `DELETE /:id` — remove an alert

**Getting a report in when the app is not the only channel**

- `POST /api/mesh/sync` and `POST /api/v1/mesh/sync` — a batch of SOS packets relayed over Bluetooth
- `POST /api/beacon/relay` and `POST /api/v1/beacon/relay` — a gateway posting a beacon ping
- `POST /api/v1/twilio/ivr` — a keypad call: 1 medical, 2 rescue, 3 security

**Orchestrator**

- `POST /api/v1/orchestrator/validate` — score an alert, write the English and Hindi note, and look for nearby volunteers
- `GET /api/v1/orchestrator/status/:id` — where that alert is in the flow
- `GET /api/v1/orchestrator/summary` — the numbers on the coordinator desk

**Needs, tasks, and assignments**

- `POST /api/v1/needs` — someone reports a need. This one can be filed without a full desk login
- `GET /api/v1/needs` and `GET /api/v1/needs/active` — the list, and the ones still open
- `PATCH /api/v1/needs/:id/assign` — a coordinator names a volunteer
- `PATCH /api/v1/needs/:id/resolve` — the need is done
- `POST /api/v1/tasks` — create a task
- `GET /api/v1/tasks/pending`, `/escalated`, and `/history` — queues a coordinator watches
- `PATCH /api/v1/tasks/:id/status` — accept, start, or complete, including proof photos
- `POST /api/v1/tasks/:id/request-help` — a volunteer asks for backup
- `POST /api/v1/tasks/:id/vote-completion` and `GET /api/v1/tasks/:id/votes` — confirm that the work is really finished
- `GET /api/v1/volunteer-assignments/mine` — tasks waiting on the signed-in volunteer
- `POST /api/v1/volunteer-assignments/:id/respond` — accept or decline

**Disasters, zones, and relief**

- `POST /api/v1/disasters` — an admin opens a disaster
- `GET /api/v1/disasters` and `GET /api/v1/disasters/:id` — the list and one record
- `PATCH /api/v1/disasters/:id` — edit it
- `POST /api/v1/disasters/:id/activate` and `POST /api/v1/disasters/:id/resolve` — start or close it
- `GET /api/v1/disasters/:id/report`, `/stats`, and `/tasks` — the write-up, the counts, and the work under it
- `POST /api/v1/disasters/:id/relief-zones` — draw a help zone. A second zone on the same ground is refused
- `GET /api/v1/disasters/:id/relief-zones` and `DELETE /api/v1/disasters/:id/relief-zones/:zoneId` — see or remove zones
- `POST /api/v1/disasters/:id/requests` and `GET /api/v1/disasters/:id/requests` — ask NGOs for kits, and read those asks
- `GET /api/v1/zones`, `/summary`, and `/geojson` — zones for the map
- `POST /api/v1/zones` — an admin creates one
- `PATCH /api/v1/zones/:id` — a coordinator updates it
- `PATCH /api/v1/zones/:id/coordinator` — an admin names who owns it

**Missing people, shelters, and supplies**

- `POST /api/v1/missing` — report someone missing, with photo links
- `GET /api/v1/missing` — the board
- `PATCH /api/v1/missing/:id/found` — mark them found, and keep a closure photo if one was sent
- `GET /api/v1/shelters` and `GET /api/v1/shelters/:id` — shelter list and one shelter
- `POST /api/v1/shelters` and `PATCH /api/v1/shelters/:id` — an org admin adds or edits a shelter
- `POST /api/v1/shelters/:id/checkin` — a volunteer checks someone in
- `GET /api/v1/resources` and `POST /api/v1/resources` — supplies on the map. Creating one is for an admin

**Organizations**

- `POST /api/v1/organizations/register` and `POST /api/v1/organizations/join` — create or join an NGO
- `GET /api/v1/organizations/nearby` — organizations near a point
- `GET /api/v1/organizations/list` — admins see every organization
- `GET /api/v1/organizations/me` and `PUT /api/v1/organizations/me` — the signed-in NGO profile
- `PUT /api/v1/organizations/me/ai-preference` — how fully the NGO wants the kit agent to commit stock
- `GET /api/v1/organizations/me/stats` — the dashboard counts
- `GET` and `POST /api/v1/organizations/me/volunteers`, and `DELETE .../volunteers/:userId` — people linked to the NGO
- `GET` and `POST /api/v1/organizations/me/resources` — what the NGO can offer
- `GET /api/v1/organizations/me/tasks` and `GET /api/v1/organizations/me/zones` — their work and their ground
- `GET /api/v1/organizations/me/requests` — relief asks waiting on them
- `POST .../requests/:assignmentId/accept`, `/reject`, and `/assign-coordinator` — answer an ask and name who will carry it

**Coordinator desk helpers**

All under `/api/v1/coordinator`, for a coordinator:

- `GET /context`, `/metrics` — the picture they are working in
- `GET /volunteers`, `/tasks`, `/needs`, `/sos`, `/missing`, `/zones`
- `GET /my-zones` and `/my-zone-volunteers` — only their patch
- `POST /tasks` and `DELETE /tasks/:id` — add or drop a task. A photo URL can be stored with the task
- `PATCH /tasks/:id/reassign` — hand it to someone else
- `PATCH /missing/:id/found` — close a missing-person report

**Map locations**

- `POST /api/v1/locations/update` — a phone reports where it is
- `GET /api/v1/locations/all`, `/all/full`, and `/nearby` — the desk and the heatmap

**Volunteers**

- `POST /api/v1/volunteers/register` — join as a volunteer
- `GET /api/v1/volunteers`, `/available`, `/locations`, and `/:id`
- `PATCH /api/v1/volunteers/availability` and `POST /api/v1/volunteers/location` — on duty, and where
- `GET /api/v1/volunteers/tasks` — work assigned to you
- `PATCH /api/v1/volunteers/:id/verify` — an admin confirms them

**Admin, search, logs, and files**

- `POST /api/v1/admin/workflows/reassign-tasks` — move work off a coordinator who is no longer active
- `PATCH /api/v1/admin/workflows/volunteers/:id/deactivate`
- `PATCH /api/v1/admin/workflows/zones/:id/freeze`
- `GET /api/v1/search` — one search across the records
- `GET /api/v1/logs/admin` and `GET /api/v1/logs/org` — the audit trail
- `POST /api/v1/uploads/task-proof` — upload up to five images and get public links back
- `GET /api/v1/notifications`, `POST /api/v1/notifications`, and `PATCH /api/v1/notifications/:id/read`
- `GET /api/v1/regions`, `POST /api/v1/regions`, `GET /api/v1/regions/dashboard`, and `GET /api/v1/regions/volunteers`
- `GET /api/v1/server/stats` — a simple health count for admins
- `GET /api/health` — is the process up

**Live updates**

The desk also listens on Socket.io. New SOS alerts, location updates, and orchestrator notes are pushed as they are written, so the map does not wait for the next refresh.
