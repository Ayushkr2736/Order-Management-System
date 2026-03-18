# Order Management System

A full-stack order management application built with **React**, **Node.js/Express**, and **PostgreSQL**. This project was developed as part of the SDE-1 Full Stack Assignment — involving a comprehensive code audit, critical bug fixes, a new feature (order cancellation), and a CI/CD pipeline.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, JavaScript, CSS |
| **Backend** | Node.js 18, Express 4 |
| **Database** | PostgreSQL 15 |
| **Infrastructure** | Docker, Docker Compose |
| **CI/CD** | GitHub Actions |
| **Linting** | ESLint 8 |

---

## Features

### Core Functionality
- **View Orders** — Sortable order list with customer and product details
- **Create Orders** — Form with customer/product selection, inventory validation, and price preview
- **Search Customers** — Real-time search by name with ILIKE pattern matching
- **Add Customers** — Inline customer creation form

### New Feature: Order Cancellation
- Cancel orders via `POST /api/orders/:id/cancel`
- Only `pending` and `confirmed` orders can be cancelled
- `shipped` and `delivered` orders are rejected with a clear error message
- Product inventory is **automatically restored** on cancellation
- Full database transaction with row-level locking prevents race conditions
- Frontend includes an **inline confirmation prompt** (not a browser popup)
- Per-row **loading state** — shows "Cancelling…" without blocking other rows
- **Success/error banners** with auto-dismiss after 4 seconds

---

## Bug Fixes Summary

A full code audit identified 13 issues across the stack. Three critical fixes were implemented:

### Fix 1: SQL Injection in Customer Search (Security)
- **File:** `backend/src/routes/customers.js`
- **Problem:** User input was concatenated directly into the SQL string, allowing arbitrary SQL execution
- **Fix:** Replaced with a parameterized query (`$1`) — consistent with the rest of the codebase

### Fix 2: N+1 Query on Order Listing (Performance)
- **File:** `backend/src/routes/orders.js`
- **Problem:** Listing N orders executed `1 + 2N` serial database queries (201 queries for 100 orders)
- **Fix:** Replaced the loop with a single `JOIN` query — the same pattern already used in `GET /orders/:id`

### Fix 3: Race Condition in Order Creation (Data Integrity)
- **File:** `backend/src/routes/orders.js`
- **Problem:** Inventory check and decrement were separate, non-transactional queries. Concurrent requests could oversell inventory
- **Fix:** Wrapped in a `BEGIN`/`COMMIT`/`ROLLBACK` transaction with `SELECT ... FOR UPDATE` row-level locking

> See [`BUG_REPORT.md`](BUG_REPORT.md) for the complete 13-issue audit and [`FIX_REPORT.md`](FIX_REPORT.md) for detailed before/after code with explanations.

---

## Getting Started

### Option A: Docker (Recommended)

```bash
docker compose up --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:3001/api |
| PostgreSQL | `localhost:5432` (user: `admin`, password: `admin123`, db: `orderdb`) |

The database is automatically seeded with sample customers, products, and orders on first boot.

### Option B: Manual Setup

**Prerequisites:** Node.js 18+, PostgreSQL 15+

#### 1. Database

```bash
# Create the database
createdb -U postgres orderdb

# Seed schema and data
psql -U postgres -d orderdb -f db/init.sql
```

#### 2. Backend

```bash
cd backend
npm install

# Set environment variables
export DB_HOST=localhost
export DB_USER=postgres
export DB_PASSWORD=your_password
export DB_NAME=orderdb
export DB_PORT=5432
export PORT=3001

npm start
```

#### 3. Frontend

```bash
cd frontend
npm install

# If backend is not on port 3001, set the API URL
export REACT_APP_API_URL=http://localhost:3001/api

npm start
```

---

## API Endpoints

### Orders

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/orders` | List all orders with customer and product details |
| `GET` | `/api/orders/:id` | Get a single order by ID |
| `POST` | `/api/orders` | Create a new order (validates inventory) |
| `PATCH` | `/api/orders/:id/status` | Update order status |
| `POST` | `/api/orders/:id/cancel` | Cancel an order and restore inventory |

