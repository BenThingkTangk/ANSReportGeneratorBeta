# Implementation Notes — Knowledge Library + Change Requests Admin Subsystem

**Build status:** TypeScript: ✅ clean | Production build: ✅ passed  
**Date:** 2026-05-14  
**Author:** Subagent build pass

---

## 1. New Files Created

### Supabase Migrations
- `supabase/migrations/0001_knowledge_and_change_requests.sql` — schema, RLS, triggers, storage bucket comments
- `supabase/migrations/0002_seed_admins_and_sources.sql` — admin roles + 13 seed knowledge sources

### Server helpers
- `server/supabase.ts` — Express server-side Supabase client helpers
- `api/_supabase.ts` — Vercel serverless Supabase client helpers (mirror)

### Vercel API routes (new)
- `api/_knowledgeCache.ts` — 60-second in-memory knowledge cache for AI pipeline
- `api/admin/me.ts` — GET `/api/admin/me`
- `api/admin/knowledge.ts` — GET/POST `/api/admin/knowledge`
- `api/admin/knowledge/[id].ts` — GET/PUT/DELETE `/api/admin/knowledge/:id`
- `api/admin/knowledge/upload.ts` — POST `/api/admin/knowledge/upload` (multipart)
- `api/admin/change-requests.ts` — GET/POST `/api/admin/change-requests`
- `api/admin/change-requests/[id].ts` — GET/PUT/DELETE `/api/admin/change-requests/:id`
- `api/admin/audit.ts` — GET `/api/admin/audit`

### Client — lib / hooks
- `client/src/lib/supabase.ts` — anon Supabase client
- `client/src/hooks/useAuth.ts` — magic-link session + role lookup

### Client — admin components
- `client/src/components/admin/AdminLayout.tsx` — deep-navy side nav + role badge
- `client/src/components/admin/AdminGuard.tsx` — role gate (non-admin → "Restricted" page)

### Client — admin pages
- `client/src/pages/admin/login.tsx`
- `client/src/pages/admin/knowledge.tsx`
- `client/src/pages/admin/knowledge/[id].tsx`
- `client/src/pages/admin/knowledge/new.tsx`
- `client/src/pages/admin/knowledge/upload.tsx`
- `client/src/pages/admin/change-requests.tsx`
- `client/src/pages/admin/change-requests/[id].tsx`
- `client/src/pages/admin/change-requests/new.tsx`
- `client/src/pages/admin/audit.tsx`

### Docs / config
- `.env.example` — all required environment variables
- `ADMIN_SETUP.md` — Supabase setup, migration steps, Vercel env vars, login flow
- `IMPLEMENTATION_NOTES.md` — this file

## 2. Modified Files

- `api/synopsis.ts` — injected knowledge library into system prompts; added `citations` to response
- `api/ask-atom.ts` — injected knowledge library; renamed Perplexity `citations` → `webCitations`; added `citations` (internal knowledge)
- `client/src/App.tsx` — added all 9 admin routes under `/admin/*`

## 3. Supabase Tables, Columns, and Policies

### Tables

#### `public.user_roles`
| Column | Type | Notes |
|--------|------|-------|
| user_id | uuid PK | references auth.users |
| role | text | super_admin / clinical_admin / reviewer / viewer |
| created_at | timestamptz | |
| updated_at | timestamptz | auto-updated by trigger |

**RLS:** SELECT by self or admins/reviewers; INSERT/UPDATE/DELETE by super_admin only.

#### `public.ans_knowledge_sources`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| title | text NOT NULL | |
| authors | text | |
| year | int | |
| publication_type | text | book / journal_article / paper / internal_protocol / algorithm_rule / note / pdf / other |
| journal | text | |
| publisher | text | |
| doi | text | |
| pubmed_id | text | |
| url | text | |
| abstract | text | |
| key_claims | jsonb | default '[]' |
| diagnostic_relevance | text | |
| ans_metrics | text[] | |
| tags | text[] | |
| file_path | text | Supabase Storage key |
| file_mime | text | |
| file_size_bytes | bigint | |
| used_in | text[] | AI prompt / algorithm / report generator / etc. |
| active_in_ai_analysis | bool | injected into Sonar Pro prompts |
| active_in_report_citations | bool | |
| active_in_admin_review | bool | |
| review_status | text | draft / pending_review / approved / archived / needs_review |
| added_by | uuid | references auth.users |
| last_updated_by | uuid | references auth.users |
| created_at | timestamptz | |
| updated_at | timestamptz | auto-updated |

