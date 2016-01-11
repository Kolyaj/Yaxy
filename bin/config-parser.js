var Parser = require('lblr-parser');
var Q = require('q');

exports.parse = function(fname) {
    var parser = Parser();

    parser.registerLineProcessor(/^\s*(.*?)\s*=>\s*(.*?)\s*$/, function(line, allMatch, operand1, operand2, data) {
        if (!data.skiping) {
            var patterns = createPatterns(operand1);
            data.currentRules = [];
            patterns.forEach(function(pattern) {
                var rule = {
                    pattern: pattern,
                    action: createAction(pattern.url || pattern.urlStart, operand2),
                    modifiers: []
                };
                data.currentRules.push(rule);
                (data.currentSection || data.result).rules.push(rule);
            });
        }
    });

    parser.registerLineProcessor(/^\$(.*)/, function(line, allMatch, modifierRule, data) {
        if (!data.skiping) {
            var modifier = createModifier(modifierRule);
            if (modifier) {
                if (data.currentRules) {
                    data.currentRules.forEach(function(rule) {
                        rule.modifiers.push(modifier);
                    });
                } else {
                    (data.currentSection || data.result).modifiers.push(modifier);
                }
            }
        }
    });

    parser.registerLineProcessor(/^\$Include (.*)/, function(line, allMatch, file, data) {
        if (!data.skiping) {
            var filename = require('path').join(data.baseDirs[0], file);
            return Q.nfcall(require('fs').readFile, filename, 'utf8').then(function(content) {
                return [
                    '$$SetBaseDir ' + require('path').dirname(filename),
                    content,
                    '$$UnsetBaseDir'
                ].join('\n') + '\n';
            }).catch(function(err) {
                console.log(err.message);
                return '';
            });
        }
    });

    parser.registerLineProcessor(/^\$\$SetBaseDir (.*)/, function(line, allMatch, dirname, data) {
        data.baseDirs.unshift(dirname);
    });

    parser.registerLineProcessor(/^\$\$UnsetBaseDir/, function(line, allMatch, data) {
        data.baseDirs.shift();
    });

    parser.registerLineProcessor(/^\$UseSSLFor (.*)/, function(line, allMatch, hosts, data) {
        if (!data.skiping) {
            hosts.split(/\s+/).forEach(function(host) {
                data.result.sslHosts.push(host);
            });
        }
    });

    parser.registerLineProcessor(/^\[\s*(#)?.*]$/, function(line, allMatch, commentChar, data) {
        data.skiping = Boolean(commentChar);
        data.currentSection = {
            modifiers: [],
            rules: []
        };
        data.result.sections.push(data.currentSection);
        data.currentRules = null;
    });

    parser.registerLineProcessor(/^(#|$)/, function() {

    });

    return Q.nfcall(require('fs').readFile, fname, 'utf8').then(function(content) {
        return parser.parse(content, {
            result: {
                modifiers: [],
                rules: [],
                sections: [],
                sslHosts: []
            },
            baseDirs: [require('path').dirname(fname)],
            currentSection: null,
            currentRules: null,
            skiping: false
        }).get('result');
    });
};

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
        fname = fname.replace(/~/g, state.get('documentRoot', ''));
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
        require('child_process').exec(command, {encoding: 'binary', maxBuffer: 1024 * 1024}, function(err, stdout, stderr) {
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
    return tpl.replace(/(?:(~)|\$(?:(\d+)|\{(&)?([^}]+)\}))/g, function(ignore, tilde, num, escape, varname) {
        if (tilde) {
            return state.get('documentRoot');
        } else if (num) {
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

    if (commandName == 'SetDocumentRoot') {
        var documentRoot = commandArg;
        return function(state) {
            state.set('documentRoot', applyTemplate(documentRoot, state, ''));
        };
    }

    console.log('Unknown modifier ' + commandName);
}
