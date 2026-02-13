type FirebaseLookupResponse = {
  users?: Array<{
    localId?: string;
    email?: string;
    emailVerified?: boolean;
    displayName?: string;
  }>;
};

export type FirebaseVerifiedUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  name?: string;
};

function readFirebaseWebApiKey(): string {
  const key = process.env.FIREBASE_WEB_API_KEY ?? process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!key) {
    throw new Error("Missing FIREBASE_WEB_API_KEY or NEXT_PUBLIC_FIREBASE_API_KEY.");
  }
  return key;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<FirebaseVerifiedUser | null> {
  const token = idToken.trim();
  if (!token) return null;

  const apiKey = readFirebaseWebApiKey();
  const endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken: token }),
  });

  if (!response.ok) return null;
  const data = (await response.json()) as FirebaseLookupResponse;
  const user = data.users?.[0];
  if (!user?.localId || !user?.email) return null;

  return {
    id: user.localId,
    email: user.email,
    emailVerified: Boolean(user.emailVerified),
    name: user.displayName,
  };
}
