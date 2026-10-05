# WhatsApp setup — login codes and lead alerts

One WhatsApp business number sends everything:
- the 6-digit **login code**
- **"New lead assigned to you"** alerts to agents
- later: daily summary, site-visit reminders, messages to clients

Email login stays as a backup.

## What it costs (India, Oct 2026)

Meta charges per message. No monthly fee when you connect directly to Meta.

| Message | Price | + 18% GST |
|---|---|---|
| Login code (Authentication) | ₹0.115 | ≈ ₹0.14 |
| Lead alert, reminder (Utility) | ₹0.115 | ≈ ₹0.14 |
| Offers to clients (Marketing) | ₹0.86 | ≈ ₹1.02 |

Example: 10 agents, 200 lead alerts a day → about **₹850 a month**.
Login codes are almost free, because people stay logged in for weeks.

## What you need

1. A **phone number that is not on WhatsApp** right now (a new SIM is easiest). Once connected to the API, it can't be used in the normal WhatsApp app.
2. A **Facebook account** (yours or your father's).
3. Your father's **business documents** (GST certificate, Udyam or shop licence) for Meta business verification. You can test before this is done.

---

## Part 1 — Test today with Meta's free test number (30 minutes)

1. Go to **developers.facebook.com** → **My Apps → Create App** → choose **Business** type → name it after your CRM.
2. In the app, add the product **WhatsApp** → **Set up**. Pick or create a Business Portfolio.
3. Open **WhatsApp → API Setup**. You'll see:
   - a **test phone number** (free, from Meta)
   - **Phone number ID** → this is `WHATSAPP_PHONE_NUMBER_ID`
   - **Temporary access token** → this is `WHATSAPP_TOKEN` (expires in 24 hours; fine for testing)
4. Under **To**, add your own mobile number and verify it. The test number can only message up to 5 numbers you add here.

### Create the two message templates

Go to **WhatsApp Manager → Message templates → Create template**.

**Template 1 — login code**
- Category: **Authentication**
- Name: `login_code`
- Language: **English**
- Code delivery: **Copy code**
- Tick "Add security recommendation" and set "Code expires in 10 minutes"
- Submit. Authentication templates are usually approved within minutes.

**Template 2 — lead alert**
- Category: **Utility**
- Name: `lead_assigned`
- Language: **English**
- Body (copy exactly, the {{numbers}} are filled in by the CRM):

  ```
  Hi {{1}}, a new lead has been assigned to you.

  Name: {{2}}
  Mobile: {{3}}
  Source: {{4}}

  Please call within 15 minutes and update the status in the CRM.
  ```
- For sample values Meta asks for, use: `Priya`, `Rahul Mehta`, `9876543210`, `99acres`.
- Submit.

**Template 3 — morning summary** (sent at about 8:30 AM to everyone who has calls or visits that day)
- Category: **Utility**
- Name: `daily_summary`
- Language: **English**
- Body:

  ```
  Good morning {{1}}! Your plan for today:

  Calls due: {{2}}
  Overdue calls: {{3}}
  Site visits: {{4}}

  Open the CRM to start.
  ```
- Sample values: `Priya`, `6`, `2`, `1`.

Owners and managers get the totals for the whole company; agents get their own numbers.

### Connect it to Supabase

5. Supabase → **Authentication → Sign In / Providers → Phone** → turn **Enable phone provider** ON. Pick any SMS provider in the list and leave its fields blank or fill dummy values; the hook below replaces it.
6. Supabase → **Authentication → Auth Hooks → Add hook → Send SMS hook** → type **HTTPS**.
   - URL: `https://<your-vercel-site>/api/hooks/send-sms`
   - Press **Generate secret**, copy it (starts with `v1,whsec_`) → this is `SEND_SMS_HOOK_SECRET`.
   - Save.

> The hook needs a public website address. It will **not** work with `localhost`. Put the site on Vercel first (SETUP.md Part B and C), or test lead alerts locally and login codes after deploying.

### Add the keys

In **Vercel → Project → Settings → Environment Variables** (and in `.env.local` on your laptop):

```
WHATSAPP_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
SEND_SMS_HOOK_SECRET=v1,whsec_...
SUPABASE_SERVICE_ROLE_KEY=...      (needed for the morning summary)
CRON_SECRET=any-long-random-text   (Vercel uses it to run the morning summary)
```

Redeploy on Vercel after adding them.

### Test

- Log in with the **WhatsApp** tab using your verified number → the code arrives on WhatsApp from Meta's test number.
- As owner, add a lead and assign it to a team member whose number you verified in step 4 → they get the "new lead" message.

---

## Part 2 — Go live with your own number

1. **Business verification**: Meta Business Settings → **Security Centre → Start verification**. Upload GST or Udyam certificate. Takes 1–5 days.
2. WhatsApp Manager → **Phone numbers → Add phone number** → enter the new SIM number, set the **display name** (your company name, e.g. "Doye Realty"), verify by SMS code.
3. Add a **payment method** in WhatsApp Manager (card).
4. Make a **permanent token**: Business Settings → **System users → Add** (Admin) → **Generate token** for your app with permissions `whatsapp_business_messaging` and `whatsapp_business_management`. Replace `WHATSAPP_TOKEN` with it.
5. Replace `WHATSAPP_PHONE_NUMBER_ID` with your real number's ID. Create the same two templates on the real number if they don't show up there.
6. Redeploy on Vercel.

New accounts can message about 250 different people a day at first. Meta raises this automatically as you send good-quality messages.

## Good to know

- Every agent needs their **mobile number saved in the Team page** (they log in with it, so it's saved automatically when they use WhatsApp login).
- If WhatsApp fails, the lead is still saved; only the alert is skipped. Email login keeps working.
- Never put the token in any `NEXT_PUBLIC_` variable or in the code.
- When a manager reassigns a lead on the lead page, the new agent also gets the "new lead" WhatsApp.
- The morning summary skips people with nothing due, so you don't pay for empty messages.
