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
                            action: createAction(pattern, operands[1]) ,
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
    if (source.indexOf('/') == 0 && source.lastIndexOf('/') == source.length - 1) {
        return {
            url: new RegExp(source.substr(1, source.length - 2), 'i')
        };
    } else {
        return {
            urlStart: source.replace(/^(?!https?:\/\/)/, 'http://')
        };
    }
}

function createAction(pattern, replacement) {
    if (replacement == '') {
        return function(state) {
            state.abort();
        };
    }
    if (replacement == '$') {
        return function(state) {
            state.doRequest();
        };
    }
    if (replacement.match(/^data:(?:([a-zA-Z/-]+);)?(base64,)?(.*)/)) {
        var dataContentType = RegExp.$1 || 'text/plain';
        var dataContent = new Buffer(RegExp.$3 || '', RegExp.$2 ? 'base64' : 'utf8');
        return function(state) {
            state.setResponseType(dataContentType);
            state.send(dataContent);
        };
    }
    if (replacement.indexOf('file://') == 0) {
        return function(state) {
            var url = state.getRequestUrl();
            var fname = replacement.slice(7);
            if (pattern.urlStart) {
                fname = require('path').join(fname, url.slice(pattern.urlStart.length));
            } else if (pattern.url) {
                fname = url.replace(pattern.url, fname);
            }
            state.sendFile(fname);
        };
    }
    return function(state) {
        var url = state.getRequestUrl();
        if (pattern.url) {
            state.setRequestUrl(url.replace(pattern.url, replacement));
        } else if (pattern.urlStart) {
            state.setRequestUrl(replacement.replace(/^(?!https?:\/\/)/, 'http://') + url.slice(pattern.urlStart.length));
        }
        state.doRequest();
    };
}

function createModifier(command) {
    var args = command.split(/\s+/);
    var commandName = args.shift();
    var commandArg = args.join(' ');
    if (/^(setRequestHeader|setResponseHeader|setQueryParam|setCookie)$/.test(commandName)) {
        var argsSeparator = ':';
        if (commandName == 'setQueryParam' || commandName == 'setCookie') {
            argsSeparator = '=';
        }
        var setArgs = commandArg.split(argsSeparator);
        var setArgName = setArgs.shift().trim();
        var setArgValue = setArgs.join(argsSeparator).trim();
        return function(state) {
            state[commandName](setArgName, setArgValue);
        };
    }
    if (/^(removeRequestHeader|removeResponseHeader|removeQueryParam|removeCookie)$/.test(commandName)) {
        return function(state) {
            state[commandName](commandArg);
        };
    }
    if (commandName == 'setStatusCode') {
        var statusCode = +commandArg;
        if (statusCode) {
            return function(state) {
                state.overwriteResponseStatus(statusCode);
            };
        }
    }
}