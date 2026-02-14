import { doc, getDoc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";
import { ChatEvent } from "../chatEvents";
import { CoachPlan } from "../coachPlan";
import { getFirebaseDb } from "./client";

const CHAT_STATE_COLLECTION = "chatStates";

export type CloudChatState = {
  events: ChatEvent[];
  coachPlan: CoachPlan | null;
  updatedAtMs: number;
};

type CloudChatStateDoc = {
  events?: ChatEvent[];
  coachPlan?: CoachPlan | null;
  updatedAtMs?: number;
};

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as T;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (nested === undefined) continue;
    out[key] = stripUndefinedDeep(nested);
  }
  return out as T;
}

function getUserChatStateRef(userId: string) {
  const db = getFirebaseDb();
  return doc(db, CHAT_STATE_COLLECTION, userId);
}

export async function loadCloudChatState(userId: string): Promise<CloudChatState | null> {
  const snapshot = await getDoc(getUserChatStateRef(userId));
  if (!snapshot.exists()) return null;
  const data = snapshot.data() as CloudChatStateDoc;
  if (data.events !== undefined && !Array.isArray(data.events)) {
    throw new Error("Invalid cloud chat state: events must be an array.");
  }
  return {
    events: Array.isArray(data.events) ? data.events : [],
    coachPlan: data.coachPlan ?? null,
    updatedAtMs: Number(data.updatedAtMs) || 0,
  };
}

export function subscribeCloudChatState(
  userId: string,
  onValue: (state: CloudChatState | null) => void,
  onError?: (error: unknown) => void
) {
  return onSnapshot(
    getUserChatStateRef(userId),
    (snapshot) => {
      if (!snapshot.exists()) {
        onValue(null);
        return;
      }
      const data = snapshot.data() as CloudChatStateDoc;
      if (data.events !== undefined && !Array.isArray(data.events)) {
        if (onError) onError(new Error("Invalid cloud chat state: events must be an array."));
        return;
      }
      onValue({
        events: Array.isArray(data.events) ? data.events : [],
        coachPlan: data.coachPlan ?? null,
        updatedAtMs: Number(data.updatedAtMs) || 0,
      });
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export async function saveCloudChatState(userId: string, state: Omit<CloudChatState, "updatedAtMs">) {
  await setDoc(
    getUserChatStateRef(userId),
    stripUndefinedDeep({
      events: state.events,
      coachPlan: state.coachPlan ?? null,
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    }),
    { merge: true }
  );
}

export async function clearCloudChatState(userId: string) {
  await setDoc(
    getUserChatStateRef(userId),
    {
      events: [],
      coachPlan: null,
      updatedAtMs: Date.now(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
