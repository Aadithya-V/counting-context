"""ECI state-code registry and the subset enabled for the dashboard."""

STATES: dict[str, str] = {
    "S01": "Andhra Pradesh",
    "S02": "Arunachal Pradesh",
    "S03": "Assam",
    "S04": "Bihar",
    "S05": "Goa",
    "S06": "Gujarat",
    "S07": "Haryana",
    "S08": "Himachal Pradesh",
    "S09": "Jammu & Kashmir",
    "S10": "Karnataka",
    "S11": "Kerala",
    "S12": "Madhya Pradesh",
    "S13": "Maharashtra",
    "S14": "Manipur",
    "S15": "Meghalaya",
    "S16": "Mizoram",
    "S17": "Nagaland",
    "S18": "Odisha",
    "S19": "Punjab",
    "S20": "Rajasthan",
    "S21": "Sikkim",
    "S22": "Tamil Nadu",
    "S23": "Tripura",
    "S24": "Uttar Pradesh",
    "S25": "West Bengal",
    "S26": "Chhattisgarh",
    "S27": "Jharkhand",
    "S28": "Uttarakhand",
    "S29": "Telangana",
    "U01": "Andaman & Nicobar Islands",
    "U02": "Chandigarh",
    "U03": "Dadra & Nagar Haveli and Daman & Diu",
    "U05": "Delhi",
    "U06": "Lakshadweep",
    "U07": "Puducherry",
    "U08": "Ladakh",
}

# Codes shown in the dashboard dropdown and scraped on the schedule.
ENABLED: tuple[str, ...] = (
    "S22",  # Tamil Nadu
    "S25",  # West Bengal
    "S03",  # Assam
    "U07",  # Puducherry
)


def enabled_states() -> list[dict[str, str]]:
    return [{"code": c, "name": STATES[c]} for c in ENABLED]


def is_enabled(code: str) -> bool:
    return code in ENABLED


def name_for(code: str) -> str:
    return STATES.get(code, code)
