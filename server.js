require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const { getAuth } = require('firebase-admin/auth');
const admin = require('firebase-admin');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  })
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Authentication middleware
const authenticate = async (req, res, next) => {
  const sessionCookie = req.cookies.session || '';
  
  try {
    const decodedClaims = await getAuth().verifySessionCookie(sessionCookie, true);
    req.user = decodedClaims;
    next();
  } catch (error) {
    // Allow access to login page without authentication
    if (req.path.includes('login.html')) {
      return next();
    }
    res.redirect('/login.html');
  }
};

// Apply authentication to all routes except login
app.use(authenticate);

// Create session endpoint
app.post('/sessionLogin', async (req, res) => {
  try {
    const { idToken } = req.body;
    const expiresIn = 60 * 60 * 24 * 5 * 1000; // 5 days
    const sessionCookie = await getAuth().createSessionCookie(idToken, { expiresIn });
    
    res.cookie('session', sessionCookie, {
      maxAge: expiresIn,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });
    res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Session creation error:', error);
    res.status(401).json({ error: 'Failed to create session' });
  }
});

// Logout endpoint
app.post('/sessionLogout', (req, res) => {
  res.clearCookie('session');
  res.status(200).json({ status: 'success' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});