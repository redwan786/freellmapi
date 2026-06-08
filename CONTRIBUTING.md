# Contributing

Contributions are welcome. Keep changes focused, add tests for behavior changes,
and run the relevant checks before opening a PR.

```bash
npm install
npm run dev
npm test
npm run build
```

## Database Migrations

Schema changes must use file-per-migration files under
`server/src/db/migrations/`. Do not edit old applied migration files.

Always create migrations with the scaffold command:

```bash
npm run db:migration:create --name=add_embedding_index
```

This creates a file like
`server/src/db/migrations/20260615_143022_add_embedding_index.ts` from the
template in `server/src/db/migrate/TEMPLATE.ts`. The timestamp is generated in
UTC by Node.

Use these commands while developing:

```bash
npm run db:migration:status
npm run db:migration:up
npm run db:migration:down
```

Production startup applies pending migrations automatically. Tests auto-run
migrations from `initDb()` so test files can use a fully migrated schema without
calling the migration runner. Local development keeps migration execution
manual; run `npm run db:migration:up` after pulling schema changes.

`db:migration:down` rolls back only the most recently applied migration. It is a
local development tool. Never run it in production, and never run it for a
migration that has already been merged to `main`. If merged work needs to be
reverted, write a new forward migration.

Default model catalog changes belong in migrations. Add, retire, or correct
built-in models with a new forward migration so every install reaches the same
catalog through migration history.

### Reordering Local Migrations

If another contributor merges an older migration while your newer local
migration is already applied:

1. Your local migration is `20260615_143022_my_feature.ts` and is applied.
2. Contributor A's `20260614_090000_their_feature.ts` gets merged to `main`.
3. Run `npm run db:migration:down`; this undoes only your migration.
4. Run `git pull origin main`.
5. Run `npm run db:migration:up`; this applies A's migration.
6. Fix genuine schema conflicts in your migration, then test with `npm run db:migration:up` again.

CI runs a migration round-trip check: all migrations up, 
down to the legacy baseline, then up again. The final schema must match the
first full-up schema.
