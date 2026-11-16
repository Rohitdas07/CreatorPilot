import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from 'firebase/storage';
import { storage } from '../firebase.js';

export interface StorageUploadResult {
  downloadUrl: string;
  storagePath: string;
  bytes: number;
}

function sanitizeFilename(name: string): string {
  return (
    name
      .trim()
      .replace(/[^a-zA-Z0-9._\-]/g, '_')
      .replace(/_{2,}/g, '_')
      .slice(0, 100) || 'asset'
  );
}

export async function uploadFileToFirebaseStorage(
  storagePath: string,
  blob: Blob,
  contentType: string,
  onProgress?: (pct: number) => void
): Promise<StorageUploadResult> {
  const storageRef = ref(storage, storagePath);

  return new Promise<StorageUploadResult>((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, blob, { contentType });

    task.on(
      'state_changed',
      (snapshot) => {
        if (snapshot.totalBytes > 0 && onProgress) {
          onProgress(
            Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
          );
        }
      },
      (error) => {
        const message =
          error?.message ||
          'Firebase Storage upload failed. Verify storage.rules and Storage bucket setup in Firebase Console.';
        reject(new Error(message));
      },
      async () => {
        try {
          const downloadUrl = await getDownloadURL(task.snapshot.ref);
          resolve({
            downloadUrl,
            storagePath,
            bytes: blob.size,
          });
        } catch (err) {
          reject(
            err instanceof Error
              ? err
              : new Error('Failed to get Firebase Storage download URL.')
          );
        }
      }
    );
  });
}

export async function uploadBrandLogo(
  userId: string,
  file: File,
  onProgress?: (pct: number) => void
): Promise<StorageUploadResult> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Brand logo must be an image file (PNG, JPG, WebP, SVG).');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Brand logo must be 5 MB or smaller.');
  }

  const safeName = sanitizeFilename(file.name);
  const storagePath = `users/${userId}/brand-assets/${Date.now()}-${safeName}`;
  return uploadFileToFirebaseStorage(
    storagePath,
    file,
    file.type || 'image/png',
    onProgress
  );
}

export async function uploadRenderedVideoBlob(
  userId: string,
  jobId: string,
  fileName: string,
  blob: Blob,
  onProgress?: (pct: number) => void
): Promise<StorageUploadResult> {
  const safeName = sanitizeFilename(fileName.endsWith('.mp4') ? fileName : `${fileName}.mp4`);
  const storagePath = `users/${userId}/rendered-videos/${jobId}-${safeName}`;
  return uploadFileToFirebaseStorage(
    storagePath,
    blob,
    'video/mp4',
    onProgress
  );
}

export async function uploadThumbnailBlob(
  userId: string,
  thumbnailId: string,
  fileName: string,
  blob: Blob,
  onProgress?: (pct: number) => void
): Promise<StorageUploadResult> {
  if (blob.size > 10 * 1024 * 1024) {
    throw new Error('Thumbnail image must be 10 MB or smaller.');
  }
  const safeName = sanitizeFilename(
    fileName.endsWith('.png') || fileName.endsWith('.jpg') ? fileName : `${fileName}.png`
  );
  const storagePath = `users/${userId}/thumbnails/${thumbnailId}-${safeName}`;
  return uploadFileToFirebaseStorage(
    storagePath,
    blob,
    blob.type || 'image/png',
    onProgress
  );
}

export async function deleteFirebaseStorageAsset(storagePath: string): Promise<void> {
  if (!storagePath.trim()) return;
  const assetRef = ref(storage, storagePath);
  await deleteObject(assetRef);
}
