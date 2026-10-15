"""Eight fictional student profiles (sample data, not real people) for the demo.

Answers use the questionnaire's exact option strings (tests/test_roommates.py checks every value
against questionnaire.py). Write them with:  .venv/bin/python scripts/seed_roommates.py
"""
from __future__ import annotations

import copy

BASE = {
    "living": {
        "city": "Boston", "neighborhood": "", "occupation": "Student", "gender": "Prefer not to say",
        "move_in_date": "1–3 months", "lease_type": "1-year lease", "budget_min": 1000, "budget_max": 1500,
        "budget_flexibility": "Can flex up to ~$100", "room_type": "Private room", "bathroom_preference": "No preference",
        "roommate_gender": "No preference", "pets": "I love pets but don't have any",
        "smoking": "Non-smoking household only", "drinking": "Socially",
    },
    "financial": {
        "utilities_split": "Split equally", "groceries_split": "Split basics (condiments, cleaning)",
        "security_deposit": "Yes, up to 1 month's rent", "payment_style": "Shared app (Splitwise, etc.)",
    },
    "routines": {
        "sleep_schedule": "Somewhere in between", "wake_time": "6am–8am", "cooking_habits": "A few times a week",
        "kitchen_sharing": "No strong preference", "bathroom_time": "15–30 minutes", "common_space_usage": "Balanced use",
        "cleanliness": 3, "cleaning_schedule": "Rotating chore chart",
    },
    "social": {
        "noise_level": "Occasional friends over (weekends)", "overnight_guests": "Occasionally (once a month or less)",
        "guest_notice": "Always give notice", "parties": "Small gatherings only (< 10 people)", "introvert_extrovert": 3,
    },
    "lifestyle": {
        "work_from_home": "Hybrid (a few days a week)", "quiet_hours_needed": "Occasionally — a few times a week",
        "schedule_predictability": "Mostly consistent with some variation",
        "temperature_preference": "Moderate (68–72°F / 20–22°C)", "hobbies": "", "lifestyle_notes": "",
    },
    "personality": {
        "conflict_style": "Cool off first, then discuss", "communication_style": "Group chat / text for everything",
        "roommate_relationship": "Friendly but independent",
    },
    "dealbreakers": {"non_negotiables": ["No smoking indoors"], "top_priorities": [], "flexible_on": [], "custom_dealbreaker": ""},
}


def _q(**sections: dict) -> dict:
    q = copy.deepcopy(BASE)
    for name, values in sections.items():
        q[name].update(values)
    return q


