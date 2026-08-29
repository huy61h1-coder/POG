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

1. Create a **PostgreSQL** database in Vibe Host and copy its connection string.
2. Connect this GitHub repository and select the branch containing the release (normally `main`).
3. Choose Node.js **22** (or a later version supported by Vibe Host).
4. Configure the environment variable `DATABASE_URL` with the PostgreSQL connection string.
5. Add `OPENAI_API_KEY` as a secret environment variable to enable AI recommendations. The default model is `gpt-5.4-mini`; override it with `OPENAI_MODEL` when needed.
6. Set build command to `npm run build` and start command to `npm run start`.

The app creates its `fulfillment_state` table automatically on first start. Set `UPLOAD_DIR` to a persistent shared volume for uploaded POG images/PDFs; a temporary application filesystem can be cleared during redeploy. When `DATABASE_URL` is omitted, the app uses `DATA_DIR/store.json` only for local demo use.

## Main capabilities

- Product search by name, SKU, barcode, Line, and shelf side
- Stock, loss, expiry, and picking workflow
- POG map with A/B shelf plans
- Manager/Admin editing of each Line's name, color, and logo text
- AI recommendations grounded only in current in-stock products, with a local-data fallback when AI is unavailable
