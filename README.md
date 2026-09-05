# Fulfillment SmartOps

Internal web application for product lookup, stock/loss checks, POG shelf maps, order picking, and configurable Line layouts. It runs as a standard Node.js application and can be deployed from GitHub to Vibe Host.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Build

```bash
npm run build
```

## Deploy to Vibe Host from GitHub

1. Create a **PostgreSQL** database in Vibe Host and copy its connection string. This is the recommended storage because records survive every GitHub update, build, and container restart.
2. Connect this GitHub repository and select the branch containing the release (normally `main`).
3. Choose Node.js **22** (or a later version supported by Vibe Host).
4. Configure the environment variable `DATABASE_URL` with the PostgreSQL connection string.
5. Optionally set `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD`, and `BOOTSTRAP_ADMIN_NAME` to create the first Admin securely at startup. Without these values, the first screen lets you create the initial Admin once.
6. Add `OPENAI_API_KEY` as a secret environment variable to enable AI recommendations. The default model is `gpt-5-mini`; override it with `OPENAI_MODEL` when needed.
7. Add the Cloudinary server secrets `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`; optionally set `CLOUDINARY_FOLDER` (default `products`) to enable camera uploads. Never expose `CLOUDINARY_API_SECRET` in browser variables.
8. Set build command to `npm run build` and start command to `npm run start`.

The app creates its `fulfillment_state` table automatically on first start and never replaces an existing database state during deploy. GitHub updates only replace code; customer, stock, order, POG, and account data remain in PostgreSQL.

If PostgreSQL is unavailable, configure `DATA_DIR` as an **absolute persistent server volume outside the repository** (for example `/var/lib/pog/data`) and set `UPLOAD_DIR` to a persistent uploads directory. Production refuses to start when these settings are missing or point inside the source checkout, which prevents a redeploy from silently starting with empty data. Local JSON mode keeps an atomic `store.json` plus `store.backup.json`; the backup is refreshed periodically before writes and used automatically if the main file is interrupted or corrupted. A backup is a safety net, not a replacement for a persistent volume.

## Main capabilities

- Product search by name, SKU, barcode, Line, and shelf side
- Nine-column Product Master Data with background `.xlsx` updates merged by SKU (up to 500,000 rows / 100 MB), upload/import progress, reconnect recovery, and a bounded import queue
- Server-side product search, filters, expiry ordering, CSV streaming, and 100-row pagination so the browser never renders the whole catalog at once
- Product create, edit, delete, and CSV export for Manager/Admin
- Product image links (multiple URLs separated by `|`) and camera capture with signed Cloudinary upload for Manager/Admin
- Password login and Admin-managed Staff/Manager/Admin permissions
- Stock, loss, expiry, and picking workflow
- POG map with A/B shelf plans
- Manager/Admin editing of each Line's name, color, and logo text
- AI recommendations grounded only in current in-stock products, with a local-data fallback when AI is unavailable
