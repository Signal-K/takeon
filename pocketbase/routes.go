package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// Gameplay economy constants — must mirror packages/engine/src/net/sync.ts.
const (
	startingCredits        = 1600
	discoveryCredits       = 120
	photoCreditsPerQuality = 2
)

var resourceValue = map[string]float64{
	"regolith": 1, "stone": 2, "ice": 4, "iron": 5, "silica": 4,
	"copper": 6, "titanium": 10, "crystal": 25, "sulfur": 5,
	"iron-plate": 14, "glass": 11, "water": 10, "alloy": 32,
}

type missionStateLite struct {
	ID     string `json:"id"`
	BodyID string `json:"bodyId"`
	Status string `json:"status"`
	Rover  struct {
		Cargo map[string]float64 `json:"cargo"`
		Spec  struct {
			Name string `json:"name"`
		} `json:"spec"`
	} `json:"rover"`
	Anomalies []struct {
		Documented bool `json:"documented"`
	} `json:"anomalies"`
	Photos []struct {
		Quality float64 `json:"quality"`
	} `json:"photos"`
}

func registerRoutes(app core.App, se *core.ServeEvent) {
	g := se.Router.Group("/api/takeon")

	g.GET("/health", func(e *core.RequestEvent) error {
		return e.JSON(http.StatusOK, map[string]any{"ok": true, "service": "takeon"})
	})

	g.GET("/catalog", func(e *core.RequestEvent) error {
		parts, err := app.FindRecordsByFilter("takeon_parts", "1=1", "category,tier", 500, 0)
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		bodies, err := app.FindRecordsByFilter("takeon_bodies", "1=1", "name", 200, 0)
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		partOut := make([]map[string]any, 0, len(parts))
		for _, p := range parts {
			partOut = append(partOut, map[string]any{
				"id":          p.GetString("partId"),
				"category":    p.GetString("category"),
				"name":        p.GetString("name"),
				"tier":        p.GetInt("tier"),
				"mass":        p.GetFloat("mass"),
				"cost":        p.GetFloat("cost"),
				"description": p.GetString("description"),
				"stats":       p.Get("stats"),
			})
		}
		bodyOut := make([]any, 0, len(bodies))
		for _, b := range bodies {
			bodyOut = append(bodyOut, b.Get("def"))
		}
		return e.JSON(http.StatusOK, map[string]any{"parts": partOut, "bodies": bodyOut})
	})

	g.GET("/profile", func(e *core.RequestEvent) error {
		uid := requireUser(e)
		if uid == "" {
			return nil
		}
		p, err := findOrCreateProfile(app, uid)
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, profileJSON(p))
	})

	g.GET("/rovers", func(e *core.RequestEvent) error {
		uid := requireUser(e)
		if uid == "" {
			return nil
		}
		recs, err := app.FindRecordsByFilter("takeon_rovers", "userId = {:uid}", "-updated", 100, 0, dbx.Params{"uid": uid})
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		out := make([]any, 0, len(recs))
		for _, r := range recs {
			out = append(out, r.Get("spec"))
		}
		return e.JSON(http.StatusOK, out)
	})

	g.POST("/rovers", func(e *core.RequestEvent) error {
		uid := requireUser(e)
		if uid == "" {
			return nil
		}
		var spec map[string]any
		if err := e.BindBody(&spec); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "invalid spec body"})
		}
		id, _ := spec["id"].(string)
		if id == "" {
			id = fmt.Sprintf("rov_%s", core.GenerateDefaultRandomId())
			spec["id"] = id
		}
		name, _ := spec["name"].(string)
		rec, err := app.FindFirstRecordByFilter("takeon_rovers", "roverId = {:rid}", dbx.Params{"rid": id})
		if err != nil || rec == nil {
			col, cerr := app.FindCollectionByNameOrId("takeon_rovers")
			if cerr != nil {
				return e.JSON(http.StatusInternalServerError, map[string]string{"error": cerr.Error()})
			}
			rec = core.NewRecord(col)
			rec.Set("roverId", id)
			rec.Set("userId", uid)
		} else if rec.GetString("userId") != uid {
			return e.JSON(http.StatusForbidden, map[string]string{"error": "not your rover"})
		}
		rec.Set("name", name)
		rec.Set("spec", spec)
		if err := app.Save(rec); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, spec)
	})

	g.DELETE("/rovers/{id}", func(e *core.RequestEvent) error {
		uid := requireUser(e)
		if uid == "" {
			return nil
		}
		rec, err := app.FindFirstRecordByFilter("takeon_rovers", "roverId = {:rid} && userId = {:uid}",
			dbx.Params{"rid": e.Request.PathValue("id"), "uid": uid})
		if err != nil || rec == nil {
			return e.JSON(http.StatusNotFound, map[string]string{"error": "rover not found"})
		}
		if err := app.Delete(rec); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, map[string]bool{"ok": true})
	})

	g.GET("/missions", func(e *core.RequestEvent) error {
		uid := requireUser(e)
		if uid == "" {
			return nil
		}
		recs, err := app.FindRecordsByFilter("takeon_missions", "userId = {:uid}", "-updated", 100, 0, dbx.Params{"uid": uid})
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		out := make([]map[string]any, 0, len(recs))
		for _, r := range recs {
			out = append(out, map[string]any{
				"id":        r.GetString("missionId"),
				"bodyId":    r.GetString("bodyId"),
				"roverName": r.GetString("roverName"),
				"status":    r.GetString("status"),
				"updated":   r.GetDateTime("updated").Unix(),
			})
		}
		return e.JSON(http.StatusOK, out)
	})

	g.GET("/missions/{id}", func(e *core.RequestEvent) error {
		uid := requireUser(e)
		if uid == "" {
			return nil
		}
		rec, err := app.FindFirstRecordByFilter("takeon_missions", "missionId = {:mid} && userId = {:uid}",
			dbx.Params{"mid": e.Request.PathValue("id"), "uid": uid})
		if err != nil || rec == nil {
			return e.JSON(http.StatusNotFound, map[string]string{"error": "mission not found"})
		}
		return e.JSON(http.StatusOK, rec.Get("state"))
	})

	g.POST("/missions", func(e *core.RequestEvent) error {
		uid := requireUser(e)
		if uid == "" {
			return nil
		}
		var body struct {
			State     json.RawMessage `json:"state"`
			RoverName string          `json:"roverName"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "invalid body"})
		}
		var lite missionStateLite
		if err := json.Unmarshal(body.State, &lite); err != nil || lite.ID == "" || lite.BodyID == "" {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "invalid mission state"})
		}
		rec, err := app.FindFirstRecordByFilter("takeon_missions", "missionId = {:mid}", dbx.Params{"mid": lite.ID})
		if err != nil || rec == nil {
			col, cerr := app.FindCollectionByNameOrId("takeon_missions")
			if cerr != nil {
				return e.JSON(http.StatusInternalServerError, map[string]string{"error": cerr.Error()})
			}
			rec = core.NewRecord(col)
			rec.Set("missionId", lite.ID)
			rec.Set("userId", uid)
		} else if rec.GetString("userId") != uid {
			return e.JSON(http.StatusForbidden, map[string]string{"error": "not your mission"})
		}
		rec.Set("bodyId", lite.BodyID)
		rec.Set("roverName", body.RoverName)
		rec.Set("status", lite.Status)
		rec.Set("state", string(body.State))
		if err := app.Save(rec); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, map[string]bool{"ok": true})
	})

	g.POST("/missions/complete", func(e *core.RequestEvent) error {
		uid := requireUser(e)
		if uid == "" {
			return nil
		}
		var body struct {
			State  json.RawMessage    `json:"state"`
			Banked map[string]float64 `json:"banked"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "invalid body"})
		}
		var lite missionStateLite
		if err := json.Unmarshal(body.State, &lite); err != nil || lite.ID == "" {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "invalid mission state"})
		}

		credits := missionCreditsGo(lite, body.Banked)

		profile, err := findOrCreateProfile(app, uid)
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		inv := map[string]float64{}
		_ = profile.UnmarshalJSONField("inventory", &inv)
		for res, qty := range body.Banked {
			inv[res] += qty
		}
		for res, qty := range lite.Rover.Cargo {
			inv[res] += qty
		}
		documented := 0
		for _, a := range lite.Anomalies {
			if a.Documented {
				documented++
			}
		}
		profile.Set("credits", profile.GetFloat("credits")+float64(credits))
		profile.Set("inventory", inv)
		profile.Set("discoveries", profile.GetInt("discoveries")+documented)
		if err := app.Save(profile); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}

		if rec, err := app.FindFirstRecordByFilter("takeon_missions", "missionId = {:mid} && userId = {:uid}",
			dbx.Params{"mid": lite.ID, "uid": uid}); err == nil && rec != nil {
			rec.Set("status", "complete")
			rec.Set("state", string(body.State))
			_ = app.Save(rec)
		}

		return e.JSON(http.StatusOK, map[string]any{"credits": credits})
	})

	g.POST("/photos", func(e *core.RequestEvent) error {
		uid := requireUser(e)
		if uid == "" {
			return nil
		}
		var body struct {
			Meta      map[string]any `json:"meta"`
			DataURL   string         `json:"dataUrl"`
			MissionID string         `json:"missionId"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "invalid body"})
		}
		photoID, _ := body.Meta["id"].(string)
		if photoID == "" {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "meta.id required"})
		}
		if existing, err := app.FindFirstRecordByFilter("takeon_photos", "photoId = {:pid}", dbx.Params{"pid": photoID}); err == nil && existing != nil {
			return e.JSON(http.StatusOK, map[string]bool{"ok": true}) // idempotent re-delivery
		}
		col, err := app.FindCollectionByNameOrId("takeon_photos")
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		rec := core.NewRecord(col)
		rec.Set("userId", uid)
		rec.Set("missionId", body.MissionID)
		rec.Set("photoId", photoID)
		rec.Set("meta", body.Meta)
		if body.DataURL != "" {
			if img, name, err := decodeDataURL(body.DataURL, photoID); err == nil {
				if f, ferr := filesystem.NewFileFromBytes(img, name); ferr == nil {
					rec.Set("image", f)
				}
			}
		}
		if err := app.Save(rec); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, map[string]bool{"ok": true})
	})

	g.POST("/discoveries", func(e *core.RequestEvent) error {
		uid := requireUser(e)
		if uid == "" {
			return nil
		}
		var body struct {
			AnomalyID string         `json:"anomalyId"`
			Type      string         `json:"type"`
			Name      string         `json:"name"`
			BodyID    string         `json:"bodyId"`
			MissionID string         `json:"missionId"`
			Pos       map[string]any `json:"pos"`
		}
		if err := e.BindBody(&body); err != nil || body.AnomalyID == "" || body.BodyID == "" {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "anomalyId and bodyId required"})
		}
		// Idempotent per user+anomaly (both cron-style redelivery and re-photographing).
		if existing, err := app.FindFirstRecordByFilter("takeon_discoveries",
			"anomalyId = {:aid} && userId = {:uid}", dbx.Params{"aid": body.AnomalyID, "uid": uid}); err == nil && existing != nil {
			return e.JSON(http.StatusOK, map[string]bool{"ok": true})
		}
		col, err := app.FindCollectionByNameOrId("takeon_discoveries")
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		rec := core.NewRecord(col)
		rec.Set("userId", uid)
		rec.Set("missionId", body.MissionID)
		rec.Set("bodyId", body.BodyID)
		rec.Set("anomalyId", body.AnomalyID)
		rec.Set("type", body.Type)
		rec.Set("name", body.Name)
		rec.Set("pos", body.Pos)
		if err := app.Save(rec); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, map[string]bool{"ok": true})
	})

	g.POST("/credits/spend", func(e *core.RequestEvent) error {
		uid := requireUser(e)
		if uid == "" {
			return nil
		}
		var body struct {
			Amount float64 `json:"amount"`
		}
		if err := e.BindBody(&body); err != nil || body.Amount < 0 {
			return e.JSON(http.StatusBadRequest, map[string]string{"error": "invalid amount"})
		}
		profile, err := findOrCreateProfile(app, uid)
		if err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		if profile.GetFloat("credits") < body.Amount {
			return e.JSON(http.StatusPaymentRequired, map[string]string{"error": "insufficient credits"})
		}
		profile.Set("credits", profile.GetFloat("credits")-body.Amount)
		if err := app.Save(profile); err != nil {
			return e.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return e.JSON(http.StatusOK, profileJSON(profile))
	})
}

func missionCreditsGo(lite missionStateLite, banked map[string]float64) int {
	total := 0.0
	for res, qty := range banked {
		total += resourceValue[res] * qty
	}
	for res, qty := range lite.Rover.Cargo {
		total += resourceValue[res] * qty
	}
	for _, a := range lite.Anomalies {
		if a.Documented {
			total += discoveryCredits
		}
	}
	for _, p := range lite.Photos {
		total += float64(int(p.Quality*photoCreditsPerQuality + 0.5))
	}
	return int(total)
}

func findOrCreateProfile(app core.App, uid string) (*core.Record, error) {
	rec, err := app.FindFirstRecordByFilter("takeon_profiles", "userId = {:uid}", dbx.Params{"uid": uid})
	if err == nil && rec != nil {
		return rec, nil
	}
	col, err := app.FindCollectionByNameOrId("takeon_profiles")
	if err != nil {
		return nil, err
	}
	rec = core.NewRecord(col)
	rec.Set("userId", uid)
	rec.Set("credits", startingCredits)
	rec.Set("inventory", map[string]float64{})
	rec.Set("discoveries", 0)
	if err := app.Save(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

func profileJSON(p *core.Record) map[string]any {
	return map[string]any{
		"userId":      p.GetString("userId"),
		"credits":     p.GetFloat("credits"),
		"inventory":   p.Get("inventory"),
		"discoveries": p.GetInt("discoveries"),
	}
}

func decodeDataURL(dataURL, photoID string) ([]byte, string, error) {
	const prefix = "data:"
	if !strings.HasPrefix(dataURL, prefix) {
		return nil, "", fmt.Errorf("not a data url")
	}
	comma := strings.IndexByte(dataURL, ',')
	if comma < 0 {
		return nil, "", fmt.Errorf("malformed data url")
	}
	meta := dataURL[len(prefix):comma]
	payload := dataURL[comma+1:]
	if !strings.Contains(meta, "base64") {
		return nil, "", fmt.Errorf("expected base64 data url")
	}
	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return nil, "", err
	}
	if len(raw) > 2_000_000 {
		return nil, "", fmt.Errorf("image too large")
	}
	ext := ".jpg"
	if strings.Contains(meta, "png") {
		ext = ".png"
	} else if strings.Contains(meta, "webp") {
		ext = ".webp"
	}
	return raw, photoID + ext, nil
}
