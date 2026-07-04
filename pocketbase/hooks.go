package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"

	"github.com/pocketbase/pocketbase/core"
)

// Cross-post noteworthy discoveries to another spoke (e.g. Saily's Daily
// Transit feed), following the ecosystem's service-to-service pattern:
// direct HTTP POST, X-Internal-Api-Key auth, idempotent payload keyed by
// (userId, anomalyId). No-op unless both env vars are configured.
//
//	SAILY_PB_URL           e.g. https://signal-k-saily.fly.dev
//	SAILY_INTERNAL_API_KEY shared secret expected by the receiver
func registerHooks(app core.App) {
	app.OnRecordAfterCreateSuccess("takeon_discoveries").BindFunc(func(e *core.RecordEvent) error {
		target := os.Getenv("SAILY_PB_URL")
		key := os.Getenv("SAILY_INTERNAL_API_KEY")
		if target == "" || key == "" {
			return e.Next()
		}

		rec := e.Record
		payload := map[string]any{
			// Stable idempotency key so redelivery never double-posts.
			"sourceId": rec.GetString("userId") + ":" + rec.GetString("anomalyId"),
			"source":   "takeon",
			"userId":   rec.GetString("userId"),
			"bodyId":   rec.GetString("bodyId"),
			"type":     rec.GetString("type"),
			"name":     rec.GetString("name"),
		}
		go func() {
			body, err := json.Marshal(payload)
			if err != nil {
				return
			}
			req, err := http.NewRequest(http.MethodPost, target+"/api/saily/ecosystem-events", bytes.NewReader(body))
			if err != nil {
				return
			}
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Internal-Api-Key", key)
			resp, err := httpClient.Do(req)
			if err != nil {
				app.Logger().Warn("takeon: discovery cross-post failed", "error", err)
				return
			}
			defer resp.Body.Close()
			if resp.StatusCode >= 300 {
				app.Logger().Warn("takeon: discovery cross-post rejected", "status", resp.StatusCode)
				return
			}
			// Mark as posted (best-effort; uniqueness on the receiver is the real guard).
			rec.Set("crossPosted", true)
			_ = app.Save(rec)
		}()
		return e.Next()
	})
}
