# Postman / curl examples – check if backend works

**Backend must be running:** `npm start` (port 3000).

Use these **exact URLs** in Postman or in the browser (for GETs).

---

## 1. No auth – use these first

### GET Root (welcome)
- **URL:** `http://localhost:3000/`
- **Method:** GET  
- **Headers:** none  
- **Expected:** `{ "message": "Welcome to Sahyog Backend API (Clerk + Postgres)" }`

In browser: open **http://localhost:3000/**  
In Postman: New Request → GET → paste URL → Send.

---

### GET Health
- **URL:** `http://localhost:3000/api/health`
- **Method:** GET  
- **Headers:** none  
- **Expected:** `{ "ok": true, "message": "Backend reachable" }`

In browser: open **http://localhost:3000/api/health**  
In Postman: GET → `http://localhost:3000/api/health` → Send.

---

**If these fail:** backend is not reachable (not running, wrong port, or firewall). Start with `npm start` in the project root and try again.

---

## 2. With curl (terminal)

```bash
# Root
curl -s http://localhost:3000/

# Health
curl -s http://localhost:3000/api/health
```

---

## 3. Auth required – need Clerk token

### GET /api/users/me
- **URL:** `http://localhost:3000/api/users/me`
- **Method:** GET  
- **Headers:**  
  - `Authorization`: `Bearer YOUR_CLERK_TOKEN`

**How to get a token:** sign in to the admin panel (http://localhost:5174), open DevTools → Console, run:

```javascript
// After signing in, in browser console on admin panel:
const { getToken } = await import('https://esm.sh/@clerk/clerk-react');
// Or get token from Application → Cookies / session and use Clerk's getToken in app context.
```

Easier: use the admin panel; it sends the token automatically. For Postman, you can copy the token from the Network tab (request to `/api/users/me` → Headers → Authorization).

---

## 4. Sample POST body (create SOS)

- **URL:** `http://localhost:3000/api/v1/sos`
- **Method:** POST  
- **Headers:**  
  - `Authorization`: `Bearer YOUR_CLERK_TOKEN`  
  - `Content-Type`: `application/json`  
- **Body (raw JSON):**

```json
{
  "lat": 19.0760,
  "lng": 72.8777,
  "type": "medical",
  "description": "Need help"
}
```

---

## 5. Import collection in Postman

1. Open Postman.
2. Import → Upload Files → choose  
   `postman/Sahyog_Backend_Examples.postman_collection.json`
3. Set collection variable `baseUrl` = `http://localhost:3000`.
4. Run **GET Root** and **GET Health** (no token).
5. For **GET /api/users/me**, set variable `token` to your Clerk session token (see above).

---

## Quick checklist

| Request              | URL                        | Auth? | If it works, backend is…   |
|----------------------|----------------------------|-------|----------------------------|
| GET /                | http://localhost:3000/     | No    | Running and responding     |
| GET /api/health      | http://localhost:3000/api/health | No | Same + health route works  |
| GET /api/users/me    | http://localhost:3000/api/users/me | Yes (Bearer token) | Same + auth works |

Start with the two no-auth requests; if both return JSON, the backend is working and the health route is reachable.
