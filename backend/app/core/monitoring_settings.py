from threading import Lock

_lock = Lock()

_settings: dict[str, float] = {
    "warn_error_delta": 1.0,
    "warn_error_rate": 3.0,
    "crit_error_delta": 3.0,
    "crit_error_rate": 10.0,
}


def get_monitoring_settings() -> dict[str, float]:
    with _lock:
        return dict(_settings)


def update_monitoring_settings(
    *,
    warn_error_delta: float,
    warn_error_rate: float,
    crit_error_delta: float,
    crit_error_rate: float,
) -> dict[str, float]:
    if warn_error_delta < 0 or warn_error_rate < 0 or crit_error_delta < 0 or crit_error_rate < 0:
        raise ValueError("Threshold values must be non-negative")
    with _lock:
        _settings["warn_error_delta"] = float(warn_error_delta)
        _settings["warn_error_rate"] = float(warn_error_rate)
        _settings["crit_error_delta"] = float(crit_error_delta)
        _settings["crit_error_rate"] = float(crit_error_rate)
        return dict(_settings)

