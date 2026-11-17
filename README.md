# RWO Registration

Race registration, payments and clearance for Race World Offshore: which boats are entered and paid, who's on each boat, what each person still needs, and whether each boat is cleared to race. Used by teams and crew before the event, and by the office, registration, tech and safety on site.

**Why it doesn't break the way Airtable did:** people are never matched to boats by typing a team name the same way twice. Crew pick their boat from a list. If they type it instead, the system works out which boat they mean on its own, even with typos ("rip curent / 8" goes to *08 Rip Current*, "allen lawn care / S17" to *S-17 Team Allen Lawn Care*), and stores a hard link. Team names count more than boat numbers, because numbers repeat between teams. Someone who signs up before their boat registers waits, can be found by name, and is placed automatically the moment their boat registers. Only a true 50/50 ever reaches the office, and once the office answers it, that spelling is remembered for everyone after.

Tested on the 2026 Key West data: of 70 real sign-ups typed after the event list had been cleaned up, 68 were placed on the right boat automatically and 2 were waiting for a boat that never registered. None were placed on the wrong boat.

## What each person sees

| Who | Where | What they can do |
|---|---|---|
| Anyone | the site address | Boat board: every boat and whether it's cleared. Tap a boat for its team page |
| Owners | **Boat registration** (or `?page=register`) | Register a boat for a race. Returning boats only answer what changed. Pay the entry fee now or later |
| Crew | **Crew sign-up** (or `?page=signup`) | Sign up, pick their boat, pay their own RWO membership |
| A team | tap their boat, or their private team link | Status at each race, each person's missing items with medical and dunker dates, and pay the entry, memberships for several crew at once, and event extras |
| Registration | sign in with the registration PIN | Find anyone by name, boat or team; tick memberships; enter dates; mark signed |
| Tech / Safety | their PIN | One big pass button per boat, with notes |
| Office | office PIN | Everything above, plus the inbox, events, boats, team links, history and the Airtable import |
| Admin | admin PIN | Everything, plus **Admin**: every setting, PINs, clearance rules, fees and prices, remembered spellings |

**Who did what, and when:** staff must enter their name to sign in. Every check (RWO member and paid, APBA member and paid, medical and dunker dates, entry paid, tech, safety, signed) shows who last changed it and when, like "Checked by Jess (Registration), Nov 17, 2:31 PM", and unticking is recorded too. Stripe payments are stamped "Stripe payment". The **History** tab lists every change in plain English and can be searched by person, boat or staff name.

## How it's built

- **Website** (the `docs` folder) is hosted free on GitHub Pages.
- **Database** is Supabase, a free hosted database.
- **Server function** (`supabase/functions/race-api`) holds every rule: matching, clearance, permissions, prices and Stripe. Browsers can't read or change the database directly, and prices always come from the server, never the browser.
- **Payments** go through Stripe Checkout, Stripe's own secure payment page. Card details never touch this app. When Stripe confirms a payment, the right box ticks itself.

Until step 5 below is done, the site runs a **demo with made-up teams**, and payments are simulated. Demo PINs: Admin 9999, Office 1111, Registration 2222, Tech 3333, Safety 4444.

---

## Setup (about an hour, once)

### 1. Put the code on GitHub
1. On github.com, click **New repository**. Name it `rwo-registration` and make it **Public**. On a free GitHub account, Pages only works on public repositories. There's no member data or secret in the code; your data lives in Supabase.
2. Upload everything from this folder, including the hidden `.github` folder. On a Mac, press Cmd+Shift+. in Finder to show hidden files before dragging.

### 2. Turn on the website
1. In the repository: **Settings > Pages**. Under **Build and deployment** choose **Deploy from a branch**, branch **main**, folder **/docs**, then **Save**.
2. After a minute your site is at `https://YOUR-GITHUB-NAME.github.io/rwo-registration/`, in demo mode.

### 3. Create the database
1. At supabase.com, create a free account and a **New project** (region: East US). Save the database password somewhere safe.
2. Open **SQL Editor > New query**, paste the whole of `supabase/schema.sql`, and click **Run**. It creates every table, locks them down, and loads starting settings, clearance rules and the fee table from your website. It's safe to run again after an update.

### 4. Add the server function
Pick **one** of these.

**A. Paste it in (simplest).** Supabase: **Edge Functions > Deploy a new function > Via Editor**, name it exactly `race-api`, replace the sample code with the whole of `supabase/functions/race-api/index.ts`, and **Deploy**. Then in the function's settings turn **off** "Verify JWT" / "Enforce JWT verification" and save. The function checks PINs itself, and Stripe can't send a login.

**B. Let GitHub deploy it.** Supabase: your avatar > **Account > Access Tokens > Generate new token**. In GitHub: **Settings > Secrets and variables > Actions**, add `SUPABASE_ACCESS_TOKEN` (the token) and `SUPABASE_PROJECT_REF` (the part before `.supabase.co` in your Project URL). Then **Actions > Deploy server function > Run workflow**. It re-deploys by itself whenever the function changes.

