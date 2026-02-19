# Start backend + admin (two terminals)

**"Backend: unreachable"** means the API server is not running or not on port 3000. Use two terminals.

---

## Terminal 1 – Backend (required first)

```bash
cd /Users/nirajrajendranaphade/Programming/sahyog
npm run dev
```

Wait until you see:
```text
Server running in development mode on port 3000
✅ Clerk Auth Initialized
```

Leave this terminal open.

---

## Terminal 2 – Admin panel

```bash
cd /Users/nirajrajendranaphade/Programming/sahyog/admin-panel
npm run dev
```

Open **http://localhost:5174** in your browser.

---

## Quick check

With the backend running (Terminal 1), in a **third** terminal or in the browser:

```bash
curl http://localhost:3000/api/health
```

You should see: `{"ok":true,"message":"Backend reachable"}`

If that fails, the backend is not running or not on port 3000.
