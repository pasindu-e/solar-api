# NB6007CEM: Real-Time Solar Generation Data API
## Development Specification (Express.js + MongoDB), mapped to the marking rubric

Purpose: a single working document that lists every feature to build, how to build it with Express.js and MongoDB, and which rubric dimension it earns marks in. It targets the **First band (70+)** on every dimension.

> The module "REST API Design Guidelines" white paper is not in the uploaded files. Section numbers below come from Appendix A of the brief. Check this spec against the white paper once you have it, especially naming, versioning and error-body rules.

> MongoDB is the chosen database. The brief does not mandate any database. The cost of choosing MongoDB is that **it does not enforce foreign keys**, so integrity is enforced in application code and verified by a script (section 3.4). Defend this honestly in the report.

> **Revision 2 (changes after brief and rubric review).** (1) Unknown query parameters now always return 400 (needed for injection tests). (2) Top-level `/readings` replaced by scoped readings under provinces, districts and grid substations. (3) District summary `as_of` is data-derived so ETag/304 works. (4) PATCH accepts `application/merge-patch+json`. (5) Ingestion rules added (path-only installation id, active-installation check, timestamp rules). (6) Grid-substation CRUD is now required. (7) `simulate` automated. (8) Deployment moved earlier. (9) Misc consistency fixes (403 decision, user role/level, Express 5 note, test cases).

---

## 0. Scoring Map (what earns marks)

| # | Dimension | Marks | Where this spec covers it |
|---|---|---|---|
| 1 | Architecture and data model | 15 | Section 3 |
| 2 | API design | 20 | Sections 5, 6, 7 |
| 3 | Coverage | 15 | Sections 5, 6 (full spine, advanced behaviour, summary) |
| 4 | Implementation with generated code | 10 | Sections 9, 14 (AI log, repair evidence) |
| 5 | Functionality against seed data | 5 | Sections 4, 11 |
| 6 | Deployment and operation | 10 | Sections 10, 12, 13 |
| 7 | Security and authentication | 15 | Section 8 |
| 8 | Report quality | 10 | Section 14 |

**Eligibility gate (fail any and no mark stands):**
- [ ] Report has architecture, design and deployment sections, 2250 to 2750 words
- [ ] Signed coursework declaration submitted with the report
- [ ] Git repo shared with the module leader as a **collaborator** (invite his GitHub username, ask for it on the LMS; his email address alone is not enough)
- [ ] API deployed over HTTPS and working against seed data at submission time
- [ ] You attend the viva and can explain every artefact

---

## 1. Fixed Constraints From the Brief

- Backend only. No dashboard, client or BI tool.
- JSON for every resource.
- Public deployment over HTTPS. Localhost-only is not accepted.
- Live OpenAPI (Swagger) surface served from the deployment.
- JWT bearer authentication with scopes.
- Richardson Maturity Level 2 target. Level 3 (hypermedia) is out of scope.
- Incremental Git history. A single bulk upload is weak evidence.
- AI-generated code is allowed if disclosed. **Report prose must be your own** (Turnitin similarity under 15% and AI score under 15%, and even below 15% can be reviewed manually).

---

## 2. Tech Stack (Express.js + MongoDB)

| Concern | Choice | Reason |
|---|---|---|
| Runtime | Node.js 20 or 22 LTS | Stable, supported by all hosts |
| Framework | **Express 5** (or Express 4 plus `express-async-errors`) | Required stack. Express 5 forwards rejected async handlers to the error middleware |
| Database | **MongoDB Atlas** (cloud cluster, free M0 tier) for development and deployment | Chosen database. No local MongoDB or Docker needed |
| ODM | **Mongoose 8** | Schemas, validators, indexes, `ref`s. Easy to explain at viva |
| Auth | `jsonwebtoken`, `bcryptjs` | JWT bearer, hashing of passwords and device secrets |
| Validation | `zod` | Central validation of params, query and body. Also blocks NoSQL operator injection (section 8.5) |
| API docs | `swagger-ui-express` plus hand-maintained `openapi.yaml` | Live Swagger UI at `/api-docs`, raw spec at `/openapi.json` |
| Security middleware | `helmet`, `cors`, `express-rate-limit` | Basic hardening |
| Logging | `pino-http` (or `morgan`) | Request logs, request id |
| Testing | `jest`, `supertest`, `mongodb-memory-server` | In-memory MongoDB for automated tests (or a separate local test database) |
| Seed | Plain Node script using Mongoose and a seeded PRNG (`seedrandom`) | Repeatable dataset |
| Hosting | Render, Railway or Fly.io for the API plus MongoDB Atlas | Free or cheap TLS and a public URL |

Tips:
- Check free-tier limits. Free web services may sleep, and Atlas free clusters have storage limits (the seed data is small, a few tens of MB, so it fits).
- Atlas network access: hosts with changing outbound IPs usually force an allow-list of `0.0.0.0/0`. Compensate with a strong database password, a least-privilege database user, and never committing the connection string.

---

## 3. Architecture and Data Model (15 marks)

### 3.1 Implementation-independent model (state this in the report first)

```
Province 1 ---- * District 1 ---- * GridSubstation 1 ---- * SolarInstallation 1 ---- * GenerationReading
User (role, jurisdiction scope)   -> reads only; never writes readings
```

| Entity | Role | Notes |
|---|---|---|
| Province | Top-level jurisdiction | 9 |
| District | Mid-level jurisdiction | 25, each belongs to one Province |
| GridSubstation | Grid node | Each belongs to one District |
| SolarInstallation | The metered asset | Belongs to one GridSubstation. Holds `meter_id` |
| GenerationReading | One timestamped record | **Append-only time series**, belongs to one Installation |
| User | SLSEA person | Role plus jurisdiction level and ids |

### 3.2 The two decisions that carry marks

1. **`meter_id` is an attribute of SolarInstallation.** Do **not** create a `devices` collection.
2. **GenerationReading is its own append-only collection.** Do **not** store `last_power` or `last_energy` on the installation. The "last known reading" is a derived query.

Also justify: write and read concerns are separated (devices write readings, users read, admin manages the registry).

### 3.3 Physical model: MongoDB collections (Mongoose)

