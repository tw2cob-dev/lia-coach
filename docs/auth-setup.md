# Auth setup (Firebase)

## 1) Create Firebase project
1. Open `https://console.firebase.google.com`
2. Click `Create a project`
3. Name it (for example `lia-coach`) and finish the wizard

## 2) Enable Email/Password auth
1. In Firebase Console, open `Build -> Authentication`
2. Click `Get started`
3. Open `Sign-in method`
4. Enable `Email/Password`

## 3) Create Web app and copy config
1. In project settings, click `General`
2. In `Your apps`, click web icon `</>`
3. Register app and copy these values:
- `apiKey`
- `authDomain`
- `projectId`
- `appId`

## 4) Set environment variables
Set these in local `.env.local` (or Windows user env vars) and in Vercel:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

Also required by chat features:
- `OPENAI_API_KEY`

Optional cost tuning:
- `NEXT_PUBLIC_LIA_COST_INPUT_PER_1K`
- `NEXT_PUBLIC_LIA_COST_OUTPUT_PER_1K`

## 5) Local test flow
1. `npm run dev`
2. Open `/login`
3. Register user (name/email/password)
4. Open verification email and click the link
5. Return to `/login` -> tab `Verificar email` -> click `Ya verifique mi email`
