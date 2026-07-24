package main

import (
	"testing"
	"time"
)

// resetWarmState puts the warm-tab circuit breaker back to its zero value.
func resetWarmState(t *testing.T) {
	t.Helper()
	browserMu.Lock()
	warmTabFails = 0
	warmTabPausedAt = time.Time{}
	warmTabCtx, warmTabCancel = nil, nil
	warmTabAt = time.Time{}
	browserMu.Unlock()
}

// A broken warm path must stop being retried. Without this, every lookup pays
// the warm-fetch timeout before falling back — which is precisely how 2.4.0
// ended up SLOWER than the version it replaced.
func TestWarmPathPausesAfterRepeatedFailures(t *testing.T) {
	resetWarmState(t)
	browserMu.Lock()
	defer browserMu.Unlock()

	diag := []string{}
	for i := 0; i < warmTabMaxFails; i++ {
		if !warmPathUsable() {
			t.Fatalf("warm path gave up after %d failures, want %d", i, warmTabMaxFails)
		}
		noteWarmFailure(&diag)
	}
	if warmPathUsable() {
		t.Fatalf("warm path still usable after %d consecutive failures", warmTabMaxFails)
	}
	if len(diag) == 0 {
		t.Error("pausing the fast path should be reported in the lookup diagnostics")
	}
}

// The pause must expire, so a transient outage doesn't disable the fast path
// for the rest of the session.
func TestWarmPathResumesAfterPauseExpires(t *testing.T) {
	resetWarmState(t)
	browserMu.Lock()
	defer browserMu.Unlock()

	diag := []string{}
	for i := 0; i < warmTabMaxFails; i++ {
		noteWarmFailure(&diag)
	}
	if warmPathUsable() {
		t.Fatal("expected the warm path to be paused")
	}
	warmTabPausedAt = time.Now().Add(-warmTabPauseFor - time.Second)
	if !warmPathUsable() {
		t.Error("warm path should resume once the pause window has elapsed")
	}
	if warmTabFails != 0 {
		t.Errorf("resuming should clear the failure streak, got %d", warmTabFails)
	}
}

// A success in between failures must clear the streak, so intermittent
// hiccups never accumulate into a pause.
func TestWarmSuccessClearsFailureStreak(t *testing.T) {
	resetWarmState(t)
	browserMu.Lock()
	defer browserMu.Unlock()

	diag := []string{}
	noteWarmFailure(&diag)
	noteWarmFailure(&diag)
	noteWarmSuccess()
	if warmTabFails != 0 {
		t.Errorf("failure streak = %d after a success, want 0", warmTabFails)
	}
	for i := 0; i < warmTabMaxFails-1; i++ {
		noteWarmFailure(&diag)
	}
	if !warmPathUsable() {
		t.Error("warm path paused too early: a success should have reset the count")
	}
}
