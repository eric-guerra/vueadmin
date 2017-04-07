/**
 * Vuex store definition. Written as a UMD module that returns a plain options object, so it can be
 * passed to `new Vuex.Store()` in the browser and unit-tested in Node without Vue.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); } else { root.VueAdminStore = factory(); }
}(this, function () {
  'use strict';

  function createStoreOptions(api, storage) {
    var saved = storage && storage.getItem('vueadmin.session');
    var session = saved ? JSON.parse(saved) : null;

    var auth = {
      namespaced: true,
      state: function () { return { token: session && session.token, user: session && session.user, error: null }; },
      getters: {
        isLoggedIn: function (s) { return !!s.token; },
        can: function (s) {
          return function (perm) {
            var role = s.user && s.user.role;
            var matrix = { viewOrders: ['admin', 'manager'], refund: ['admin', 'manager'], manageUsers: ['admin'] };
            return (matrix[perm] || []).indexOf(role) >= 0;
          };
        }
      },
      mutations: {
        setSession: function (s, payload) {
          s.token = payload && payload.token;
          s.user = payload && payload.user;
          s.error = null;
          if (storage) { if (payload) storage.setItem('vueadmin.session', JSON.stringify(payload)); else storage.removeItem('vueadmin.session'); }
        },
        setError: function (s, e) { s.error = e; }
      },
      actions: {
        login: function (ctx, creds) {
          return api.post('/api/login', creds).then(function (res) { ctx.commit('setSession', res); return true; }, function (e) { ctx.commit('setError', e.message); return false; });
        },
        logout: function (ctx) {
          var p = ctx.state.token ? api.post('/api/logout', null, ctx.state.token).catch(function () {}) : Promise.resolve();
          ctx.commit('setSession', null);
          return p;
        }
      }
    };

    var dashboard = {
      namespaced: true,
      state: function () { return { days: 30, data: null, loading: false, error: null, loadedAt: null }; },
      getters: {
        /** Revenue trend summed across stores (for the "all stores" line). */
        totalTrend: function (s) {
          if (!s.data) return [];
          return s.data.trend.labels.map(function (_, i) {
            return s.data.trend.datasets.reduce(function (sum, d) { return sum + d.data[i]; }, 0);
          });
        },
        criticalAlerts: function (s) {
          return s.data ? s.data.alerts.filter(function (a) { return a.severity !== 'low'; }) : [];
        }
      },
      mutations: {
        setDays: function (s, d) { s.days = d; },
        loading: function (s) { s.loading = true; s.error = null; },
        loaded: function (s, payload) { s.loading = false; s.data = payload.data; s.loadedAt = payload.at; },
        failed: function (s, e) { s.loading = false; s.error = e; }
      },
      actions: {
        load: function (ctx) {
          ctx.commit('loading');
          return api.get('/api/dashboard?days=' + ctx.state.days, ctx.rootState.auth.token)
            .then(function (data) { ctx.commit('loaded', { data: data, at: new Date().toISOString() }); },
              function (e) { ctx.commit('failed', e.message); if (e.status === 401) ctx.commit('auth/setSession', null, { root: true }); });
        },
        changeRange: function (ctx, days) {
          ctx.commit('setDays', days);
          return ctx.dispatch('load');
        }
      }
    };

    var orders = {
      namespaced: true,
      state: function () {
        return { filters: { status: '', store: '', channel: '', search: '' }, sort: 'createdAt', dir: 'desc', page: 1, result: null, loading: false, error: null };
      },
      mutations: {
        setFilter: function (s, change) { Object.assign(s.filters, change); s.page = 1; },
        setSort: function (s, key) {
          if (s.sort === key) s.dir = s.dir === 'asc' ? 'desc' : 'asc';
          else { s.sort = key; s.dir = 'desc'; }
          s.page = 1;
        },
        setPage: function (s, p) { s.page = p; },
        loading: function (s) { s.loading = true; s.error = null; },
        loaded: function (s, r) { s.loading = false; s.result = r; s.page = r.page; },
        failed: function (s, e) { s.loading = false; s.error = e; },
        replaceOrder: function (s, order) {
          if (!s.result) return;
          var i = s.result.items.findIndex(function (o) { return o.id === order.id; });
          if (i >= 0) s.result.items.splice(i, 1, order);
        }
      },
      actions: {
        fetch: function (ctx) {
          var s = ctx.state;
          var q = Object.keys(s.filters).filter(function (k) { return s.filters[k]; }).map(function (k) { return k + '=' + encodeURIComponent(s.filters[k]); });
          q.push('sort=' + s.sort, 'dir=' + s.dir, 'page=' + s.page);
          ctx.commit('loading');
          return api.get('/api/orders?' + q.join('&'), ctx.rootState.auth.token).then(function (r) { ctx.commit('loaded', r); }, function (e) { ctx.commit('failed', e.message); });
        },
        refund: function (ctx, id) {
          return api.post('/api/orders/' + id + '/refund', null, ctx.rootState.auth.token).then(function (o) { ctx.commit('replaceOrder', o); return o; });
        }
      }
    };

    return { modules: { auth: auth, dashboard: dashboard, orders: orders } };
  }

  /** fetch-based API client used in the browser. */
  function httpApi(fetchImpl) {
    var f = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    function call(method, url, body, token) {
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      return f(url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined }).then(function (res) {
        if (res.status === 204) return null;
        return res.json().then(function (data) {
          if (!res.ok) {
            var err = new Error(data.error || 'Request failed');
            err.status = res.status;
            throw err;
          }
          return data;
        });
      });
    }
    return {
      get: function (url, token) { return call('GET', url, null, token); },
      post: function (url, body, token) { return call('POST', url, body, token); }
    };
  }

  return { createStoreOptions: createStoreOptions, httpApi: httpApi };
}));
