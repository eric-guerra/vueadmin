'use strict';

var createApp = require('./app');
var port = Number(process.env.PORT) || 3000;
createApp().listen(port, function () {
  console.log('VueAdmin on http://localhost:' + port + '  (admin@example.com / admin-pass)');
});
