TRUST_POLICY_CATALOG: dict[str, dict] = {
    "strict": {
        "label": "strict",
        "description": "Код при каждом входе.",
        "code_required": "Да, на каждый вход",
        "duration": "0 дней",
        "risk": "Минимальный риск",
        "color": "#f0a85e",
        "bg": "rgba(240,168,94,0.14)",
    },
    "standard": {
        "label": "standard",
        "description": "Доверие 30 дней.",
        "code_required": "Только при новом устройстве",
        "duration": "30 дней",
        "risk": "Сбалансированно",
        "color": "#64a8c9",
        "bg": "rgba(100,168,201,0.16)",
    },
    "extended": {
        "label": "extended",
        "description": "Доверие 90 дней.",
        "code_required": "Только при новом устройстве",
        "duration": "90 дней",
        "risk": "Выше standard",
        "color": "#56bfd1",
        "bg": "rgba(86,191,209,0.14)",
    },
    "permanent": {
        "label": "permanent",
        "description": "Бессрочное доверие.",
        "code_required": "Только при первом входе",
        "duration": "Бессрочно",
        "risk": "Повышенный риск",
        "color": "#e67f7f",
        "bg": "rgba(230,127,127,0.14)",
    },
}


def trust_policy_catalog_payload() -> dict:
    return {"policies": [TRUST_POLICY_CATALOG[key] for key in ("strict", "standard", "extended", "permanent")]}
