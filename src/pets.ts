export type DinoSpecies = "steggy" | "raptor" | "bronto";

export type PetRecord = {
  id: string;
  stage: "egg" | "dino";
  species: DinoSpecies;
  foundAtCompletedLevel: number;
  levelsToHatch: number;
};

export type PetSessionState = {
  completedLevels: number;
  pets: PetRecord[];
};

export type PetProgressResult = {
  state: PetSessionState;
  foundEgg?: PetRecord;
  hatched: PetRecord[];
};

const STORAGE_KEY = "fruitblaster:pets:v1";
const SPECIES: DinoSpecies[] = ["steggy", "raptor", "bronto"];
const MAX_PETS = 10;

const emptyState = (): PetSessionState => ({
  completedLevels: 0,
  pets: [],
});

export function loadPetSession(): PetSessionState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();

    const parsed = JSON.parse(raw) as Partial<PetSessionState>;
    if (!Array.isArray(parsed.pets) || typeof parsed.completedLevels !== "number") {
      return emptyState();
    }

    return {
      completedLevels: Math.max(0, Math.floor(parsed.completedLevels)),
      pets: parsed.pets
        .filter(isPetRecord)
        .slice(0, MAX_PETS)
        .map((pet) => ({ ...pet })),
    };
  } catch {
    return emptyState();
  }
}

export function savePetSession(state: PetSessionState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable in private/restricted contexts. The game
    // should remain playable; pets simply become memory-only for that run.
  }
}

export function progressPetsForCompletedLevel(
  current: PetSessionState,
  eggChance = 0.35,
): PetProgressResult {
  const state: PetSessionState = {
    completedLevels: current.completedLevels + 1,
    pets: current.pets.map((pet) => ({ ...pet })),
  };

  const hatched: PetRecord[] = [];

  state.pets.forEach((pet) => {
    if (pet.stage !== "egg") return;

    pet.levelsToHatch -= 1;
    if (pet.levelsToHatch <= 0) {
      pet.levelsToHatch = 0;
      pet.stage = "dino";
      hatched.push({ ...pet });
    }
  });

  let foundEgg: PetRecord | undefined;
  if (state.pets.length < MAX_PETS && Math.random() < eggChance) {
    foundEgg = {
      id: makeId(state.completedLevels),
      stage: "egg",
      species: randomSpecies(),
      foundAtCompletedLevel: state.completedLevels,
      levelsToHatch: randomInt(2, 4),
    };
    state.pets.push(foundEgg);
  }

  savePetSession(state);
  return { state, foundEgg, hatched };
}

function randomSpecies(): DinoSpecies {
  return SPECIES[Math.floor(Math.random() * SPECIES.length)] ?? "steggy";
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeId(completedLevels: number) {
  return `pet-${completedLevels}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function isPetRecord(value: unknown): value is PetRecord {
  if (!value || typeof value !== "object") return false;

  const pet = value as Partial<PetRecord>;
  return (
    typeof pet.id === "string" &&
    (pet.stage === "egg" || pet.stage === "dino") &&
    (pet.species === "steggy" || pet.species === "raptor" || pet.species === "bronto") &&
    typeof pet.foundAtCompletedLevel === "number" &&
    typeof pet.levelsToHatch === "number"
  );
}
