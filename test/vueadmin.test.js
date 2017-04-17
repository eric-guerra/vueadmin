'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var createApp = require('../server/app');
var metrics = require('../server/metrics');
var data = require('../server/data');
var VueAdminStore = require('../public/js/store');

var NOW = new Date('2017-09-14T20:00:00Z'); // a Thursday

function start() {
  return new Promise(function (resolve) {
    var server = createApp({ now: function () { return NOW; } }).listen(0, function () {
      var base = 'http://localhost:' + server.address().port;
      var api = VueAdminStore.httpApi(function (url, opts) { return fetch(base + url, opts); });
      resolve({ api: api, close: function () { return new Promise(function (r) { server.close(r); }); } });
    });
  });
}

async function login(api, email, password) {
  return (await api.post('/api/login', { email: email, password: password })).token;
}

test('metrics: KPIs exclude refunds and compare to the same weekday last week', function () {
  var orders = [
    { createdAt: '2017-09-14T15:00:00Z', status: 'completed', totalCents: 10000, channel: 'online' },
    { createdAt: '2017-09-14T16:00:00Z', status: 'completed', totalCents: 5000, channel: 'in-store' },
    { createdAt: '2017-09-14T17:00:00Z', status: 'refunded', totalCents: 9999, channel: 'in-store' },
    { createdAt: '2017-09-07T15:00:00Z', status: 'completed', totalCents: 10000, channel: 'online' },
    { createdAt: '2017-09-13T15:00:00Z', status: 'completed', totalCents: 70000, channel: 'online' }
  ];
  var k = metrics.kpis(orders, NOW);
  assert.equal(k.current.salesCents, 15000);
  assert.equal(k.current.orders, 2);
  assert.equal(k.current.aovCents, 7500);
  assert.equal(k.current.refunds, 1);
  assert.equal(k.current.onlineShare, 33);
  assert.deepEqual(k.change, { salesPct: 50, ordersPct: 100, aovPct: -25 });
});

test('metrics: inventory alerts ranked by urgency using recent sales velocity', function () {
  var products = [{ sku: 'A', name: 'A', reorderPoint: 5 }, { sku: 'B', name: 'B', reorderPoint: 5 }, { sku: 'C', name: 'C', reorderPoint: 5 }];
  var inventory = [{ storeId: 'S', sku: 'A', onHand: 4 }, { storeId: 'S', sku: 'B', onHand: 0 }, { storeId: 'S', sku: 'C', onHand: 9 }];
  var orders = [{ storeId: 'S', createdAt: '2017-09-10T10:00:00Z', status: 'completed', lines: [{ sku: 'A', qty: 28 }] }];
  var alerts = metrics.inventoryAlerts(inventory, products, orders, NOW);
  assert.deepEqual(alerts.map(function (a) { return [a.sku, a.severity, a.daysOfCover]; }), [['B', 'out', null], ['A', 'critical', 2]]);
});

test('metrics: trend and leaderboard over generated data', function () {
  var db = data.generate(NOW, 1);
  var trend = metrics.salesTrend(db.orders, db.stores, NOW, 30);
  assert.equal(trend.labels.length, 30);
  assert.equal(trend.labels[29], '2017-09-14');
  var rows = metrics.storePerformance(db.orders, db.stores, '2017-08-15T00:00:00Z', NOW.toISOString());
  assert.equal(rows[0].storeId, 'HOU01', 'flagship store generates the most revenue');
  var share = rows.reduce(function (s, r) { return s + r.sharePct; }, 0);
  assert.ok(Math.abs(share - 100) < 0.5);
});

test('auth and role-based access', async function (t) {
  var env = await start();
  t.after(env.close);
  await assert.rejects(env.api.post('/api/login', { email: 'admin@example.com', password: 'nope' }), /Invalid email or password/);
  var viewer = await login(env.api, 'viewer@example.com', 'viewer-pass');
  await env.api.get('/api/dashboard', viewer);
  await assert.rejects(env.api.get('/api/orders', viewer), function (e) { return e.status === 403; });
  await assert.rejects(env.api.get('/api/dashboard'), function (e) { return e.status === 401; });

  var admin = await login(env.api, 'admin@example.com', 'admin-pass');
  var bad = env.api.post('/api/users', { email: 'x', role: 'manager', region: 'Mars', password: 'short' }, admin);
  await assert.rejects(bad, function (e) { return e.status === 422; });
  var created = await env.api.post('/api/users', { email: 'new@example.com', name: 'New', role: 'viewer', password: 'long-enough-pass' }, admin);
  assert.equal(created.role, 'viewer');
  assert.equal(created.hash, undefined, 'password hash never leaves the server');

  await env.api.post('/api/logout', null, admin);
  await assert.rejects(env.api.get('/api/users', admin), function (e) { return e.status === 401; });
});

