// fix-media-fields.js
require('dotenv').config();
const admin = require('firebase-admin');

const serviceAccount = {
  projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
  privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
  clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function fixMediaFields() {
  console.log('🔍 Fixing media fields for all prompts...');
  const snapshot = await db.collection('uploads').get();
  let fixed = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const fileType = data.fileType || 'image';
    const updates = {};

    if (fileType === 'image' && data.videoUrl) {
      updates.videoUrl = null;
      console.log(`🖼️ Clearing videoUrl for image prompt ${doc.id}`);
    }

    if (fileType === 'video' && data.imageUrl && data.imageUrl === data.videoUrl) {
      // Optionally clear imageUrl for videos (not strictly needed, but cleaner)
      // updates.imageUrl = data.thumbnailUrl || data.mediaUrl || null;
      // console.log(`🎬 Clearing imageUrl for video prompt ${doc.id}`);
    }

    if (Object.keys(updates).length > 0) {
      await doc.ref.update(updates);
      fixed++;
    }
  }

  console.log(`✅ Fixed ${fixed} documents.`);
}

fixMediaFields().catch(console.error);