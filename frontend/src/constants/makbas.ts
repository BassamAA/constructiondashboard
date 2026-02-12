export type MakbasOption = {
  id: string;
  label: string;
};

export const MAKBASES: MakbasOption[] = Array.from({ length: 9 }, (_, index) => {
  const number = index + 1;
  return {
    id: `MAKBAS_${number}`,
    label: `Makbas ${number}`,
  };
});

const MAKBASE_LABEL_MAP = MAKBASES.reduce<Record<string, string>>((map, option) => {
  map[option.id] = option.label;
  return map;
}, {});

export function formatMakbas(id?: string | null): string {
  if (!id) {
    return "Unassigned Makbas";
  }
  return MAKBASE_LABEL_MAP[id] ?? id;
}
