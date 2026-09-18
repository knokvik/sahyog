# Firebase Auth + Node.js (PostgreSQL) + Flutter Implementation Guide

This guide provides a complete, production-ready implementation for a disaster response application using Flutter, Firebase Authentication, Node.js, and PostgreSQL.

## Prerequisites
1.  **Firebase Project**: Created in Firebase Console with Authentication enabled (Email/Password or Phone).
2.  **Service Account**: Generated from Firebase Console -> Project Settings -> Service Accounts -> Generate new private key. Save as `serviceAccountKey.json`.
3.  **PostgreSQL Database**: Running and accessible.

---

## SECTION 1 – FLUTTER SIDE

### 1. Dependencies (`pubspec.yaml`)
```yaml
dependencies:
  firebase_core: latest_version
  firebase_auth: latest_version
  http: latest_version
  # Provider or GetX for state management
```

### 2. Initialization (`main.dart`)
Initialize Firebase before running the app.

```dart
import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
  runApp(MyApp());
}
```

### 3. Authentication Service (`services/auth_service.dart`)
Handles login and token retrieval.

```dart
import 'package:firebase_auth/firebase_auth.dart';

class AuthService {
  final FirebaseAuth _auth = FirebaseAuth.instance;

  // Login with Email/Password
  Future<User?> signIn(String email, String password) async {
    try {
      UserCredential result = await _auth.signInWithEmailAndPassword(
        email: email, 
        password: password
      );
      return result.user;
    } catch (e) {
      print(e.toString());
      return null;
    }
  }

  // Get ID Token (Force refresh if needed)
  Future<String?> getIdToken() async {
    User? user = _auth.currentUser;
    if (user != null) {
      // true forces a refresh of the token
      return await user.getIdToken(true);
    }
    return null;
  }

  // Logout
  Future<void> signOut() async {
    await _auth.signOut();
  }
}
```

### 4. HTTP Interceptor / API Client (`services/api_service.dart`)
Attaches the token to every request to the backend.

```dart
import 'package:http/http.dart' as http;
import 'auth_service.dart';

class ApiService {
  final String baseUrl = 'http://your-backend-api.com/api';
  final AuthService _authService = AuthService();

  Future<http.Response> getProtectedData(String endpoint) async {
    String? token = await _authService.getIdToken();
    
    if (token == null) {
      throw Exception('User not authenticated');
    }

    return await http.get(
      Uri.parse('$baseUrl/$endpoint'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token', // Attach Token Here
      },
    );
  }
}
```

---

## SECTION 2 – BACKEND SETUP (NODE.JS)

### 1. Dependencies
```bash
npm install firebase-admin pg express cors
```

### 2. Firebase Admin Initialization (`config/firebase.js`)
Place your `serviceAccountKey.json` in the root (add to `.gitignore`).

```javascript
const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

module.exports = admin;
```

### 3. Authentication Middleware (`middleware/authMiddleware.js`)
Verifies the ID token sent from Flutter.

```javascript
const admin = require('../config/firebase');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Verify ID token with Firebase Admin
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    // Attach UID to request object
    req.user = decodedToken;
    req.uid = decodedToken.uid;
    
    next();
  } catch (error) {
    console.error('Error verifying token:', error);
    return res.status(403).json({ message: 'Unauthorized: Invalid token' });
  }
};

module.exports = verifyToken;
```

---

## SECTION 3 & 4 – DATABASE connection & RBAC

### 1. PostgreSQL Schema
```sql
CREATE TABLE users (
    uid VARCHAR(255) PRIMARY KEY, -- Matches Firebase UID
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user', -- 'admin', 'volunteer', 'authority'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP
);
```

### 2. User Sync & Role Verification (`middleware/roleMiddleware.js` & `controllers`)
We verify the user in Postgres *after* Firebase verification.

