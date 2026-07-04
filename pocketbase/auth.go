package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

// Hub-and-spoke auth: this spoke never validates JWTs locally. It delegates
// to the shared Star Sailors backend's auth-refresh endpoint (same pattern
// Landnam and Saily use), caching results briefly to keep gameplay routes
// cheap.

const authCacheTTL = 5 * time.Minute

type cachedAuth struct {
	userID string
	expiry time.Time
}

var (
	authCache   = map[string]cachedAuth{}
	authCacheMu sync.Mutex
	httpClient  = &http.Client{Timeout: 8 * time.Second}
)

func sharedBackendURL() string {
	if v := os.Getenv("SHARED_PB_URL"); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "http://127.0.0.1:8090"
}

func allowAnon() bool {
	return os.Getenv("TAKEON_ALLOW_ANON") == "true"
}

// requireUser resolves the calling user's shared-backend id, or replies with
// an error status and returns "".
func requireUser(e *core.RequestEvent) string {
	token := strings.TrimPrefix(e.Request.Header.Get("Authorization"), "Bearer ")
	token = strings.TrimSpace(token)

	if token == "" {
		if allowAnon() {
			return "anon"
		}
		e.JSON(http.StatusUnauthorized, map[string]string{"error": "missing Authorization token"})
		return ""
	}

	authCacheMu.Lock()
	if c, ok := authCache[token]; ok && time.Now().Before(c.expiry) {
		authCacheMu.Unlock()
		return c.userID
	}
	authCacheMu.Unlock()

	uid, err := verifyWithSharedBackend(token)
	if err != nil {
		if allowAnon() {
			return "anon"
		}
		e.JSON(http.StatusUnauthorized, map[string]string{"error": fmt.Sprintf("token rejected: %v", err)})
		return ""
	}

	authCacheMu.Lock()
	if len(authCache) > 4096 { // crude bound; entries are tiny
		authCache = map[string]cachedAuth{}
	}
	authCache[token] = cachedAuth{userID: uid, expiry: time.Now().Add(authCacheTTL)}
	authCacheMu.Unlock()
	return uid
}

func verifyWithSharedBackend(token string) (string, error) {
	req, err := http.NewRequest(http.MethodPost, sharedBackendURL()+"/api/collections/users/auth-refresh", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", token)
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("shared backend unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("shared backend replied %d", resp.StatusCode)
	}
	var body struct {
		Record struct {
			ID string `json:"id"`
		} `json:"record"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", err
	}
	if body.Record.ID == "" {
		return "", fmt.Errorf("no record id in auth-refresh response")
	}
	return body.Record.ID, nil
}
