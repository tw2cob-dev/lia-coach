import { CoachPlan } from "./coachPlan";

export type MemoryPatch = Partial<Pick<CoachPlan, "physicalProfile" | "signals">>;

export async function extractMemoryPatch(args: {
  message: string;
  profile?: CoachPlan["physicalProfile"];
  todayISO: string;
}): Promise<MemoryPatch | null> {
  const message = args.message.trim();
  if (!message) return null;

  try {
    const response = await fetch("/api/ai/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        profile: args.profile ?? {},
        todayISO: args.todayISO,
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { patch?: MemoryPatch };
    if (!data.patch || typeof data.patch !== "object") return null;
    return data.patch;
  } catch {
    return null;
  }
}

