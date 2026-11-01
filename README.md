# CSE 6332 Project 3 — Customer Service Order Lookup

A customer service representative searches the `classicmodels` orders by date
range, then opens any order for full detail. nginx proxies to a Node.js service
that queries MySQL, all in one Docker container.

Aaron Pantoja

## Run it locally

    docker compose up -d --build

Then open <http://localhost:8082>. The container is capped at 512 MB in
`docker-compose.yaml` to match the free hosting tier it deploys to.

    docker compose logs -f
    docker compose down

## Routes

| Route | Purpose |
|---|---|
| `/` | Redirects to the search form |
| `/orders/orders-by-date` | Date range form, plus optional customer and status filters |
| `/orders/orders-by-date/results` | Matching orders; add `&format=json` for JSON |
| `/orders/orders-by-date/results.csv` | Same query as a CSV download |
| `/orders/show/:orderNumber` | Order detail as JSON; add `?format=html` for the page |
| `/node` | Service and Node version, reached through the proxy block from the assignment |
| `/healthz` | Reports the order date range, used by the Docker and host health checks |

## Database

`mysql/init/` runs at **image build time**, so a started container already has
its data and never pays for initialization:

| File | Purpose |
|---|---|
| `01-classicmodels.sql` | The sample database |
| `02-shift-dates.sql` | Advances every order and payment date by 20 years |
| `03-users.sql` | Creates `cs_mgr` (ALL) and `cs_wkr` (SELECT only) |

The 20 year shift puts the data in **2023-01-06 through 2025-05-31**, matching
the modified dataset used in the assignment.

The application connects as **`cs_wkr`**, which only holds `GRANT SELECT ON
classicmodels.*`. A read-only lookup tool has no reason to hold write
privileges, and it can be demonstrated:

    docker exec cse6332-project3 mysql -u cs_wkr -pwkr_password classicmodels \
      -e "DELETE FROM orders WHERE orderNumber=10100;"
    ERROR 1142 (42000): DELETE command denied to user 'cs_wkr'@'localhost'

Connections use the MySQL unix socket, so the database is never exposed on a
network port.

## What we added

**Money is computed in integer cents.** Floating point dollars accumulate
error: the reference implementation reports order 10100 as
`"subtotal":10223.829999999998` and `"tax":843.4659749999998`. `app/lib/money.js`
parses each `DECIMAL` price into cents, multiplies and sums as integers, and
formats only at the edge, so the same order returns `"10223.83"` and `"843.47"`.

**More ways to search.** Customer name and order status narrow the date range,
results show a count, each row carries the customer and order total, and the
whole result set downloads as CSV with correctly quoted fields.

**Dates stay dates.** `DATE` columns are read as strings, so an order placed
`2023-01-06` is reported as `2023-01-06` rather than a UTC timestamp that can
display as the previous day.

**Input is validated and parameterized.** Dates must be real calendar dates,
the start must not follow the end, and a status must be one the database
actually contains. Every value reaches MySQL as a bound parameter, so
`?customer=' OR 1=1--` returns 0 rows rather than all 326.

**Consistent presentation.** The interface reuses the Project 1 dark theme and
is served without any CDN dependency.

## Screenshots

`screenshots/` holds the search form, a successful query, an order detail page,
and a filtered query. Regenerate them with the container running:

    ./scripts/capture-screenshots.sh

## Submission archive

    ./scripts/make-submission-zip.sh
