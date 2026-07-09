# Deploying LOI Vault (no engineering experience required)

You'll set up three free accounts — Supabase (database), Anthropic (AI), and Netlify (hosting) — and connect them with five settings. Budget about 30 minutes the first time.

---

## Step 1 — Supabase (your database)

1. Go to **supabase.com** and click **Start your project**. Sign up with your work email.
2. Click **New project**. Name it `loi-vault`, set a database password (save it somewhere, though you won't need it day-to-day), pick the region closest to you (US East for NYC), and click **Create new project**. Wait ~2 minutes while it provisions.
3. In the left sidebar, click **SQL Editor**, then **New query**.
4. Open the file `supabase/migration.sql` from this project in any text editor. Select all, copy, and paste it into the SQL Editor.
5. Click **Run** (bottom right). You should see "Success. No rows returned." That created your tables, security rules, and file storage.

### Get your Supabase keys (you'll need them in Step 4)

1. In the left sidebar click the **gear icon (Project Settings)** → **API**.
2. Copy three things into a notes file:
   - **Project URL** (looks like `https://abcdefg.supabase.co`)
   - **anon public** key (long string starting with `eyJ`)
   - **service_role** key (also starts with `eyJ` — click "Reveal" first). **Treat this one like a password.**

### Turn on email sign-in

1. Left sidebar → **Authentication** → **Providers**. Make sure **Email** is enabled (it is by default).
2. Under **Authentication** → **URL Configuration**:
   - You'll come back here in Step 5 to paste your Netlify URL. **This is the #1 gotcha** — if you skip it, sign-in emails arrive but the link won't log you in.

---

## Step 2 — Anthropic (the AI that reads LOIs)

1. Go to **console.anthropic.com** and create an account.
2. Click **Billing** and add a payment method. Put **~$20** of credit on the account — a typical LOI extraction costs a few cents, so $20 lasts a long time.
3. Click **API Keys** → **Create Key**. Name it `loi-vault`, copy the key (starts with `sk-ant-`), and save it in your notes file. You can't see it again after closing the dialog.

---

## Step 3 — Netlify (the website host)

Two options — GitHub is better long-term, drag-and-drop is faster today.

**Option A — connect a GitHub repo (recommended):**
1. Put this project folder in a GitHub repository (GitHub Desktop app makes this point-and-click: File → New Repository → drag the folder in → Publish).
2. Go to **app.netlify.com**, sign up, click **Add new site → Import an existing project → GitHub**, and pick your repo.
3. Netlify auto-detects Next.js. Don't change the build settings. **Don't click Deploy yet** — do Step 4 first.

**Option B — CLI deploy (if you don't want GitHub):**
Netlify's drag-and-drop ZIP upload doesn't work for this app (it needs a build step). If you skip GitHub, install the Netlify CLI (`npm install -g netlify-cli`, requires Node.js from nodejs.org) and run `netlify deploy --build --prod` inside the project folder. If that sounds like too much, use Option A — it's genuinely easier.

---

## Step 4 — Add the five environment variables

In Netlify: **Site configuration → Environment variables → Add a variable**. Add each of these (exact spelling matters):

| Key | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your `sk-ant-...` key from Step 2 |
| `NEXT_PUBLIC_SUPABASE_URL` | your Project URL from Step 1 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the **anon public** key |
| `SUPABASE_SERVICE_ROLE_KEY` | the **service_role** key |
| `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS` | your firm's email domain(s), e.g. `nmrk.com` — comma-separated for multiple |

Optional: add `CLAUDE_MODEL` if you ever want to change which Claude model is used (defaults to `claude-sonnet-4-5`).

---

## Step 5 — Deploy and connect the pieces

1. In Netlify, click **Deploy site** (or trigger a deploy from the **Deploys** tab). Wait ~2 minutes.
2. Copy your site URL (something like `https://loi-vault.netlify.app`).
3. **Back in Supabase**: Authentication → URL Configuration:
   - Set **Site URL** to your Netlify URL.
   - Under **Redirect URLs**, click Add URL and enter `https://YOUR-SITE.netlify.app/dashboard` (and `https://YOUR-SITE.netlify.app`). Again — skipping this is the most common reason sign-in breaks.
4. Open your Netlify URL, enter your work email, click the link in the email, and you should land on the Buildings page.
5. **Test with a real LOI**: create a building, click **+ New transaction**, drop in a PDF or Word LOI, and watch it extract. Spot-check the trail column against the document — a red dot on a cell means low confidence, so check that one.
6. Drop the next proposal into the same transaction with **+ Add proposal**. It becomes column two.
7. Click **+ Suggested counter** to draft the landlord's position as a final column. It starts as a copy of the last proposal; every cell you leave alone stays shaded yellow, meaning you're accepting it.

---

## Sharing it with your team

There's nothing to install and no per-person setup. Send teammates the Netlify URL. They enter their work email, click the link, and they're in — as long as their domain is in `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS`.

Everyone on the same email domain sees the same buildings, the same transactions, and the same tracker, live. There are no private workspaces: if you add a building, the desk sees it. Edits to a cell save immediately and show up for the next person who loads the page.

---

## Troubleshooting

**The magic-link email never arrives, or the link doesn't sign me in**
- 90% of the time this is the Redirect URL from Step 5.3 — make sure your exact Netlify URL (with `https://`) is in Supabase's Redirect URLs list.
- Check spam. Supabase's built-in email sender is rate-limited (a handful per hour); if the team is onboarding all at once, wait a few minutes between attempts.

**Upload works but the trail column comes back empty**
- Usually the `ANTHROPIC_API_KEY` is missing, mistyped, or the account has no credit — check **Site configuration → Environment variables** in Netlify and your balance at console.anthropic.com.
- If the LOI is a **scanned image PDF** (a photo of paper rather than a digital file), there's no text to read. The app will tell you this; enter the terms manually — every cell in the trail is editable, in any column.

**"Function timeout" on long LOIs**
- Netlify's free tier caps functions at 10 seconds; long documents can exceed that. This project's `netlify.toml` already requests a 60-second timeout, which is honored on **Netlify Pro** ($19/user/mo). Upgrading the site to Pro fixes it. Shorter LOIs generally finish within the free tier's 10 seconds.

**Export (PDF/Word/Excel) fails or downloads a broken file**
- Exports build in your browser, so a stale tab is the usual culprit — hard-refresh (Cmd+Shift+R) and try again.
- PDF export uses built-in Helvetica, so missing-font errors mean the page didn't fully load its export module; refresh and retry on a stable connection.
- If Excel opens with a warning, click "Yes" to recover — it's usually a locale settings mismatch, and the numbers are intact.

**A proposal didn't add a column**
- Each round has to go into the *same transaction*. Open the transaction and use **+ Add proposal** rather than **+ New transaction** on the building page.
- If a column landed in the wrong place, hover its header and click the ✕ to delete it, then re-upload.

**The wrong cells are highlighted**
- The **Highlight** dropdown above the grid switches between *Agreed terms* (shade what the last column accepts from the one before it) and *Terms that moved* (shade what changed). The app guesses based on whether your last column is a drafted counter; override it there.

**A date shows as "—" or the wrong format**
- Dates that are conditions rather than calendar dates ("Upon lease execution and completion of Landlord's Work") get left blank by the extractor on purpose, since inventing a date would be worse. Click the cell and type the condition — it's stored as written and treated as the value from then on.
- The date in a column header is the date **on the proposal**, not the day you uploaded it. Correct it with the small date field under the header.

**Someone from outside the firm can't sign in**
- That's the allowlist working. Add their domain to `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAINS` in Netlify (comma-separated) and redeploy.

---

## What it costs to run

- **Supabase**: free tier is plenty for a team's LOIs.
- **Netlify**: free tier works; Pro ($19/mo) only if you hit function timeouts on long documents.
- **Anthropic**: pay-per-use, a few cents per extraction. $20 of credit goes a long way.
