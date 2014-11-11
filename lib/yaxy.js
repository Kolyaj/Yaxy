var fileExists = require('fs').exists || require('path').exists;

module.exports = Yaxy;

function Yaxy(port, httpsPort) {
    if (!(this instanceof Yaxy)) {
        return new Yaxy(port, httpsPort);
    }
    this._listeners = [];
    this._proxy = null;
    this._sslHosts = [];
    this._httpsPort = httpsPort;

    this._server = require('http').createServer(this._onRequest.bind(this, 'http:'));
    this._server.on('connect', this._onConnect.bind(this));
    this._server.listen(port);

    this._httpsServer = null;
    if (httpsPort) {
        var options = {
            key: require('fs').readFileSync(__dirname + '/../ssl/privatekey.pem'),
            cert: require('fs').readFileSync(__dirname + '/../ssl/certificate.pem')
        };
        this._httpsServer = require('https').createServer(options, this._onRequest.bind(this, 'https:'));
        this._httpsServer.listen(httpsPort);
    }
}

Yaxy.prototype = {
    /**
     *
     * @param {Object} listener Объект с возможными полями
     *      * url
     *      * urlStart
     *      * host
     *      * rhost
     *      * path
     *      * pathStart
     *      * queryParams {Object}
     *      * headers {Object}
     *      * referer
     *      * refererStart
     *      * refererHost
     *      * refererRhost
     *      * refererPath
     *      * refererPathStart
     *      * refererQueryParams
     *      * cookies {Object}
     *      * fn
     */
    bind: function(listener) {
        this._listeners.push(listener);
    },

    unbind: function(listener) {
        var index = this._listeners.indexOf(listener);
        if (index > -1) {
            this._listeners.splice(index, 1);
        }
    },

    unbindAll: function() {
        this._listeners.length = 0;
    },

    useSSLFor: function(host) {
        if (host.indexOf(':') == -1) {
            host += ':443';
        }
        if (this._sslHosts.indexOf(host) == -1) {
            this._sslHosts.push(host);
        }
    },

    unuseSSLFor: function(host) {
        if (host.indexOf(':') == -1) {
            host += ':443';
        }
        var index = this._sslHosts.indexOf(host);
        if (index > -1) {
            this._sslHosts.splice(index, 1);
        }
    },

    unuseAllSSL: function() {
        this._sslHosts.length = 0;
    },

    setProxy: function(proxy) {
        this._proxy = proxy;
    },


    _onRequest: function(protocol, req, res) {
        var state = new State(protocol, req, res);
        state.setProxy(this._proxy);
        (function next(i) {
            if (i < this._listeners.length) {
                state._match(this._listeners[i], function() {
                    next.call(this, i + 1);
                }, this);
            } else {
                state.doRequest();
            }
        }).call(this, 0);
    },

    _onConnect: function(request, socketRequest, head) {
        var host = 'localhost';
        var port = this._httpsPort;
        if (!port || this._sslHosts.indexOf(request.url) == -1) {
            var ph = require('url').parse('http://' + request.url);
            host = ph.hostname;
            port = ph.port;
        }
        var socket = require('net').connect(port, host, function() {
            socket.write(head);
            socketRequest.write("HTTP/" + request.httpVersion + " 200 Connection established\r\n\r\n");
        });

        socket.on('data', function(chunk) {
            socketRequest.write(chunk);
        });
        socket.on('end', function() {
            socketRequest.end();
        });
        socket.on('error', function() {
            socketRequest.write("HTTP/" + request.httpVersion + " 500 Connection error\r\n\r\n");
            socketRequest.end();
        });

        socketRequest.on('data', function(chunk) {
            socket.write(chunk);
        });
        socketRequest.on('end', function() {
            socket.end();
        });
        socketRequest.on('error', function() {
            socket.end();
        });
    }
};