test('managers only see their region and can refund only completed orders', async function (t) {
  var env = await start();
  t.after(env.close);
  var manager = await login(env.api, 'gulf@example.com', 'manager-pass');
  var me = await env.api.get('/api/me', manager);
  assert.deepEqual(me.stores.map(function (s) { return s.id; }), ['HOU01', 'HOU02']);
  var dash = await env.api.get('/api/dashboard?days=7', manager);
  assert.deepEqual(dash.stores.map(function (s) { return s.storeId; }).sort(), ['HOU01', 'HOU02']);
  assert.equal(dash.trend.labels.length, 7);

  var page = await env.api.get('/api/orders?status=completed&sort=totalCents&dir=desc&pageSize=10', manager);
  assert.ok(page.items.every(function (o) { return o.storeId.indexOf('HOU') === 0 && o.status === 'completed'; }));
  assert.ok(page.items[0].totalCents >= page.items[9].totalCents);
  var refunded = await env.api.post('/api/orders/' + page.items[0].id + '/refund', null, manager);
  assert.equal(refunded.status, 'refunded');
  await assert.rejects(env.api.post('/api/orders/' + page.items[0].id + '/refund', null, manager), function (e) { return e.status === 409; });

  var admin = await login(env.api, 'admin@example.com', 'admin-pass');
  var austin = await env.api.get('/api/orders?store=AUS01&pageSize=5', admin);
  await assert.rejects(env.api.post('/api/orders/' + austin.items[0].id + '/refund', null, manager), function (e) { return e.status === 404; }, 'out-of-region orders are invisible');
});

test('vuex modules: mutations, getters and actions', async function (t) {
  var env = await start();
  t.after(env.close);
  var mem = {};
  var storage = { getItem: function (k) { return mem[k] || null; }, setItem: function (k, v) { mem[k] = v; }, removeItem: function (k) { delete mem[k]; } };
  var opts = VueAdminStore.createStoreOptions(env.api, storage);

  // A minimal Vuex-like harness: enough to run namespaced actions in Node.
  var state = {};
  Object.keys(opts.modules).forEach(function (n) { state[n] = opts.modules[n].state(); });
  function commit(type, payload, options) {
    var parts = type.split('/');
    opts.modules[parts[0]].mutations[parts[1]](state[parts[0]], payload, options);
  }
  function ctx(ns) {
    return {
      state: state[ns], rootState: state,
      commit: function (type, payload, options) { commit(options && options.root ? type : ns + '/' + type, payload); },
      dispatch: function (type, payload) { return opts.modules[ns].actions[type](ctx(ns), payload); }
    };
  }
  var getter = function (ns, name) { return opts.modules[ns].getters[name](state[ns]); };

  assert.equal(await opts.modules.auth.actions.login(ctx('auth'), { email: 'admin@example.com', password: 'wrong' }), false);
  assert.equal(state.auth.error, 'Invalid email or password');
  assert.equal(await opts.modules.auth.actions.login(ctx('auth'), { email: 'admin@example.com', password: 'admin-pass' }), true);
  assert.ok(JSON.parse(mem['vueadmin.session']).token, 'session persisted');
  assert.equal(getter('auth', 'can')('manageUsers'), true);

  await opts.modules.dashboard.actions.changeRange(ctx('dashboard'), 7);
  assert.equal(state.dashboard.data.trend.labels.length, 7);
  assert.equal(getter('dashboard', 'totalTrend').length, 7);

  commit('orders/setFilter', { status: 'pending' });
  commit('orders/setSort', 'totalCents');
  commit('orders/setSort', 'totalCents');
  assert.equal(state.orders.dir, 'asc', 'clicking the same column toggles direction');
  await opts.modules.orders.actions.fetch(ctx('orders'));
  assert.ok(state.orders.result.items.every(function (o) { return o.status === 'pending'; }));

  await opts.modules.auth.actions.logout(ctx('auth'));
  assert.equal(state.auth.token, null);
  assert.equal(mem['vueadmin.session'], undefined);
});