```javascript
const { Pool } = require('pg');
const pool = new Pool({ /* config */ });

// Middleware to sync user and check role
const checkRole = (requiredRole) => {
  return async (req, res, next) => {
    const { uid, email } = req.user; // From verifyToken middleware

    try {
      // 1. SELECT user from Postgres
      let result = await pool.query('SELECT * FROM users WHERE uid = $1', [uid]);
      let user = result.rows[0];

      // 2. Sync: Create user if they don't exist (First Login)
      if (!user) {
        result = await pool.query(
          'INSERT INTO users (uid, email, role, last_login_at) VALUES ($1, $2, $3, NOW()) RETURNING *',
          [uid, email, 'user'] // Default role
        );
        user = result.rows[0];
      } else {
        // Update last login
        await pool.query('UPDATE users SET last_login_at = NOW() WHERE uid = $1', [uid]);
      }

      // 3. Attach DB user to request (contains role)
      req.dbUser = user;

      // 4. Role Check
      if (requiredRole && user.role !== requiredRole && user.role !== 'admin') {
         return res.status(403).json({ message: `Access denied. Requires ${requiredRole} role.` });
      }

      next();
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: 'Database error' });
    }
  };
};

module.exports = checkRole;
```

### 3. Usage in Routes (`routes/taskRoutes.js`)

```javascript
const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/authMiddleware');
const checkRole = require('../middleware/roleMiddleware');

// Route: Get All Tasks (Public to valid users)
router.get('/', verifyToken, checkRole(), (req, res) => {
    res.json({ message: "Tasks list" });
});

// Route: Assign Task (Authority Only)
router.post('/assign', verifyToken, checkRole('authority'), (req, res) => {
    res.json({ message: "Task assigned successfully" });
});

// Route: Accept Task (Volunteer Only)
router.post('/accept', verifyToken, checkRole('volunteer'), (req, res) => {
    res.json({ message: "Task accepted" });
});

module.exports = router;
```

---

## SECTION 5 – SECURITY BEST PRACTICES

1.  **Never Trust the Client**:
    *   Do **NOT** send the role from the Flutter app (e.g., in the body or a custom header). A malicious user can easily modify the app code to send `role: "admin"`.
    *   **Always** fetch the role from your secure PostgreSQL database using the verified Firebase UID.

2.  **Why Backend Verification?**:
    *   The Firebase ID Token is signed by Google. Verifying it on the backend ensures the request is coming from a legitimate, currently logged-in user.
    *   If you just check `if (user)` in Flutter, someone could call your API directly using Postman without logging in.

3.  **Blocking Users**:
    *   Firebase can disable accounts, but the ID token remains valid for 1 hour.
    *   **Solution**: Since you check the PostgreSQL database on every request (or cache it), you can add an `is_active` column in Postgres. If `false`, deny the request in the `checkRole` middleware immediately.

4.  **Token Refresh**:
    *   Firebase ID tokens expire after 1 hour.
    *   The Firebase SDK in Flutter automatically refreshes this token in the background.
    *   Calling `user.getIdToken()` in Flutter automatically handles getting a fresh token if the current one is expired.

---

## SECTION 6 – COMPLETE FLOW DIAGRAM

**Scenario**: A Volunteer accepts a task.

1.  **User Action**: Volunteer clicks "Accept Task" in Flutter.
2.  **Flutter**: Checks `FirebaseAuth`. User is logged in.
3.  **Flutter**: Calls `user.getIdToken()`. Gets JWT string `eyJ...`.
4.  **Network**: Sends `POST /api/tasks/accept` with header `Authorization: Bearer eyJ...`.
5.  **Backend (Node.js)**:
    *   `verifyToken` middleware intercepts request.
    *   Validates JWT signature using Firebase Admin SDK. **(Security Check 1)**
    *   Extracts `uid` (e.g., `user_abc123`).
6.  **Backend (Postgres)**:
    *   `checkRole('volunteer')` middleware runs.
    *   Queries `SELECT role FROM users WHERE uid = 'user_abc123'`.
    *   DB returns `role: 'volunteer'`.
7.  **Backend (Logic)**:
    *   Compares DB role ('volunteer') with required role ('volunteer'). **(Security Check 2)**.
    *   Match found. Proceed to controller.
8.  **Controller**: Updates task status in DB to "Accepted".
9.  **Response**: Returns `200 OK` to Flutter.

