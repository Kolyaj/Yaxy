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
            var replacement = rewrites[i].replacement;
            if (replacement) {
                if (replacement.indexOf('data:') == 0) {
                    return replacement;
                } else {
                    return url.replace(rewrites[i].pattern, replacement);
                }
            } else {
                return '';
            }
        }
    }
    return url;
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