### 5. Connect the website to the database
1. Supabase: **Project Settings > API Keys**. Copy the **Project URL** and the **Publishable key** (starts with `sb_publishable_`). The publishable key is meant to be public. **Never** put a secret key in GitHub.
2. GitHub: edit `docs/config.js`, fill in `url` and `key`, and commit. Reload the site: it's live and empty.

### 6. Sign in as Admin and set things up
1. **Staff sign in** with your name and PIN **9999**, then open **Admin**.
2. **PINs:** change all five right away. Each department needs its own.
3. **General:** set **Website address of this app** to your GitHub Pages address from step 2. Stripe sends people back there after paying.
4. **Clearance rules:** tick what each role needs. As delivered, every role needs RWO member, RWO paid, APBA member and APBA paid, and riding roles also need a current medical and dunker/swim.
5. **Fees & prices:** your website's entry fees are loaded, with Key West prices used automatically at any event whose name includes "Key West". The RWO membership is $200. The Key West extras (RV / equipment footprint, Duval Street entry, boat build contest) are switched off until you enter their prices.

### 7. Turn on Stripe payments
Use Stripe's **test mode** first. Everything works the same, and test card 4242 4242 4242 4242 is never charged.
1. Stripe dashboard: **Developers > API keys**. Copy the **Secret key** (`sk_test_...` for testing, `sk_live_...` when you go live).
2. Supabase: **Edge Functions > Secrets** (or Project Settings > Edge Functions). Add a secret named `STRIPE_SECRET_KEY` with that key.
3. Stripe: **Developers > Webhooks > Add endpoint**.
   - Endpoint URL: `https://YOUR-PROJECT.supabase.co/functions/v1/race-api?stripe=webhook`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
4. Open the new webhook and copy its **Signing secret** (`whsec_...`). Add it in Supabase as a secret named `STRIPE_WEBHOOK_SECRET`. The app ignores any payment message that isn't signed by Stripe.
5. Try it: register a test boat, pay the entry fee with 4242 4242 4242 4242, and watch "Entry paid" tick itself.
6. When you're ready for real money, repeat steps 1 to 4 with your **live** keys and a live-mode webhook.

### 8. First event and your Airtable data
1. **Events & boats > Add an event** with its dates, and keep "Crew can sign up" on. The first event becomes current.
2. In Airtable, **Download CSV** from your Teams view and your Memberships view.
3. **Events & boats > Import from Airtable**: choose both files and click **Import**. Running it twice won't create duplicates.

### 9. Share the links
- **Boat registration:** `https://YOUR-GITHUB-NAME.github.io/rwo-registration/?page=register`
- **Crew sign-up:** `https://YOUR-GITHUB-NAME.github.io/rwo-registration/?page=signup`
- **Boat board:** the site address
- **Team links:** each owner gets theirs after registering. The office can also copy it from any boat's page.

You can link these from raceworldoffshore.com in place of the current forms and shop.

---

## Everyday use

- **Before an event:** add the event, check that fees are right, and share the registration and sign-up links. Owners register and pay; crew sign up and pay, or the owner pays for them. Look at the **Office inbox** now and then. Usually there's nothing to decide.
- **Returning boats** answer "Has your riding crew changed?" and "Has your hull or boat info changed?". Each "yes" opens that section again; everything else carries over. A rider who's been replaced stops counting for this race but stays on record for earlier ones.
- **At registration:** search a name. Green means cleared, yellow means hand them the waiver and press **Mark signed**, red lists exactly what's missing. Only the office or admin can sign someone who isn't ready, and that's recorded.
- **Paid somewhere else (cash, check, APBA site):** tick the box on the person's page. It's stamped with your name and the time.
- **Tech and safety:** the Tech or Safety tab, one button per boat. The board and team pages update within seconds.

## Admin settings, explained

| Setting | What it does |
|---|---|
| Anyone can see the boat board | Off: staff only |
| Tapping a boat opens its team page | Each person's missing items and medical/dunker dates (never emails or phones). Off: only owners with their private link |
| People can only sign once everything is done | Off: registration can sign anyone; missing items still show |
| Every person on a boat must be cleared | Off: only the riding crew holds the boat back |
| Who a boat must have, cleared | Default `Driver\|Alt Driver; Throttleman\|Alt Throttle` |
| Automatic matching | Normal places people whenever it's clear. Careful sends more close calls to the office |
| Remembered spellings | Every spelling the office has taught it. Remove any that are wrong |

## Good to know

- **Free plan pausing:** Supabase pauses free projects that get little use over 7 days. The included `Keep Registration awake` GitHub action checks in every 3 days to prevent that. If it ever pauses anyway, open the project in Supabase and click **Resume**; your data is kept.
- **Backups:** before each race, export the main tables (people, boats, crew, entries, signatures, payments) from Supabase's Table Editor.
- **Refunds** are done in the Stripe dashboard. Then untick "Entry paid" or "RWO paid" in the app; that change is recorded too.
- **Changing code:** edit files in `src/`, run `node build.js`, and commit. `docs/` and the server function are generated from `src/`.