Design rules:
- **Reference, do not embed**, for the hierarchy. Every level is its own addressable REST resource, so each is its own collection linked by `ObjectId` references.
- **Never embed readings in the installation.** A reading array would grow without bound (document size limit, rewrite cost, no pagination). Readings are a separate collection.
- JSON field names are `snake_case`. Map Mongoose `_id` to `id` and hide `__v` in a `toJSON` transform.
- Store decimals as **`Number`**, not `Decimal128` (Decimal128 serialises as `{ "$numberDecimal": "..." }` and breaks the response shape).
- Use `timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }` and an explicit integer `version` field incremented with `$inc` on every update (Mongoose's own version key does not change on ordinary field updates, so do not rely on it for ETags).

```
provinces
  _id            ObjectId
  code           String   required, unique        (e.g. "WP")
  name           String   required, unique
  version        Number   default 1
  created_at, updated_at

districts
  _id
  province_id    ObjectId ref provinces, required, indexed
  name           String   required, unique
  version, created_at, updated_at

grid_substations
  _id
  district_id    ObjectId ref districts, required, indexed
  province_id    ObjectId ref provinces, required   (denormalised, server-derived)
  name           String   required
  capacity_mva   Number
  version, created_at, updated_at

solar_installations
  _id
  substation_id  ObjectId ref grid_substations, required, indexed
  district_id    ObjectId ref districts, required, indexed     (denormalised, server-derived)
  province_id    ObjectId ref provinces, required, indexed     (denormalised, server-derived)
  meter_id       String   required, unique                       (identifier-as-attribute decision)
  owner_name     String
  capacity_kw    Number   required, min 0.1
  status         String   enum [active, inactive, decommissioned], default active
  latitude       Number
  longitude      Number
  installed_at   Date
  device_secret_hash  String  required, select:false             (never returned)
  version, created_at, updated_at

generation_readings            (append-only, no updated_at, no version)
  _id
  installation_id ObjectId ref solar_installations, required
  recorded_at    Date     required                              (device timestamp, UTC)
  power_kw       Number   required, min 0
  energy_kwh     Number   required, min 0                       (cumulative meter value)
  voltage_v      Number   required
  ingested_at    Date     default now                           (server receipt time, justified extra field)
  Indexes:
    { installation_id: 1, recorded_at: 1 }  UNIQUE   -> duplicate protection, range queries, latest lookup, sort both ways
    { recorded_at: 1 }                                -> time-window scans

users
  _id
  email          String   required, unique, lowercase
  password_hash  String   required, select:false
  full_name      String   required
  role           String   enum [national_analyst, provincial_analyst, district_analyst, admin]
  jurisdiction_level String enum [national, province, district]   (derived by the server from role: national_analyst and admin = national, provincial_analyst = province, district_analyst = district. Never accepted from a client, so role and level cannot disagree)
  province_id    ObjectId ref provinces (required if level = province)
  district_id    ObjectId ref districts (required if level = district)
  created_at
```

Denormalisation, and why it is justified:
- `district_id` and `province_id` are copied onto each installation (and `province_id` onto each substation) so jurisdiction scoping and filtering are single-collection index lookups instead of multi-step joins.
- They are **derived by the server from `substation_id`**, never accepted from a client. Recompute them on every installation create, PUT and PATCH that changes `substation_id`.
- Readings stay "pure" (no jurisdiction fields). To filter readings by jurisdiction, resolve the installation ids first (`find({ district_id }).distinct('_id')`, at most a few hundred ids), then query readings with `installation_id: { $in: ids }`. State this trade-off in the report (alternative: copy the keys onto every reading, faster reads but stale if an installation moves).

Notes:
- `energy_kwh` is **cumulative** (monotonically increasing). Today's energy is the latest cumulative minus the cumulative at the start of the local day.
- Time zone: Asia/Colombo is UTC+05:30 with no daylight saving, so a fixed offset is safe for "start of today". Store all timestamps in UTC.
- **Why a standard collection and not a MongoDB native time-series collection:** native time-series collections do not support unique indexes (verify against the current MongoDB docs), so they cannot enforce the one-reading-per-installation-per-timestamp rule that gives the 409 duplicate behaviour. A regular collection with a compound unique index is simpler to explain and meets the "append-only time series" modelling requirement. Mention the native option as a future improvement.

### 3.4 Referential integrity without foreign keys

MongoDB will not reject a bad reference, so enforce it yourself and prove it:

- Seed in dependency order (provinces, districts, substations, installations, readings, users).
- On create or update, check the parent exists (`exists`) before saving, and return **400** (or 404 for a path parent) if not.
- Block deletes of parents that have children (409), as for installations with readings.
- Provide `npm run seed:verify` which uses aggregation `$lookup` to assert there are **zero orphans** at every level and prints counts. Run it after seeding and again on the deployed database. This is your evidence for "foreign-key-consistent seed data".
- Set `mongoose.set('strictQuery', true)` and `mongoose.set('sanitizeFilter', true)`.

---

## 4. Seed Data (5 marks functionality, supports 15 marks coverage)

Command: `npm run seed` must be **repeatable** (drop and reload collections, deterministic via a seeded PRNG).

| Element | Target | Notes |
|---|---|---|
| Provinces | 9 | Western, Central, Southern, Northern, Eastern, North Western, North Central, Uva, Sabaragamuwa |
| Districts | 25 | Western: Colombo, Gampaha, Kalutara. Central: Kandy, Matale, Nuwara Eliya. Southern: Galle, Matara, Hambantota. Northern: Jaffna, Kilinochchi, Mannar, Vavuniya, Mullaitivu. Eastern: Batticaloa, Ampara, Trincomalee. North Western: Kurunegala, Puttalam. North Central: Anuradhapura, Polonnaruwa. Uva: Badulla, Monaragala. Sabaragamuwa: Ratnapura, Kegalle |
| Substations | 30 (brief says 20 or more) | At least one per district so no district summary is empty |
| Installations | 250 (brief says 200 or more) | Spread unevenly across substations. Include a few `inactive` ones |
| Readings | 7 days x 96 per day (every 15 min) = 672 per installation, about 168,000 documents | Insert in batches of 2000 to 5000 with `insertMany` |
| Users | 1 national, 2 to 3 provincial, 3 to 5 district, 1 admin | Include two district users in different districts to test leakage |

Reading generation rules:
- Local time 06:00 to 18:00 follows a sine curve: `power_kw = capacity_kw * max(0, sin(pi * (hour - 6) / 12)) * cloud_factor`. Zero at night.
- `cloud_factor` is random per day per site (for example 0.6 to 1.0) plus small per-reading noise.
- `energy_kwh` accumulates: `previous + power_kw * 0.25`. Start each installation with a random lifetime offset.
- `voltage_v` is about 230 with small noise (225 to 240).
- Round numbers to 3 decimal places before inserting.
- The window should end at "now" (rounded down to 15 minutes) so last-known and today's summary have data.

Scripts:
- `npm run seed` loads everything and prints counts and demo credentials.
- `npm run seed:verify` checks for orphans and prints counts per collection.
- `npm run simulate` appends the missing 15-minute readings up to now so "current power" and "today's energy" are not stale. **Automate it**: run it every 15 minutes as a scheduled job (a Render Cron Job, or a GitHub Actions schedule using `MONGODB_URI` as a repository secret), or as an in-app timer behind `SIMULATOR_ENABLED=true`. Also run it by hand just before marking and the viva as a fallback. It writes through the model directly, not through the API; say so in the report.
- `npm run db:indexes` calls `syncIndexes()` on every model (run it in the release step, because the unique reading index is required for the 409 rule).

Demo credentials: print them in the README for the marker (clearly labelled demo data). Never commit real secrets. For devices use a deterministic demo secret (for example `demo-secret-<meter_id>`, stored hashed), or write a gitignored `device-credentials.csv` during seeding.

---

## 5. API Design (20 marks) and Coverage (15 marks)

### 5.1 Conventions (Guideline sections 5.1, 5.6)

- Base path: `/api/v1`
- URIs: lowercase, hyphenated, plural collections, nouns for things, no verbs, scoped sub-collections.
- Nested only where a collection makes sense under its parent.
- JSON keys: `snake_case`, consistent everywhere.
- Timestamps: ISO 8601 UTC (`2026-10-09T06:15:00Z`). Numbers are real JSON numbers.
- Identifiers in URLs are the 24-character hex `ObjectId` string, exposed as `id`.
- A malformed id (not 24 hex characters) returns **400** with `VALIDATION_ERROR`, a well-formed but unknown id returns **404**. Validate ids with zod before they reach Mongoose (otherwise Mongoose throws a `CastError` that becomes a 500).

### 5.2 Resource taxonomy (Guideline section 4)

| Type | Resources |
|---|---|
| Atomic | province, district, substation, installation, reading |
| Collection | provinces, districts, substations, installations, readings (scoped under an installation, and aggregated under a substation, district or province) |
| Composite | installation overview |
| Processing / derived | last-known-reading, district generation-summary |

### 5.3 Endpoint table

**Auth**

| Method | URI | Purpose | Success |
|---|---|---|---|
| POST | `/api/v1/auth/token` | Issue a JWT. Body `grant_type` = `password` (email, password) or `device` (meter_id, device_secret) | 200 `{access_token, token_type, expires_in, scope}` |

**Hierarchy (read, user tokens)**

| Method | URI | Notes |
|---|---|---|
| GET | `/provinces` | Collection, paginated, jurisdiction-trimmed |
| GET | `/provinces/{provinceId}` | Atomic, ETag |
| GET | `/provinces/{provinceId}/districts` | Scoped collection |
| GET | `/districts` | Optional filter `province_id` |
| GET | `/districts/{districtId}` | Atomic |
| GET | `/districts/{districtId}/grid-substations` | Scoped collection |
| GET | `/grid-substations` | Optional filters `district_id`, `province_id` |
| GET | `/grid-substations/{substationId}` | Atomic |
| GET | `/grid-substations/{substationId}/installations` | Scoped collection |
| GET | `/installations` | Filters `province_id`, `district_id`, `substation_id`, `status`; sort; pagination |
| GET | `/installations/{installationId}` | Atomic, ETag, Last-Modified |

**Composite and derived (read)**

| Method | URI | Notes |
|---|---|---|
| GET | `/installations/{installationId}/overview` | **Composite**: installation plus substation, district, province, last known reading and reading count / first reading time |
| GET | `/installations/{installationId}/last-known-reading` | **Derived**, operational view. 200 with the newest reading, or 404 `NO_READINGS` if none exist |
| GET | `/districts/{districtId}/generation-summary` | **Processing resource (stretch, needed for First band)** |

Why `last-known-reading` and not `readings/latest`: `readings/latest` collides with `readings/{readingId}` as a path segment. A separate hyphenated noun avoids ambiguity. State this reasoning in the report.

**Readings (analytical history)**

| Method | URI | Who | Notes |
|---|---|---|---|
| GET | `/installations/{installationId}/readings` | User | Pagination, `from`/`to`, sort, ETag |
| GET | `/installations/{installationId}/readings/{readingId}` | User | Atomic reading. 404 if the reading belongs to a different installation |
| POST | `/installations/{installationId}/readings` | Device (own installation only) | **201 + `Location`**. Rules in section 5.4a |
| GET | `/grid-substations/{substationId}/readings` | User | Readings across all installations of one substation. Filters `from`, `to`; sort; pagination |
| GET | `/districts/{districtId}/readings` | User | Readings across the district. Filters `substation_id`, `from`, `to`; sort; pagination |
| GET | `/provinces/{provinceId}/readings` | User | Readings across the province. Filters `district_id`, `substation_id`, `from`, `to`; sort; pagination |

There is deliberately **no top-level `/readings`**. The brief wants collections nested under their parent where they only make sense there, and a reading only makes sense under an installation. The three aggregated collections above meet "filtering by jurisdiction (province / district / substation) and by time window" while keeping every readings URI scoped to a parent. Rules for them:
- The parent in the path is the jurisdiction check (403 if outside the token scope). A narrowing filter (`district_id`, `substation_id`) must belong to the path parent, else 400.
- Implementation: resolve installation ids for the parent (and filter), then query readings with `installation_id: { $in: ids }`.
- If neither `from` nor `to` is given, default the window to the **last 24 hours** and say so in the response docs. Cap `page_size` at 500.
- The per-installation collection stays the canonical scoped one.

**Installation registry write path (admin token, scope `registry:write`)**

| Method | URI | Semantics | Success |
|---|---|---|---|
| POST | `/installations` | Create. Server derives `district_id` and `province_id` from `substation_id`. 400 if the substation does not exist | 201 + `Location` + body |
| PUT | `/installations/{id}` | **Full replacement only.** All writable fields required, else 400 | 200 |
| PATCH | `/installations/{id}` | Partial update (JSON merge patch). Accepts `application/merge-patch+json` and `application/json` | 200 |
| DELETE | `/installations/{id}` | Remove. If readings exist return **409** (`INSTALLATION_HAS_READINGS`). Recommend `PATCH status=decommissioned` instead | 204 |

**Grid-substation registry (admin token, scope `registry:write`), required.** The rubric's First band asks for full CRUD on the write path, so build it for substations too:

| Method | URI | Semantics | Success |
|---|---|---|---|
| POST | `/grid-substations` | Create. `district_id` must exist (400 if not); server derives `province_id` | 201 + `Location` + body |
| PUT | `/grid-substations/{id}` | Full replacement. `district_id` is **immutable** (400 if it differs), so no cascade to installations is needed | 200 |
| PATCH | `/grid-substations/{id}` | Partial update. Same immutability rule | 200 |
| DELETE | `/grid-substations/{id}` | 409 `GRID_SUBSTATION_HAS_INSTALLATIONS` if installations exist | 204 |

Demo note: every seeded installation has readings, so `DELETE` on it correctly returns 409. To demonstrate 204, create a fresh installation (or substation) first and delete that.

**Readings are append-only.** `PUT`, `PATCH`, `DELETE` on a reading return **405 Method Not Allowed** with an `Allow` header (`GET, HEAD` on a reading; `GET, HEAD, POST` on the readings collection). Defend this at viva.

### 5.4 Method semantics and idempotency (Guideline section 7)

| Method | Safe | Idempotent | Used for |
|---|---|---|---|
| GET / HEAD | Yes | Yes | All reads |
| POST | No | No | Create installation, ingest reading, issue token |
| PUT | No | Yes | Full replace only (never partial) |
| PATCH | No | Merge patch is idempotent in this API | Partial update |
| DELETE | No | Yes (first call 204, repeat returns 404) | Remove |

Duplicate reading protection: the **unique compound index** `(installation_id, recorded_at)` makes MongoDB reject a repeated timestamp (error code 11000). Catch it and return **409 `DUPLICATE_READING`**, so a device retry after a lost response cannot create two documents. Optional extra: accept an `Idempotency-Key` header.

### 5.4a Reading ingestion rules (POST `/installations/{installationId}/readings`)

- The installation comes **only from the path**. A body containing `installation_id` (or any unknown field) is rejected with 400.
- Device token `installation_id` claim must equal the path id, else 403 `FORBIDDEN`.
- The installation must exist (404) and have `status = active`, else 403 `INSTALLATION_NOT_ACTIVE`. This is checked in the database on every POST, because a device token outlives a decommissioning.
- `recorded_at`: ISO 8601 UTC. More than 5 minutes ahead of server time gives 400. Past timestamps (late, buffered, out of order) are accepted.
- `power_kw` is a number >= 0, `energy_kwh` a number >= 0, `voltage_v` a number > 0 and <= 500. Anything else gives 400.
- `energy_kwh` is **not** required to increase at ingestion (meter replacement and out-of-order delivery are legitimate). Derived resources guard against it: today's energy is clamped at `max(0, last - first)`.
- Duplicate `(installation_id, recorded_at)` gives 409 `DUPLICATE_READING`.
- Success: 201, body is the stored reading, `Location: /api/v1/installations/{id}/readings/{readingId}`. That URL resolves for user tokens; the device itself cannot GET it (devices have no read scope). Document this as deliberate.

### 5.5 Representation

Single resource (example installation):

```json
{
  "id": "6650f1c2a1b2c3d4e5f60042",
  "meter_id": "SL-MTR-000042",
  "owner_name": "A. Perera",
  "capacity_kw": 5.5,
  "status": "active",
  "latitude": 6.9271,
  "longitude": 79.8612,
  "installed_at": "2025-03-14",
  "substation_id": "6650f1c2a1b2c3d4e5f60007",
  "district_id": "6650f1c2a1b2c3d4e5f60001",
  "province_id": "6650f1c2a1b2c3d4e5f60000",
  "version": 3,
  "created_at": "2026-10-01T04:00:00Z",
  "updated_at": "2026-10-01T04:00:00Z"
}
```

Never return `device_secret_hash`, `password_hash` or `__v`.

Composite overview:

```json
{
  "installation": { "id": "6650f1c2a1b2c3d4e5f60042", "meter_id": "SL-MTR-000042", "capacity_kw": 5.5, "status": "active" },
  "substation": { "id": "6650f1c2a1b2c3d4e5f60007", "name": "Kotte GSS" },
  "district": { "id": "6650f1c2a1b2c3d4e5f60001", "name": "Colombo" },
  "province": { "id": "6650f1c2a1b2c3d4e5f60000", "name": "Western" },
  "last_known_reading": { "id": "6650f1c2a1b2c3d4e5f6a123", "recorded_at": "2026-10-09T06:00:00Z", "power_kw": 3.214, "energy_kwh": 4521.88, "voltage_v": 231.4 },
  "reading_summary": { "total_readings": 672, "first_recorded_at": "2026-10-02T06:15:00Z" }
}
```

Build it with a bounded number of queries (a few `findById` calls run with `Promise.all`, or one aggregation with `$lookup`), never one query per field in a loop.

District summary:

```json
{
  "district_id": "6650f1c2a1b2c3d4e5f60001",
  "district_name": "Colombo",
  "as_of": "2026-10-09T06:00:00Z",
  "timezone": "Asia/Colombo",
  "installation_count": 18,
  "reporting_installation_count": 17,
  "current_power_kw": 41.372,
  "today_energy_kwh": 126.905
}
```

Definitions to document:
- "current" = latest reading per installation within the last 30 minutes.
- "Today" = since local midnight Asia/Colombo, computed as latest cumulative energy minus the first cumulative reading of the day for each installation, clamped at 0. Generation is zero around midnight, so using the first reading of the day instead of the last reading before midnight makes no practical difference; say so.
- `installation_count` = active installations in the district. `reporting_installation_count` = those with a reading in the last 30 minutes.
- **`as_of` = the newest `recorded_at` used in the calculation, not the current time.** Otherwise the body (and its hash ETag) changes on every request and 304 can never happen.
- A district with no readings today returns 200 with zero totals, not an error.

Aggregation outline (single pipeline, no per-installation loop):

```
1. installationIds = installations.find({ district_id, status: 'active' }).distinct('_id')   // scoped, tiny
2. generation_readings.aggregate([
     { $match: { installation_id: { $in: installationIds }, recorded_at: { $gte: startOfTodayUtc } } },
     { $sort:  { installation_id: 1, recorded_at: 1 } },                         // uses the compound index
     { $group: { _id: '$installation_id',
                 first_energy: { $first: '$energy_kwh' },
                 last_energy:  { $last:  '$energy_kwh' },
                 last_power:   { $last:  '$power_kw' },
                 last_time:    { $last:  '$recorded_at' } } },
     { $project: { today_energy: { $subtract: ['$last_energy', '$first_energy'] },
                   last_power: 1, last_time: 1 } }
   ])
3. In the service: total today_energy over all rows; sum last_power only for rows with last_time >= now - 30 min
```

---

## 6. Advanced Behaviour (Guideline sections 10.2 to 10.4, 11)

### 6.1 Pagination

Query: `page` (default 1) and `page_size` (default 50, max 500). Implementation: `find(filter).sort(sort).skip((page - 1) * page_size).limit(page_size)` plus `countDocuments(filter)` run in parallel. Response envelope for every collection:

```json
{
  "data": [ ... ],
  "pagination": { "total": 672, "page": 2, "page_size": 50, "total_pages": 14 },
  "links": {
    "self":  "/api/v1/installations/6650f1c2a1b2c3d4e5f60042/readings?page=2&page_size=50",
    "first": "/api/v1/installations/6650f1c2a1b2c3d4e5f60042/readings?page=1&page_size=50",
    "prev":  "/api/v1/installations/6650f1c2a1b2c3d4e5f60042/readings?page=1&page_size=50",
    "next":  "/api/v1/installations/6650f1c2a1b2c3d4e5f60042/readings?page=3&page_size=50",
    "last":  "/api/v1/installations/6650f1c2a1b2c3d4e5f60042/readings?page=14&page_size=50"
  }
}
```

- `total` reflects the **filtered** count including the user's jurisdiction, not the collection size.
- `prev` is `null` on page 1. `next` is `null` on the last page.
- Preserve all other query parameters inside the links.
- Optionally emit an RFC 8288 `Link` header.
- Reject `page < 1` or `page_size > max` with **400**.
- Be ready to explain why skip/limit is acceptable here, and what you would change at larger scale (keyset pagination on `recorded_at`, because large `skip` values get slow).

### 6.2 Filtering

- Time window: `from` and `to` (ISO 8601). Document whether bounds are inclusive. `from > to` is **400**. Build `{ recorded_at: { $gte: from, $lte: to } }` from **parsed Date values**, never from raw query objects.
- Jurisdiction: `province_id`, `district_id`, `substation_id` on `/installations`. For readings, jurisdiction is the path parent (`/provinces/{id}/readings`, `/districts/{id}/readings`, `/grid-substations/{id}/readings`) plus narrowing filters (section 5.3). Resolve installation ids first, then `installation_id: { $in: ids }`.
- Filtering by an out-of-scope jurisdiction value returns **403**, not an empty list that hides the reason (or document an alternative).
- Unknown query parameters (including keys such as `district_id[$ne]`) return **400** `VALIDATION_ERROR` on every endpoint. This is fixed, not a choice: under the `simple` query parser, `?district_id[$ne]=x` arrives as an unknown key, and ignoring it would return 200 instead of the 400 the security tests expect.

### 6.3 Sorting

- `sort=timestamp` plus `order=asc|desc` (default `desc` for readings). Map the public name `timestamp` to the stored field `recorded_at`. For installations allow `sort=meter_id|capacity_kw|created_at`.
- **Whitelist** sortable fields in code. Never pass user input straight into `.sort()`.
- Add a deterministic tiebreaker (`_id`) so pages do not overlap.

### 6.4 Conditional GET (Guideline section 10.4) and headers (section 8)

- Atomic resources: `ETag` from `version` (for example `"inst-6650...-v3"`) and `Last-Modified` from `updated_at`. Readings are immutable, so their ETag can come from the id and `Last-Modified` from `ingested_at`.
- Collections and composite or derived resources: ETag computed as a hash (SHA-1 or SHA-256) of the serialised body. `Last-Modified` where meaningful (for readings: the newest `recorded_at` in the result). Never put wall-clock time in a hashed body (see `as_of` in section 5.5).
- Request handling: `If-None-Match` match returns **304 with an empty body** (also send `ETag`). `If-Modified-Since` supported as a fallback.
- Express can compare freshness itself with `req.fresh`, but implement the helper explicitly (`utils/conditional.js`) so you can explain it and so `Last-Modified` is set. Test that the 304 response has no body.
- Writes: if `If-Match` is supplied on PUT, PATCH or DELETE and does not match the current ETag, return **412 Precondition Failed**. Apply the update with a filter on the expected `version` (`findOneAndUpdate({ _id, version }, { ..., $inc: { version: 1 } })`) so the check and the write are atomic.
- `Cache-Control: private, max-age=0, must-revalidate` for authenticated data.

### 6.5 Content negotiation and media types

- If `Accept` is present and `req.accepts('json')` is false, return **406**.
- Requests with a body must send `Content-Type: application/json` (PATCH also accepts `application/merge-patch+json`); otherwise **415**. Responses are always `application/json`.
- All responses (including errors): `Content-Type: application/json; charset=utf-8`.

### 6.6 Consistent error contract (Guideline section 11)

One shape for **every** client error, produced by a single global error handler:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Request validation failed.",
  "details": [
    { "field": "power_kw", "issue": "must be a number greater than or equal to 0" }
  ],
  "status": 400,
  "path": "/api/v1/installations/6650f1c2a1b2c3d4e5f60042/readings",
  "timestamp": "2026-10-09T06:15:03Z",
  "request_id": "b3c1c2e0-..."
}
```

Rules:
- Use the same shape for 400, 401, 403, 404, 405, 406, 409, 412, 415 and unknown-route 404s.
- Stable machine codes: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `INVALID_TOKEN`, `FORBIDDEN`, `OUT_OF_JURISDICTION`, `NOT_FOUND`, `NO_READINGS`, `METHOD_NOT_ALLOWED`, `NOT_ACCEPTABLE`, `UNSUPPORTED_MEDIA_TYPE`, `DUPLICATE_READING`, `INSTALLATION_HAS_READINGS`, `GRID_SUBSTATION_HAS_INSTALLATIONS`, `INSTALLATION_NOT_ACTIVE`, `PRECONDITION_FAILED`.
- The error handler must translate Mongo and Mongoose errors: `CastError` to 400, `ValidationError` to 400, duplicate key (code 11000) on readings to 409 `DUPLICATE_READING`, duplicate `meter_id` to 409.
- Malformed JSON body (from `express.json()`) must also produce this shape (400).
- Server errors (500) return the same shape with a generic message and **no stack trace and no Mongo error text**.

---

## 7. Status Code Matrix (Guideline section 9)

| Situation | Code |
|---|---|
| Successful read, update | 200 |
| Created (installation, reading) with `Location` | 201 |
| Deleted | 204 |
| Conditional GET, client copy is current (empty body) | 304 |
| Malformed or invalid input, malformed id, bad pagination, `from > to`, unknown parent id in body | 400 |
| Missing, expired or invalid token | 401 (with `WWW-Authenticate: Bearer`) |
| Valid token but wrong scope, wrong installation, inactive installation, or out of jurisdiction | 403 |
| Unknown resource or route, or no last-known reading | 404 |
| Method not allowed on the resource (for example PUT a reading) | 405 + `Allow` |
| `Accept` cannot be satisfied | 406 |
| Duplicate reading or meter id, delete installation that has readings | 409 |
| `If-Match` precondition failed | 412 |
| Wrong request `Content-Type` | 415 |
| Unexpected failure | 500 |

Decision (fixed): out-of-scope direct access returns **403**. The alternative, 404, would avoid confirming that a resource exists (less information leakage) but is less clear to clients. Defend the 403 choice in the report, apply it everywhere, and acknowledge that it reveals existence.

---

## 8. Security and Authentication (15 marks, Guideline section 12)

### 8.1 The write-read split

| Client | Authenticates as | Scope | Can do | Cannot do |
|---|---|---|---|---|
| Metering device | One installation (`meter_id` plus device secret) | `readings:write` | `POST` readings for **its own** installation | Read anything, write to another installation |
| SLSEA user | Person (email plus password) | `data:read` | `GET` within jurisdiction | Write readings or registry |
| Admin | Person | `data:read registry:write` | Manage installations, read all | Write readings |

(Admin is an addition for managing the installation registry. Explain this choice in the report; it does not break the "users never write readings" rule.)

### 8.2 JWT design

Issued by `POST /api/v1/auth/token`, signed HS256 (or RS256), secret from an environment variable.

Device token claims:

```json
{ "sub": "installation:6650f1c2a1b2c3d4e5f60042", "scope": "readings:write",
  "installation_id": "6650f1c2a1b2c3d4e5f60042", "iss": "slsea-api", "iat": 0, "exp": 0 }
