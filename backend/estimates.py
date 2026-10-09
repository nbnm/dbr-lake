from dataclasses import dataclass
from statistics import median, quantiles
from .models import Estimate

DAY_MS = 86_400_000


@dataclass(frozen=True)
class HistoricalAttempt:
    signature: str
    ended_at: int
    duration_ms: int
    result: str = "succeeded"


def estimate_duration(history: list[HistoricalAttempt], signature: str, launch_at: int,
                      version: str, fallback_ms: int | None = None) -> Estimate:
    """Only comparable successes known before launch enter the frozen cohort."""
    cohort = sorted((h for h in history if h.signature == signature
                     and h.result == "succeeded" and h.duration_ms > 0
                     and launch_at - 30 * DAY_MS <= h.ended_at < launch_at),
                    key=lambda h: h.ended_at, reverse=True)[:20]
    count = len(cohort)
    if count < 5:
        return Estimate(predicted_duration_ms=fallback_ms, sample_count=count,
                        confidence="low" if fallback_ms is not None else "unknown", version=version)
    durations = [h.duration_ms for h in cohort]
    q1, _, q3 = quantiles(durations, n=4, method="inclusive")
    return Estimate(predicted_duration_ms=int(median(durations)), sample_count=count,
                    q1_ms=int(q1), q3_ms=int(q3), confidence="historical", version=version)
