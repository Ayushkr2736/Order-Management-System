# Bug Report — Order Management System

A comprehensive review of the full-stack codebase (backend, frontend, database, infrastructure) uncovering security vulnerabilities, performance bottlenecks, data integrity issues, and correctness bugs.

---

## Issue 1: SQL Injection in Customer Search

- **Location:** `backend/src/routes/customers.js` — Line 19
- **Problem:**  
  The search endpoint builds its SQL query via direct string concatenation:
  ```javascript
  const query = "SELECT * FROM customers WHERE name ILIKE '%" + name + "%'";
  ```
  The `name` query parameter from the user is interpolated into the SQL string without any sanitization or parameterization. Every other query in the codebase correctly uses parameterized queries (`$1`, `$2`, …), making this a clear oversight.
- **Impact:**  
  An attacker can inject arbitrary SQL via a crafted request such as:
  ```
  GET /api/customers/search?name='; DROP TABLE orders; --
  ```
  This enables full database compromise — data exfiltration, table deletion, or privilege escalation. This is the most severe vulnerability in the codebase and would be an instant fail in any security audit. It is classified as [CWE-89](https://cwe.mitre.org/data/definitions/89.html).
- **Fix:**  
  Use a parameterized query, consistent with the rest of the codebase:
  ```javascript
  const result = await pool.query(
    "SELECT * FROM customers WHERE name ILIKE $1",
    [`%${name}%`]
  );
  ```

---

## Issue 2: Race Condition in Order Creation (No Transaction)

- **Location:** `backend/src/routes/orders.js` — Lines 54–88
- **Problem:**  
  The order creation flow executes three dependent database operations as separate, non-transactional queries:
  1. `SELECT` to check product inventory
  2. `INSERT` to create the order
  3. `UPDATE` to decrement inventory

  These are not wrapped in a `BEGIN`/`COMMIT` block. This creates two distinct failure modes:

  **Race condition (TOCTOU):** Two concurrent requests can both read `inventory_count = 1`, both pass the check, both insert orders, and both decrement — driving inventory to `-1`.

  **Partial failure:** If the INSERT succeeds but the UPDATE fails (e.g., connection drop), the order exists in the database but inventory was never decremented. There is no rollback mechanism.
- **Impact:**  
  Inventory overselling under concurrent load. Data inconsistency between orders and product stock that is difficult to detect after the fact.
- **Fix:**  
  Wrap all three operations in a database transaction using `pool.connect()` + `BEGIN`/`COMMIT`/`ROLLBACK`. Use `SELECT ... FOR UPDATE` on the product row to acquire a row-level lock, preventing concurrent reads of stale inventory:
  ```javascript
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const product = await client.query(
      'SELECT * FROM products WHERE id = $1 FOR UPDATE', [product_id]
    );
    // ... validate inventory, insert order, decrement stock ...
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  ```

---

## Issue 3: Global Error Handler Returns HTTP 200 on Errors

- **Location:** `backend/src/index.js` — Lines 23–26
- **Problem:**  
  The Express global error handler catches all unhandled errors and responds with:
  ```javascript
  app.use((err, req, res, next) => {
    console.log('Something happened');
    res.status(200).json({ success: true });
  });
  ```
  It returns status `200` with `{ success: true }` regardless of the error. The actual `err` object is never logged — only the useless string `'Something happened'` is printed.
- **Impact:**  
  Clients receive a success response when the server has failed. This silently masks bugs, makes production debugging nearly impossible, and defeats any monitoring/alerting system that relies on HTTP 5xx status codes to detect failures.
- **Fix:**  
  Return a proper `500` status, log the actual error, and avoid leaking internal details to the client:
  ```javascript
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });
  ```

---

## Issue 4: Hardcoded Database Credentials

- **Location:** `backend/src/config/db.js` — Lines 4–10, `docker-compose.yml` — Lines 7–9
- **Problem:**  
  Database credentials are hardcoded directly in source code:
  ```javascript
  const pool = new Pool({
    user: 'admin',
    password: 'admin123',
    host: 'db',
    ...
  });
  ```
  The same values appear in `docker-compose.yml`. Both files are committed to version control.
- **Impact:**  
  Credentials persist in Git history permanently, even if changed later. Anyone with repo access (current or future) has full database credentials. This violates SOC2 and PCI-DSS compliance requirements.
- **Fix:**  
  Read credentials from environment variables:
  ```javascript
  const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST || 'db',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'orderdb',
  });
  ```
  Pass these values via `docker-compose.yml` environment section referencing a `.env` file (which is `.gitignore`-d), and provide a `.env.example` template in the repo.

---

## Issue 5: N+1 Query Problem on Order Listing

- **Location:** `backend/src/routes/orders.js` — Lines 6–30
- **Problem:**  
  The `GET /api/orders` endpoint fetches all orders, then loops through each one and fires two additional queries (customer + product) per order:
  ```javascript
  for (const order of orders) {
    const customerResult = await pool.query('SELECT ... WHERE id = $1', [order.customer_id]);
    const productResult  = await pool.query('SELECT ... WHERE id = $1', [order.product_id]);
  }
  ```
  For N orders, this executes `1 + 2N` serial database queries. Notably, the `GET /api/orders/:id` endpoint on line 33 already solves this with a proper `JOIN` — the list endpoint simply doesn't use the same approach.
- **Impact:**  
  Response time scales linearly with order count. With 100 orders, that is 201 queries (~1 second). With 1,000 orders, it is 2,001 queries (~10 seconds). The endpoint will eventually time out under any realistic data volume.
- **Fix:**  
  Replace the loop with a single `JOIN` query (the same pattern already used in the `GET /:id` route):
  ```javascript
  const result = await pool.query(`
    SELECT o.*, c.name AS customer_name, c.email AS customer_email,
           p.name AS product_name, p.price AS product_price
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    JOIN products p ON o.product_id = p.id
    ORDER BY o.created_at DESC
  `);
  res.json(result.rows);
  ```

---

## Issue 6: No Validation on Order Status Updates

- **Location:** `backend/src/routes/orders.js` — Lines 92–106
- **Problem:**  
  The `PATCH /api/orders/:id/status` endpoint accepts any value for `status` from `req.body` and writes it directly to the database. There is no whitelist of valid statuses and no state-transition logic. An order can be moved from `delivered` back to `pending`, or set to an arbitrary string like `"xyz"`.
- **Impact:**  
  Business logic integrity is broken. Order lifecycle becomes meaningless — a shipped order can be reverted, a delivered order can be reset. Reporting and analytics on order status become unreliable.
- **Fix:**  
  Validate against a whitelist of allowed statuses and enforce valid transitions:
  ```javascript
  const VALID_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered'];
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  ```
  Optionally, implement a state machine that enforces valid transitions (e.g., `pending → confirmed → shipped → delivered`).

---

## Issue 7: Frontend API Layer Never Checks HTTP Response Status

- **Location:** `frontend/src/api/index.js` — All functions (lines 3–53)
- **Problem:**  
  Every API function calls `fetch()` and immediately returns `res.json()` without checking `res.ok` or `res.status`:
  ```javascript
  export async function fetchOrders() {
    const res = await fetch(`${API_BASE}/orders`);
    return res.json(); // never checks if response indicates an error
  }
  ```
  The `fetch` API does not reject on HTTP 4xx/5xx errors — those are still resolved promises. Additionally, there is no `try/catch`, so network-level failures (server offline, DNS failure) throw unhandled promise rejections.
- **Impact:**  
  Error responses from the backend are silently treated as success. Combined with Issue #3 (backend returns 200 on errors), the frontend has no reliable way to detect failures. Users see stale or incorrect data with no error indication.
- **Fix:**  
  Add a shared helper function that checks `res.ok` and throws on errors:
  ```javascript
  async function request(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed with status ${res.status}`);
    }
    return res.json();
  }
  ```

---

## Issue 8: Missing `useEffect` Dependency in Product Preview

- **Location:** `frontend/src/components/CreateOrder.js` — Lines 20–25
- **Problem:**  
  The `useEffect` that computes the selected product preview only depends on `[products]`, but it also reads `selectedProduct`:
  ```javascript
  useEffect(() => {
    if (selectedProduct) {
      const product = products.find(p => p.id === parseInt(selectedProduct));
      setSelectedProductData(product);
    }
  }, [products]); // Missing dependency: selectedProduct
  ```
  The effect runs once when `products` loads, but does not re-run when the user selects a different product.
- **Impact:**  
  The product preview panel (name, price × quantity, available stock) does not update when the user changes their product selection. The user sees stale pricing and stock information, which can lead to orders placed with incorrect expectations.
- **Fix:**  
  Add `selectedProduct` to the dependency array, and handle the deselection case:
  ```javascript
  useEffect(() => {
    if (selectedProduct) {
      const product = products.find(p => p.id === parseInt(selectedProduct));
      setSelectedProductData(product);
    } else {
      setSelectedProductData(null);
    }
  }, [products, selectedProduct]);
  ```

---

## Issue 9: Customer Search Has No Debounce and No URL Encoding

- **Location:** `frontend/src/components/CustomerSearch.js` — Lines 13–21, `frontend/src/api/index.js` — Line 37
- **Problem:**  
  The search handler fires an API call on every keystroke with no debounce:
  ```javascript
  const handleSearch = async (value) => {
    setQuery(value);
    if (value.length > 0) {
      const data = await searchCustomers(value); // fires on every character
      setResults(data);
    }
  };
  ```
  Additionally, the `name` parameter is interpolated into the URL without `encodeURIComponent`:
  ```javascript
  const res = await fetch(`${API_BASE}/customers/search?name=${name}`);
  ```
- **Impact:**  
  Typing "Aarav" fires 5 sequential API calls. Under moderate concurrent usage, this generates unnecessary database load. Because each API call hits the SQL-injectable endpoint (Issue #1), it also multiplies the attack surface. The missing URL encoding means names containing `&`, `#`, or spaces will break the query string.
