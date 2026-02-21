from collections import defaultdict
from threading import Lock
import re

_metrics_lock = Lock()
_counters: dict[str, dict[tuple[tuple[str, str], ...], int]] = defaultdict(dict)


def _normalize_labels(labels: dict[str, str] | None) -> tuple[tuple[str, str], ...]:
    if not labels:
        return tuple()
    return tuple(sorted((str(k), str(v)) for k, v in labels.items()))


def increment_counter(name: str, value: int = 1, **labels: str) -> None:
    key = _normalize_labels(labels)
    with _metrics_lock:
        current = _counters[name].get(key, 0)
        _counters[name][key] = current + int(value)


def snapshot_metrics() -> dict[str, list[dict]]:
    with _metrics_lock:
        result: dict[str, list[dict]] = {}
        for metric_name, items in _counters.items():
            result[metric_name] = [
                {"labels": {k: v for k, v in label_key}, "value": value}
                for label_key, value in items.items()
            ]
        return result


def _sanitize_metric_name(name: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9_:]", "_", name)
    if not re.match(r"^[a-zA-Z_:]", clean):
        clean = f"metric_{clean}"
    return clean


def _escape_label_value(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def prometheus_text() -> str:
    lines: list[str] = []
    with _metrics_lock:
        for raw_name, items in sorted(_counters.items(), key=lambda x: x[0]):
            name = _sanitize_metric_name(raw_name)
            lines.append(f"# TYPE {name} counter")
            for label_key, value in items.items():
                if label_key:
                    labels = ",".join(f'{k}="{_escape_label_value(v)}"' for k, v in label_key)
                    lines.append(f"{name}{{{labels}}} {int(value)}")
                else:
                    lines.append(f"{name} {int(value)}")
    return "\n".join(lines) + "\n"
