'use strict';

/** Aggregations behind the dashboard. Refunded and pending orders never count toward revenue. */

function dayKey(iso) {
  return iso.slice(0, 10);
}

function isRevenue(o) {
  return o.status === 'completed';
}

function sum(list, fn) {
  return list.reduce(function (s, x) { return s + fn(x); }, 0);
}

function inRange(o, from, to) {
  return o.createdAt >= from && o.createdAt < to;
}

/** Today vs the same weekday last week, for the KPI tiles. */
function kpis(orders, now) {
  var today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  var tomorrow = new Date(today.getTime() + 86400000);
  var lastWeek = new Date(today.getTime() - 7 * 86400000);
  var lastWeekEnd = new Date(lastWeek.getTime() + 86400000);

  function snapshot(from, to) {
    var list = orders.filter(function (o) { return inRange(o, from.toISOString(), to.toISOString()); });
    var revenue = list.filter(isRevenue);
    var sales = sum(revenue, function (o) { return o.totalCents; });
    return {
      salesCents: sales,
      orders: revenue.length,
      aovCents: revenue.length ? Math.round(sales / revenue.length) : 0,
      refunds: list.filter(function (o) { return o.status === 'refunded'; }).length,
      pending: list.filter(function (o) { return o.status === 'pending'; }).length,
      onlineShare: list.length ? Math.round(100 * list.filter(function (o) { return o.channel === 'online'; }).length / list.length) : 0
    };
  }

  var cur = snapshot(today, tomorrow);
  var prev = snapshot(lastWeek, lastWeekEnd);
  function delta(a, b) { return b ? Math.round(1000 * (a - b) / b) / 10 : null; }
  return {
    date: dayKey(today.toISOString()),
    current: cur,
    previous: prev,
    change: { salesPct: delta(cur.salesCents, prev.salesCents), ordersPct: delta(cur.orders, prev.orders), aovPct: delta(cur.aovCents, prev.aovCents) }
  };
}

/** Daily revenue per store for the trailing `days` days (line chart). */
function salesTrend(orders, stores, now, days) {
  var labels = [];
  var end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (var i = days - 1; i >= 0; i--) labels.push(new Date(end - i * 86400000).toISOString().slice(0, 10));
  var index = {};
  labels.forEach(function (d, i) { index[d] = i; });
  var series = {};
  stores.forEach(function (s) { series[s.id] = labels.map(function () { return 0; }); });
  orders.forEach(function (o) {
    var i = index[dayKey(o.createdAt)];
    if (i === undefined || !isRevenue(o) || !series[o.storeId]) return;
    series[o.storeId][i] += o.totalCents;
  });
  return { labels: labels, datasets: stores.map(function (s) { return { storeId: s.id, label: s.name, data: series[s.id] }; }) };
}

/** Store leaderboard for a period, with share of total revenue. */
function storePerformance(orders, stores, from, to) {
  var rows = stores.map(function (s) {
    var list = orders.filter(function (o) { return o.storeId === s.id && inRange(o, from, to); });
    var rev = list.filter(isRevenue);
    var sales = sum(rev, function (o) { return o.totalCents; });
    return {
      storeId: s.id, name: s.name, region: s.region, salesCents: sales, orders: rev.length,
      aovCents: rev.length ? Math.round(sales / rev.length) : 0,
      refundRate: list.length ? Math.round(1000 * list.filter(function (o) { return o.status === 'refunded'; }).length / list.length) / 10 : 0
    };
  });
  var total = sum(rows, function (r) { return r.salesCents; });
  rows.forEach(function (r) { r.sharePct = total ? Math.round(1000 * r.salesCents / total) / 10 : 0; });
  return rows.sort(function (a, b) { return b.salesCents - a.salesCents; });
}

/** Stock at or below reorder point, most urgent first (days of cover based on the last 14 days of sales). */
function inventoryAlerts(inventory, products, orders, now) {
  var since = new Date(now.getTime() - 14 * 86400000).toISOString();
  var sold = {};
  orders.forEach(function (o) {
    if (o.createdAt < since || !isRevenue(o)) return;
    o.lines.forEach(function (l) {
      var k = o.storeId + '|' + l.sku;
      sold[k] = (sold[k] || 0) + l.qty;
    });
  });
  var bySku = {};
  products.forEach(function (p) { bySku[p.sku] = p; });
  return inventory
    .filter(function (i) { return i.onHand <= bySku[i.sku].reorderPoint; })
    .map(function (i) {
      var perDay = (sold[i.storeId + '|' + i.sku] || 0) / 14;
      return {
        storeId: i.storeId, sku: i.sku, name: bySku[i.sku].name, onHand: i.onHand, reorderPoint: bySku[i.sku].reorderPoint,
        dailySales: Math.round(perDay * 10) / 10,
        daysOfCover: perDay > 0 ? Math.round((i.onHand / perDay) * 10) / 10 : null,
        severity: i.onHand === 0 ? 'out' : perDay > 0 && i.onHand / perDay < 3 ? 'critical' : 'low'
      };
    })
    .sort(function (a, b) {
      var rank = { out: 0, critical: 1, low: 2 };
      return rank[a.severity] - rank[b.severity] || (a.daysOfCover === null ? 1e9 : a.daysOfCover) - (b.daysOfCover === null ? 1e9 : b.daysOfCover);
    });
}

module.exports = { kpis: kpis, salesTrend: salesTrend, storePerformance: storePerformance, inventoryAlerts: inventoryAlerts };
