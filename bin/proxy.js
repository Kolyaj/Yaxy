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

var port = args.port || 8558;
var configFile = args.config || 'yaxy-config.txt';
var proxy = !args.proxy ? null : (function(proxy) {
    var proxyRegex = /^(?:([^:]*):([^@]*)@)?([^:]*):([0-9]*)$/;
    var groups = proxyRegex.exec(proxy);
    return {
        user: groups[1],
        password: groups[2],
        host: groups[3],
        port: parseInt(groups[4], 10)
    }
})(args.proxy);

if (!require('fs').existsSync(configFile)) {
    console.log('Config file ' + configFile + ' not found');
    console.log('Usage: yaxy --port 8558 --config yaxy-config.txt');
    console.log('    default port: 8558');
    console.log('    default config: ./yaxy-config.txt');
    process.exit();
}

process.on('uncaughtException', function(err) {
    console.error(err.stack);
});

var server = require('../lib/yaxy')(port, proxy);

loadConfig();
require('fs').watch(configFile, loadConfig);

function loadConfig() {
    require('./config-parser').parse(configFile, function(err, config) {
        if (err) {
            return console.error(err.stack);
        }
        server.unbindAll();
        config.sections.unshift({
            modifiers: [],
            rules: config.rules
        });
        config.sections.forEach(function(section) {
            var sectionModifiers = config.modifiers.concat(section.modifiers);
            section.rules.forEach(function(rule) {
                var ruleModifers = sectionModifiers.concat(rule.modifiers);
                rule.pattern.fn = function(state) {
                    ruleModifers.forEach(function(modifier) {
                        modifier(state);
                    });
                    var delay = state.get('delay', 0);
                    if (delay) {
                        setTimeout(function() {
                            rule.action(state);
                        }, delay * 1000);
                    } else {
                        rule.action(state);
                    }
                };
                server.bind(rule.pattern);
            });
        });
    });
}