PROFILES = [
    {
        "id": "priya", "name": "Priya Sharma", "school": "Northeastern University", "program": "MS Data Science",
        "hometown": "Pune, India", "color": "#0d9488",
        "bio": "Second-year data science student. Cooks most nights, likes a tidy kitchen and quiet weeknights.",
        "furniture": ["queen_bed", "desk", "dresser"],
        "questionnaire": _q(
            living={"neighborhood": "Fenway / Mission Hill", "gender": "Woman", "budget_min": 1100, "budget_max": 1450,
                    "bathroom_preference": "Shared with 1 person"},
            routines={"cooking_habits": "Daily — I cook most meals", "kitchen_sharing": "Happy to share and cook together sometimes",
                      "cleanliness": 4},
            lifestyle={"hobbies": "Cooking South Indian food, badminton, sketching",
                       "lifestyle_notes": "Vegetarian. I call my family in India late in the evening."},
            dealbreakers={"non_negotiables": ["No smoking indoors", "Non-smoking household only"],
                          "top_priorities": ["Similar cleanliness standards", "Respectful of quiet/work time", "Budget compatibility"],
                          "flexible_on": ["Move-in date", "Chore split style", "Grocery arrangement"]},
        ),
    },
    {
        "id": "ananya", "name": "Ananya Iyer", "school": "Boston University", "program": "MS Biomedical Engineering",
        "hometown": "Chennai, India", "color": "#7c3aed",
        "bio": "Lab mornings, early nights, vegetarian cook. Looking for calm, clean roommates.",
        "furniture": ["full_bed", "desk", "bookshelf"],
        "questionnaire": _q(
            living={"neighborhood": "Fenway / Kenmore", "gender": "Woman", "budget_min": 1000, "budget_max": 1400,
                    "pets": "No pets please", "drinking": "Never"},
            routines={"sleep_schedule": "Early bird (sleep before 10pm)", "cooking_habits": "Daily — I cook most meals",
                      "kitchen_sharing": "Happy to share and cook together sometimes", "bathroom_time": "Under 15 minutes",
                      "cleanliness": 4},
            social={"noise_level": "Very quiet, minimal guests", "overnight_guests": "Never / very rarely",
                    "parties": "Rarely, and with advance notice", "introvert_extrovert": 2},
            lifestyle={"work_from_home": "No, I go to office/school daily", "quiet_hours_needed": "Rarely, headphones handle it",
                       "schedule_predictability": "Very consistent — same routine daily",
                       "hobbies": "Carnatic music, running along the Charles", "lifestyle_notes": "Vegetarian, early lab hours."},
            dealbreakers={"non_negotiables": ["No smoking indoors", "No pets"],
                          "top_priorities": ["Similar cleanliness standards", "Compatible sleep schedule", "Honest communication style"],
                          "flexible_on": ["Lease length", "Chore split style", "Temperature preference"]},
        ),
    },
    {
        "id": "meera", "name": "Meera Patel", "school": "Northeastern University", "program": "MS Computer Science",
        "hometown": "Ahmedabad, India", "color": "#db2777",
        "bio": "On a 6-month co-op from January, so she wants a shorter lease. Hackathons, bouldering, friends over on weekends.",
        "furniture": ["queen_bed", "desk", "bookshelf"],
        "questionnaire": _q(
            living={"neighborhood": "Fenway / Mission Hill", "gender": "Woman", "budget_min": 1300, "budget_max": 1650,
                    "budget_flexibility": "Fairly flexible if the fit is right", "move_in_date": "Within 1 month",
                    "lease_type": "6-month lease"},
            routines={"sleep_schedule": "Night owl (sleep after midnight)", "wake_time": "8am–10am",
                      "cleaning_schedule": "Clean as you go / whoever notices"},
            social={"noise_level": "Social and lively, guests often", "overnight_guests": "Regularly (weekly)",
                    "guest_notice": "No strong opinion", "introvert_extrovert": 4},
            lifestyle={"hobbies": "Hackathons, bouldering, Bollywood dance",
                       "lifestyle_notes": "Late nights before deadlines; friends over most weekends."},
            dealbreakers={"non_negotiables": ["Non-smoking household only"],
                          "top_priorities": ["Matching social energy", "Location match", "Honest communication style"],
                          "flexible_on": ["Noise levels", "Guest frequency", "Chore split style"]},
        ),
    },
    {
        "id": "arjun", "name": "Arjun Reddy", "school": "MIT", "program": "PhD EECS",
        "hometown": "Hyderabad, India", "color": "#2563eb",
        "bio": "Third-year PhD, researches from home. Needs quiet afternoons for advisor calls.",
        "furniture": ["queen_bed", "desk"],
        "questionnaire": _q(
            living={"neighborhood": "Fenway", "gender": "Man", "budget_min": 1200, "budget_max": 1500},
            routines={"sleep_schedule": "Night owl (sleep after midnight)", "wake_time": "8am–10am"},
            social={"noise_level": "Very quiet, minimal guests", "parties": "Rarely, and with advance notice", "introvert_extrovert": 2},
            lifestyle={"work_from_home": "Yes, full-time remote", "quiet_hours_needed": "Yes, I'm on calls frequently during the day",
                       "hobbies": "Chess, weekend cricket, cooking biryani",
                       "lifestyle_notes": "Advisor calls most afternoons; I need quiet from 1 to 5pm on weekdays."},
            dealbreakers={"non_negotiables": ["No smoking indoors", "No parties ever"],
                          "top_priorities": ["Respectful of quiet/work time", "Similar cleanliness standards", "Budget compatibility"],
                          "flexible_on": ["Grocery arrangement", "Temperature preference", "Move-in date"]},
        ),
    },
    {
        "id": "sofia", "name": "Sofia Alvarez", "school": "Boston University", "program": "MBA",
        "hometown": "Bogotá, Colombia", "color": "#ea580c",
        "bio": "MBA student, salsa and brunch person. Social, tidy, partner visits on Fridays.",
        "furniture": ["queen_bed", "dresser", "nightstand"],
        "questionnaire": _q(
            living={"neighborhood": "Fenway", "gender": "Woman", "budget_min": 1400, "budget_max": 1800,
                    "budget_flexibility": "Can flex up to ~$200"},
            routines={"cleanliness": 4},
            social={"noise_level": "Balance of both — depends on the week", "overnight_guests": "Regularly (weekly)",
                    "introvert_extrovert": 4},
            lifestyle={"work_from_home": "No, I go to office/school daily", "hobbies": "Salsa, running, brunch spots",
                       "lifestyle_notes": "My partner stays over most Fridays."},
            dealbreakers={"non_negotiables": ["No smoking indoors"],
                          "top_priorities": ["Honest communication style", "Matching social energy", "Similar cleanliness standards"],
                          "flexible_on": ["Guest frequency", "Noise levels", "Grocery arrangement"]},
        ),
    },
    {
        "id": "rohan", "name": "Rohan Mehta", "school": "Harvard Kennedy School", "program": "Master in Public Policy",
        "hometown": "Delhi, India", "color": "#16a34a",
        "bio": "Policy student on a fixed stipend. Early riser, cooks daily, out at school most days.",
        "furniture": ["queen_bed", "desk", "bookshelf"],
        "questionnaire": _q(
            living={"neighborhood": "Fenway", "gender": "Man", "budget_min": 1100, "budget_max": 1400,
                    "budget_flexibility": "Hard limit — cannot go over"},
            routines={"sleep_schedule": "Early bird (sleep before 10pm)", "cooking_habits": "Daily — I cook most meals", "cleanliness": 4},
            social={"overnight_guests": "Never / very rarely", "parties": "Rarely, and with advance notice"},
            lifestyle={"work_from_home": "No, I go to office/school daily", "quiet_hours_needed": "Rarely, headphones handle it",
                       "hobbies": "Debate club, squash, podcasts", "lifestyle_notes": "Out at the Kennedy School most days."},
            dealbreakers={"non_negotiables": ["No smoking indoors", "Budget hard cap (cannot exceed max)"],
                          "top_priorities": ["Budget compatibility", "Similar cleanliness standards", "Respectful of quiet/work time"],
                          "flexible_on": ["Move-in date", "Lease length", "Grocery arrangement"]},
        ),
    },
    {
        "id": "jake", "name": "Jake Thompson", "school": "Berklee College of Music", "program": "BM Music Performance",
        "hometown": "Austin, TX", "color": "#ca8a04",
        "bio": "Guitarist. Practices at home in the evenings, plays late gigs, loves having people over.",
        "furniture": ["full_bed", "desk", {"name": "Keyboard stand", "w": 54, "d": 18, "h": 30}],
        "questionnaire": _q(
            living={"neighborhood": "Fenway / Back Bay", "gender": "Man", "budget_min": 1150, "budget_max": 1500,
                    "budget_flexibility": "Hard limit — cannot go over", "smoking": "I smoke", "drinking": "Regularly"},
            routines={"sleep_schedule": "Night owl (sleep after midnight)", "wake_time": "After 10am",
                      "cooking_habits": "Rarely, mostly takeout/delivery", "cleanliness": 2,
                      "cleaning_schedule": "Clean as you go / whoever notices"},
            social={"noise_level": "Social and lively, guests often", "overnight_guests": "Regularly (weekly)",
                    "guest_notice": "Prefer spontaneous — it's a shared home", "parties": "Yes, I'd love that", "introvert_extrovert": 5},
            lifestyle={"work_from_home": "Varies by week", "quiet_hours_needed": "No, not an issue",
                       "schedule_predictability": "Quite unpredictable / shift work", "hobbies": "Guitar, open mics, vinyl",
                       "lifestyle_notes": "I practice guitar at home most evenings and play late gigs."},
            dealbreakers={"non_negotiables": ["Budget hard cap (cannot exceed max)"],
                          "top_priorities": ["Matching social energy", "Similar guest/party preferences", "Location match"],
                          "flexible_on": ["Chore split style", "Temperature preference", "Lease length"]},
        ),
    },
    {
        "id": "kavya", "name": "Kavya Nair", "school": "MIT", "program": "MS Mechanical Engineering",
        "hometown": "Kochi, India", "color": "#0891b2",
        "bio": "Robotics club, rock climbing, spotless kitchen. On a tight, fixed budget.",
        "furniture": ["twin_bed", "desk", "bookshelf"],
        "questionnaire": _q(
            living={"neighborhood": "Cambridgeport or Fenway", "gender": "Woman", "budget_min": 900, "budget_max": 1250,
                    "budget_flexibility": "Hard limit — cannot go over", "pets": "Allergic to pets", "drinking": "Never"},
            routines={"sleep_schedule": "Early bird (sleep before 10pm)", "wake_time": "Before 6am",
                      "cooking_habits": "Daily — I cook most meals", "cleanliness": 5},
            social={"noise_level": "Very quiet, minimal guests", "overnight_guests": "Never / very rarely",
                    "parties": "No parties please", "introvert_extrovert": 2},
            lifestyle={"work_from_home": "No, I go to office/school daily", "hobbies": "Kathakali, rock climbing, robotics club",
                       "lifestyle_notes": "Strict vegetarian kitchen."},
            dealbreakers={"non_negotiables": ["Budget hard cap (cannot exceed max)", "No pets"],
                          "top_priorities": ["Similar cleanliness standards", "Budget compatibility", "Compatible sleep schedule"],
                          "flexible_on": ["Lease length", "Move-in date"]},
        ),
    },
]

for _p in PROFILES:
    _p["sample"] = True
