import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  inMemoryPersistence,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { handleFirestoreError, OperationType } from '../lib/firebase';
import type {
  AuthActionResult,
  LoginInput,
  SignupInput,
  UserProfile,
} from '../types/auth';

function mapFirebaseError(error: unknown): {
  message: string;
  code: string;
} {
  const errObj = error as { code?: string; message?: string };
  const code = errObj?.code || 'unknown';
  switch (code) {
    case 'auth/email-already-in-use':
      return {
        code,
        message:
          'This email address is already registered. Please sign in or use another email.',
      };
    case 'auth/invalid-email':
      return { code, message: 'Please enter a valid email address.' };
    case 'auth/weak-password':
      return {
        code,
        message: 'Password is too weak. Use at least 6 characters.',
      };
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return {
        code,
        message: 'Invalid email or password. Please check your credentials.',
      };
    case 'auth/too-many-requests':
      return {
        code,
        message:
          'Too many attempts. Please wait a moment before trying again.',
      };
    case 'auth/network-request-failed':
      return {
        code,
        message: 'Network error. Please check your connection and try again.',
      };
    case 'auth/operation-not-allowed': {
      const activeProject = auth.app.options.projectId || 'your Firebase project';
      return {
        code,
        message: `This sign-in method is disabled in Firebase Authentication for project ${activeProject}. Enable Email/Password or Google under Authentication → Sign-in method in Firebase Console.`,
      };
    }
    case 'auth/unauthorized-domain':
      return {
        code,
        message:
          'This domain is not authorized for Firebase Authentication. Add this app domain under Authentication → Settings → Authorized domains in Firebase Console.',
      };
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return {
        code,
        message: 'Sign-in popup was closed before completing authentication.',
      };
    case 'auth/popup-blocked':
      return {
        code,
        message:
          'Sign-in popup was blocked by the browser. Please allow popups or sign in with email and password.',
      };
    default:
      return {
        code,
        message:
          errObj?.message ||
          'Authentication failed. Please verify your details and try again.',
      };
  }
}

interface AuthContextValue {
  user: UserProfile | null;
  authReady: boolean;
  signup: (input: SignupInput) => Promise<AuthActionResult>;
  login: (input: LoginInput) => Promise<AuthActionResult>;
  loginWithGoogle: () => Promise<AuthActionResult>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<AuthActionResult>;
  updateUserProfile: (updates: Partial<UserProfile>) => Promise<AuthActionResult>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const isRegisteringRef = useRef(false);

