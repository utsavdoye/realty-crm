# Demo data — try every screen with fake data

## What you get

- **Doye Realty (Demo)** — about 900 leads from the last 5 months, in every stage, with calls, notes, site visits, bookings and lost leads.
- **9 projects with photos, map pins and client links** (two are kept private on purpose).
- **About 45 deals with money**: deal value, commission, buyer payment plans (some late), commission received, employee incentives, 6 months of expenses (ads, salaries, rent…).
- **15 client shortlists** already sent, some opened, some with "I like this" or "Book a visit".

## Logins (Demo tab on the login page, password `Demo@12345`)

| Person | Role | Sees |
|---|---|---|
| Rajesh Doye | Admin | Everything, including **Money** |
| Sunita Doye | Admin | Everything, including **Money** |
| Priya Nair | Manager | All leads, reports, team, map — **no Money** |
| Amit, Sneha, Rahul, Kavya, Arjun, Fatima | Employee | Only their own leads. No reports, money or export |
| Vikram Singh | Employee | Joined 3 days ago, almost empty screens |
| Deepak Rao | Removed | Must see "Your access was removed" |

Clients don't log in. They get a link (see below).

## How to load it

1. Supabase → **SQL Editor**: run `schema.sql`, then patches **002 → 008** in order (enable `pg_cron` before 005).
2. Run `supabase/demo-seed.sql`. If the popup asks, choose **Run without RLS**. You should see a table with about 908 leads, ~45 deals, ~100 money entries, 15 shortlists.
3. `.env.local` must have `NEXT_PUBLIC_DEMO_LOGIN=true`. Restart `npm run dev`.

Running the seed again wipes and rebuilds the demo. Your real company is never touched.

## What to test

- **Money (Rajesh or Sunita):** left menu → Money. Overview, Deals (open one → mark a payment paid, add commission received), Money in/out (add an expense), Salaries & incentives. Then log in as Priya — Money must not appear, and typing `/money` in the address bar must send her away.
- **Client link for a project:** Projects → a project with "Client link is on" → Preview. This is what a buyer sees (photos, price, map, nearby metro/tech parks, "Call me back" / "Book a visit"). Fill the form → a new lead appears in the CRM.
- **Personal shortlist:** open any lead that is Interested → "Send homes to the client" → tick projects → Make link → WhatsApp. Open the link in an incognito window → the employee gets an alert "opened your shortlist". Tap "Book a site visit" → alert + note on the lead.
- **Map:** left menu → Map. Tap pins, switch on metro / tech parks / hospitals / schools, orange circles show where leads want to buy.
- **"We had a lead who wanted this":** a new project "Aster Greens (new launch)" was just added. Look at the 🔔 alerts, the Today page panel, the project card, and any matching lead's page. Add your own project with a price and BHK and watch the alerts appear.
- **Filters:** Leads → More filters: date range, budget, BHK, property type, area, purpose, "requirement filled / missing".

## Remove the demo

Run `supabase/demo-remove.sql`, and set `NEXT_PUBLIC_DEMO_LOGIN=false`.
**Never turn on the Demo tab on the real website.**
