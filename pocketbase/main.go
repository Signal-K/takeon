// TakeOn spoke backend — PocketBase instance owning rover-game data.
//
// Hub-and-spoke: identity lives on the shared Star Sailors backend
// (SHARED_PB_URL); this service verifies JWTs by delegation and owns only
// game data. Runs on port 8094 by default:
//
//	go run . serve --http 0.0.0.0:8094
//
// Env:
//
//	SHARED_PB_URL           shared backend base URL (default http://127.0.0.1:8090)
//	TAKEON_ALLOW_ANON=true  accept unauthenticated players as user "anon" (dev/standalone)
//	SAILY_PB_URL            optional cross-post target for discoveries
//	SAILY_INTERNAL_API_KEY  service key for the cross-post receiver
package main

import (
	_ "embed"
	"encoding/json"
	"log"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/plugins/jsvm"
	"github.com/pocketbase/pocketbase/plugins/migratecmd"
)

//go:embed seed/parts.json
var seedParts []byte

//go:embed seed/bodies.json
var seedBodies []byte

func main() {
	app := pocketbase.New()

	// JS migrations under pb_migrations/ (same convention as Landnam).
	jsvm.MustRegister(app, jsvm.Config{MigrationsDir: "pb_migrations"})
	migratecmd.MustRegister(app, app.RootCmd, migratecmd.Config{
		Automigrate: false,
		Dir:         "pb_migrations",
	})

	registerHooks(app)

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		if err := seedCatalog(app); err != nil {
			log.Printf("takeon: catalog seed failed: %v", err)
		}
		registerRoutes(app, se)
		return se.Next()
	})

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}

// seedCatalog upserts the built-in part/body catalog (exported from
// @takeon/engine via scripts/export-catalog.mjs) into the catalog
// collections. Idempotent by partId/bodyId; server-side edits to other
// columns are preserved only for rows not present in the seed.
func seedCatalog(app core.App) error {
	var parts []map[string]any
	if err := json.Unmarshal(seedParts, &parts); err != nil {
		return err
	}
	partsCol, err := app.FindCollectionByNameOrId("takeon_parts")
	if err != nil {
		return err
	}
	for _, p := range parts {
		id, _ := p["id"].(string)
		rec, ferr := app.FindFirstRecordByFilter("takeon_parts", "partId = {:pid}", dbx.Params{"pid": id})
		if ferr != nil || rec == nil {
			rec = core.NewRecord(partsCol)
			rec.Set("partId", id)
		}
		rec.Set("category", p["category"])
		rec.Set("name", p["name"])
		rec.Set("tier", p["tier"])
		rec.Set("mass", p["mass"])
		rec.Set("cost", p["cost"])
		rec.Set("description", p["description"])
		rec.Set("stats", p["stats"])
		if err := app.Save(rec); err != nil {
			return err
		}
	}

	var bodies []map[string]any
	if err := json.Unmarshal(seedBodies, &bodies); err != nil {
		return err
	}
	bodiesCol, err := app.FindCollectionByNameOrId("takeon_bodies")
	if err != nil {
		return err
	}
	for _, b := range bodies {
		id, _ := b["id"].(string)
		rec, ferr := app.FindFirstRecordByFilter("takeon_bodies", "bodyId = {:bid}", dbx.Params{"bid": id})
		if ferr != nil || rec == nil {
			rec = core.NewRecord(bodiesCol)
			rec.Set("bodyId", id)
		}
		rec.Set("name", b["name"])
		rec.Set("def", b)
		if err := app.Save(rec); err != nil {
			return err
		}
	}
	return nil
}
