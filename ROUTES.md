# Sahyog – All addresses and routes

Base URLs (local dev):
- **Backend API:** `http://localhost:3000`
- **Admin panel:** `http://localhost:5174`

---

## Backend API (port 3000)

### No auth required

| Method | URL | Description |
|--------|-----|-------------|
| GET | `http://localhost:3000/` | Welcome message |
| GET | `http://localhost:3000/api/health` | Health check (backend reachable) |

### Auth (Clerk) – `Authorization: Bearer <token>` required unless noted

#### Auth
| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/auth/me` | Current user from Clerk (protected) |

#### Users
| Method | URL | Description | Min role |
|--------|-----|-------------|----------|
| GET | `/api/users/me` | Current user profile (id, email, role) | any |
| PUT | `/api/users/:uid/role` | Update user role | org:admin |
| GET | `/api/users/authority-only` | Example: member-only message | org:member |
| GET | `/api/users/volunteer-only` | Example: volunteer-only message | org:volunteer |

#### SOS reports (`/api/v1/sos`)
| Method | URL | Description | Min role |
|--------|-----|-------------|----------|
| POST | `/api/v1/sos` | Create SOS report | any |
| GET | `/api/v1/sos` | List reports (filtered by role) | any |
| GET | `/api/v1/sos/nearby?lat=&lng=&radiusMeters=` | Nearby SOS | any |
| GET | `/api/v1/sos/:id` | Get one report | any |
| PATCH | `/api/v1/sos/:id/status` | Update status | reporter/volunteer/admin |

#### Disasters (`/api/v1/disasters`)
| Method | URL | Description | Min role |
|--------|-----|-------------|----------|
| POST | `/api/v1/disasters` | Create disaster | org:admin |
| PATCH | `/api/v1/disasters/:id` | Update disaster | org:admin |
| POST | `/api/v1/disasters/:id/activate` | Activate | org:admin |
| POST | `/api/v1/disasters/:id/resolve` | Resolve | org:admin |
| GET | `/api/v1/disasters` | List disasters | any |
| GET | `/api/v1/disasters/:id` | Get one | any |
| GET | `/api/v1/disasters/:id/stats` | Stats | org:admin |

#### Volunteers (`/api/v1/volunteers`)
| Method | URL | Description | Min role |
|--------|-----|-------------|----------|
| POST | `/api/v1/volunteers/register` | Register as volunteer | any |
| GET | `/api/v1/volunteers` | List volunteers | org:admin |
| GET | `/api/v1/volunteers/:id` | Get one | org:admin |
| PATCH | `/api/v1/volunteers/:id/verify` | Verify volunteer | org:admin |
| PATCH | `/api/v1/volunteers/availability` | Toggle availability | org:volunteer |
| POST | `/api/v1/volunteers/location` | Update location | org:volunteer |
| GET | `/api/v1/volunteers/tasks` | My tasks | org:volunteer |

#### Tasks (`/api/v1/tasks`)
| Method | URL | Description | Min role |
|--------|-----|-------------|----------|
| POST | `/api/v1/tasks` | Create task | org:volunteer_head |
| GET | `/api/v1/tasks/pending` | List pending tasks | any |
| GET | `/api/v1/tasks/:id` | Get one | any |
| PATCH | `/api/v1/tasks/:id/accept` | Accept task | org:volunteer |
| PATCH | `/api/v1/tasks/:id/start` | Start task | org:volunteer |
| PATCH | `/api/v1/tasks/:id/complete` | Complete task | org:volunteer |

#### Shelters (`/api/v1/shelters`)
| Method | URL | Description | Min role |
|--------|-----|-------------|----------|
| POST | `/api/v1/shelters` | Create shelter | org:admin |
| PATCH | `/api/v1/shelters/:id` | Update shelter | org:admin |
| GET | `/api/v1/shelters` | List shelters | any |
| GET | `/api/v1/shelters/:id` | Get one | any |
| POST | `/api/v1/shelters/:id/checkin` | Check in to shelter | org:volunteer |

#### Missing persons (`/api/v1/missing`)
| Method | URL | Description | Min role |
|--------|-----|-------------|----------|
| POST | `/api/v1/missing` | Report missing person | any |
| GET | `/api/v1/missing` | Search/filter reports | any |
| PATCH | `/api/v1/missing/:id/found` | Mark as found | org:volunteer |

---

## Admin panel (port 5174)

All under `http://localhost:5174`; protected routes require Clerk sign-in.

| Path | Description |
|------|-------------|
| `/sign-in` | Clerk sign-in page |
| `/sign-up` | Clerk sign-up page |
| `/` | Dashboard (profile + quick links) |
| `/sos` | SOS reports list + status update |
| `/disasters` | Disasters list |
| `/volunteers` | Volunteers list |
| `/shelters` | Shelters list |
| `/missing` | Missing persons list |

Any other path redirects to `/`.