#### Create Order

```bash
curl -X POST http://localhost:3001/api/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": 1,
    "product_id": 1,
    "quantity": 2,
    "shipping_address": "42 MG Road, Bangalore"
  }'
```

#### Cancel Order

```bash
curl -X POST http://localhost:3001/api/orders/3/cancel
```

**Cancellation rules:**
| Current Status | Can Cancel? | Response |
|---|---|---|
| `pending` | ✅ Yes | `200` — Order cancelled, inventory restored |
| `confirmed` | ✅ Yes | `200` — Order cancelled, inventory restored |
| `shipped` | ❌ No | `400` — "Cannot cancel order with status shipped" |
| `delivered` | ❌ No | `400` — "Cannot cancel order with status delivered" |
| `cancelled` | ❌ No | `400` — "Order is already cancelled" |

### Customers

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/customers` | List all customers |
| `GET` | `/api/customers/search?name=X` | Search customers by name |
| `GET` | `/api/customers/:id` | Get a single customer |
| `POST` | `/api/customers` | Create a new customer |

### Products

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/products` | List all products |
| `GET` | `/api/products/:id` | Get a single product |
| `PATCH` | `/api/products/:id/inventory` | Update product inventory |

### Health Check

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Returns `{ "status": "ok" }` |

---

## CI/CD Pipeline

A GitHub Actions workflow runs automatically on every pull request to `main`.

### Pipeline Structure

```
Pull Request → main
       │
       ▼
  ┌──────────┐
  │   LINT   │  ← ESLint on backend code
  └────┬─────┘
       │ must pass
       ▼
  ┌──────────────┐
  │ HEALTH CHECK │  ← Real PostgreSQL + seeded DB + API tests
  └──────────────┘
```

### Job 1: Lint
- Checks out code
- Installs backend dependencies
- Runs `npm run lint` (ESLint with Node.js rules)

### Job 2: Health Check
- Spins up a **real PostgreSQL 15** service container
- Seeds the database with `db/init.sql`
- Starts the backend server
- Verifies three endpoints respond correctly:
  - `GET /api/health` → HTTP 200
  - `GET /api/orders` → no error in response
  - `GET /api/products` → no error in response

> See [`.github/workflows/ci.yml`](.github/workflows/ci.yml) for the full configuration.

---

## Project Structure

```
├── .github/workflows/
│   └── ci.yml                  # GitHub Actions CI pipeline
├── backend/
│   ├── Dockerfile
│   ├── .eslintrc.json          # ESLint configuration
│   ├── package.json
│   └── src/
│       ├── index.js            # Express entry point
│       ├── config/
│       │   └── db.js           # PostgreSQL connection pool
│       └── routes/
│           ├── customers.js    # Customer CRUD routes
│           ├── products.js     # Product CRUD routes
│           └── orders.js       # Order CRUD + cancel route
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js            # React entry point
│       ├── App.js              # Tab navigation
│       ├── App.css             # Global styles
│       ├── api/
│       │   └── index.js        # API client functions
│       └── components/
│           ├── OrderList.js    # Order table + cancel UI
│           ├── CreateOrder.js  # Order creation form
│           └── CustomerSearch.js
├── db/
│   └── init.sql                # Schema + seed data
├── docker-compose.yml
├── BUG_REPORT.md               # 13-issue code audit
├── FIX_REPORT.md               # Detailed fix documentation
└── README.md
```

---

## Deliverables

| Deliverable | File |
|---|---|
| Bug Report (13 issues) | [`BUG_REPORT.md`](BUG_REPORT.md) |
| Fix Report (3 critical fixes) | [`FIX_REPORT.md`](FIX_REPORT.md) |
| Order Cancellation Feature | `backend/src/routes/orders.js` + `frontend/src/components/OrderList.js` |
| CI/CD Pipeline | `.github/workflows/ci.yml` |
