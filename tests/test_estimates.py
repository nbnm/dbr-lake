from backend.estimates import DAY_MS, HistoricalAttempt, estimate_duration


def test_only_comparable_recent_successes_known_before_launch_enter_cohort():
    launch = 50 * DAY_MS
    history = [HistoricalAttempt('task:incremental:v1', launch - (i+1)*1000, 100_000+i*1000) for i in range(25)]
    excluded = [HistoricalAttempt('different-mode', launch-1000, 9_999_999),
                HistoricalAttempt('task:incremental:v1', launch-1000, 9_999_999, 'failed'),
                HistoricalAttempt('task:incremental:v1', launch+1000, 9_999_999),
                HistoricalAttempt('task:incremental:v1', launch-31*DAY_MS, 9_999_999)]
    e = estimate_duration(history + excluded, 'task:incremental:v1', launch, 'v1')
    assert e.sample_count == 20
    assert e.predicted_duration_ms == 109_500
    assert e.q1_ms < e.predicted_duration_ms < e.q3_ms


def test_sparse_history_requires_explicit_fallback():
    history = [HistoricalAttempt('task', 100, 9000)]
    e = estimate_duration(history, 'task', 200, 'v1')
    assert e.predicted_duration_ms is None and e.confidence == 'unknown'
    fallback = estimate_duration(history, 'task', 200, 'v1', fallback_ms=60_000)
    assert fallback.confidence == 'low' and fallback.sample_count == 1
    assert fallback.predicted_duration_ms == 60_000
