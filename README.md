# Content Path Overlap Checker: shared team version

Everyone who opens the Netlify link sees the same English and Hindi courses, match reports and stored report files.

## What's in this folder

| File / folder | Purpose |
|---|---|
| `public/index.html` | The web page |
| `netlify/functions/api.mjs` | Small server that saves the shared data (Netlify Blobs) |
| `netlify.toml`, `package.json` | Settings Netlify reads when it deploys |

> **Important:** Do **not** use Netlify's drag-and-drop ("Netlify Drop") deploy. Drag-and-drop does not deploy the server part, so the page would fall back to **Local mode** (data saved only in each person's browser). Use Option A or Option B below.

## Option A: Deploy through GitHub (no software to install)

1. Sign in at github.com and create a **new repository** (it can be private), e.g. `content-path-checker`.
2. In the new repository click **"uploading an existing file"**, then drag in **everything inside this folder**: `public`, `netlify`, `netlify.toml`, `package.json`, `README.md`. Keep the folder structure. Click **Commit changes**.
3. Sign in at app.netlify.com → **Add new site → Import an existing project → GitHub** → choose the repository.
4. Leave the build settings as Netlify fills them in (they come from `netlify.toml`) and click **Deploy**.
5. Open the site link. The badge at the top right should say **"● Shared: everyone with this link sees the same data"**.

To update the site later, upload the changed files to the same GitHub repository. Netlify redeploys automatically, and saved data is kept.

## Option B: Deploy with the Netlify CLI (needs Node.js)

```bash
cd content-path-checker-netlify
npm install
npx netlify-cli login
npx netlify-cli deploy --build --prod
```

## Optional: team passcode (recommended)

Without a passcode, anyone who has the link can add or delete courses. To limit changes to your team:

1. In Netlify, open the site → **Site configuration → Environment variables → Add a variable**.
2. Key: `TEAM_PASSCODE`, Value: a passcode of your choice. Save, then **Deploys → Trigger deploy**.

Anyone can still **view** courses and download reports. Saving, deleting and importing ask for the passcode once per browser.

## Moving data you already have

If you saved courses earlier in the single-file version (in your browser):
1. Open the old file → **Export backup**.
2. Open the Netlify site → **Import backup** → pick that file. The import asks whether those courses are English or Hindi.

## Notes

- **English** and **Hindi** are separate libraries. A new upload is checked against the same category. Tick **"Also compare with the … courses"** to check the other category too.
- If the same course name is uploaded again, the new file replaces it and the older file stays under **Previous versions**.
- Original report files up to 3.5 MB are stored. Bigger files still have their content paths saved, but not the file itself.
- **Export backup** downloads both categories, with all original files, as one `.json` file. Take one now and then.
