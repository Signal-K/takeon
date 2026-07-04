/// <reference path="../pb_data/types.d.ts" />
//
// TakeOn spoke collections. All gameplay writes go through the Go routes in
// main.go (which verify the shared-backend JWT), so record rules stay locked
// (null = superuser only). Photos are publicly viewable so image files can
// be served without file tokens.

migrate(
  (app) => {
    const collections = [
      new Collection({
        name: 'takeon_profiles',
        type: 'base',
        fields: [
          { name: 'userId', type: 'text', required: true },
          { name: 'credits', type: 'number' },
          { name: 'inventory', type: 'json' },
          { name: 'discoveries', type: 'number' },
          { name: 'created', type: 'autodate', onCreate: true },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE UNIQUE INDEX idx_takeon_profiles_user ON takeon_profiles (userId)'],
      }),
      new Collection({
        name: 'takeon_rovers',
        type: 'base',
        fields: [
          { name: 'userId', type: 'text', required: true },
          { name: 'roverId', type: 'text', required: true },
          { name: 'name', type: 'text' },
          { name: 'spec', type: 'json', required: true },
          { name: 'created', type: 'autodate', onCreate: true },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE UNIQUE INDEX idx_takeon_rovers_rid ON takeon_rovers (roverId)'],
      }),
      new Collection({
        name: 'takeon_missions',
        type: 'base',
        fields: [
          { name: 'userId', type: 'text', required: true },
          { name: 'missionId', type: 'text', required: true },
          { name: 'bodyId', type: 'text', required: true },
          { name: 'roverName', type: 'text' },
          { name: 'status', type: 'text' },
          { name: 'state', type: 'json', required: true, maxSize: 2000000 },
          { name: 'created', type: 'autodate', onCreate: true },
          { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
        ],
        indexes: ['CREATE UNIQUE INDEX idx_takeon_missions_mid ON takeon_missions (missionId)'],
      }),
      new Collection({
        name: 'takeon_photos',
        type: 'base',
        listRule: '',
        viewRule: '',
        fields: [
          { name: 'userId', type: 'text', required: true },
          { name: 'missionId', type: 'text' },
          { name: 'photoId', type: 'text', required: true },
          { name: 'meta', type: 'json' },
          {
            name: 'image',
            type: 'file',
            maxSelect: 1,
            maxSize: 2000000,
            mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
          },
          { name: 'created', type: 'autodate', onCreate: true },
        ],
        indexes: ['CREATE UNIQUE INDEX idx_takeon_photos_pid ON takeon_photos (photoId)'],
      }),
      new Collection({
        name: 'takeon_discoveries',
        type: 'base',
        fields: [
          { name: 'userId', type: 'text', required: true },
          { name: 'missionId', type: 'text' },
          { name: 'bodyId', type: 'text', required: true },
          { name: 'anomalyId', type: 'text', required: true },
          { name: 'type', type: 'text' },
          { name: 'name', type: 'text' },
          { name: 'pos', type: 'json' },
          { name: 'crossPosted', type: 'bool' },
          { name: 'created', type: 'autodate', onCreate: true },
        ],
        indexes: [
          'CREATE UNIQUE INDEX idx_takeon_disc_unique ON takeon_discoveries (userId, anomalyId)',
        ],
      }),
      new Collection({
        name: 'takeon_parts',
        type: 'base',
        listRule: '',
        viewRule: '',
        fields: [
          { name: 'partId', type: 'text', required: true },
          { name: 'category', type: 'text', required: true },
          { name: 'name', type: 'text', required: true },
          { name: 'tier', type: 'number' },
          { name: 'mass', type: 'number' },
          { name: 'cost', type: 'number' },
          { name: 'description', type: 'text' },
          { name: 'stats', type: 'json' },
        ],
        indexes: ['CREATE UNIQUE INDEX idx_takeon_parts_pid ON takeon_parts (partId)'],
      }),
      new Collection({
        name: 'takeon_bodies',
        type: 'base',
        listRule: '',
        viewRule: '',
        fields: [
          { name: 'bodyId', type: 'text', required: true },
          { name: 'name', type: 'text', required: true },
          { name: 'def', type: 'json', required: true },
        ],
        indexes: ['CREATE UNIQUE INDEX idx_takeon_bodies_bid ON takeon_bodies (bodyId)'],
      }),
    ];

    for (const c of collections) {
      app.save(c);
    }
  },
  (app) => {
    for (const name of [
      'takeon_profiles',
      'takeon_rovers',
      'takeon_missions',
      'takeon_photos',
      'takeon_discoveries',
      'takeon_parts',
      'takeon_bodies',
    ]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        // already gone
      }
    }
  },
);