```

User token claims:

```json
{ "sub": "user:6650f1c2a1b2c3d4e5f60abc", "scope": "data:read", "role": "district_analyst",
  "jurisdiction": { "level": "district", "province_id": "6650f1c2a1b2c3d4e5f60000", "district_id": "6650f1c2a1b2c3d4e5f60001" },
  "iss": "slsea-api", "iat": 0, "exp": 0 }
```

- Expiry: users 1 hour, devices about 24 hours (device re-authenticates with its secret). `grant_type=device` refuses installations that are not `active`, and ingestion re-checks status on every POST (section 5.4a), so a decommissioned device stops writing immediately even though its token is still valid.
- Passwords and device secrets stored hashed (bcrypt). Because the hash fields use `select: false`, load them explicitly with `.select('+password_hash')` only in the token endpoint. Never log them.
- Same generic error for wrong email and wrong password (no user enumeration).
- Verify `iss`, `exp` and algorithm explicitly (`algorithms: ['HS256']`).
- Token is read from `Authorization: Bearer <token>` only.

### 8.3 Jurisdiction enforcement (no cross-jurisdiction leakage)

| User level | Visible data |
|---|---|
| national | Everything |
| province | Districts, substations, installations, readings inside that province |
| district | Only that district's substations, installations, readings |

Implementation:
1. **Direct resource access** (`/installations/{id}`, `/districts/{id}`, `/installations/{id}/readings`): load the resource, compare its `province_id` / `district_id` with the token jurisdiction, **403** if outside.
2. **Collections** (`/installations`, `/provinces`, `/grid-substations`, and the scoped readings collections under provinces, districts and substations, where the path parent is also checked): add a scope predicate to the Mongo filter (`{ district_id }` or `{ province_id }`) in a **shared helper** (`scopeFilter(user, collection)`) merged with `$and`, so no list endpoint can forget it.
3. **Filters**: a user filter can only narrow the result, never widen beyond the token scope.
4. **Derived resources**: `generation-summary`, `overview`, `last-known-reading` and totals in `pagination.total` must obey the same scope. A summary for another district is 403.
5. **Counts**: `countDocuments` must use the same scoped filter, so `total` never includes out-of-scope documents.

### 8.4 Middleware order per route

```
requestId -> helmet/cors -> rate limit -> content negotiation (406/415)
-> authenticate (401) -> requireScope (403) -> validate ids, query, body with zod (400)
-> authorizeJurisdiction or ownInstallation (403) -> handler -> conditional GET (304) -> response
-> notFound (404) -> errorHandler (single error shape)
```

Note: validation of the id format runs before the database lookup so malformed ids are 400, and the jurisdiction check runs after the resource is loaded. In **Express 5, `req.query` is a read-only getter**, so the validation middleware must put parsed values on `req.validated` (not reassign `req.query`). Because content negotiation runs before authentication, a request with a bad `Accept` and no token gets 406, not 401; that is acceptable, just be consistent.

### 8.5 Other security measures (including MongoDB-specific)

- **NoSQL operator injection:** a request such as `?district_id[$ne]=x` or a JSON body `{"email": {"$gt": ""}}` can turn a value into a query operator. Defences: (1) validate every param, query and body field with zod as a plain string / number / ISO date and **reject objects and arrays** where a scalar is expected, (2) cast ids with `mongoose.Types.ObjectId` only after validating the 24-hex format, (3) enable `mongoose.set('sanitizeFilter', true)`, (4) set `app.set('query parser', 'simple')` explicitly so nested query syntax is not parsed. Under `simple`, `district_id[$ne]=x` arrives as a plain key named `district_id[$ne]`, not an object, and is blocked by the unknown-parameter rule (400, section 6.2). Under Express 4's default `extended` parser it would arrive as an object and be rejected by zod. Test both the query form and the JSON-body form. Add tests that send operator payloads and expect 400.
- HTTPS only: rely on the host's TLS, set `app.set('trust proxy', 1)`, add HSTS via `helmet`, redirect plain HTTP when `x-forwarded-proto` is `http`. Atlas connections use TLS.
- Whitelist sort fields. Never build filters from raw request objects.
- Request body size limit (`express.json({ limit: '10kb' })`).
- Rate limit `/auth/token` strictly (brute force) and the API generally.
- Secrets (`MONGODB_URI`, `JWT_SECRET`) only in environment variables. `.env` is gitignored, `.env.example` is committed. Use a least-privilege Atlas database user (read/write on this database only).
- CORS restricted or off (no browser client is required).

### 8.6 Scope-based versus attribute-based access control (be ready for this at viva)

- **Scopes** (coarse capabilities in the token: `readings:write`, `data:read`, `registry:write`) are simple, cheap to check and easy to audit, but cannot express "only district 3".
- **ABAC** decides from attributes (user jurisdiction, resource district, device installation id, time, status). It is flexible and fine-grained but harder to test and audit, and policy logic spreads through code.
- Scope names map onto the rubric's examples: `readings:write` plus the `installation_id` claim is the "installation-write" scope, and `data:read` plus the jurisdiction claim is "analyst-read-by-district". Say this explicitly in the report.
- This API uses a **hybrid**: scopes gate the action, then an attribute check (jurisdiction claim versus resource ownership) gates the data. Trade-offs to mention: jurisdiction is embedded in the token so a change to a user's jurisdiction does not apply until the token expires (short expiry mitigates this), tokens grow if many attributes are added, and a policy engine (for example Casbin or OPA) would centralise rules at the cost of more moving parts.

### 8.7 Security test cases (put these in Jest)

| Test | Expected |
|---|---|
| No token on any endpoint | 401 |
| Expired or tampered token | 401 |
| Device POSTs reading to its own installation | 201 |
| Device POSTs reading to another installation | 403 |
| Device calls any GET | 403 |
| User POSTs a reading | 403 |
| District user reads own district | 200 |
| District user reads another district, installation, readings, summary | 403 |
| District user lists `/installations` | Only own-district documents, correct `total` |
| District user adds `?district_id=<other>` | 403 |
| Province user reads a district inside province | 200, outside province 403 |
| Non-admin attempts installation create, PUT, PATCH, DELETE | 403 |
| `?district_id[$ne]=x` or JSON operator payload | 400 |
| Login with `{"email":{"$gt":""},"password":{"$gt":""}}` | 400 |
| Any endpoint with an unknown query parameter | 400 |
| District user reads another district's `/districts/{id}/readings` | 403 |
| Device POSTs to an inactive or decommissioned installation | 403 |

---

## 9. Project Structure (Implementation, 10 marks)

```
solar-api/
├── package.json
├── .env.example
├── .gitignore
├── README.md                    # run, seed, demo credentials, live URL
├── docs/
│   ├── SPEC.md                  # this file
│   ├── openapi.yaml             # OpenAPI 3 spec served at /openapi.json
│   ├── er-diagram.png
│   └── uri-table.md
├── src/
│   ├── server.js                # connect to MongoDB, then listen
│   ├── app.js                   # express app, middleware wiring
│   ├── config/index.js          # env parsing and validation
│   ├── db/
│   │   ├── connect.js           # mongoose connection, strictQuery, sanitizeFilter
│   │   ├── models/              # Province, District, GridSubstation, SolarInstallation, GenerationReading, User
│   │   └── scripts/             # seed.js, seed-verify.js, simulate.js, sync-indexes.js
│   ├── middleware/
│   │   ├── requestId.js
│   │   ├── negotiate.js         # 406 and 415
│   │   ├── authenticate.js      # 401
│   │   ├── requireScope.js      # 403
│   │   ├── jurisdiction.js      # ownInstallation, canAccessDistrict, scopeFilter
│   │   ├── validate.js          # zod to VALIDATION_ERROR (rejects objects/arrays and unknown params); writes to req.validated (Express 5 req.query is read-only)
│   │   ├── notFound.js
│   │   └── errorHandler.js      # the single error shape (maps Mongo errors)
│   ├── routes/                  # auth, provinces, districts, substations, installations, readings
│   ├── controllers/             # thin: parse, call service, send
│   ├── services/                # business logic and queries (readings, summary, hierarchy)
│   ├── utils/
│   │   ├── pagination.js        # parse params, build envelope and links
│   │   ├── conditional.js       # ETag, Last-Modified, 304, 412
│   │   ├── errors.js            # ApiError class with code, status, details
│   │   ├── serialize.js         # _id -> id, strip __v and secrets
│   │   └── time.js              # Asia/Colombo helpers (fixed +05:30)
│   └── schemas/                 # zod schemas
└── tests/                       # supertest suites using mongodb-memory-server
```

Scripts: `dev`, `start`, `seed`, `seed:verify`, `simulate`, `db:indexes`, `test`, `lint`.

---

## 10. OpenAPI / Swagger (Deployment 10 marks, Coverage)

- Serve Swagger UI at `/api-docs` and the raw spec at `/openapi.json`, from the **deployed** server.
- Document every endpoint: parameters, request bodies, response schemas, all status codes, the shared `Error` schema, pagination envelope, headers (`Location`, `ETag`, `Last-Modified`, `Allow`), and the `bearerAuth` security scheme (`type: http`, `scheme: bearer`, `bearerFormat: JWT`) so "Authorize" works in the UI.
- Describe ids as `string` with pattern `^[0-9a-f]{24}$`.
- Include example responses.
- Set the `servers` entry to the live HTTPS URL.
- Keep the spec truthful: a spec that disagrees with the behaviour hurts both Deployment and Functionality. A test that loads `openapi.yaml` and validates it is a cheap safeguard.

---

## 11. Testing and Functionality Checks (5 marks)

Automated (Jest and Supertest, with `mongodb-memory-server` and a small fixture dataset; create the indexes in test setup, otherwise the 409 duplicate test will not work):

- Pagination: `total`, `next`, `prev`, first and last page edges, out-of-range page.
- Filtering: `from`/`to` boundaries, empty result set (200 with `data: []` and `total: 0`, not an error), combined filters.
- Sorting: asc and desc order, invalid sort field gives 400.
- Conditional GET: first request 200 with ETag, repeat with `If-None-Match` gives 304 with empty body, modified resource gives 200 again.
- 412 on stale `If-Match`.
- 201 plus `Location` on POST reading and POST installation, and the `Location` URL actually resolves.
- 405 with `Allow` on PUT/PATCH/DELETE of a reading.
- 406 and 415.
- Error shape identical across all error tests (one schema assertion helper).
- Edge cases: malformed id (400), unknown id (404), reading requested through the wrong installation (404), no readings yet (404 `NO_READINGS`), duplicate timestamp (409), negative power (400), future timestamp (decide the rule and test it), unknown `substation_id` on installation create (400).
- Ingestion rules (section 5.4a): timestamp more than 5 minutes ahead (400), late and out-of-order past timestamp (201), body containing `installation_id` (400), inactive installation (403 `INSTALLATION_NOT_ACTIVE`).
- Unknown query parameter (400). DELETE tests must create their own installation or substation, because seeded ones have children (409).
- Security matrix from section 8.7, including operator-injection cases.
- `seed:verify` reports zero orphans.

Manual smoke test against the **deployed** URL before submission (Appendix A).

---

## 12. Deployment and Operation (10 marks)

- [ ] MongoDB Atlas cluster (free M0 is enough), database user with least privilege, network access configured for the host
- [ ] Public HTTPS API URL (Render, Railway or Fly.io)
- [ ] Environment variables set on the host: `MONGODB_URI`, `JWT_SECRET`, `NODE_ENV=production`, `PORT`, `PUBLIC_BASE_URL`, `JWT_ISSUER`
- [ ] Release step runs `npm run db:indexes`; run `npm run seed` once against Atlas (from your machine or the host shell) and then `npm run seed:verify`
- [ ] `GET /health` returns 200 and checks the MongoDB connection state (`mongoose.connection.readyState === 1`), or 503 in the standard error shape if not connected. Keep it unauthenticated and free of sensitive data
- [ ] Swagger UI reachable at the live URL
- [ ] `trust proxy` configured; HTTP redirects to HTTPS
- [ ] Data fresh at submission and viva (scheduled `simulate` job running, plus a manual run just before)
- [ ] Service is awake before marking (free tiers may sleep)
- [ ] Evidence for the report: live URL, screenshot of Swagger, sample 200/201/304/403 responses, Atlas and host dashboards showing the service and database, deployment steps

---

## 13. Git Workflow (part of Deployment 10 marks)

- Share the repo with the module leader as **collaborator** (not just a public link) on day one.
- Commit per increment with clear messages (conventional commits are fine). Suggested sequence:

1. `chore: init express project, eslint, env config`
2. `feat(db): mongoose connection and hierarchy models`
3. `feat(db): installation and generation reading models with indexes`
4. `feat(db): user model`
5. `feat(seed): hierarchy seed (9 provinces, 25 districts, substations)`
6. `feat(seed): installations and 7-day diurnal readings`
7. `feat(seed): seed:verify orphan check`
8. `feat(api): provinces and districts read endpoints`
9. `feat(api): substations and installations read endpoints`
9a. `chore(deploy): first deploy to Render + Atlas, /health, seed:verify on Atlas` (deploy early, redeploy per increment)
10. `feat(api): global error handler and ApiError (maps mongo errors)`
11. `feat(api): pagination helper and links`
12. `feat(api): readings sub-collection and substation/district/province readings with filter and sort`
13. `feat(api): last-known-reading and installation overview`
14. `feat(api): ETag, Last-Modified, 304 and 412`
15. `feat(auth): token endpoint, JWT middleware, scopes`
16. `feat(auth): jurisdiction scoping helper applied to all reads`
17. `feat(api): device reading ingestion (201 + Location, 409 duplicates)`
18. `feat(api): installation and grid-substation CRUD with PUT/PATCH/DELETE semantics`
19. `feat(api): content negotiation 406 and 415, 405 on readings`
20. `feat(api): district generation summary (aggregation)`
21. `fix(security): reject operator objects in query and body`
22. `feat(docs): OpenAPI spec and Swagger UI`
23. `test: security matrix and conditional GET tests`
24. `fix: <each generator mistake you repair>` (one commit each, and mention it in the AI log)
25. `chore(deploy): final README, demo credentials, release checks, scheduled simulate job`

Fix commits that repair AI output are valuable evidence for the Implementation band. The history must be genuine: do not backdate, squash or bulk-upload.

---

## 14. Report Plan (10 marks) and AI Disclosure

The report is **your own prose**. Use this only as a skeleton. Do not use AI to write it.

| Section | Target words | Must contain |
|---|---|---|
| Architecture and data model | about 450 | ER diagram, implementation-independent model, identifier-as-attribute, readings as time series, why `last_power` fails, why MongoDB with references (not embedding), denormalised jurisdiction keys and their trade-off, no enforced foreign keys and how integrity is verified, why a standard collection and not a native time-series collection, extra fields justified |
| API design justification | about 600 | URI table, resource taxonomy, method and idempotency choices, status codes, headers, pagination/filter/sort/conditional design, why readings are scoped under parents (no top-level `/readings`), error contract, guideline section references |
| Security justification | about 450 | Write-read split, JWT claims and scopes, jurisdiction enforcement, 403 vs 404 decision, NoSQL injection defences, scope vs ABAC trade-off |
| Deployment | about 250 | Host and Atlas, how it is built and seeded, HTTPS, Swagger URL, evidence of operation, commit history |
| Richardson Maturity evaluation | about 250 | Level 2 with evidence (resources, verbs, status codes). State honestly that it stops short of Level 3 because responses carry no hypermedia controls. The pagination `links` are navigation aids, not state-transition affordances, so they do not make it Level 3. Say what HATEOAS would add and cost |
| Critical evaluation | about 400 | Strengths, limitations (no FK enforcement, skip/limit pagination at scale, HS256 shared secret, jurisdiction in token goes stale, no refresh tokens, no multi-document transactions used, no per-device rate limiting), what you would change with more time |
| Intro and conclusion | about 100 | Brief |
| **Total** | **about 2500** | Must land between 2250 and 2750 |

Not counted in the words: declaration, AI appendix, diagrams, tables, code listings, references.

Before submitting: run Turnitin if available, keep your drafts and notes as evidence, sign the declaration, and cite the guidelines and any sources in the reference list.

### AI-disclosure appendix (required, code only)

If this specification (committed as `docs/SPEC.md`) or any design document was produced with AI help, log that too. Log only mistakes that really happened; invented entries will not survive the viva.

Keep a running log from day one:

| # | Date | Tool/model | Prompt (verbatim or summarised) | What it produced | What was wrong | How I fixed it | Commit |
|---|---|---|---|---|---|---|---|

### Generator mistakes to look for and repair

- Using `PUT` for partial update
- Returning 200 instead of 201, or omitting `Location`
- Verbs in URIs (`/getReadings`, `/addReading`)
- Singular collection names or camelCase and snake_case mixed
- Adding a `devices` collection, or `last_power` on the installation
- Embedding readings inside the installation document
- Using `Decimal128` (breaks JSON), or returning `_id` and `__v` instead of `id`
- Relying on Mongoose's `__v` for ETags (it does not change on normal updates)
- Missing jurisdiction filter on one list endpoint, `countDocuments` or the summary
- `total` computed before jurisdiction or filters
- Passing `req.query` or `req.body` straight into `find()` (NoSQL injection)
- Passing the `sort` query value straight into `.sort()`
- Unvalidated ids causing `CastError` and a 500 response
- Forgetting the unique reading index in tests or on the deployed database (so duplicates are accepted)
- Reading looked up by id without checking it belongs to the installation in the path
- `password_hash` or `device_secret_hash` returned because `select: false` was removed
- Timezone mistakes for "today" (UTC versus Asia/Colombo)
- Weak or inconsistent ETags, or 304 responses that still send a body
- Different error shapes from different middleware (body parser, JWT library, validators, Mongoose)
- Stack traces or Mongo error messages in 500 responses
- Hardcoded JWT secret or algorithm not pinned
- Per-installation queries in a loop in the composite or summary
- Missing jurisdiction check on the path parent of a scoped readings collection (province, district or substation in the URL)
- Treating `?district_id[$ne]=x` as harmless because it is ignored (it must return 400)
- Swagger spec that does not match actual behaviour

---

## 15. Viva Preparation (integrity gate)

You must be able to explain **every file and every line you submit**, including AI-generated code. Practise:

- Draw the ER model and explain why readings are a separate append-only collection.
- Why `meter_id` is an attribute and not a separate device entity.
- Why references and not embedding; why MongoDB does not enforce the hierarchy and what you did about it.
- Why jurisdiction ids are denormalised onto installations, and what happens if an installation moves.
- Why a standard collection with a unique compound index and not a native time-series collection.
- Walk through one request end to end: middleware order, auth, jurisdiction check, Mongo query, response headers.
- Why `POST` returns 201 with `Location`; why `PUT` is full replace only; why readings reject PUT/PATCH/DELETE.
- How ETag and 304 work and how you generate the ETag; how `If-Match` and the `version` filter make the update atomic.
- How pagination `total`, `next` and `prev` are calculated; why skip/limit is acceptable here.
- How the summary aggregation works and how it avoids per-installation queries.
- How a district user is prevented from reading another district (show the code and run the test).
- How you stop NoSQL operator injection (show a blocked payload).
- 401 versus 403 versus 404, and why you chose it.
- Scope-based versus ABAC.
- Why Level 2 and not Level 3.
- What the AI got wrong and how you caught it.
- Live demo: authorize in Swagger, call endpoints, show a 304, show a 403.

---

## 16. First-Band Self-Audit (tick before submission)

**Architecture and data model**
- [ ] Five entities plus User, correct cardinalities, references enforced in code and checked by `seed:verify`
- [ ] `meter_id` on the installation, no devices collection
- [ ] Readings append-only in their own collection, no last-value fields, readings not embedded
- [ ] Model explained implementation-independently and justified, including MongoDB trade-offs

**API design**
- [ ] Lowercase, hyphenated, plural collection URIs, no verbs, correct nesting
- [ ] Taxonomy: atomic, collection, composite, processing all present
- [ ] GET safe, PUT full-replace only, PATCH partial, DELETE 204
- [ ] 201 + Location, 200, 204, 304, 400, 401, 403, 404, 405, 406, 409, 412, 415 used correctly
- [ ] ETag, Last-Modified, Location, Content-Type, Allow correct
- [ ] Consistent snake_case JSON with `id` (not `_id`)

**Coverage**
- [ ] Hierarchy reads, installation composite, last-known-reading, readings sub-collection, scoped readings under substation/district/province
- [ ] Full CRUD on installations and grid substations, device POST reading with ingestion rules (5.4a)
- [ ] Pagination with total, next, prev
- [ ] Filtering by jurisdiction and time window
- [ ] Sorting by timestamp both ways
- [ ] Conditional GET returns 304 with empty body
- [ ] One error schema everywhere (including Mongo errors)
- [ ] District generation summary implemented

**Implementation**
- [ ] Layered structure, readable code, no dead code
- [ ] AI log complete with specific mistakes and fixes in commits
- [ ] You can explain every file

**Functionality**
- [ ] Every endpoint verified on the **deployed** data, including empty sets, not-found and 304

**Deployment**
- [ ] HTTPS public URL, Atlas connected, live Swagger, repo shared, incremental history, data fresh, indexes present

**Security**
- [ ] JWT bearer with scopes, per-installation device tokens, jurisdiction scoping with no leakage in lists, filters, totals or summary
- [ ] NoSQL injection blocked and tested
- [ ] HTTPS throughout, secrets in env, hashed credentials
- [ ] Scope vs ABAC trade-off understood

**Report**
- [ ] 2250 to 2750 words, all sections, Richardson Level 2 defended honestly
- [ ] Declaration signed, AI appendix complete, prose is your own

---

## 17. Suggested Build Order

| Phase | Work | Outcome |
|---|---|---|
| 1 | ER diagram, URI table, status table, repo created and shared | Design before code |
| 2 | Express skeleton, config, error handler, Mongoose connection and models, indexes | Runnable app, consistent errors from day one |
| 3 | Seed script, `seed:verify`, `simulate` (hierarchy, installations, readings, users) | Real data to build against |
| 4 | Hierarchy reads, installations, pagination helper, **first deployment to Render + Atlas** | Read path |
| 5 | Readings sub-collection and scoped readings under substation/district/province, filter, sort, last-known, overview | Analytical and operational views |
| 6 | ETag, Last-Modified, 304, 412 | Conditional behaviour |
| 7 | JWT auth, scopes, jurisdiction helper, injection defences, device ingestion | Security and write path |
| 8 | Installation and grid-substation CRUD, 405, 406, 415, 409 | Write semantics |
| 9 | District generation summary | Top-band stretch |
| 10 | OpenAPI and Swagger UI | Documentation surface |
| 11 | Tests, fix AI mistakes, redeploy | Evidence and stability |
| 12 | Simulate fresh data, final smoke test, report, declaration, appendix, viva practice | Submission |

Deploy early (after phase 4), then redeploy per increment. That gives you the commit-and-deploy history the Deployment dimension rewards and avoids last-day host problems.

---

## Appendix A. Smoke Test Commands

```bash
BASE=https://<your-app>.onrender.com/api/v1

