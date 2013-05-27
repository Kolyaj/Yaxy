#!/usr/bin/env node

if (require.main == module) {
    require('./bin/proxy');
} else {
    module.exports = require('./lib/yaxy');
}