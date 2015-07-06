var Q = require('q');
var spawn = require('child_process').spawn;
var assert = require('assert');

describe('Yaxy', function() {
    require('../tools/test-server');

    describe('Rules', function() {
        var tests = [
            ['simple-request', 'http://localhost:9595/', 'Hello'],
            ['simple-rewrite', 'http://www.yandex.ru/', 'Hello']
        ];

        var yaxy;

        afterEach(function() {
            yaxy.kill();
        });
        this.timeout(5000);

        tests.forEach(function(test) {
            it(test[0], function() {
                return Q.Promise(function(resolve, reject) {
                    try {
                        yaxy = spawn('node', ['index.js', '--config', 'test/yaxy-configs/' + test[0] + '.txt', '--port', '9559', '--https-port', '9569'], {
                            cwd: process.cwd()
                        });
                        yaxy.stdout.on('data', function(chunk) {
                            console.log('Yaxy: ' + chunk);
                        });
                        yaxy.stderr.on('data', function(chunk) {
                            yaxy.kill();
                            reject('YaxyError: ' + chunk);
                        });
                    } catch (err) {
                        reject(err);
                    }
                    setTimeout(function() {
                        var phantomResult = '';
                        var phantomError = '';
                        var phantom = spawn(require('phantomjs').path, ['--proxy=localhost:9559', 'tools/phantom.js', test[1]]);
                        phantom.stdout.on('data', function(chunk) {
                            phantomResult += chunk;
                        });
                        phantom.stderr.on('data', function(chunk) {
                            phantomError += chunk;
                        });
                        phantom.on('exit', function() {
                            if (phantomError) {
                                reject(new Error('PhantomError: ' + phantomError));
                            } else {
                                assert.equal(phantomResult.trim(), test[2]);
                                resolve();
                            }
                        });
                    }, 500);
                });
            });
        });
    });
});
