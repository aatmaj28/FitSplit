"""The listing amenity vocabulary, in the words renters filter on (Zillow / Apartments.com style).

`filter`: we treat it as a common renter search filter, for the "matches N more common renter
filters" insight. That flag is our curated judgement of which tags those sites let renters filter
on, not a measured statistic."""
from __future__ import annotations

AMENITIES: list[dict] = [
    # kitchen
    {"id": "dishwasher", "label": "Dishwasher", "group": "Kitchen", "filter": True},
    {"id": "stainless_appliances", "label": "Stainless steel appliances", "group": "Kitchen", "filter": True},
    {"id": "gas_stove", "label": "Gas stove", "group": "Kitchen", "filter": True},
    {"id": "electric_stove", "label": "Electric stove", "group": "Kitchen", "filter": False},
    {"id": "microwave", "label": "Microwave", "group": "Kitchen", "filter": True},
    {"id": "refrigerator", "label": "Refrigerator", "group": "Kitchen", "filter": True},
    {"id": "garbage_disposal", "label": "Garbage disposal", "group": "Kitchen", "filter": True},
    {"id": "stone_counters", "label": "Granite / quartz counters", "group": "Kitchen", "filter": True},
    {"id": "kitchen_island", "label": "Kitchen island", "group": "Kitchen", "filter": True},
    {"id": "renovated_kitchen", "label": "Renovated kitchen", "group": "Kitchen", "filter": False},
    # laundry
    {"id": "in_unit_laundry", "label": "In-unit washer & dryer", "group": "Laundry", "filter": True},
    {"id": "washer_dryer_hookups", "label": "Washer / dryer hookups", "group": "Laundry", "filter": True},
    # climate
    {"id": "central_ac", "label": "Central air", "group": "Heating & cooling", "filter": True},
    {"id": "window_ac", "label": "Window AC unit", "group": "Heating & cooling", "filter": True},
    {"id": "ceiling_fan", "label": "Ceiling fan", "group": "Heating & cooling", "filter": True},
    {"id": "radiator_heat", "label": "Radiator heat", "group": "Heating & cooling", "filter": False},
    {"id": "fireplace", "label": "Fireplace", "group": "Heating & cooling", "filter": True},
    # floors and interior
    {"id": "hardwood_floors", "label": "Hardwood floors", "group": "Interior", "filter": True},
    {"id": "carpet", "label": "Carpet", "group": "Interior", "filter": True},
    {"id": "tile_floors", "label": "Tile floors", "group": "Interior", "filter": False},
    {"id": "high_ceilings", "label": "High ceilings", "group": "Interior", "filter": True},
    {"id": "natural_light", "label": "Lots of natural light", "group": "Interior", "filter": False},
    {"id": "walk_in_closet", "label": "Walk-in closet", "group": "Interior", "filter": True},
    {"id": "exposed_brick", "label": "Exposed brick", "group": "Interior", "filter": False},
    {"id": "recessed_lighting", "label": "Recessed lighting", "group": "Interior", "filter": False},
    {"id": "furnished", "label": "Furnished", "group": "Interior", "filter": True},
    # bathroom
    {"id": "bathtub", "label": "Bathtub", "group": "Bathroom", "filter": True},
    {"id": "walk_in_shower", "label": "Walk-in shower", "group": "Bathroom", "filter": False},
    {"id": "double_vanity", "label": "Double vanity", "group": "Bathroom", "filter": False},
    {"id": "renovated_bathroom", "label": "Renovated bathroom", "group": "Bathroom", "filter": False},
    # outdoor
    {"id": "balcony", "label": "Balcony / patio", "group": "Outdoor", "filter": True},
]
BY_ID = {a["id"]: a for a in AMENITIES}
ROOM_TYPES = ("kitchen", "bedroom", "bathroom", "living", "dining", "hallway", "closet", "balcony", "laundry", "entry", "other")
FLOORING = ("hardwood", "laminate", "tile", "carpet", "vinyl", "concrete", "stone", "unknown")
OBJECTS = ("door", "window", "fridge", "stove", "oven", "dishwasher", "microwave", "sink", "toilet", "bathtub", "shower",
           "kitchen counter", "bed", "sofa", "dining table", "desk", "washer", "dryer", "radiator", "ceiling fan", "closet door")
