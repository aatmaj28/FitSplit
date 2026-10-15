"""The one prompt every provider gets (bump PROMPT_VERSION when editing it)."""

PROMPT_VERSION = "v2"

PROMPT = """You are an expert at reading residential apartment floor plans.

Look at the attached image and return ONLY one minified JSON object (no markdown fences, no comments, no text before or after it). Omit any key whose value would be null.

Schema:
{
  "is_3d_render": true if the image is a 3D / perspective / isometric rendering instead of a flat 2D floor plan, else false,
  "rooms": [
    {
      "name": the room label exactly as printed (e.g. "DREAM", "Master Bedroom", "Living Room/Dining Room", "C"),
      "type": one of "bedroom", "bathroom", "kitchen", "living", "dining", "closet", "balcony", "foyer", "other",
      "label_center": [x, y] = center of the printed room NAME text, normalized to the image: x from 0.0 (left edge) to 1.0 (right edge), y from 0.0 (top edge) to 1.0 (bottom edge), 3 decimals,
      "dims_text": the dimension text printed for this room exactly as written (e.g. "17'10\\" x 10'10\\""),
      "width_ft": the FIRST printed dimension in decimal feet,
      "length_ft": the SECOND printed dimension in decimal feet,
      "has_private_bath": bedrooms only, true or false (see rule 5)
    }
  ],
  "total_sqft": total square footage, only if printed on the image,
  "beds": number of bedrooms, if printed or clearly countable,
  "baths": number of bathrooms, if printed or clearly countable (0.5 for a half bath)
}

Rules:
1. Include every labeled space: bedrooms, bathrooms, kitchen, living/dining, every closet (including tiny ones labeled only "C" or "CL"), pantry, laundry, storage, foyer/entry, balconies/terraces. List each occurrence separately (three closets labeled "C" = three entries). Do not invent rooms for unlabeled areas such as hallways. Appliance or fixture labels (REF, DW, W, D, W/D, range, etc.) are not rooms.
2. label_center must sit on the room's name text. If the name wraps onto two lines (e.g. "Living Room/" above "Dining Room"), use the center of both lines together. Text may be rotated 90 degrees; still give its center.
3. Classify by function, keep the printed name. Some buildings use marketing names, e.g. GATHER = living, DREAM = bedroom, CREATE = kitchen, REFRESH = bathroom, STYLE = walk-in closet (type "closet"), BREATHE = balcony, C or CL = closet. Pantry = closet. Laundry, storage, den, office = other. Entry or foyer = foyer. A combined "Living/Dining" room = living. For any unfamiliar name, decide from the fixtures and context (bed-sized room with a closet = bedroom, tub/toilet/sink = bathroom, stove/sink/fridge = kitchen).
4. Dimensions: only use dimensions printed for that room. Convert feet-inches to decimal feet with 2 decimals, keeping the printed order: 17'10" -> 17.83, 10'10" -> 10.83, 12'6" -> 12.5, 7-1/2' -> 7.5, 11'3"w x 11'1"h -> 11.25 and 11.08.
5. has_private_bath: trace the doors. It is true when the bedroom has its own bathroom: the bathroom door opens into the bedroom itself, or into a small vestibule / dressing area / closet zone that is open to that bedroom (no door between them) and is separated from the rest of the apartment by a door, so bedroom + bathroom form a private suite. It is false when the bathroom is entered from a hallway, foyer or living area that other rooms also use.
6. If something is not visible, omit it. Never estimate total_sqft.
"""

RETRY_SUFFIX = """

Your previous reply could not be used: {error}
Reply again with ONLY the JSON object described above."""
