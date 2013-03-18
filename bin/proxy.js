var configFile = process.argv[2] || 'yaxy-config.txt';
var port = 8558;

process.on('uncaughtException', function(err) {
    console.error(err.stack);
});

var server = require('../lib/yaxy')(port);

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
                    rule.action(state);
                };
                server.bind(rule.pattern);
            });
        });
    });
}