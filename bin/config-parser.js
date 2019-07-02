var Parser = require('lblr-parser');
var Q = require('q');

exports.parse = function(server, fname) {
    var parser = Parser(true);

    parser.registerLineProcessor(/^(.*?)\s*=>\s*(.*?)$/, function(line, allMatch, operand1, operand2, data) {
        if (!data.skiping) {
            applyRules(server, data);
            var patterns = createPatterns(operand1);
            patterns.forEach(function(pattern) {
                data.currentRules.push({
                    pattern: pattern,
                    action: createAction(pattern.url || pattern.urlStart, operand2),
                    modifiers: []
                });
            });
        }
    });

    parser.registerLineProcessor(/^\$(.*)/, function(line, allMatch, modifierRule, data) {
        if (!data.skiping) {
            var modifier = createModifier(modifierRule);
            if (modifier) {
                if (data.currentRules.length) {
                    data.currentRules.forEach(function(rule) {
                        rule.modifiers.push(modifier);
                    });
                } else {
                    (data.currentSection || data).modifiers.push(modifier);
                }
            }
        }
    });

    parser.registerLineProcessor(/^\$Include\s+(.*)/, function(line, allMatch, filename, data) {
        if (!data.skiping) {
            applyRules(server, data);
            return parseFile(parser, filename).then(function(includedData) {
                applyRules(server, includedData);
                [].push.apply(data.files, includedData.files);
            }).catch(function(err) {
                console.log(err.message);
            });
        }
    });

    parser.registerLineProcessor(/^\$UseSSLFor\s+(.*)/, function(line, allMatch, hosts, data) {
        if (!data.skiping) {
            hosts.split(/\s+/).forEach(function(host) {
                server.useSSLFor(host);
            });
        }
    });

    parser.registerLineProcessor(/^\[\s*(#)?.*]$/, function(line, allMatch, commentChar, data) {
        applyRules(server, data);
        data.skiping = Boolean(commentChar);
        data.currentSection = {
            modifiers: [],
            documentRoot: data.documentRoot
        };
    });

    parser.registerLineProcessor(/^\$SetDocumentRoot (.*)/, function(line, allMatch, documentRoot, data) {
        applyRules(server, data);
        documentRoot = documentRoot.trim();
        if (data.currentSection) {
            data.currentSection.documentRoot = documentRoot;
        } else {
            data.documentRoot = documentRoot;
        }
    });

    parser.registerLineProcessor(/~/, function(line, ignored, data) {
        return line.replace(/~/g, data.currentSection ? data.currentSection.documentRoot : data.documentRoot);
    });

    parser.registerLineProcessor(/^(#|$)/, function() {

    });

    return parseFile(parser, fname).then(function(data) {
        applyRules(server, data);
        return data.files;
    });
};

function applyRules(server, data) {
    if (data.currentRules.length) {
        var modifiers = data.modifiers.concat(data.currentSection ? data.currentSection.modifiers : []);
        data.currentRules.forEach(function(rule) {
            var ruleModifiers = modifiers.concat(rule.modifiers);
            rule.pattern.fn = function(state) {
                ruleModifiers.forEach(function(modifier) {
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
        data.currentRules.length = 0;
    }
}

function parseFile(parser, fname) {
    return Q.nfcall(require('fs').readFile, fname, 'utf8').then(function(content) {
        return parser.parse(content, {
            documentRoot: require('path').dirname(fname),
            modifiers: [],
            files: [fname],
            currentSection: null,
            currentRules: [],
            skiping: false
        });
    });
}

function createPatterns(source) {
    if (source[0] == '/' && source[source.length - 1] == '/') {
        return [{
            url: new RegExp(source.substr(1, source.length - 2), 'i')
        }];
    } else if (source[0] == '!') {
        return normalizeUrl(source.slice(1)).map(function(url) {
            return {
                url: url
            };
        });
    } else {
        return normalizeUrl(source).map(function(url) {
            return {
                urlStart: url
            };
        });
    }
}

function normalizeUrl(url) {
    var urls = [url];
    if (!/^https?:\/\//.test(url)) {
        urls = ['http://' + url, 'https://' + url];
    }
    return urls.map(function(url) {
        // С помощью такой комбинации parse-format кириллические домены переводятся в punycode
        var normalizedUrl = require('url').format(require('url').parse(url));
        if (url.lastIndexOf('/') != url.length - 1) {
            normalizedUrl = normalizedUrl.replace(/\/$/, '');
        }
        return normalizedUrl;
    });
}

function createAction(pattern, replacement) {
    if (replacement == '$') {
        return createDefaultAction();
    } else if (replacement == '') {
        return createAbortAction();
    } else if (replacement.match(/^data:(?:([a-zA-Z/-]+);)?(base64,)?(.*)/)) {
        return createDataAction(pattern, RegExp.$3 || '', RegExp.$1 || 'text/plain', !!RegExp.$2);
    } else if (replacement.indexOf('file://') == 0) {
        return createFileAction(pattern, replacement.slice(7));
    } else if (replacement.indexOf('proxy:') == 0) {
        return createProxyAction(replacement.slice(6).trim())
    } else if (replacement.indexOf('bin:') == 0) {
        return createBinAction(pattern, replacement.slice(4).trim());
    } else {
        return createStandardAction(pattern, replacement);
    }
}

function createDefaultAction() {
    return function(state) {
        state.doRequest();
    };
}

function createAbortAction() {
    return function(state) {
        state.abort();
    };
}

function createDataAction(pattern, tpl, contentType, isBase64) {
    return function(state) {
        var content = tpl;
        if (!isBase64) {
            content = applyTemplate(tpl, state, pattern);
        }
        content = new Buffer(content, isBase64 ? 'base64' : 'utf8');
        state.setResponseType(contentType);
        state.send(content);
    };
}

function createFileAction(pattern, fnameTemplate) {
    return function(state) {
        var tpl = fnameTemplate;
        if (typeof pattern == 'string') {
            tpl = require('path').join(tpl, state.getRequestUrl().slice(pattern.length));
        }
        var fname = applyTemplate(tpl, state, pattern).split('?')[0];
        state.sendFile(fname);
    };
}

function createProxyAction(proxyParam) {
    if (proxyParam && proxyParam.match(/^(?:([^:]*):([^@]*)@)?([^:]*):([0-9]*)$/)) {
        var proxy = {
            user: RegExp.$1,
            password: RegExp.$2,
            host: RegExp.$3,
            port: RegExp.$4
        };
    }
    return function(state) {
        state.setProxy(proxy);
        state.doRequest();
    };
}

function createBinAction(pattern, commandTpl) {
    return function(state) {
        var command = applyTemplate(commandTpl, state, pattern);
        require('child_process').exec(command, {encoding: 'binary', maxBuffer: Infinity}, function(err, stdout, stderr) {
            if (err) {
                return state.error(err);
            }
            state.send(stdout || stderr);
        });
    };
}

function createStandardAction(pattern, urlTemplate) {
    return function(state) {
        var url = applyTemplate(urlTemplate, state, pattern);
        url = url.replace(/^(?!https?:\/\/)/, state.getRequestProtocol() + '//');
        if (typeof pattern == 'string') {
            url += state.getRequestUrl().slice(pattern.length);
        }
        state.setRequestUrl(url);
        state.doRequest();
    };
}

function applyTemplate(tpl, state, pattern) {
    var args = [];
    if (typeof pattern != 'string') {
        args = state.getRequestUrl().match(pattern);
    }
    return tpl.replace(/(?:\$(?:(\d+)|\{(&)?([^}]+)\}))/g, function(ignore, num, escape, varname) {
        if (num) {
            return args[num] || '';
        } else {
            var result = '';
            var method = {
                url: 'getRequestUrl',
                host: 'getRequestHost',
                port: 'getRequestPort',
                path: 'getRequestPath',
                query: 'getQueryString'
            }[varname];
            if (method) {
                result = state[method]();
            } else if (varname.indexOf('header:') == 0) {
                result = state.getRequestHeader(varname.slice(7));
            } else if (varname.indexOf('param:') == 0) {
                result = state.getQueryParam(varname.slice(6));
            } else if (varname.indexOf('cookie:')) {
                result = state.getCookie(varname.slice(7));
            }
            if (escape) {
                result = encodeURIComponent(result);
            }
            return result;
        }
    });
}

function createModifier(command) {
    var args = command.split(/\s+/);
    var commandName = args.shift();
    var methodName = commandName[0].toLowerCase() + commandName.slice(1);
    var commandArg = args.join(' ');
    if (/^(SetRequestHeader|SetResponseHeader|SetQueryParam|SetCookie)$/.test(commandName)) {
        var argsSeparator = ':';
        if (commandName == 'SetQueryParam' || commandName == 'SetCookie') {
            argsSeparator = '=';
        }
        var setArgs = commandArg.split(argsSeparator);
        var setArgName = setArgs.shift().trim();
        var setArgValue = setArgs.join(argsSeparator).trim();
        return function(state) {
            state[methodName](setArgName, applyTemplate(setArgValue, state, ''));
        };
    }
    if (/^(RemoveRequestHeader|RemoveResponseHeader|RemoveQueryParam|RemoveCookie)$/.test(commandName)) {
        return function(state) {
            state[methodName](commandArg);
        };
    }
    if (commandName == 'StatusCode') {
        var statusCode = +commandArg;
        if (statusCode) {
            return function(state) {
                state.overwriteResponseStatus(statusCode);
            };
        }
    }
    if (commandName == 'Delay') {
        var timeout = +commandArg;
        if (timeout) {
            return function(state) {
                state.set('delay', timeout);
            };
        }
    }

    console.log('Unknown modifier ' + commandName);
}
