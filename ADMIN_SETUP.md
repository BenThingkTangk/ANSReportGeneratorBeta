# Admin Setup Guide — PhysioPS × HumanOS ANS Reporting AI

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → **New project**.
2. Choose a region close to your users.
3. Save the database password securely.
4. Once provisioned, go to **Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL` / `VITE_SUPABASE_URL`
   - **anon public key** → `VITE_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (keep this secret)

## 2. Run Migrations

Open the **Supabase SQL editor** (Dashboard → SQL Editor) and run the migrations in order:

```sql
-- Step 1: Schema (tables, RLS, triggers, storage comments)
-- Paste the contents of: supabase/migrations/0001_knowledge_and_change_requests.sql

-- Step 2: Seed (admin roles + 13 knowledge sources)
-- Paste the contents of: supabase/migrations/0002_seed_admins_and_sources.sql
```

Or use the Supabase CLI:
```bash
supabase db push
```

## 3. Create Storage Buckets

In **Supabase Dashboard → Storage**, create two **private** buckets:

| Bucket name                  | Public? |
|------------------------------|---------|
| `knowledge-files`            | No      |
| `change-request-screenshots` | No      |

Then apply the storage policies from the comments at the bottom of `0001_knowledge_and_change_requests.sql`.

## 4. Set Environment Variables in Vercel

In the [Vercel Dashboard](https://vercel.com) → Project → **Settings → Environment Variables**, add:

| Variable                   | Value                              | Environment          |
|----------------------------|------------------------------------|----------------------|
| `SUPABASE_URL`             | `https://xxxx.supabase.co`         | Production, Preview  |
| `SUPABASE_SERVICE_ROLE_KEY`| `eyJ…`                             | Production, Preview  |
| `VITE_SUPABASE_URL`        | `https://xxxx.supabase.co`         | Production, Preview  |
| `VITE_SUPABASE_ANON_KEY`   | `eyJ…` (anon key)                  | Production, Preview  |
| `PPLX_API_KEY`             | Already set                        | Production, Preview  |

> **Note:** `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never add it as a `VITE_` variable.

## 5. How to Log In as Admin (Magic Link)

1. Navigate to `/#/admin/login` (e.g., `https://your-app.vercel.app/#/admin/login`).
2. Enter your admin email address (`ben.oleary@thingktangk.com`, `jcolombo@physiops.com`, or `soleary@physiops.com`).
3. Click **Send Magic Link**.
4. Check your email and click the link. You will be redirected to the admin console.

> On first login, if the user_roles row wasn't created by migration seed, the `on_auth_user_created_assign_role` trigger will insert the correct role automatically.

## 6. How to Add a New Knowledge Source

### Option A — Manual form
1. Sign in as admin → **Add Source** in the sidebar.
2. Fill in title, authors, year, type, DOI, URL, abstract.
3. Set toggles for AI Analysis, Report Citations, Admin Review.
4. Set `review_status = draft` and click **Create Source**.
5. Navigate to the source detail → click **Submit for Review** → have a super_admin or clinical_admin click **Approve**.
6. Toggle **Active in AI Analysis** to include it in Sonar prompts.

### Option B — PDF Upload
1. Sign in → **Upload PDF** in the sidebar.
2. Drag-drop a PDF (≤25 MB) and enter a title.
3. Click **Upload & Process** — the file is stored in the `knowledge-files` bucket, text is extracted and chunked (~800 tokens/chunk).
4. You will be redirected to the source detail page to complete metadata.
5. Follow the review → approve → activate flow above.

## 7. How to Submit a Change Request

1. Sign in as any admin → **Submit Request** in the sidebar.
2. Fill in title, category, priority, description, and optional suggested fix.
3. Use the **Related Report ID** field only with an anonymised ID — no PHI.
4. Click **Submit Request**.
5. Admins can update status, add notes, and view the full audit history on the detail page.

## 8. Active Source Toggle Flow (AI Analysis)

To enable a source for AI prompt injection:

1. Navigate to **Knowledge Inventory** → click the source row.
2. On the detail page, ensure `review_status = approved`.
3. Toggle **Active in AI Analysis** → ON (violet).
4. Click **Save Changes**.
5. The 60-second in-memory cache will update automatically on the next AI call.

> Only sources with `active_in_ai_analysis = true` AND `review_status = 'approved'` are included in Sonar Pro system prompts. The cache refreshes every 60 seconds.

## 9. Manual Review Items (Pre-Launch Checklist)

- [ ] Supabase project created and migrations 0001 + 0002 run
- [ ] Storage buckets `knowledge-files` and `change-request-screenshots` created (private)
- [ ] Storage policies applied (from migration 0001 comments)
- [ ] Vercel environment variables set (all four Supabase vars + PPLX_API_KEY)
- [ ] Test magic-link login for each admin email
- [ ] Verify 13 seed sources appear in Knowledge Inventory with `review_status = approved`
- [ ] Verify AI toggle: activate one source → call `/api/synopsis` → confirm `citations` array present in response
- [ ] Confirm non-admin users see "Admins Only" page at `/#/admin`
- [ ] Confirm super_admin can view Audit Log, clinical_admin cannot
