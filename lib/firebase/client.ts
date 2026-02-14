import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { Firestore, getFirestore, initializeFirestore } from "firebase/firestore";

let cachedDb: Firestore | null = null;

function readEnv(name: string): string {
  let value: string | undefined;
  if (name === "NEXT_PUBLIC_FIREBASE_API_KEY") value = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (name === "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN") value = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  if (name === "NEXT_PUBLIC_FIREBASE_PROJECT_ID") value = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (name === "NEXT_PUBLIC_FIREBASE_APP_ID") value = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  if (!value) {
    throw new Error(`Missing env var: ${name}.`);
  }
  return value;
}

export function getFirebaseAuth() {
  const config = {
    apiKey: readEnv("NEXT_PUBLIC_FIREBASE_API_KEY"),
    authDomain: readEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
    projectId: readEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
    appId: readEnv("NEXT_PUBLIC_FIREBASE_APP_ID"),
  };

  const app = getApps().length ? getApp() : initializeApp(config);
  return getAuth(app);
}

export function getFirebaseDb() {
  const config = {
    apiKey: readEnv("NEXT_PUBLIC_FIREBASE_API_KEY"),
    authDomain: readEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"),
    projectId: readEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID"),
    appId: readEnv("NEXT_PUBLIC_FIREBASE_APP_ID"),
  };

  const app = getApps().length ? getApp() : initializeApp(config);
  if (cachedDb) return cachedDb;
  try {
    cachedDb = initializeFirestore(app, { ignoreUndefinedProperties: true });
  } catch {
    cachedDb = getFirestore(app);
  }
  return cachedDb;
}
