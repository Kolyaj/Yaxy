require('http').createServer(function(req, res) {
    if (req.url == '/') {
        res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf8'
        });
        res.end('Hello');
    } else {
        res.writeHead(404);
        res.end();
    }
}).listen(9595);