**RLS:** SELECT/UPDATE for super_admin + clinical_admin + reviewer; INSERT for super_admin + clinical_admin; DELETE for super_admin only.

#### `public.ans_knowledge_chunks`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| source_id | uuid | FK → ans_knowledge_sources cascade delete |
| chunk_index | int | |
| content | text | ~800 tokens / ~3000 chars |
| tokens | int | rough estimate |
| created_at | timestamptz | |

**Index:** (source_id, chunk_index)

#### `public.app_change_requests`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| title | text NOT NULL | |
| category | text | clinical_logic / algorithm_rule / report_language / ui_ux / citation_evidence / data_parsing / admin / bug / feature_request |
| priority | text | low / medium / high / urgent |
| description | text | |
| suggested_fix | text | |
| screenshot_path | text | storage key |
| related_report_id | text | free-text, NO PHI |
| status | text | submitted / under_review / accepted / in_progress / completed / rejected |
| submitted_by | uuid | FK auth.users |
| admin_notes | text | admin-only |
| created_at | timestamptz | |
| updated_at | timestamptz | auto-updated |

**RLS:** SELECT for submitter + admins/reviewers; INSERT/UPDATE for admins/reviewers; DELETE for super_admin only.

#### `public.audit_log`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| actor_id | uuid | |
| actor_email | text | |
| action | text | create / update / delete / upload_file |
| entity_type | text | |
| entity_id | uuid | |
| before | jsonb | |
| after | jsonb | |
| ip | text | |
| user_agent | text | |
| created_at | timestamptz | |

**RLS:** INSERT for all authenticated; SELECT for super_admin only.

### Triggers
- `on_auth_user_created_assign_role` — fires after INSERT on auth.users; auto-assigns role from allowlist (ben.oleary@thingktangk.com → super_admin; jcolombo@physiops.com, soleary@physiops.com → clinical_admin).
- `*_updated_at` — fires BEFORE UPDATE on user_roles, ans_knowledge_sources, app_change_requests to set updated_at = now().

### Storage Buckets
| Bucket | Public | Notes |
|--------|--------|-------|
| knowledge-files | No | PDFs + text files. Admin upload only. Signed URL download (5-min expiry). |
| change-request-screenshots | No | Screenshot attachments. Reviewer+ upload. |

---

## 4. How to Enable a New Source for AI Analysis (Toggle Flow)

1. Create or upload a knowledge source (status starts as `draft`).
2. Complete all metadata fields (title, authors, year, abstract, key_claims).
3. Click **Submit for Review** → status becomes `pending_review`.
4. A `clinical_admin` or `super_admin` reviews the source → clicks **Approve** → status becomes `approved`.
5. On the detail page, toggle **Active in AI Analysis** → ON.
6. Click **Save Changes**.
7. The server-side 60-second cache (`api/_knowledgeCache.ts`) will refresh within 60 seconds.
8. All subsequent calls to `/api/synopsis` and `/api/ask-atom` will include this source in the Sonar Pro system prompt and return it in the `citations` array.

**To deactivate:** Toggle **Active in AI Analysis** → OFF and save.

---

## 5. Manual Review Items (Pre-Launch)

- **Supabase project** must be created and both migrations (0001 + 0002) run in the SQL editor.
- **Storage buckets** `knowledge-files` and `change-request-screenshots` must be created (private) and storage policies applied (SQL at bottom of 0001 migration).
- **Vercel environment variables**: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server), VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (client) must all be set in production + preview.
- **Magic-link email provider**: Supabase sends magic-link emails via its built-in email service (limited to 4/hour on free tier). For production, configure a custom SMTP provider in Supabase Auth settings.
- **Seed sources**: The 0002 migration seeds 13 sources. Admin user_roles are seeded if users already exist — otherwise the `on_auth_user_created_assign_role` trigger will assign roles on first login.
- **pdf-parse**: The upload route (`api/admin/knowledge/upload.ts`) uses `pdf-parse` which requires the `canvas` dependency in some environments. If PDF text extraction fails silently, chunking is skipped but the file is still uploaded.
- **Chunk size warning**: The Vite build produces a `>500 kB` bundle warning (pre-existing, not introduced by this change). Code-splitting is a separate optimization task.
- **No PHI reminder**: The `related_report_id` field in change requests is free-text and the UI shows a "no PHI" placeholder. Server-side there is no validation — enforce via clinic workflow.