# 1. user token
curl -s -X POST $BASE/auth/token -H 'Content-Type: application/json' \
  -d '{"grant_type":"password","email":"district.colombo@slsea.demo","password":"<demo>"}'

# 2. read own district, then another (expect 200 then 403)
curl -i $BASE/districts/$OWN_DISTRICT_ID -H "Authorization: Bearer $USER_TOKEN"
curl -i $BASE/districts/$OTHER_DISTRICT_ID -H "Authorization: Bearer $USER_TOKEN"

# 3. readings page with filter and sort
curl -i "$BASE/installations/$INST_ID/readings?from=2026-10-08T00:00:00Z&to=2026-10-09T00:00:00Z&sort=timestamp&order=asc&page=2&page_size=25" \
  -H "Authorization: Bearer $USER_TOKEN"

# 4. conditional GET (expect 304, empty body)
curl -i $BASE/installations/$INST_ID -H "Authorization: Bearer $USER_TOKEN" -H 'If-None-Match: "<etag-from-previous-call>"'

# 5. device token and ingestion (expect 201 + Location)
curl -s -X POST $BASE/auth/token -H 'Content-Type: application/json' \
  -d '{"grant_type":"device","meter_id":"SL-MTR-000001","device_secret":"<demo>"}'
curl -i -X POST $BASE/installations/$INST_ID/readings -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"recorded_at":"2026-10-09T06:30:00Z","power_kw":2.4,"energy_kwh":4530.1,"voltage_v":231.2}'

