require('proxy').createServer(function(url) {
    return url;
}).listen(8678);