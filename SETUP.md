# EstateDesk — setup guide

> Want to try it with lots of fake data first? See **DEMO.md**.

You need three free accounts. Use your one GitHub account to sign in to the other two.

| What | Why | Cost to start |
|---|---|---|
| GitHub | Stores the code | Free |
| Supabase | Login (OTP) + database | Free |
| Vercel | Puts the website online | Free |

Takes about 30–40 minutes the first time.

---

## Part A — Supabase (database and login)

1. Go to **supabase.com** → Sign in with GitHub → **New project**.
   - Name: `estatedesk`
   - Region: **Mumbai (ap-south-1)** — fastest for India
   - Save the database password somewhere safe.
2. Wait 2 minutes for it to start.
3. Left menu → **SQL Editor** → **New query**. Open `supabase/schema.sql` from this folder, copy everything, paste, press **Run**. You should see "Success. No rows returned".
   Then do the same, one by one and in this order, for `supabase/patch-002-whatsapp.sql`, `patch-003-lead-capture.sql`, `patch-004-crm.sql`, `patch-005-alerts-import.sql`, `patch-006-project-photos.sql`, `patch-007-admins-money-sharing-map.sql`, `patch-008-project-matches.sql`, `patch-009-international-phones.sql`, `patch-010-passwords.sql`, `patch-011-forms-interns-teaser.sql`, `patch-012-reassign-alerts.sql` and `patch-013-team-link-projects.sql`. Each one is safe to run again if you are not sure you ran it.
   **Before patch-005:** left menu → **Database → Extensions** → search `pg_cron` → switch it on. This runs the "move a lead if nobody calls it" check every minute. If you forget, run patch-005 again after switching it on.
4. Left menu → **Project Settings → API**. Copy two things:
   - **Project URL**
   - **anon public** key

### Turn on email OTP (works today, free)

5. **Authentication → Sign In / Providers → Email**: make sure Email is ON.
6. **Authentication → Emails (Templates)**. Open **Magic Link** and **Confirm signup**. In both, replace the body with:

   ```
   <h2>Your EstateDesk login code</h2>
   <p>Enter this code: <b style="font-size:24px">{{ .Token }}</b></p>
   <p>It expires in 1 hour. If you did not ask for it, ignore this email.</p>
   ```
7. **Authentication → URL Configuration**: set **Site URL** to your Vercel address (after Part C), e.g. `https://estatedesk.vercel.app`.

> Supabase's built-in email sender only allows a few emails per hour. Fine for testing. Before your father's whole team uses it, connect a free SMTP sender (Resend or Brevo) in **Authentication → Emails → SMTP settings**.

### Turn on mobile OTP (later, costs money per SMS)

SMS to Indian numbers needs **DLT registration** (a TRAI rule). Two options:

- **Twilio Verify** — easiest. Supabase has it built in: **Authentication → Sign In / Providers → Phone** → choose *Twilio Verify* → paste Account SID, Auth Token and Verify Service SID. Ask Twilio about India delivery before going live.
- **MSG91** — cheaper for India and they help with DLT. Needs a small extra piece (an "SMS hook"). Ask Claude to add it when you're ready.

Until SMS is on, the login page tells people to use email. Nothing breaks.

---

## Part B — Put the code on GitHub

1. Go to **github.com → New repository** → name `estatedesk` → **Private** → Create.
2. Easiest way without commands: **Add file → Upload files** → drag in everything from this folder **except** `node_modules` and `.next` (if present) → Commit.

(If you use the terminal: `git init && git add . && git commit -m "Step 1" && git branch -M main && git remote add origin https://github.com/UtsavDoye20122005/estatedesk.git && git push -u origin main`)

---

## Part C — Vercel (website online)

1. Go to **vercel.com** → Sign in with GitHub → **Add New → Project** → pick `estatedesk` → Import.
2. Before pressing Deploy, open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL from Supabase |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key from Supabase |
   | `NEXT_PUBLIC_SITE_URL` | `https://<your-project>.vercel.app` |

3. Press **Deploy**. In 1–2 minutes you get your link.
4. Go back to Supabase step 7 and put this link as the Site URL.

---

## Part D — First test (10 minutes)

1. Open your website → log in with **your email** → enter the 6-digit code.
2. You land on **Create your company account** → fill it → you are the **Owner**.
3. Go to **Team → Invite someone** → enter a second email you own, role *Sales agent* → **Create invite link**.
4. Open the link in a private/incognito window → log in with that second email → **Join team**.
5. As owner, add 2 leads: assign one to the agent, keep one unassigned.
6. In the incognito window (agent), open **Leads**: the agent must see **only** their one lead, and no Team page, no Export button.
7. As owner: **Team → Remove access** on the agent and move their leads to yourself. Refresh the agent window: it shows "Your access was removed".

If all 7 work, Step 1 is done.

---

## Running the business side

- New companies get a **14-day free trial**. After that their data locks (it is not deleted).
- To mark a paying company as active, in Supabase **SQL Editor** run:

  ```sql
  update public.organizations set plan_status = 'active' where name = 'Doye Realty';
  ```
- To pause a company that stopped paying: `set plan_status = 'suspended'`.

## Good to know

- **Free Supabase projects pause after about a week with no use.** Once real people use it daily this won't happen. Upgrade to Pro (about $25/month) when you have paying customers.
- Never share the **service_role** key from Supabase. This website does not need it.
- Every rule (who sees which lead, who can invite, removed people, expired trials) is enforced **inside the database**, not just hidden in the screens. Someone who opens the browser's developer tools still can't get other people's leads.

## To run on your laptop (optional)

```
npm install
cp .env.example .env.local   # then fill in the 3 values
npm run dev                  # open http://localhost:3000
```
