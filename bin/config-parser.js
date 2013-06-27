exports.parse = function(fname, callback) {
    require('fs').readFile(fname, 'utf8', function(err, config) {
        if (err) {
            return callback(err);
        }

        var result = {
            modifiers: [],
            rules: [],
            sections: []
        };
        var currentSection;
        var currentRule;
        var skiping = false;
        config.split('\n').forEach(function(line) {
            line = line.trim();
            if (line && line.indexOf('#') != 0) {
                if (line.indexOf('[') == 0 && line.indexOf(']') == line.length - 1) {
                    var sectionName = line.slice(1, -1).trim();
                    skiping = sectionName.indexOf('#') == 0;
                    currentSection = {
                        modifiers: [],
                        rules: []
                    };
                    result.sections.push(currentSection);
                    currentRule = null;
                } else if (!skiping) {
                    if (line.indexOf('$') == 0) {
                        var modifier = createModifier(line.slice(1));
                        if (modifier) {
                            (currentRule || currentSection || result).modifiers.push(modifier);
                        }
                    } else if (line.indexOf('=>') > -1) {
                        var operands = line.split('=>').map(function(operand) {
                            return operand.trim();
                        });
                        var pattern = createPattern(operands[0]);
                        currentRule = {
                            pattern: pattern,
                            action: createAction(pattern.url || pattern.urlStart, operands[1]) ,
                            modifiers: []
                        };
                        (currentSection || result).rules.push(currentRule);
                    }

                }
            }
        });
        callback(null, result);
    });
};

function createPattern(source) {
    if (source[0] == '/' && source[source.length - 1] == '/') {
        return {
            url: new RegExp(source.substr(1, source.length - 2), 'i')
        };
    } else if (source[0] == '!') {
        return {
            url: source.slice(1).replace(/^(?!https?:\/\/)/, 'http://')
        };
    } else {
        return {
            urlStart: source.replace(/^(?!https?:\/\/)/, 'http://')
        };
    }
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
        var url = state.getRequestUrl();
        var content = typeof pattern != 'string' && !isBase64 ? applyTemplate(tpl, url.match(pattern)) : tpl;
        content = new Buffer(content, isBase64 ? 'base64' : 'utf8');
        state.setResponseType(contentType);
        state.send(content);
    };
}

function createFileAction(pattern, fnameTemplate) {
    return function(state) {
        var url = state.getRequestUrl();
        var fname = typeof pattern == 'string' ? require('path').join(fnameTemplate, url.slice(pattern.length)) : applyTemplate(fnameTemplate, url.match(pattern));
        fname = fname.split('?')[0];
        state.sendFile(fname);
    };
}

function createStandardAction(pattern, urlTemplate) {
    return function(state) {
        var originUrl = state.getRequestUrl();
        var url;
        if (typeof pattern == 'string') {
            url = urlTemplate.replace(/^(?!https?:\/\/)/, 'http://') + originUrl.slice(pattern.length);
        } else {
            url = applyTemplate(urlTemplate, originUrl.match(pattern));
        }
        state.setRequestUrl(url);
        state.doRequest();
    };
}

function applyTemplate(tpl, args) {
    args = args || [];
    return tpl.replace(/\$(\d+)/g, function(ignore, num) {
        return args[num] || '';
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
            state[methodName](setArgName, setArgValue);
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
}