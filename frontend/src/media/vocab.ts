/**
 * Amenity words for the browser: how an agent's own listing text names each amenity (to see what
 * the photos found that the listing doesn't mention yet), and how renters' filters name it. The ids
 * and labels come from the backend (app/media/vocab.py).
 */

export const GROUP_ORDER = ["Kitchen", "Laundry", "Heating & cooling", "Interior", "Bathroom", "Outdoor"];

const TEXT: Record<string, { words: RegExp; phrase: string }> = {
  dishwasher: { words: /dish\s?-?washer/i, phrase: "a dishwasher" },
  stainless_appliances: { words: /stainless/i, phrase: "stainless appliances" },
  gas_stove: { words: /gas (stove|range|cooking)/i, phrase: "a gas stove" },
  electric_stove: { words: /electric (stove|range)/i, phrase: "an electric stove" },
  microwave: { words: /microwave/i, phrase: "a microwave" },
  refrigerator: { words: /fridge|refrigerator/i, phrase: "a refrigerator" },
  garbage_disposal: { words: /disposal/i, phrase: "a garbage disposal" },
  stone_counters: { words: /granite|quartz|marble|stone counter/i, phrase: "stone counters" },
  kitchen_island: { words: /island/i, phrase: "a kitchen island" },
  renovated_kitchen: { words: /(new|renovated|updated|remodeled) kitchen|kitchen (was )?(renovated|updated|remodeled)/i, phrase: "a renovated kitchen" },
  in_unit_laundry: { words: /in[- ]unit (laundry|washer)|washer\s*(\/|and|&)\s*dryer in|w\/d in|laundry in (the )?unit/i, phrase: "in-unit laundry" },
  washer_dryer_hookups: { words: /hook-?ups?/i, phrase: "washer / dryer hookups" },
  central_ac: { words: /central (air|a\/?c)|central cooling/i, phrase: "air conditioning" },
  window_ac: { words: /\ba\/?c\b|air condition/i, phrase: "air conditioning" },
  ceiling_fan: { words: /ceiling fan/i, phrase: "a ceiling fan" },
  radiator_heat: { words: /radiator|steam heat/i, phrase: "radiator heat" },
  fireplace: { words: /fireplace/i, phrase: "a fireplace" },
  hardwood_floors: { words: /hard ?wood|wood floor/i, phrase: "hardwood floors" },
  carpet: { words: /carpet/i, phrase: "carpet" },
  tile_floors: { words: /tile/i, phrase: "tile floors" },
  high_ceilings: { words: /high ceiling|tall ceiling/i, phrase: "high ceilings" },
  natural_light: { words: /natural light|sunny|sun-?filled|bright/i, phrase: "natural light" },
  walk_in_closet: { words: /walk[- ]in closet/i, phrase: "a walk-in closet" },
  exposed_brick: { words: /exposed brick/i, phrase: "exposed brick" },
  recessed_lighting: { words: /recessed light/i, phrase: "recessed lighting" },
  furnished: { words: /\bfurnished\b/i, phrase: "a furnished place" },
  bathtub: { words: /\b(bath)?tub\b/i, phrase: "a bathtub" },
  walk_in_shower: { words: /walk[- ]in shower/i, phrase: "a walk-in shower" },
  double_vanity: { words: /double (vanity|sink)/i, phrase: "a double vanity" },
  renovated_bathroom: { words: /(new|renovated|updated|remodeled) bath/i, phrase: "a renovated bathroom" },
  balcony: { words: /balcony|patio|deck|terrace/i, phrase: "outdoor space" },
};

/** Amenity ids an agent's listing text already mentions ("Unfurnished" doesn't count as furnished). */
export function mentioned(text: string): string[] {
  const t = text.replace(/\bun-?furnished\b/gi, " ");
  return Object.entries(TEXT).filter(([, v]) => v.words.test(t)).map(([id]) => id);
}

/** "Renters filtering for <phrase> would have missed you." */
export function filterPhrase(id: string, label: string): string {
  return TEXT[id]?.phrase ?? label.toLowerCase();
}

export const ROOM_LABEL: Record<string, string> = {
  kitchen: "Kitchen", bedroom: "Bedroom", bathroom: "Bathroom", living: "Living room", dining: "Dining", hallway: "Hallway",
  closet: "Closet", balcony: "Balcony", laundry: "Laundry", entry: "Entry", other: "Other",
};
