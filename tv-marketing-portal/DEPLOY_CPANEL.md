# Deploying to cPanel at toolkityourlife.com/ProjectPanes

This uses cPanel's **Setup Node.js App** feature (Phusion Passenger), which most cPanel hosts include under **Software**. It takes about 10 minutes.

## Before you start
- In cPanel, open **Software → Setup Node.js App**. If it isn't there, your host doesn't offer Node.js on this plan, so ask them to enable it.
- Have the upload package ready: `projectpanes-deploy.zip`. Or build it yourself from the repo with `git archive -o projectpanes-deploy.zip HEAD:tv-marketing-portal`.
- Pick a strong admin password and keep it handy.

## 1. Upload the files
1. cPanel → **Files → File Manager**.
2. Go to your **home directory** (the top level, the folder that *contains* `public_html`). Don't upload into `public_html`, because the database would then be downloadable from the web.
3. Click **+ Folder** and name it `projectpanes`.
4. Open `projectpanes`, click **Upload**, and choose `projectpanes-deploy.zip`.
5. Back in File Manager, right-click the zip, choose **Extract**, and extract into `/home/<you>/projectpanes`. Then delete the zip.
   You should now see `app.cjs`, `package.json`, `server/` and `public/` inside `projectpanes`.

## 2. Create the Node.js app
cPanel → **Setup Node.js App** → **Create Application**:

| Field | Value |
|---|---|
| Node.js version | The highest offered. **22.x** is best; 20.x and 18.x also work. |
| Application mode | Production |
| Application root | `projectpanes` |
| Application URL | `toolkityourlife.com` / `ProjectPanes` |
| Application startup file | `app.cjs` |

Under **Environment variables**, click **Add Variable** for each of these:

| Name | Value |
|---|---|
| `BASE_PATH` | `/ProjectPanes` |
| `ADMIN_PASSWORD` | your strong admin password (only used the very first time the app starts) |
| `NODE_ENV` | `production` |
| `ANTHROPIC_API_KEY` | *(optional)* turns on importing from screenshots and PDFs |

Click **Create**.

## 3. Install and start
1. On the app's page, click **Run NPM Install** and wait for it to finish.
   - If you chose Node 22.13 or newer and a warning mentions `better-sqlite3`, you can ignore it. That package is only needed on older Node versions.
2. Click **Restart**.
3. Visit **https://toolkityourlife.com/ProjectPanes/** and sign in as `admin` with the password you set.
4. Open **Go to… → Users & permissions**, create a login for each person with the right permissions, and link each login to its personnel record. Then fill in the dropdown lists under **Dropdown options**. Department billing codes matter most.

## 4. HTTPS (needed for phone barcode scanning)
- cPanel → **Security → SSL/TLS Status**: make sure `toolkityourlife.com` has a valid certificate. If not, click **Run AutoSSL**.
- cPanel → **Domains**: turn on **Force HTTPS Redirect** for the domain.

## Backups
All the portal's data lives in one file: `~/projectpanes/data/portal.db`. cPanel's own backups include it. To keep a copy yourself, download it from File Manager now and then.

## Updating to a new version
1. Upload and extract the new zip into `projectpanes`, overwriting the old files. **Don't delete the `data` folder.**
2. **Setup Node.js App** → your app → **Run NPM Install** → **Restart**.
The database is upgraded automatically on start-up.

## Troubleshooting
| Symptom | Fix |
|---|---|
| "503", "Incomplete response" or the app won't start | Open `~/projectpanes/stderr.log` in File Manager. The last lines name the problem. |
| Log says `No SQLite driver` | Click **Run NPM Install** again, then **Restart**. Or switch the app to Node 22.13+. |
| Page loads but has no styling, or sign-in fails | Check that `BASE_PATH` is exactly `/ProjectPanes` (it is case-sensitive), then **Restart**. |
| `toolkityourlife.com/projectpanes` (lowercase) shows 404 | URLs are case-sensitive. Use `/ProjectPanes`. |
| Changed an environment variable but nothing happened | Click **Restart** after every change. |
| Camera won't open on phones | The site must load over `https://` (see step 4). |
