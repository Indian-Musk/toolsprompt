// migrate-to-r2.js
// Collection name: uploads (corrected from "prompts")
// Run: node migrate-to-r2.js

require('dotenv').config();
const admin = require('firebase-admin');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const serviceAccount = {
  projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
  privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
  clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: process.env.FIREBASE_ADMIN_STORAGE_BUCKET,
});

const db = admin.firestore();
const firebaseBucket = admin.storage().bucket();

const r2Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY,
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

// =============================================
// HELPERS
// =============================================

function extractPathFromFirebaseUrl(url) {
  if (!url) return null;
  const match = url.match(/storage\.googleapis\.com\/[^\/]+\/(.+)/);
  return match ? match[1] : null;
}

async function downloadFromFirebase(filePath) {
  try {
    const file = firebaseBucket.file(filePath);
    const [exists] = await file.exists();
    if (!exists) {
      console.log(`   ⚠️ File not found: ${filePath}`);
      return null;
    }
    const chunks = [];
    const fileStream = file.createReadStream();
    return new Promise((resolve, reject) => {
      fileStream.on('data', (chunk) => chunks.push(chunk));
      fileStream.on('end', () => resolve(Buffer.concat(chunks)));
      fileStream.on('error', reject);
    });
  } catch (error) {
    console.error(`   ❌ Download error: ${error.message}`);
    return null;
  }
}

async function uploadToR2(buffer, key, contentType) {
  try {
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    });
    await r2Client.send(command);
    return `${R2_PUBLIC_URL}/${key}`;
  } catch (error) {
    console.error(`   ❌ Upload error: ${error.message}`);
    return null;
  }
}

function getContentType(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const map = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'webp': 'image/webp',
    'gif': 'image/gif',
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'mov': 'video/quicktime',
  };
  return map[ext] || 'application/octet-stream';
}

// =============================================
// MAIN MIGRATION (USING "uploads" COLLECTION)
// =============================================

async function migrateAllPrompts() {
  console.log('🚀 Starting migration from Firebase Storage to Cloudflare R2...');
  console.log('📁 Collection: uploads\n');

  let lastDoc = null;
  let migratedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  let batchSize = 0;

  do {
    let query = db.collection('uploads').orderBy('__name__').limit(500);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    batchSize = snapshot.docs.length;

    if (batchSize === 0) break;

    console.log(`📦 Processing batch of ${batchSize} documents...`);

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const docId = doc.id;

      if (data.migratedToR2 === true) {
        console.log(`⏭️ Skipping ${docId} (already migrated)`);
        skippedCount++;
        continue;
      }

      console.log(`🔄 Processing: ${docId} - ${data.title || 'Untitled'}`);

      let updatedFields = {};
      let hasChanges = false;
      let allUploadsSucceeded = true;

      // --- Migrate Media ---
      const mediaUrl = data.mediaUrl || data.imageUrl || data.videoUrl;
      if (mediaUrl && mediaUrl.includes('storage.googleapis.com')) {
        const filePath = extractPathFromFirebaseUrl(mediaUrl);
        if (filePath) {
          console.log(`   📥 Downloading: ${filePath}`);
          const buffer = await downloadFromFirebase(filePath);
          if (buffer) {
            const contentType = getContentType(filePath);
            console.log(`   📤 Uploading to R2: ${filePath}`);
            const newUrl = await uploadToR2(buffer, filePath, contentType);
            if (newUrl) {
              updatedFields.mediaUrl = newUrl;
              updatedFields.imageUrl = newUrl;
              updatedFields.videoUrl = newUrl;
              hasChanges = true;
              console.log(`   ✅ Migrated: ${newUrl}`);
            } else {
              allUploadsSucceeded = false;
            }
          } else {
            allUploadsSucceeded = false;
          }
        }
      }

      // --- Migrate Thumbnail ---
      if (data.thumbnailUrl && data.thumbnailUrl.includes('storage.googleapis.com')) {
        const filePath = extractPathFromFirebaseUrl(data.thumbnailUrl);
        if (filePath) {
          console.log(`   📥 Downloading thumbnail: ${filePath}`);
          const buffer = await downloadFromFirebase(filePath);
          if (buffer) {
            const contentType = getContentType(filePath);
            console.log(`   📤 Uploading thumbnail to R2: ${filePath}`);
            const newUrl = await uploadToR2(buffer, filePath, contentType);
            if (newUrl) {
              updatedFields.thumbnailUrl = newUrl;
              hasChanges = true;
              console.log(`   ✅ Migrated thumbnail: ${newUrl}`);
            } else {
              allUploadsSucceeded = false;
            }
          } else {
            allUploadsSucceeded = false;
          }
        }
      }

      // --- Update Firestore ---
      if (hasChanges && allUploadsSucceeded) {
        updatedFields.migratedToR2 = true;
        updatedFields.migratedAt = new Date().toISOString();
        try {
          await doc.ref.update(updatedFields);
          console.log(`   💾 Updated Firestore for ${docId}`);
          migratedCount++;
        } catch (updateError) {
          console.error(`   ❌ Failed to update Firestore: ${updateError.message}`);
          errorCount++;
        }
      } else if (hasChanges && !allUploadsSucceeded) {
        console.log(`   ⚠️ Skipping update for ${docId} due to upload failures`);
        errorCount++;
      } else {
        // No Firebase URLs – mark as migrated
        if (!mediaUrl || !mediaUrl.includes('storage.googleapis.com')) {
          try {
            await doc.ref.update({ migratedToR2: true, migratedAt: new Date().toISOString() });
            console.log(`   ℹ️ No Firebase URLs found. Marked ${docId} as migrated.`);
            migratedCount++;
          } catch (e) {}
        }
      }

      console.log('');
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];

  } while (batchSize === 500);

  // =============================================
  // FINAL SUMMARY
  // =============================================

  console.log('🎉 MIGRATION COMPLETED!');
  console.log(`✅ Migrated: ${migratedCount} prompts`);
  console.log(`⏭️ Skipped (already migrated): ${skippedCount} prompts`);
  console.log(`❌ Errors: ${errorCount} prompts`);
  console.log(`\n🔗 New files are accessible via: ${R2_PUBLIC_URL}`);
  console.log('💰 You are now paying $0 for egress (bandwidth) from Cloudflare R2!');
}

migrateAllPrompts().catch((error) => {
  console.error('❌ Migration crashed:', error);
  process.exit(1);
});