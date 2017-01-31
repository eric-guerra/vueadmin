'use strict';

var path = require('path');
var crypto = require('crypto');
var express = require('express');
var metrics = require('./metrics');
var generate = require('./data').generate;

/**
 * Roles: admin (everything), manager (dashboards + orders for their region), viewer (dashboards only).
 * Sessions are opaque tokens in memory; passwords are scrypt-hashed.
 */
function hash(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

function createApp(options) {
  options = options || {};
  var now = options.now || function () { return new Date(); };
  var db = options.data || generate(now());
  var users = new Map();
  var sessions = new Map();

  function addUser(u) {
    var salt = crypto.randomBytes(8).toString('hex');
    var user = { id: crypto.randomUUID(), email: u.email.toLowerCase(), name: u.name, role: u.role, region: u.region || null, salt: salt, hash: hash(u.password, salt) };
    users.set(user.email, user);
    return user;
  }
  addUser({ email: 'admin@example.com', name: 'Ada Admin', role: 'admin', password: 'admin-pass' });
  addUser({ email: 'gulf@example.com', name: 'Gus Manager', role: 'manager', region: 'Gulf', password: 'manager-pass' });
  addUser({ email: 'viewer@example.com', name: 'Vi Viewer', role: 'viewer', password: 'viewer-pass' });

  function publicUser(u) {
    return { id: u.id, email: u.email, name: u.name, role: u.role, region: u.region };
  }

  var app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.post('/api/login', function (req, res) {
    var b = req.body || {};
    var u = users.get(String(b.email || '').toLowerCase());
    if (!u || !crypto.timingSafeEqual(Buffer.from(hash(String(b.password || ''), u.salt), 'hex'), Buffer.from(u.hash, 'hex'))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    var token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, u.email);
    res.json({ token: token, user: publicUser(u) });
  });

  function auth(roles) {
    return function (req, res, next) {
      var m = /^Bearer (\w+)$/.exec(req.get('Authorization') || '');
      var email = m && sessions.get(m[1]);
      var u = email && users.get(email);
      if (!u) return res.status(401).json({ error: 'Please sign in' });
      if (roles && roles.indexOf(u.role) < 0) return res.status(403).json({ error: 'Not allowed for role ' + u.role });
      req.user = u;
      next();
    };
  }

  /** Managers only see their region's stores. */
  function visibleStores(user) {
    return user.role === 'manager' ? db.stores.filter(function (s) { return s.region === user.region; }) : db.stores;
  }

  function scopedOrders(user) {
    var ids = new Set(visibleStores(user).map(function (s) { return s.id; }));
    return db.orders.filter(function (o) { return ids.has(o.storeId); });
  }

  app.post('/api/logout', auth(), function (req, res) {
    sessions.forEach(function (email, token) { if (email === req.user.email) sessions.delete(token); });
    res.status(204).end();
  });

  app.get('/api/me', auth(), function (req, res) {
    res.json({ user: publicUser(req.user), stores: visibleStores(req.user) });
  });

  app.get('/api/dashboard', auth(), function (req, res) {
    var days = Math.min(Math.max(parseInt(req.query.days || '30', 10) || 30, 7), 90);
    var orders = scopedOrders(req.user);
    var stores = visibleStores(req.user);
    var n = now();
    var from = new Date(n.getTime() - days * 86400000).toISOString();
    res.json({
      kpis: metrics.kpis(orders, n),
      trend: metrics.salesTrend(orders, stores, n, days),
      stores: metrics.storePerformance(orders, stores, from, n.toISOString()),
      alerts: metrics.inventoryAlerts(db.inventory.filter(function (i) { return stores.some(function (s) { return s.id === i.storeId; }); }), db.products, orders, n).slice(0, 20)
    });
  });

  app.get('/api/orders', auth(['admin', 'manager']), function (req, res) {
    var q = req.query;
    var list = scopedOrders(req.user).filter(function (o) {
      return (!q.status || o.status === q.status) && (!q.store || o.storeId === q.store) && (!q.channel || o.channel === q.channel) &&
        (!q.search || o.id.toLowerCase().indexOf(String(q.search).toLowerCase()) >= 0);
    });
    var sortKey = ['createdAt', 'totalCents'].indexOf(q.sort) >= 0 ? q.sort : 'createdAt';
    var dir = q.dir === 'asc' ? 1 : -1;
    list = list.slice().sort(function (a, b) { return (a[sortKey] < b[sortKey] ? -1 : a[sortKey] > b[sortKey] ? 1 : 0) * dir; });
    var pageSize = Math.min(Math.max(parseInt(q.pageSize || '25', 10) || 25, 5), 100);
    var page = Math.max(parseInt(q.page || '1', 10) || 1, 1);
    var pages = Math.max(1, Math.ceil(list.length / pageSize));
    page = Math.min(page, pages);
    res.json({ total: list.length, page: page, pages: pages, pageSize: pageSize, items: list.slice((page - 1) * pageSize, page * pageSize) });
  });

  app.post('/api/orders/:id/refund', auth(['admin', 'manager']), function (req, res) {
    var o = scopedOrders(req.user).find(function (x) { return x.id === req.params.id; });
    if (!o) return res.status(404).json({ error: 'Order not found' });
    if (o.status !== 'completed') return res.status(409).json({ error: 'Only completed orders can be refunded' });
    o.status = 'refunded';
    o.refundedBy = req.user.email;
    res.json(o);
  });

  app.get('/api/users', auth(['admin']), function (req, res) {
    res.json(Array.from(users.values()).map(publicUser));
  });

  app.post('/api/users', auth(['admin']), function (req, res) {
    var b = req.body || {};
    var errors = {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || '')) errors.email = 'Valid email required';
    if (users.has(String(b.email || '').toLowerCase())) errors.email = 'Email already in use';
    if (['admin', 'manager', 'viewer'].indexOf(b.role) < 0) errors.role = 'Role must be admin, manager or viewer';
    if (b.role === 'manager' && !db.stores.some(function (s) { return s.region === b.region; })) errors.region = 'Managers need a valid region';
    if (!b.password || b.password.length < 10) errors.password = 'At least 10 characters';
    if (!b.name) errors.name = 'Name required';
    if (Object.keys(errors).length) return res.status(422).json({ errors: errors });
    res.status(201).json(publicUser(addUser(b)));
  });

  return app;
}

module.exports = createApp;
