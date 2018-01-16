# VueAdmin

An operations dashboard for a multi-store retailer: daily KPIs against the same weekday last week, revenue trends per store, a store leaderboard, inventory alerts ranked by days of cover, and an orders console with filtering, sorting, paging and refunds. Built with **Vue 2, Vuex, Vue Router and Chart.js** on an **Express** API.

> Portfolio reference implementation of a 2017 internal-tools project, built using Vue 2.7 + Vuex 3 loaded from a CDN with no build step, as many internal tools of that era were.

## Features

- **KPIs**: sales, orders, AOV and online share for today vs the same weekday last week (refunded and pending orders never count as revenue)
- **Trend chart**: daily revenue per store over 7, 30 or 90 days
- **Leaderboard**: sales, share of total, AOV and refund rate per store
- **Inventory alerts**: items at or below reorder point, classed *out*, *critical* (under 3 days of cover at the last 14 days' velocity) or *low*
- **Orders**: server-side filtering by status, channel, store and search, sortable columns (click again to toggle direction), pagination, and refunds (completed orders only, recorded with who did it)
- **Roles**: admin sees everything and manages users; a manager sees and refunds only their region's stores (out-of-region orders return 404, not 403, so they can't be probed); a viewer sees dashboards only. Routes are guarded client-side and every endpoint is enforced server-side
- **Auth**: scrypt-hashed passwords, constant-time comparison, opaque session tokens, logout invalidates all of a user's sessions

## Structure

```
server/app.js        API, auth, role scoping
server/metrics.js    pure aggregations (unit-tested)
server/data.js       deterministic demo data (5 stores, 90 days)
public/js/store.js   Vuex modules (auth, dashboard, orders): a UMD module, so Node tests run the real store logic
public/js/app.js     components (KPI tile, Chart.js wrapper, dashboard, orders, login) and the router guard
```

## Run and test

```bash
npm install
npm start        # http://localhost:3000   admin@example.com / admin-pass · gulf@example.com / manager-pass
npm test
```
