export function detectCoachIntent(messageText: string): boolean {
  if (!messageText) return false;
  const text = messageText.toLowerCase().trim();
  return (
    text.includes("plan semanal") ||
    text.includes("plan de la semana") ||
    text.includes("plan de comidas") ||
    text.includes("meal plan") ||
    text.includes("entrenamiento semanal") ||
    text.includes("training plan") ||
    text.includes("plan de entrenamiento") ||
    text.includes("check-in") ||
    text.includes("revisión del día") ||
    text.includes("peso") ||
    text.includes("calorías") ||
    text.includes("nutrición") ||
    text.includes("hábitos") ||
    text.includes("objetivos de salud") ||
    text.includes("quiero mejorar mi alimentación") ||
    text.includes("quiero perder peso") ||
    text.includes("quiero ganar músculo")
  );
}

export function isCheckInRequest(messageText: string): boolean {
  if (!messageText) return false;
  const text = messageText.toLowerCase();
  return (
    text.includes("check-in") ||
    text.includes("revisión del día")
  );
}
