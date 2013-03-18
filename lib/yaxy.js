var fileExists = require('fs').exists || require('path').exists;

module.exports = Yaxy;

function Yaxy(port) {
    if (!(this instanceof Yaxy)) {
        return new Yaxy(port);
    }
    this._listeners = [];
    this._server = require('http').createServer(this._onRequest.bind(this));
    if (port) {
        this.listen(port);
    }
}

Yaxy.prototype = {
    listen: function(port) {
        this._server.listen(port);
    },

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


    _onRequest: function(req, res) {
        var state = new State(req, res);
        (function next(i) {
            if (i < this._listeners.length) {
                state._match(this._listeners[i], function() {
                    next.call(this, i + 1);
                }, this);
            } else {
                state.doRequest();
            }
        }).call(this, 0);
    }
};

function State(req, res) {
    this._req = req;
    this._res = res;

    this._responseStatus = 0;
    this._requestHeaders = this._req.headers;
    this._responseHeadersOverwrites = {};

    this.setRequestUrl(this._req.url);
    this._referer = this._req.headers['referer'] ? require('url').parse(this._req.headers['referer']) : {
        host: '',
        pathname: '',
        search: ''
    };
    this._refererQueryParams = this._referer.search ? require('querystring').parse(this._referer.search) : {};
    this._refererRhost = this._referer.host ? this._referer.host.split('.').reverse() : [];

    this._cookies = this._parseCookie(this._req.headers['cookie']);
}

State.prototype = {
    overwriteResponseStatus: function(status) {
        this._responseStatus = status;
    },

    setRequestHeader: function(header, value) {
        this._requestHeaders[header.toLowerCase()] = String(value);
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

    setRequestUrl: function(url) {
        this._url = require('url').parse(url);
        this._queryParams = require('querystring').parse(this._url.query);
        this._rhost = this._url.host.split('.').reverse();
    },

    setRequestParam: function(param, value) {
        this._queryParams[param] = value;
    },

    removeRequestParam: function(param) {
        delete this._queryParams[param];
    },

    setCookie: function(name, value) {
        this._cookies[name] = value;
    },

    removeCookie: function(name) {
        delete this._cookies;
    },

    doRequest: function() {
        var protocol = this._url.protocol || 'http';
        if (!/^https?$/.test(protocol)) {
            this.abort();
        }
        var secure = protocol == 'https';
        var host = this._url.hostname || this._requestHeaders['host'];
        var port = +(location.port || host.split(':')[1] || (secure ? 443 : 80));
        var queryString = require('querystring').stringify(this._queryParams);
        var path = this._url.pathname + (queryString ? '?' + queryString : '');
        var cookieString = this._buildCookie(this._cookies);
        if (cookieString) {
            this.setRequestHeader('Cookie', cookieString);
        } else {
            this.removeRequestHeader('Cookie');
        }
        var requestOptions = {
            host: host,
            port: port,
            method: this._req.method,
            path: path,
            headers: this._requestHeaders
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

        this._req.on('data', function(data) {
            clientReq.write(data);
        });

        this._req.on('end', function() {
            clientReq.end();
        });

        if (!this._req.connection.__yaxy_clientReqs) {
            this._req.connection.__yaxy_clientReqs = [];
            this._req.connection.once('close', function() {
                this._req.connection.__yaxy_clientReqs.forEach(function(req) {
                    req.abort();
                })
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
                        var contentType = require('./mime').getType(require('path').extname(fname));
                        if (contentType.substr(0, 4) == 'text' || contentType.indexOf('xml') >= 0 || contentType.indexOf('json') >= 0 || contentType.indexOf('javascript') >= 0) {
                            contentType += '; charset=UTF-8';
                        }
                        that.setResponseHeader('Content-Type', contentType);
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
        this._res.writeHead(this._responseStatus || 200, this._responseHeaders);
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

    error: function(err) {
        this.overwriteResponseStatus(500);
        this.setResponseHeader('X-Yaxy-Error', err.message);
        this.send('');
        console.error(err.stack);
    },


    _buildResponseHeaders: function(origin) {
        var over = this._responseHeadersOverwrites;
        var headers = {};
        Object.keys(origin).forEach(function(header) {
            if (header in over) {
                if (typeof over[header] != 'undefined') {
                    headers[header] = over[header];
                }
            } else {
                headers[header] = origin[header];
            }
        });
        return headers;
    },

    _parseCookie: function(cookieString) {
        var cookies = {};
        if (cookieString) {
            cookieString.split(';').forEach(function(oneCookieString) {
                var oneCookiePair = oneCookieString.split('=');
                cookies[decodeURIComponent(oneCookiePair[0].trim())] = decodeURIComponent(oneCookiePair[1].trim());
            }, this);
        }
        return cookies;
    },

    _buildCookie: function(cookies) {
        return Object.keys(cookies).map(function(name) {
            return encodeURIComponent(name) + '=' + encodeURIComponent(cookies[name]);
        }).join('; ');
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
            return pattern instanceof RegExp ? pattern.test(value) : pattern == value;
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