- **Fix:**  
  Apply `encodeURIComponent(name)` in the API call. Add a 300ms debounce to the search handler using `setTimeout`/`clearTimeout` or a `useDebouncedValue` hook.

---

## Issue 10: Array Index Used as React Key in Sortable Order List

- **Location:** `frontend/src/components/OrderList.js` — Line 60
- **Problem:**  
  The order table rows use the array loop index as the React `key`:
  ```jsx
  {sortedOrders.map((order, index) => (
    <tr key={index}>
  ```
  This list is sortable — clicking column headers re-sorts the array. When the sort order changes, the index-to-order mapping changes, but React sees the same keys in the same positions and reuses existing DOM nodes.
- **Impact:**  
  After sorting, the `<select>` dropdowns for order status may display values from the wrong order. If a user changes a status immediately after sorting, the status update could be applied to the wrong order via `handleStatusChange(order.id, ...)`.
- **Fix:**  
  Use the stable, unique `order.id` as the key:
  ```jsx
  {sortedOrders.map((order) => (
    <tr key={order.id}>
  ```

---

## Issue 11: Open CORS Policy Allows Any Origin

- **Location:** `backend/src/index.js` — Line 10
- **Problem:**  
  CORS is enabled with no configuration:
  ```javascript
  app.use(cors());
  ```
  This sets `Access-Control-Allow-Origin: *`, allowing any website to make cross-origin requests to the API.
