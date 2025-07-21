const express = require('express');
const path = require('path');
const admin = require('firebase-admin');
const Busboy = require('busboy');
require('dotenv').config(); // Load environment variables

// Initialize Firebase Admin with environment variables
admin.initializeApp({
  credential: admin.credential.cert({
    project_id: process.env.FIREBASE_ADMIN_PROJECT_ID,
    private_key: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_ADMIN_CLIENT_EMAIL
  }),
  storageBucket: process.env.FIREBASE_ADMIN_STORAGE_BUCKET
});

const app = express();
const port = process.env.PORT || 3000;

// Get Firestore and Storage instances
const db = admin.firestore();
const bucket = admin.storage().bucket();

console.log(`Using storage bucket: ${bucket.name}`);

// Middleware to verify Firebase token
const verifyToken = async (req, res, next) => {
  const idToken = req.headers.authorization?.split('Bearer ')[1];
  
  if (!idToken) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ error: 'Invalid authorization token' });
  }
};

// Upload endpoint (protected)
app.post('/api/upload', verifyToken, (req, res) => {
  const busboy = Busboy({ headers: req.headers });
  const fields = {};
  let fileBuffer = null;
  let fileInfo = null;

  busboy.on('file', (name, file, info) => {
    if (name !== 'image') {
      file.resume();
      return;
    }
    
    fileInfo = info;
    const chunks = [];
    
    file.on('data', (chunk) => {
      chunks.push(chunk);
    });
    
    file.on('end', () => {
      fileBuffer = Buffer.concat(chunks);
    });
  });

  busboy.on('field', (name, value) => {
    fields[name] = value;
  });

  busboy.on('finish', async () => {
    try {
      if (!fileBuffer) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { title, promptText } = fields;
      const userId = req.user.uid;
      
      if (!title || !title.trim()) {
        return res.status(400).json({ error: 'Title is required' });
      }
      
      if (!promptText || !promptText.trim()) {
        return res.status(400).json({ error: 'Prompt text is required' });
      }

      // Generate unique filename
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const extension = fileInfo.filename ? path.extname(fileInfo.filename) : '.png';
      const filename = `uploads/${uniqueSuffix}${extension}`;
      const fileRef = bucket.file(filename);

      // Upload to Firebase Storage
      await fileRef.save(fileBuffer, {
        metadata: {
          contentType: fileInfo.mimeType || 'image/png',
          metadata: {
            uploadedBy: userId
          }
        }
      });

      // Make file public
      await fileRef.makePublic();
      
      // Get public URL
      const [url] = await fileRef.getSignedUrl({
        action: 'read',
        expires: '03-09-2491' // Far future date
      });

      // Save to Firestore
      const newUpload = {
        title: title.trim(),
        promptText: promptText.trim(),
        imageUrl: url,
        userId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        likes: 0,
        uses: 0
      };

      const docRef = await db.collection('uploads').add(newUpload);

      res.json({ 
        success: true, 
        message: 'Upload successful',
        upload: { 
          id: docRef.id, 
          ...newUpload,
          createdAt: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Upload processing error:', error);
      res.status(500).json({ error: `Upload failed: ${error.message}` });
    }
  });

  busboy.on('error', (error) => {
    console.error('Busboy error:', error);
    res.status(500).json({ error: 'File processing error' });
  });

  req.pipe(busboy);
});

// Endpoint to get paginated uploads
app.get('/api/uploads', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    // Get total count
    const countSnapshot = await db.collection('uploads').count().get();
    const totalCount = countSnapshot.data().count;
    const totalPages = Math.ceil(totalCount / limit);

    // Get paginated uploads
    const snapshot = await db.collection('uploads')
      .orderBy('createdAt', 'desc')
      .offset(offset)
      .limit(limit)
      .get();

    const uploads = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      uploads.push({ 
        id: doc.id, 
        ...data,
        createdAt: data.createdAt.toDate().toISOString()
      });
    });

    res.json({
      uploads,
      currentPage: page,
      totalPages,
      totalCount
    });
  } catch (error) {
    console.error('Error fetching uploads:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve static files
app.use(express.static('public'));

// Handle 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Firebase project: ${process.env.FIREBASE_ADMIN_PROJECT_ID}`);
});