function State(protocol, req, res) {
    this._req = req;
    this._res = res;
    this._proxy = null;

    this._requestBodyChunks = [];
    this._isRequestEnd = false;
    this._requestEndListeners = [];
    this._req.on('data', this._onRequestData.bind(this));
    this._req.on('end', this._onRequestEnd.bind(this));

    this._responseStatus = 0;
    this._requestHeaders = this._req.headers;
    this._responseHeadersOverwrites = {};

    if (!/^https?:\/\//.test(this._req.url)) {
        this._req.url = protocol + '//' + this._req.headers['host'] + this._req.url;
    }
    this.setRequestUrl(this._req.url);
    this._overwriteQueryParams = {};
    this._referer = this._req.headers['referer'] ? require('url').parse(this._req.headers['referer']) : {
        host: '',
        pathname: '',
        search: ''
    };
    this._refererQueryParams = this._referer.search ? require('querystring').parse(this._referer.search) : {};
    this._refererRhost = this._referer.host ? this._referer.host.split('.').reverse() : [];

    this._cookies = this._parseCookie(this._req.headers['cookie']);

    this._vars = {};
}

State.prototype = {
    getMethod: function() {
        return this._req.method;
    },

    getRequestUrl: function() {
        return this._urlString;
    },

    getRequestProtocol: function() {
        return this._url.protocol;
    },

    getRequestHost: function() {
        return this._url.hostname;
    },

    getRequestPort: function() {
        return this._url.port;
    },

    getRequestPath: function() {
        return this._url.pathname;
    },

    getQueryString: function() {
        return this._url.query;
    },

    setRequestUrl: function(url) {
        this._urlString = url;
        this._url = require('url').parse(url);
        this._queryParams = require('querystring').parse(this._url.query);
        this._rhost = this._url.host.split('.').reverse();
    },

    overwriteResponseStatus: function(status) {
        this._responseStatus = status;
    },

    setRequestHeader: function(header, value) {
        this._requestHeaders[header.toLowerCase()] = String(value);
    },

    getRequestHeader: function(header) {
        return this._requestHeaders[header.toLowerCase()] || '';
    },

    removeRequestHeader: function(header) {
        delete this._requestHeaders[header.toLowerCase()];
    },

    setResponseHeader: function(header, value) {
        this._responseHeadersOverwrites[header.toLowerCase()] = String(value);
    },

    removeResponseHeader: function(header) {
        this._responseHeadersOverwrites[header.toLowerCase()] = undefined;
    },

    setResponseType: function(contentType) {
        if (!this._responseHeadersOverwrites['content-type']) {
            if (contentType.substr(0, 4) == 'text' || contentType.indexOf('xml') >= 0 || contentType.indexOf('json') >= 0 || contentType.indexOf('javascript') >= 0) {
                contentType += '; charset=UTF-8';
            }
            this.setResponseHeader('Content-Type', contentType);
        }
    },

    setQueryParam: function(param, value) {
        this._overwriteQueryParams[param] = value;
    },

    getQueryParam: function(param) {
        return require('querystring').parse(this._url.query)[param] || '';
    },

    removeQueryParam: function(param) {
        this._overwriteQueryParams[param] = null;
    },

    setCookie: function(name, value) {
        this._cookies[name] = value;
    },

    getCookie: function(name) {
        return this._cookies[name];
    },

    removeCookie: function(name) {
        delete this._cookies[name];
    },

    getRequestBody: function(encoding) {
        return Buffer.concat(this._requestBodyChunks).toString(encoding || 'utf8');
    },

    redirect: function(url, status) {
        this.overwriteResponseStatus(status || 302);
        this.setResponseHeader('Location', url);
        this.send('');
    },

    doRequest: function() {
        var protocol = this._url.protocol || 'http:';
        if (!/^https?:$/.test(protocol)) {
            return this.error(new Error('Unknown protocol ' + protocol));
        }
        var secure = protocol == 'https:';
        var host = this._url.hostname || this._requestHeaders['host'];
        var port = +(this._url.port || host.split(':')[1] || (secure ? 443 : 80));
        var queryString = this._buildQueryString();
        var path = this._url.pathname + (queryString ? '?' + queryString : '');
        var cookieString = this._buildCookie(this._cookies);
        if (cookieString) {
            this.setRequestHeader('Cookie', cookieString);
        } else {
            this.removeRequestHeader('Cookie');
        }
        if (this._requestHeaders.connection == 'keep-alive') {
            delete this._requestHeaders.connection;
        }
        if (this._proxy && this._proxy.user) {
            this._requestHeaders['proxy-authorization'] = 'Basic ' + new Buffer(this._proxy.user + ':' + this._proxy.password).toString('base64');
        }

        var headers = {};
        Object.keys(this._requestHeaders).forEach(function(name) {
            var camelName = name.replace(/(^|-)([a-z])/g, function(ignored, dash, letter) {
                return dash + letter.toUpperCase();
            });
            headers[camelName] = this._requestHeaders[name];
        }, this);

        var requestOptions = {
            host: this._proxy ? this._proxy.host : host,
            port: this._proxy ? this._proxy.port : port,
            method: this._req.method,
            path: this._proxy ? protocol + '//' + host + path : path,
            headers: headers,
            rejectUnauthorized: false
        };

        var that = this;
        var clientReq = require(secure ? 'https' : 'http').request(requestOptions, function(clientRes) {
            var statusCode = that._responseStatus || clientRes.statusCode;
            var headers = that._buildResponseHeaders(clientRes.headers);
            that._res.writeHead(statusCode, headers);
            clientRes.on('data', function(data) {
                that._res.write(data);
            });
            clientRes.on('end', function() {
                that._res.end();
            });
        });

        clientReq.on('error', function(err) {
            that.error(err);
        });

        this.ready(function() {
            clientReq.write(Buffer.concat(this._requestBodyChunks));
            clientReq.end();
        }, this);

        if (!this._req.connection.__yaxy_clientReqs) {
            this._req.connection.__yaxy_clientReqs = [];
            this._req.connection.once('close', function() {
                that._req.connection.__yaxy_clientReqs.forEach(function(req) {
                    req.abort();
                });
            });
        }
        this._req.connection.__yaxy_clientReqs.push(clientReq);
    },

    sendFile: function(fname) {
        var that = this;
        fileExists(fname, function(exists) {
            if (exists) {
                require('fs').stat(fname, function(err, stat) {
                    if (err) {
                        return that.error(err);
                    }
                    if (stat.isDirectory()) {
                        that.sendFile(require('path').join(fname, 'index.html'));
                    } else if (stat.isFile()) {
                        that.setResponseType(require('./mime').getType(require('path').extname(fname)));
                        require('fs').readFile(fname, function(err, content) {
                            if (err) {
                                return that.error(err);
                            }
                            that.send(content);
                        });
                    } else {
                        that.abort();
                    }
                });
            } else {
                that.overwriteResponseStatus(404);
                that.setResponseHeader('Content-Type', 'text/plain; charset=UTF-8');
                that.send('Yaxy did not find file ' + fname, 'utf8');
            }
        });
    },

    send: function(content, encoding) {
        this._res.writeHead(this._responseStatus || 200, this._buildResponseHeaders({}));
        this._res.write(content, encoding || 'binary');
        this._res.end();
    },

    abort: function() {
        this._res.end();
    },

    next: function() {
        if (this._matchCallback) {
            this._matchCallback.call(this._matchCtx);
            this._matchCallback = null;
        }
    },

    ready: function(fn, ctx) {
        if (this._isRequestEnd) {
            fn.call(ctx);
        } else {
            this._requestEndListeners.push([fn, ctx]);
        }
    },

    setProxy: function(proxy) {
        this._proxy = proxy;
    },

    set: function(name, value) {
        this._vars[name] = value;
    },

    get: function(name, defaultValue) {
        return name in this._vars ? this._vars[name] : defaultValue;
    },

    error: function(err) {
        if (err.code == 'ECONNRESET') {
            return;
        }
        this.overwriteResponseStatus(500);
        this.setResponseHeader('X-Yaxy-Error', err.message);
        this.send('');
        if (err.code == 'ENOTFOUND') {
            console.log('Host ' + this._url.hostname + ' not found.');
        } else {
            console.error(err.stack);
        }
    },


    _buildResponseHeaders: function(origin) {
        var over = this._responseHeadersOverwrites;
        Object.keys(over).forEach(function(header) {
            if (typeof over[header] == 'undefined') {
                delete origin[header];
            } else {
                origin[header] = over[header];
            }
        });
        return origin;
    },

    _buildQueryString: function() {
        var queryString = this._url.query || '';
        Object.keys(this._overwriteQueryParams).forEach(function(param) {
            var value = this._overwriteQueryParams[param];
            var pattern = new RegExp('(^|&)' + param + '\\b[^&]*');
            queryString = queryString.replace(pattern, value == null ? '' : '$1' + param + '=' + value);
            if (value != null && !pattern.test(queryString)) {
                // значит параметра в строке не было, ничего не заменилось, добавляем
                queryString += (queryString ? '&' : '') + param + '=' + encodeURIComponent(value);
            }
        }, this);
        return queryString;
    },

    _parseCookie: function(cookieString) {
        var cookies = {};
        if (cookieString) {
            cookieString.split(';').forEach(function(oneCookieString) {
                var oneCookiePair = oneCookieString.split('=');
                cookies[oneCookiePair.shift().trim()] = oneCookiePair.join('=').trim();
            }, this);
        }
        return cookies;
    },

    _buildCookie: function(cookies) {
        return Object.keys(cookies).map(function(name) {
            return name + '=' + cookies[name];
        }).join('; ');
    },

    _onRequestData: function(chunk) {
        this._requestBodyChunks.push(chunk);
    },

    _onRequestEnd: function() {
        this._isRequestEnd = true;
        this._req.removeAllListeners();
        this._requestEndListeners.forEach(function(listener) {
            listener[0].call(listener[1]);
        });
    },

    _match: function(listener, callback, ctx) {
        if (!listener.fn) {
            return callback.call(ctx);
        }
        this._matchCallback = callback;
        this._matchCtx = ctx;
        var validListener = Object.keys(listener).every(function(matcherName) {
            if (matcherName.indexOf('_') == 0 || !this._matchers[matcherName]) {
                return true;
            }
            return this._matchers[matcherName].call(this, listener[matcherName]);
        }, this);
        if (validListener) {
            listener.fn.call(listener.ctx, this);
        } else {
            this.next();
        }
    },

    _matchers: {
        url: function(url) {
            return this._matchers._string(url, this._req.url);
        },

        urlStart: function(url) {
            return this._matchers._stringStart(url, this._req.url);
        },

        host: function(host) {
            return this._url.host == host;
        },

        rhost: function(rhost) {
            return this._matchers._rhost(rhost, this._rhost);
        },

        path: function(path) {
            return this._matchers._string(path, this._url.pathname);
        },

        pathStart: function(path) {
            return this._matchers._stringStart(path, this._url.pathname);
        },

        queryParams: function(params) {
            return this._matchers._object(params, this._queryParams);
        },

        headers: function(headers) {
            return this._matchers._object(headers, this._req.headers);
        },

        referer: function(referer) {
            return this._matchers._string(referer, this._req.headers['referer'] || '');
        },

        refererStart: function(referer) {
            return this._matchers._stringStart(referer, this._req.headers['referer'] || '');
        },

        refererHost: function(host) {
            return this._referer.host == host;
        },

        refererRhost: function(rhost) {
            return this._matchers._rhost(rhost, this._refererRhost);
        },

        refererPath: function(path) {
            return this._matchers._string(path, this._referer.pathname);
        },

        refererPathStart: function(path) {
            return this._matchers._stringStart(path, this._referer.pathname);
        },

        refererQueryParams: function(params) {
            return this._matchers._object(params, this._refererQueryParams);
        },

        cookies: function(cookies) {
            return this._matchers._object(cookies, this._cookies);
        },


        _string: function(pattern, value) {
            return Object.prototype.toString.call(pattern) == '[object RegExp]' ? pattern.test(value) : pattern == value;
        },

        _stringStart: function(pattern, value) {
            return value.indexOf(pattern) == 0;
        },

        _object: function(pattern, value) {
            return Object.keys(pattern).every(function(field) {
                var fieldValue = pattern[field];
                return typeof fieldValue == 'boolean' ? field in value == fieldValue : this._string(fieldValue, value[field] || '');
            }, this);
        },

        _rhost: function(pattern, value) {
            pattern = pattern.replace(/^\.|\.$/g, '').split('.');
            for (var i = 0; i < pattern.length; i++) {
                if (pattern[i] != value[i]) {
                    return false;
                }
            }
            return true;
        }
    }
};