# 6. duplicate timestamp (expect 409), device writing to another installation (expect 403),
#    user writing a reading (expect 403)
# 7. last known reading and district summary
curl -i $BASE/installations/$INST_ID/last-known-reading -H "Authorization: Bearer $USER_TOKEN"
curl -i $BASE/districts/$OWN_DISTRICT_ID/generation-summary -H "Authorization: Bearer $USER_TOKEN"
# 8. wrong method, wrong Accept, malformed id, operator injection (expect 405, 406, 400, 400)
curl -i -X PUT $BASE/installations/$INST_ID/readings/$READING_ID -H "Authorization: Bearer $ADMIN_TOKEN"
curl -i $BASE/provinces -H 'Accept: text/xml' -H "Authorization: Bearer $USER_TOKEN"
curl -i $BASE/installations/not-an-id -H "Authorization: Bearer $USER_TOKEN"
curl -i "$BASE/installations?district_id[\$ne]=x" -H "Authorization: Bearer $USER_TOKEN"
```

## Appendix B. Environment Variables (`.env.example`)

```
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb+srv://<db-user>:<password>@<cluster>.mongodb.net/solar_api_dev?retryWrites=true&w=majority
JWT_SECRET=change-me-long-random
JWT_ISSUER=slsea-api
USER_TOKEN_TTL=1h
DEVICE_TOKEN_TTL=24h
PUBLIC_BASE_URL=http://localhost:3000
SEED_RANDOM=slsea-2026
```

## Appendix C. Core npm Packages

```
dependencies:  express, mongoose, jsonwebtoken, bcryptjs, zod, helmet, cors,
               express-rate-limit, swagger-ui-express, yaml, pino-http (or morgan),
               dotenv, seedrandom
