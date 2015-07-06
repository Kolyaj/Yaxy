var system = require('system');

var url = system.args[1];

var page = require('webpage').create();

page.onError = function(msg) {
    console.error(msg);
};

page.open(url, function(status) {
    if (status == 'success') {
        console.log(page.evaluate(function() {
            return document.body.innerHTML;
        }));
    }
    phantom.exit();
});
