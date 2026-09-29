# Market Dashboard: one-time setup kit

About 40 minutes, all free. You do these steps because I'm not allowed to create accounts or handle passwords and keys. I build everything else.

**Two rules for every step**
- If any page asks for a credit card, stop and tell me. Nothing here needs one.
- Never paste a key or password into our chat. Keys go into GitHub Secrets (step 7). I never see them.

Use the new Gmail you made on 28 Sep for every sign-up. Keep the keys in a locked note (for example, Apple Notes with a password) until step 7.

---

## 1. data.dubai (DLD market data): do this first

The sign-up page is open in the Browser pane. You can also get there from data.dubai → Login → Register Now.

1. Choose **Individual**.
2. Enter your Gmail, choose a password, and tap **Next**.
3. Fill in the profile screen (name, mobile).
4. Open the verification email in Gmail and click the link.
5. Log in, then tell me "data.dubai done".

After that I'll open the "Request API Access Key" form for three datasets: Real Estate Transactions, Rent Contracts and Real Estate Projects. We fill it in together, and you approve before it's sent. The API Key and API Secret arrive later by email. Save both for step 7.

## 2. GitHub (stores the code and runs it every morning)

1. Go to github.com/signup. Use your Gmail and pick the **Free** plan. A username like `sanjayram-dubai` works.
2. When GitHub asks you to turn on two-factor authentication, do it. It's free and required.
3. Create the repository: **+** (top right) → **New repository**.
   - Name: `market-dashboard`
   - Select **Private**
   - Don't add a README
   - Click **Create repository**
4. Create a key so this Mac can upload code:
   1. Open **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   2. Name: `mac-push`. Expiration: 1 year.
   3. Repository access: **Only select repositories** → `market-dashboard`.
   4. Permissions: **Contents: Read and write** and **Workflows: Read and write**.
   5. Click **Generate** and copy the token.

   You'll paste this token once into Terminal when I ask. It never goes into chat.

## 3. Google AI Studio (Gemini, the main AI)

1. Go to aistudio.google.com and sign in with your Gmail.
2. Click **Get API key → Create API key**. Let it create a new project.
3. Copy the key and save it as `GEMINI_API_KEY`.
4. Don't turn on billing. The free tier is what we use.

## 4. Groq (backup AI)

1. Go to console.groq.com and sign up with your Gmail.
2. Open **API Keys → Create API Key**. Name it `market-dashboard`.
3. Copy the key and save it as `GROQ_API_KEY`.
4. Don't add a card.

## 5. Telegram (optional, skipped for now)

The dashboard doesn't need this. Only do it if you later want the 9:30 brief and failure alerts as phone messages.

1. Install Telegram if you don't have it. It needs your phone number.
2. Search for **@BotFather** and send `/newbot`.
   - Name: `Sanjay Market Brief`
   - Username: something ending in `bot`, e.g. `sanjay_market_brief_bot`
3. BotFather replies with a token. Save it as `TELEGRAM_BOT_TOKEN`.
4. Open your new bot and tap **Start**.
5. Search for **@userinfobot** and tap **Start**. It replies with your numeric ID. Save it as `TELEGRAM_CHAT_ID`.

## 6. Cloudflare (hosts the dashboard page)

1. Go to dash.cloudflare.com/sign-up. Use your Gmail and verify the email. Stay on the Free plan.
2. Copy your **Account ID**. It's on the account home page, in the right-hand column. Save it as `CLOUDFLARE_ACCOUNT_ID`.
3. Create an API token:
   1. Open **My Profile → API Tokens → Create Token → Create Custom Token**.
   2. Name: `market-dashboard-deploy`.
   3. Add two permissions: **Account → Cloudflare Pages → Edit** and **Account → Workers Scripts → Edit**.
   4. Click **Continue → Create Token** and copy it. Save it as `CLOUDFLARE_API_TOKEN`.
4. Optional test: click **Zero Trust** in the left menu and choose the Free plan.
   - If it asks for a payment method, close it. We'll use the password gate instead.
   - If it doesn't ask, tell me and we'll use Cloudflare Access.
5. Choose a long dashboard password, for example four random words. Save it as `DASHBOARD_PASSWORD`.

## 7. Put the keys into GitHub Secrets

1. Open your repository: **Settings → Secrets and variables → Actions → New repository secret**.
2. Add one secret for each name below, pasting the value you saved:

| Secret name | From step |
|---|---|
| `GEMINI_API_KEY` | 3 |
| `GROQ_API_KEY` | 4 |
| `TELEGRAM_BOT_TOKEN` | 5, optional |
| `TELEGRAM_CHAT_ID` | 5, optional |
| `CLOUDFLARE_ACCOUNT_ID` | 6 |
| `CLOUDFLARE_API_TOKEN` | 6 |
| `DASHBOARD_PASSWORD` | 6 |
| `DATADUBAI_API_KEY` | 1, when the email arrives |
| `DATADUBAI_API_SECRET` | 1, when the email arrives |

3. Tell me "secrets done". I only see the names, never the values.
