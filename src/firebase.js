import { initializeApp, getApps } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';
import { getAuth } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

/** @type {import('firebase/app').FirebaseApp} */
export const app =
  getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);

/** @type {import('firebase/auth').Auth} */
export const auth = getAuth(app);

const databaseId = /** @type {{ firestoreDatabaseId?: string }} */ (firebaseConfig)
  .firestoreDatabaseId;

/** @type {import('firebase/firestore').Firestore} */
export const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);

/** @type {import('firebase/storage').FirebaseStorage} */
export const storage = getStorage(app);

if (typeof window !== 'undefined' && firebaseConfig.measurementId) {
  isSupported()
    .then((supported) => {
      if (supported) {
        getAnalytics(app);
      }
    })
    .catch(() => {
      // Analytics unavailable in restricted browser/iframe contexts
    });
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();