  const loadFirebaseProfile = useCallback(async (fbUser: User): Promise<UserProfile> => {
    const fallbackProfile: UserProfile = {
      uid: fbUser.uid,
      fullName: fbUser.displayName || fbUser.email?.split('@')[0] || 'Creator',
      email: fbUser.email || '',
      countryCode: '+1',
      phoneNumber: '',
      brandHandle: `@${(fbUser.displayName || fbUser.email?.split('@')[0] || 'creator')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')}`,
      niche: 'Tech, Productivity & Creator Systems',
      brandVoice: 'Clear, practical, creator-first, conversational without hype',
    };

    const path = `users/${fbUser.uid}`;
    try {
      const snap = await Promise.race([
        getDoc(doc(db, 'users', fbUser.uid)),
        new Promise<never>((_, reject) =>
          window.setTimeout(() => reject(new Error('Firestore profile lookup timed out')), 4000)
        ),
      ]);
      if (snap.exists()) {
        const data = snap.data();
        return {
          uid: fbUser.uid,
          fullName: String(data.fullName || fallbackProfile.fullName),
          email: String(data.email || fallbackProfile.email),
          countryCode: String(data.countryCode || '+1'),
          phoneNumber: String(data.phoneNumber || ''),
          brandHandle: data.brandHandle
            ? String(data.brandHandle)
            : fallbackProfile.brandHandle,
          niche: data.niche ? String(data.niche) : fallbackProfile.niche,
          brandVoice: data.brandVoice
            ? String(data.brandVoice)
            : fallbackProfile.brandVoice,
        };
      }
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.toLowerCase().includes('missing or insufficient permissions')
      ) {
        try {
          handleFirestoreError(err, OperationType.GET, path);
        } catch (loggedErr) {
          console.error(loggedErr);
        }
      } else {
        console.warn('Could not load Firestore user profile, using auth fallback:', err);
      }
    }
    return fallbackProfile;
  }, []);

  useEffect(() => {
    let settled = false;
    const safetyTimer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        setAuthReady(true);
      }
    }, 2500);

    const unsubscribe = onAuthStateChanged(
      auth,
      async (fbUser) => {
        if (isRegisteringRef.current) {
          return;
        }
        try {
          if (!fbUser) {
            setUser(null);
            return;
          }
          const profile = await loadFirebaseProfile(fbUser);
          setUser(profile);
        } catch (err) {
          console.error('Auth state restoration error:', err);
          setUser(null);
        } finally {
          settled = true;
          window.clearTimeout(safetyTimer);
          setAuthReady(true);
        }
      },
      (err) => {
        console.error('Firebase auth listener error:', err);
        settled = true;
        window.clearTimeout(safetyTimer);
        setUser(null);
        setAuthReady(true);
      }
    );

    return () => {
      window.clearTimeout(safetyTimer);
      unsubscribe();
    };
  }, [loadFirebaseProfile]);

  const signup = useCallback(async (input: SignupInput): Promise<AuthActionResult> => {
    const cleanEmail = input.email.trim().toLowerCase();
    const cleanName = input.fullName.trim();
    const cleanPhone = input.phoneNumber.replace(/[\s\-()]/g, '');

    isRegisteringRef.current = true;

    try {
      const credential = await createUserWithEmailAndPassword(
        auth,
        cleanEmail,
        input.password
      );
      const createdUser = credential.user;

      await updateProfile(createdUser, { displayName: cleanName });

      const path = `users/${createdUser.uid}`;
      const brandHandle = `@${
        cleanName
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .slice(0, 24) || 'creator'
      }`;

      try {
        await Promise.race([
          setDoc(doc(db, 'users', createdUser.uid), {
            uid: createdUser.uid,
            fullName: cleanName,
            email: cleanEmail,
            countryCode: input.countryCode,
            phoneNumber: cleanPhone,
            brandHandle,
            niche: 'Tech, Productivity & Creator Systems',
            brandVoice: 'Clear, practical, creator-first, conversational without hype',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }),
          new Promise<never>((_, reject) =>
            window.setTimeout(() => reject(new Error('Firestore profile write timed out')), 5000)
          ),
        ]);
      } catch (fsErr) {
        if (
          fsErr instanceof Error &&
          fsErr.message.toLowerCase().includes('missing or insufficient permissions')
        ) {
          try {
            handleFirestoreError(fsErr, OperationType.CREATE, path);
          } catch (loggedErr) {
            console.error(loggedErr);
          }
        } else {
          console.warn('Account created in Auth, but Firestore profile write skipped:', fsErr);
        }
      }

      await signOut(auth);
      setUser(null);
      return { ok: true };
    } catch (err) {
      try {
        if (auth.currentUser) {
          await signOut(auth);
        }
      } catch {
        // ignore cleanup signOut errors
      }
      const mapped = mapFirebaseError(err);
      return {
        ok: false,
        code: mapped.code,
        error: mapped.message,
      };
    } finally {
      isRegisteringRef.current = false;
    }
  }, []);

  const ensureSafePersistence = useCallback(async (rememberMe: boolean) => {
    const preferred = rememberMe ? browserLocalPersistence : browserSessionPersistence;
    try {
      await setPersistence(auth, preferred);
    } catch {
      try {
        await setPersistence(auth, browserSessionPersistence);
      } catch {
        try {
          await setPersistence(auth, inMemoryPersistence);
        } catch {
          // ignore if Firebase Auth persistence cannot be changed
        }
      }
    }
  }, []);

  const login = useCallback(
    async (input: LoginInput): Promise<AuthActionResult> => {
      const cleanEmail = input.email.trim().toLowerCase();

      try {
        await ensureSafePersistence(input.rememberMe);
        const credential = await signInWithEmailAndPassword(
          auth,
          cleanEmail,
          input.password
        );
        const profile = await loadFirebaseProfile(credential.user);
        setUser(profile);
        setAuthReady(true);
        return { ok: true };
      } catch (err) {
        const mapped = mapFirebaseError(err);
        return {
          ok: false,
          code: mapped.code,
          error: mapped.message,
        };
      }
    },
    [ensureSafePersistence, loadFirebaseProfile]
  );

  const loginWithGoogle = useCallback(async (): Promise<AuthActionResult> => {
    try {
      await ensureSafePersistence(true);
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const credential = await signInWithPopup(auth, provider);
      const profile = await loadFirebaseProfile(credential.user);
      setUser(profile);
      setAuthReady(true);
      return { ok: true };
    } catch (err) {
      const mapped = mapFirebaseError(err);
      return {
        ok: false,
        code: mapped.code,
        error: mapped.message,
      };
    }
  }, [ensureSafePersistence, loadFirebaseProfile]);

  const logout = useCallback(async (): Promise<void> => {
    await signOut(auth);
    setUser(null);
  }, []);

  const resetPassword = useCallback(
    async (email: string): Promise<AuthActionResult> => {
      const cleanEmail = email.trim().toLowerCase();

      try {
        await sendPasswordResetEmail(auth, cleanEmail);
        return { ok: true };
      } catch (err) {
        const mapped = mapFirebaseError(err);
        return {
          ok: false,
          code: mapped.code,
          error: mapped.message,
        };
      }
    },
    []
  );

  const updateUserProfile = useCallback(
    async (updates: Partial<UserProfile>): Promise<AuthActionResult> => {
      if (!user || !auth.currentUser) {
        return { ok: false, error: 'You must be signed in to update your profile.' };
      }

      const nextProfile: UserProfile = {
        ...user,
        ...updates,
      };

      const path = `users/${user.uid}`;
      try {
        if (updates.fullName) {
          await updateProfile(auth.currentUser, { displayName: updates.fullName });
        }
        await updateDoc(doc(db, 'users', user.uid), {
          fullName: nextProfile.fullName,
          countryCode: nextProfile.countryCode,
          phoneNumber: nextProfile.phoneNumber,
          brandHandle: nextProfile.brandHandle || '',
          niche: nextProfile.niche || '',
          brandVoice: nextProfile.brandVoice || '',
          updatedAt: serverTimestamp(),
        });
        setUser(nextProfile);
        return { ok: true };
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.toLowerCase().includes('missing or insufficient permissions')
        ) {
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Failed to update profile.',
        };
      }
    },
    [user]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        signup,
        login,
        loginWithGoogle,
        logout,
        resetPassword,
        updateUserProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
