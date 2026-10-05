# Automatic lead capture

Every place your leads come from gets its own secret link on the **Lead sources** page (owner and manager only). When a lead arrives:

1. It is saved within seconds, with the source name.
2. If the number already exists, the enquiry is added to the existing lead. No copies.
3. It goes to the active sales agent with the fewest open leads (owner can switch this off).
4. That agent gets a WhatsApp alert (once WhatsApp is set up).

## Before you start

Run `supabase/patch-003-lead-capture.sql` once in Supabase → SQL Editor.

The links only work on your **live website** (Vercel), not on `localhost`, because the portals must reach them over the internet.

## 99acres, MagicBricks, Housing.com

These portals send leads to a CRM link only for **paid advertiser accounts**.

1. Lead sources → **Add a lead source** → pick the portal → Add.
2. Copy its **Lead link**.
3. In the portal dashboard, look for *Lead management → CRM integration / Push API / Webhook* and paste it. If you can't find it, call or email your account manager: *"Please push our leads to this CRM link: …"*. They do this every day for other CRMs.
4. Send a test enquiry from another phone. It should appear in Leads within a minute.

The link understands the common field names portals use (name, mobile, email, city, project, budget, message). If a portal uses odd names, send me one sample and I'll map it.

**If the portal won't push leads** (some smaller plans): they still email you each lead. The next step is an email address that reads those emails and creates leads automatically.

## Your own website form

1. Add a source of type **Your website form**.
2. Press **Show website form code** and paste it into your site. Or send the Lead link to your website developer.
3. Change the `_redirect` value to your thank-you page.

## Google Ads lead forms

1. Add a source of type **Google Ads**.
2. In Google Ads: open the lead form asset → **Lead delivery → Webhook integration**.
3. Paste the **Webhook URL** and the **Key** from the Lead sources page → **Send test data**.

## Facebook and Instagram lead ads

One-time setup (about 30 minutes). Uses the same Meta app as WhatsApp.

**In Vercel** add these and redeploy:
- `SUPABASE_SERVICE_ROLE_KEY` – Supabase → Project Settings → API Keys → *secret / service_role*. Never share it.
- `META_APP_SECRET` – Meta app → App settings → Basic → App secret.
- `META_VERIFY_TOKEN` – any long random word you make up.

**In the Meta app** (developers.facebook.com):
1. Add the product **Webhooks** → choose **Page** → **Subscribe to this object**.
2. Callback URL: `https://<your-site>/api/leads/meta`. Verify token: the same word as `META_VERIFY_TOKEN`.
3. Subscribe to the field **leadgen**.

**Get a page access token:**
1. Business Settings → **System users** → your admin system user → **Add assets** → your Facebook page (full control).
2. **Generate token** for your app with permissions `leads_retrieval`, `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`.
3. Connect the page to the app: in Graph API Explorer, run `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen` with that token.

**In EstateDesk:**
1. Lead sources → add **Facebook / Instagram ads** → enter your Facebook page ID.
2. Paste the page access token → **Save token**.
3. Test with Meta's **Lead Ads Testing Tool** (developers.facebook.com/tools/lead-ads-testing).

## Any other tool

Pick **Other tool**. Any app that can send a web request (Zapier, Pabbly, another CRM) can post `name`, `mobile`, `email`, `budget`, `project`, `message` to the link.

## Safety

- Each link has a long secret key. Anyone with the link can add leads, so only give it to the portal. If a link leaks, switch that source off and add a new one.
- Wrong or switched-off links are rejected. Leads without a valid 10-digit mobile are rejected.
