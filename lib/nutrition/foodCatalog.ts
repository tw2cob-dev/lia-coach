export type FoodCatalogItem = {
  id: string;
  name: string;
  aliases: string[];
  defaultServingGrams: number;
  units?: Record<string, number>;
  per100g: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG?: number;
  };
};

export const FOOD_CATALOG: FoodCatalogItem[] = [
  {
    id: "banana",
    name: "platano",
    aliases: ["platano", "banana", "banano"],
    defaultServingGrams: 120,
    units: { unidad: 120, platano: 120, banana: 120 },
    per100g: { kcal: 89, proteinG: 1.1, carbsG: 22.8, fatG: 0.3, fiberG: 2.6 },
  },
  {
    id: "egg",
    name: "huevo",
    aliases: ["huevo", "huevos"],
    defaultServingGrams: 60,
    units: { unidad: 60, huevo: 60 },
    per100g: { kcal: 143, proteinG: 12.6, carbsG: 0.7, fatG: 9.5 },
  },
  {
    id: "rice",
    name: "arroz",
    aliases: ["arroz"],
    defaultServingGrams: 150,
    units: { racion: 150 },
    per100g: { kcal: 130, proteinG: 2.7, carbsG: 28.2, fatG: 0.3 },
  },
  {
    id: "chicken_breast",
    name: "pollo",
    aliases: ["pollo", "pechuga de pollo"],
    defaultServingGrams: 150,
    units: { racion: 150 },
    per100g: { kcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 },
  },
  {
    id: "bread",
    name: "pan",
    aliases: ["pan"],
    defaultServingGrams: 40,
    units: { rebanada: 30, rebanadas: 30 },
    per100g: { kcal: 265, proteinG: 9, carbsG: 49, fatG: 3.2, fiberG: 2.7 },
  },
  {
    id: "olive_oil",
    name: "aceite de oliva",
    aliases: ["aceite", "aceite de oliva"],
    defaultServingGrams: 10,
    units: { cucharada: 10 },
    per100g: { kcal: 884, proteinG: 0, carbsG: 0, fatG: 100 },
  },
  {
    id: "milk",
    name: "leche",
    aliases: ["leche"],
    defaultServingGrams: 250,
    units: { vaso: 250 },
    per100g: { kcal: 61, proteinG: 3.2, carbsG: 4.8, fatG: 3.3 },
  },
];

export function findCatalogItemByText(text: string): FoodCatalogItem | null {
  const normalized = normalize(text);
  for (const item of FOOD_CATALOG) {
    if (item.aliases.some((alias) => normalized.includes(normalize(alias)))) {
      return item;
    }
  }
  return null;
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

