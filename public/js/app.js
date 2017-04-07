/* global Vue, Vuex, VueRouter, Chart, VueAdminStore */
(function () {
  'use strict';

  var money = function (c) { return '$' + Math.round(c / 100).toLocaleString(); };
  Vue.filter('money', money);
  Vue.filter('pct', function (v) { return v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v + '%'; });
  Vue.filter('datetime', function (iso) { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); });

  var store = new Vuex.Store(VueAdminStore.createStoreOptions(VueAdminStore.httpApi(), window.localStorage));

  var KpiTile = {
    props: ['label', 'value', 'change'],
    template: '<div class="kpi"><span class="label">{{ label }}</span><strong>{{ value }}</strong>' +
      '<span class="change" :class="{ up: change > 0, down: change < 0 }">{{ change | pct }} vs last week</span></div>'
  };

  /** Chart.js wrapper that re-renders when its data changes. */
  var LineChart = {
    props: ['labels', 'datasets'],
    template: '<div class="chart"><canvas ref="canvas"></canvas></div>',
    mounted: function () { this.render(); },
    watch: { datasets: 'render' },
    beforeDestroy: function () { if (this.chart) this.chart.destroy(); },
    methods: {
      render: function () {
        if (this.chart) this.chart.destroy();
        var colors = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2'];
        this.chart = new Chart(this.$refs.canvas, {
          type: 'line',
          data: {
            labels: this.labels.map(function (d) { return d.slice(5); }),
            datasets: this.datasets.map(function (d, i) {
              return { label: d.label, data: d.data.map(function (c) { return c / 100; }), borderColor: colors[i % colors.length], tension: 0.25, pointRadius: 0, fill: false };
            })
          },
          options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            scales: { y: { ticks: { callback: function (v) { return '$' + v.toLocaleString(); } } } } }
        });
      }
    }
  };

  var Login = {
    data: function () { return { email: '', password: '' }; },
    computed: { error: function () { return this.$store.state.auth.error; } },
    template: '<form class="login card" @submit.prevent="submit"><h1>VueAdmin</h1>' +
      '<input v-model="email" type="email" placeholder="Email" required><input v-model="password" type="password" placeholder="Password" required>' +
      '<p class="error" v-if="error">{{ error }}</p><button>Sign in</button><p class="muted">Demo: admin@example.com / admin-pass</p></form>',
    methods: {
      submit: function () {
        var self = this;
        this.$store.dispatch('auth/login', { email: this.email, password: this.password }).then(function (ok) { if (ok) self.$router.push('/'); });
      }
    }
  };

  var Dashboard = {
    components: { KpiTile: KpiTile, LineChart: LineChart },
    computed: Object.assign(
      Vuex.mapState('dashboard', ['data', 'loading', 'error', 'days']),
      Vuex.mapGetters('dashboard', ['criticalAlerts'])
    ),
    created: function () { this.$store.dispatch('dashboard/load'); },
    template: '<section>' +
      '<div class="toolbar"><h2>Dashboard</h2><select :value="days" @change="$store.dispatch(\'dashboard/changeRange\', +$event.target.value)">' +
      '<option :value="7">7 days</option><option :value="30">30 days</option><option :value="90">90 days</option></select></div>' +
      '<p v-if="error" class="error">{{ error }}</p><p v-if="loading && !data" class="muted">Loading…</p>' +
      '<template v-if="data"><div class="kpis">' +
      '<kpi-tile label="Sales today" :value="data.kpis.current.salesCents | money" :change="data.kpis.change.salesPct"></kpi-tile>' +
      '<kpi-tile label="Orders" :value="data.kpis.current.orders" :change="data.kpis.change.ordersPct"></kpi-tile>' +
      '<kpi-tile label="Avg order" :value="data.kpis.current.aovCents | money" :change="data.kpis.change.aovPct"></kpi-tile>' +
      '<div class="kpi"><span class="label">Online share</span><strong>{{ data.kpis.current.onlineShare }}%</strong><span class="change">{{ data.kpis.current.pending }} pending</span></div></div>' +
      '<div class="card"><h3>Revenue by store</h3><line-chart :labels="data.trend.labels" :datasets="data.trend.datasets"></line-chart></div>' +
      '<div class="grid2"><div class="card"><h3>Store leaderboard</h3><table><tr><th>Store</th><th>Sales</th><th>Share</th><th>AOV</th><th>Refunds</th></tr>' +
      '<tr v-for="s in data.stores" :key="s.storeId"><td>{{ s.name }}</td><td>{{ s.salesCents | money }}</td><td>{{ s.sharePct }}%</td><td>{{ s.aovCents | money }}</td><td>{{ s.refundRate }}%</td></tr></table></div>' +
      '<div class="card"><h3>Inventory alerts <span class="badge" v-if="criticalAlerts.length">{{ criticalAlerts.length }} urgent</span></h3>' +
      '<table><tr><th>Store</th><th>Item</th><th>On hand</th><th>Cover</th></tr>' +
      '<tr v-for="a in data.alerts" :key="a.storeId + a.sku" :class="a.severity"><td>{{ a.storeId }}</td><td>{{ a.name }}</td><td>{{ a.onHand }}</td><td>{{ a.daysOfCover === null ? "—" : a.daysOfCover + " d" }}</td></tr></table></div></div>' +
      '</template></section>'
  };

  var Orders = {
    computed: Object.assign(Vuex.mapState('orders', ['filters', 'result', 'loading', 'error', 'sort', 'dir']), {
      canRefund: function () { return this.$store.getters['auth/can']('refund'); }
    }),
    created: function () { this.$store.dispatch('orders/fetch'); },
    methods: {
      filter: function (change) { this.$store.commit('orders/setFilter', change); this.$store.dispatch('orders/fetch'); },
      sortBy: function (k) { this.$store.commit('orders/setSort', k); this.$store.dispatch('orders/fetch'); },
      go: function (p) { this.$store.commit('orders/setPage', p); this.$store.dispatch('orders/fetch'); },
      refund: function (o) {
        if (window.confirm('Refund ' + o.id + ' for ' + money(o.totalCents) + '?')) this.$store.dispatch('orders/refund', o.id).catch(function (e) { window.alert(e.message); });
      }
    },
    template: '<section><div class="toolbar"><h2>Orders</h2>' +
      '<input placeholder="Search order #" :value="filters.search" @input="filter({ search: $event.target.value })">' +
      '<select :value="filters.status" @change="filter({ status: $event.target.value })"><option value="">All statuses</option><option>completed</option><option>pending</option><option>refunded</option></select>' +
      '<select :value="filters.channel" @change="filter({ channel: $event.target.value })"><option value="">All channels</option><option>online</option><option>in-store</option></select></div>' +
      '<p v-if="error" class="error">{{ error }}</p>' +
      '<table class="card" v-if="result"><tr><th>Order</th><th class="sortable" @click="sortBy(\'createdAt\')">Date {{ sort === "createdAt" ? (dir === "asc" ? "▲" : "▼") : "" }}</th>' +
      '<th>Store</th><th>Channel</th><th>Status</th><th class="sortable" @click="sortBy(\'totalCents\')">Total {{ sort === "totalCents" ? (dir === "asc" ? "▲" : "▼") : "" }}</th><th></th></tr>' +
      '<tr v-for="o in result.items" :key="o.id"><td>{{ o.id }}</td><td>{{ o.createdAt | datetime }}</td><td>{{ o.storeId }}</td><td>{{ o.channel }}</td>' +
      '<td><span class="status" :class="o.status">{{ o.status }}</span></td><td>{{ o.totalCents | money }}</td>' +
      '<td><button v-if="canRefund && o.status === \'completed\'" class="link" @click="refund(o)">Refund</button></td></tr></table>' +
      '<div class="pager" v-if="result"><button :disabled="result.page <= 1" @click="go(result.page - 1)">‹</button> Page {{ result.page }} of {{ result.pages }} ({{ result.total }} orders)' +
      '<button :disabled="result.page >= result.pages" @click="go(result.page + 1)">›</button></div></section>'
  };

  var router = new VueRouter({
    routes: [
      { path: '/login', component: Login },
      { path: '/', component: Dashboard },
      { path: '/orders', component: Orders, meta: { perm: 'viewOrders' } }
    ]
  });
  router.beforeEach(function (to, from, next) {
    if (to.path !== '/login' && !store.getters['auth/isLoggedIn']) return next('/login');
    if (to.meta.perm && !store.getters['auth/can'](to.meta.perm)) return next('/');
    next();
  });

  new Vue({
    el: '#app',
    store: store,
    router: router,
    computed: Object.assign(Vuex.mapGetters('auth', ['isLoggedIn']), {
      user: function () { return this.$store.state.auth.user; },
      canOrders: function () { return this.$store.getters['auth/can']('viewOrders'); }
    }),
    methods: {
      logout: function () { var self = this; this.$store.dispatch('auth/logout').then(function () { self.$router.push('/login'); }); }
    }
  });
})();
