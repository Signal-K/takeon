.PHONY: pb-dev

# The takeon-pb backend is a single static Go/PocketBase binary — Docker buys
# nothing for the local inner dev loop and only costs build/image disk space.
# Data lands in pocketbase/pb_data (gitignored).
pb-dev:
	cd pocketbase && SHARED_PB_URL=$${SHARED_PB_URL:-http://localhost:8090} go run . serve --http=0.0.0.0:8094