devDependencies: jest, supertest, mongodb-memory-server, nodemon, eslint, prettier
```

## Appendix D. MongoDB Atlas Setup (no Docker, no local MongoDB)

1. Create a free Atlas account and a **free M0 cluster** (pick a region close to your host and to you).
2. **Database Access:** create a database user (username plus a strong password) with the built-in role `readWrite` on your database only, not `atlasAdmin`.
3. **Network Access:** add your current IP address for development. For the deployed host (Render, Railway or Fly.io, which use changing outbound IPs) you will probably need `0.0.0.0/0`, so keep the password strong and never commit it.
4. **Connect:** choose "Drivers", copy the `mongodb+srv://...` connection string, put your user, password and database name in `.env` as `MONGODB_URI`. URL-encode special characters in the password (for example `@` becomes `%40`).
5. **Use separate databases on the same cluster:**
   - `solar_api_dev` for development and seeding
   - `solar_api_prod` for the deployed API (set as `MONGODB_URI` on the host)
   - Tests use `mongodb-memory-server` (downloads a MongoDB binary on first run, no Docker), or a throwaway `solar_api_test` database on the cluster
6. Run `npm run db:indexes`, `npm run seed`, then `npm run seed:verify` against the dev database. Browse the data in Atlas under Collections to check counts (about 168,000 readings).

Notes for working against a cloud cluster:
- Seeding about 168,000 readings over the internet is slower than locally. Keep `insertMany` batches at 2000 to 5000 and show progress in the console.
- The free tier has a 512 MB storage limit. This dataset is only tens of megabytes, so it fits. Avoid reseeding in a loop.
- Free clusters can pause after a long period of inactivity. Check the cluster is running before development sessions, marking and the viva.
- If the connection fails, check, in order: your IP is in Network Access, the password is URL-encoded, the database user has access, and the cluster is not paused.
- Never put the connection string in the repository, the report or screenshots. Rotate the password if it leaks.