var args = (function(argv) {
    var res = {};
    var key = '';
    for (var i = 2; i < argv.length; i++) {
        if (argv[i].indexOf('--') == 0) {
            key = argv[i].slice(2);
            res[key] = true;
        } else if (key) {
            res[key] = argv[i];
            key = '';
        }
    }
    return res;
})(process.argv);

var port = args['port'] || 8558;
var httpsPort = args['https-port'] || (args['no-https'] ? 0 : 8559);
var configFile = args['config'] || 'yaxy-config.txt';
var certs = {
    key: args['key'],
    cert: args['cert']
};
if (args['proxy'] && args['proxy'].match(/^(?:([^:]*):([^@]*)@)?([^:]*):([0-9]*)$/)) {
    var proxy = {
        user: RegExp.$1,
        password: RegExp.$2,
        host: RegExp.$3,
        port: RegExp.$4
    };
}

if (!require('fs').existsSync(configFile)) {
    console.log('Config file ' + configFile + ' not found');
    console.log('Usage: yaxy --port 8558 --config yaxy-config.txt --proxy user:password@localhost:3333');
    console.log('    default port: 8558');
    console.log('    default config: ./yaxy-config.txt');
    process.exit();
}

process.on('uncaughtException', function(err) {
    console.error(err.stack);
});

var server = require('../lib/yaxy')(port, httpsPort, certs);
if (proxy) {
    server.setProxy(proxy);
}
if (args['auth']) {
    server.setAuth(args['auth']);
}

loadConfig();
require('fs').watch(configFile, loadConfig);
var includeWatchers = [];

function loadConfig() {
    server.unbindAll();
    server.unuseAllSSL();
    require('./config-parser').parse(server, configFile).then(function(allFiles) {
        includeWatchers = includeWatchers.filter(function(fname) {
            if (allFiles.indexOf(fname) == -1) {
                require('fs').unwatchFile(fname, loadConfig);
                return false;
            }
            return true;
        });
        allFiles.forEach(function(fname) {
            if (includeWatchers.indexOf(fname) == -1) {
                require('fs').watch(fname, loadConfig);
                includeWatchers.push(fname);
            }
        });
    }).catch(function(err) {
        console.error(err.stack)
    });
}
