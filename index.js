var port = 8558;
var configFile = 'config.txt';

var rewrites = [];
parseConfig(configFile);

require('fs').watch(configFile, function() {
    parseConfig(configFile);
});


process.on('uncaughtException', function(err) {
    console.log('Uncaught exception: ' + err.message);
});


require('proxy').createServer(function(url) {
    for (var i = 0; i < rewrites.length; i++) {
        if (rewrites[i].pattern.test(url)) {
            var result = {
                url: '',
                modifiers: rewrites[i].modifiers
            };
            var replacement = rewrites[i].replacement;
            if (replacement) {
                if (replacement == '$') {
                    result.url = url;
                } else if (replacement.indexOf('data:') == 0) {
                    result.url = replacement;
                } else {
                    result.url = url.replace(rewrites[i].pattern, replacement);
                }
            }
            return result;
        }
    }
    return {
        url: url,
        modifiers: []
    };
}).listen(port);


function parseConfig(fname) {
    require('config-parser').parse(fname, function(err, result) {
        if (err) {
            console.log('Config parse error: ' + err.message);
            return;
        }
        rewrites = result;
    });
}