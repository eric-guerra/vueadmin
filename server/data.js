'use strict';

/** Deterministic demo data: stores, products and 90 days of orders. */
function rng(seed) {
  return function () {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

var STORES = [
  { id: 'HOU01', name: 'Houston Galleria', region: 'Gulf' },
  { id: 'HOU02', name: 'Houston Heights', region: 'Gulf' },
  { id: 'AUS01', name: 'Austin Domain', region: 'Central' },
  { id: 'DAL01', name: 'Dallas Uptown', region: 'North' },
  { id: 'SAT01', name: 'San Antonio Pearl', region: 'Central' }
];

var PRODUCTS = [
  ['TENT-2P', 'Ridgeline 2P Tent', 34900, 6], ['BAG-20F', 'Alpine 20F Bag', 27900, 5], ['STOVE', 'Pocket Stove', 5499, 12],
  ['PACK-24', 'Summit Daypack', 8900, 10], ['SHOE-TR3', 'Trail Runner 3', 12999, 8], ['TEE-MER', 'Merino Tee', 6500, 15],
  ['LAMP-400', 'Lumen Headlamp', 4999, 10], ['BOTTLE', 'Insulated Bottle', 3499, 20]
].map(function (r) { return { sku: r[0], name: r[1], priceCents: r[2], reorderPoint: r[3] }; });

function generate(today, seed) {
  var rand = rng(seed || 42);
  var orders = [];
  var seq = 10000;
  var statuses = ['completed', 'completed', 'completed', 'completed', 'refunded', 'pending'];
  for (var day = 89; day >= 0; day--) {
    var date = new Date(today.getTime() - day * 86400000);
    STORES.forEach(function (store, si) {
      var count = 6 + Math.floor(rand() * 10) + (si === 0 ? 4 : 0) + (date.getUTCDay() >= 5 ? 5 : 0);
      for (var i = 0; i < count; i++) {
        var lines = [];
        var nLines = 1 + Math.floor(rand() * 3);
        for (var l = 0; l < nLines; l++) {
          var p = PRODUCTS[Math.floor(rand() * PRODUCTS.length)];
          lines.push({ sku: p.sku, qty: 1 + Math.floor(rand() * 2), unitCents: p.priceCents });
        }
        var at = new Date(date);
        at.setUTCHours(14 + Math.floor(rand() * 10), Math.floor(rand() * 60), 0, 0);
        orders.push({
          id: 'O' + (++seq), storeId: store.id, createdAt: at.toISOString(), channel: rand() < 0.35 ? 'online' : 'in-store',
          status: day === 0 && rand() < 0.3 ? 'pending' : statuses[Math.floor(rand() * statuses.length)],
          lines: lines, totalCents: lines.reduce(function (s, x) { return s + x.qty * x.unitCents; }, 0)
        });
      }
    });
  }
  var inventory = [];
  STORES.forEach(function (s) {
    PRODUCTS.forEach(function (p) {
      inventory.push({ storeId: s.id, sku: p.sku, onHand: Math.floor(rand() * 30) });
    });
  });
  return { stores: STORES, products: PRODUCTS, orders: orders, inventory: inventory };
}

module.exports = { generate: generate, STORES: STORES, PRODUCTS: PRODUCTS };
