# VoyageAI — Agent-Powered Travel Planning

A modern travel-planning web app backed by Google wherever possible:

- **Explore & save** destinations, categories and places.
- **AI travel agent** (Gemini via Firebase AI Logic) for itinerary planning and chat.
- **Accounts** (Google or email/password via Firebase Auth) with persistent user profiles.
- **Persistent cloud storage** (Cloud Firestore) for bookmarks, itineraries, reviews, activity
  and login-time records — data survives across devices and restarts.
- **Protected admin dashboard** to view every registered user's account, login history and
  content counts.

## Tech stack

- [Vite](https://vitejs.dev/) + [React 18](https://reactjs.org/) + TypeScript
- [Firebase](https://firebase.google.com/) (Auth, Cloud Firestore, App Check, AI Logic)
- [Lucide React](https://lucide.dev/) icons
- Plain CSS (design tokens in `src/index.css`); no Tailwind.

## Structure

```
src/
  components/   UI: Navbar, Hero, PlaceExplorer, AuthModal, ProfileView, AdminDashboard, modals…
  services/     firebase.ts, firestoreService.ts, dataConnectService.ts, authService.ts, aiTravelAgent.ts…
  types/        travel.ts (User, UserProfile, Itinerary, UserSession, AdminUserSummary…)
  App.tsx       Root component / routing of active tabs
  index.css     Global styles & design system
firestore.rules Security rules for Cloud Firestore
firebase.json   Hosting + Firestore + emulator config
dataconnect/    Data Connect source (optional backend layer)
```

## Getting started

### Prerequisites

- Node.js 16+ and npm
- A Firebase project (this repo targets `my-first-project-55f9a`; create your own for a fork)

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the placeholder file and fill in your own values (see each comment):

```bash
cp .env.example .env.local       # local development
cp .env.example .env.production  # production builds/deploy
```

The two values are:

- `VITE_APPCHECK_DEBUG_TOKEN` — a dev-only App Check debug token (register it in the console).
- `VITE_RECAPTCHA_SITE_KEY` — a production reCAPTCHA Enterprise site key (public by design).

> **Security:** `.gitignore` excludes `.env`, `.env.*` except `.env.example`. Never commit real
> keys, tokens or the debug token. Do not enable `localhost` in reCAPTCHA allowed domains.

### 3. Run locally

```bash
npm run dev        # starts the Vite dev server
npm run build      # type-check (tsc) then production build to dist/
npm run preview    # preview the production build
```

## Firebase setup

Set up the features this app uses **before** your first local run:

| Feature | Where to configure |
| --- | --- |
| Cloud Firestore database | Firebase console → Build → Firestore → create (Native mode) |
| Authentication | Firebase console → Authentication → enable Google + Email/Password |
| AI Logic (Gemini) | `firebase init ailogic` and enable the Gemini Developer API provider |
| App Check | Requirement for AI Logic — see [Enabling production AI](#enabling-production-ai) |

Deploy rules, code and hosting:

```bash
firebase login
npx firebase-tools deploy --only firestore:rules,hosting
```

Live site is served from Firebase Hosting at your project's `.web.app` or custom domain.

## Admin dashboard

Only the allow-listed admin email (defined in `firestore.rules` → `isAdmin()`) can view the
dashboard, which appears on the **Profile** tab for that account. It lists every user's name,
email, joined date, last login, login history, and counts of saved places / trips / reviews /
activity events. Reads are enforced server-side by the Firestore rules.

## Enabling production AI (App Check)

AI Logic (Gemini) **requires** Firebase App Check. In **Firebase console → Project settings →
your web app → Security → App Check**:

1. **Apps → `voyageai-web` → Manage keys → Add reCAPTCHA Enterprise key**, and paste the site key
   you used for `VITE_RECAPTCHA_SITE_KEY`. Register the same key on the reCAPTCHA Enterprise side,
   scoped to your live domain only.
2. **APIs tab → Firebase AI Logic → Enforce** (or `Unenforced` if you want to defer).

- **Local dev:** use the `VITE_APPCHECK_DEBUG_TOKEN` (debug provider) and keep it out of production.
- **Production:** the SDK uses `ReCaptchaEnterpriseProvider` (see `src/services/firebase.ts`).

## Security rules

`firestore.rules` follows a least-privilege model:

- Users may read/write only their own documents (`sessions`, `bookmarks`, `itineraries`,
  `activity`, `profiles`, `users`).
- Reviews: any signed-in user may read; authors own writes.
- `places` / `categories` / `bookmarksMeta`: public read, no client writes.
- All admin reads are gated to the `isAdmin()` allow-list email.

Adjust the admin email and content rules as your needs change, then redeploy the rules.

## Notes

- Everything a user creates is mirrored to Cloud Firestore for cross-device persistence; a
  per-user local store backs instant, offline-friendly reads.
- `npm run build` runs `tsc` so type errors block the build.