- **Impact:**  
  A malicious third-party website can make API calls from a victim's browser — reading customer PII, creating orders, or modifying order statuses. Combined with the absence of authentication, this means any website on the internet has full, unrestricted access to the API.
- **Fix:**  
  Restrict CORS to the known frontend origin:
  ```javascript
  app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  }));
  ```

---

## Issue 12: `POST` Endpoints Return `200` Instead of `201 Created`

- **Location:** `backend/src/routes/customers.js` — Line 48, `backend/src/routes/orders.js` — Line 85
- **Problem:**  
  Both `POST` endpoints return the default `200 OK` HTTP status when a new resource is successfully created:
  ```javascript
  res.json(result.rows[0]); // sends 200
  ```
- **Impact:**  
  Violates REST conventions. Any API consumer or integration expecting `201 Created` to confirm resource creation will not function correctly. It also makes API behavior less predictable and harder to document.
- **Fix:**  
  Explicitly set the `201` status code:
  ```javascript
  res.status(201).json(result.rows[0]);
  ```

---

## Issue 13: Seed Data Inventory Not Adjusted for Existing Orders

- **Location:** `db/init.sql` — Lines 40–56
- **Problem:**  
  The seed data inserts 8 orders with various quantities but never decrements the product `inventory_count` values. For example, Product 1 ("Wireless Earbuds") is seeded with `inventory_count = 50`, but orders for 3 total units already exist in the seed data — the count should be `47`.
- **Impact:**  
  The database is initialized with incorrect inventory from the very first boot. Any logic that relies on `inventory_count` being accurate (such as the order creation inventory check) will allow more orders than physically possible. This is a data integrity issue that undermines the correctness of the application.
- **Fix:**  
  Adjust the seed `inventory_count` values to reflect the quantities consumed by the seeded orders, or add `UPDATE` statements after the order inserts to decrement inventory accordingly.
