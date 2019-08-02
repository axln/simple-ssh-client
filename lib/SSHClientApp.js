'use strict';

const path     = require('path');
const net      = require('net');
const readline = require('readline');
const Client   = require('ssh2').Client;
const Helper   = require('./Helper');

const BATCH_TIMEOUT = 300;

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function SSHClientApp() {
    var self = this;
    self.client          = null;
    self.shellStream     = null;
    self.lineReader      = null;
    self.replyHook       = null;
    self.echoBuffer      = null;
    self.echoPosition    = 0;
    self.connectInfo     = null;
    self.forwardInfo     = null;
    self.ignoreNextReply = false;
    self.suppressEcho    = true;
    self.prompt          = '>';
    self.debugOutput     = false;
    //self.debugOutput   = true;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
SSHClientApp.prototype.run = function (argv) {
    var self = this;
    self.connectInfo = Helper.parseConnectInfo(argv._[0]);
    self.forwardInfo = Helper.parseForwardInfo(argv);
    //console.log('forwardInfo:', self.forwardInfo);
    //console.log('connectInfo:', self.connectInfo);

    self.client = new Client();

    self.connect(self.connectInfo).then(function () {
        Helper.logToTerminal('Connected successfully.');
        return self.startShell().then(function (stream) {
            self.shellStream = stream;
            self.shellStream.on('data', self.onShellOutput.bind(self));
            self.shellStream.on('close', self.onShellClosed.bind(self));
            self.createLineReader();
        });
    }).then(function () {
        if (self.forwardInfo.local) {
            return self.localForward(self.forwardInfo.local);
        }
    }).then(function () {
        if (self.forwardInfo.remote) {
            return self.remoteForward(self.forwardInfo.remote);
        }
    }).catch(function (err) {
        console.error('Error connecting:', err);
    });
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
SSHClientApp.prototype.createLineReader = function () {
    var self = this;
    self.lineReader = readline.createInterface({
        prompt   : self.prompt,
        input    : process.stdin,
        output   : process.stdout,
        completer: function (line, cb) {
            self.requestAutoComplete(line).then(function (complete) {
                cb(null, [[line + complete], line]);
            }).catch(function (err) {
                cb(err);
            });
        }
    });
    self.lineReader.on('line', self.onCommand.bind(self));
    self.lineReader.on('SIGINT', self.onCtrlC.bind(self));
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
SSHClientApp.prototype.connect = function (connectInfo) {
    var self = this;
    Helper.logToTerminal(`Connecting to ${self.connectInfo.host}...`);
    return new Promise(function (resolve, reject) {
        var onError = function (err) {
            self.client.removeListener('error', onError);
            reject(err);
        };
        self.client.on('error', onError);
        self.client.on('ready', function () {
            self.client.removeListener('error', onError);
            self.client.on('error', self.onError.bind(self));
            resolve();
        });
        self.client.connect(connectInfo);
    });
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
SSHClientApp.prototype.onShellClosed = function () {
    var self = this;
    Helper.logToTerminal(`Connection to ${self.connectInfo.host} closed.`);
    self.client.end();
    if (self.localServer) {
        self.localServer.close();
    }
    if (self.lineReader) {
        self.lineReader.close();
    }
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
SSHClientApp.prototype.onShellOutput = function (buffer) {
    var self = this;
    if (self.debugOutput) {
        console.log('output:', buffer);
        console.log('string:' + buffer);
    }
    if (self.ignoreNextReply) {
        self.ignoreNextReply = false;
        return;
    }
    if (self.echoBuffer) {
        for (var i = 0; i < buffer.length; ++i) {
            if (self.echoBuffer && self.echoPosition < self.echoBuffer.length) {
                //console.log('suppressed:', buffer[i]);
                if (!self.suppressEcho) {
                    //console.log('suppressed:', buffer[i]);
                    process.stdout.write(String.fromCharCode(buffer[i]));
                }
                if (self.echoBuffer[self.echoPosition] === buffer[i]) {
                    if (self.echoPosition < self.echoBuffer.length - 1) {
                        self.echoPosition += 1;
                    } else {
                        self.echoBuffer = null;
                        self.echoPosition = 0;
                        //console.log('\necho suppress done');
                    }
                }
            } else {
                var tail = buffer.slice(i, buffer.length - i);
                if (self.replyHook) {
                    self.replyHook(tail, false);
                } else {
                    process.stdout.write(tail);
                }
                break;
            }
        }
    } else if (self.replyHook) {
        self.replyHook(buffer, true);
    } else {
        process.stdout.write(buffer);
    }
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
SSHClientApp.prototype.sendLine = function (line) {
    var self = this;
    if (self.shellStream) {
        self.shellStream.write(line);
        self.echoBuffer = Buffer.from(line);
        //console.log('echo buffer:', self.echoBuffer);
        self.echoPosition = 0;
    }
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
SSHClientApp.prototype.batchRequest = function (line) {
    var self = this;
    //self.debugOutput = true;
    return new Promise(function (resolve, reject) {
        var replyBuffer = null;
        var timer = null;

        function onTimeout() {
            timer = null;
            self.replyHook = null;
            //console.log('hook removed');
            resolve(replyBuffer.toString());
        }

        self.replyHook = function (buffer) {
            if (timer) {
                // reset timer
                clearTimeout(timer);
                timer = setTimeout(onTimeout, BATCH_TIMEOUT);
            }
            //console.log('buffer:', buffer);
            //console.log('buffer as string: '+ buffer);
            if (replyBuffer) {
                replyBuffer = Buffer.concat([replyBuffer, buffer]);
            } else {
                replyBuffer = buffer;
            }
        };
        timer = setTimeout(onTimeout, BATCH_TIMEOUT);
        self.sendLine(line + '\n');
        //self.shellStream.write(line + '\n');
    });
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
SSHClientApp.prototype.requestAutoComplete = function (line) {
    var self = this;

    return new Promise(function (resolve, reject) {
        //console.log('\ntry autocomplete:', line);
        self.sendLine(line);
        self.shellStream.write('\t');

        var replyBuffer = null;
        self.replyHook = function (buffer, finish) {
            if (replyBuffer) {
                replyBuffer = Buffer.concat([replyBuffer, buffer]);
            } else {
                replyBuffer = buffer;
            }
            if (finish) {
                self.replyHook = null;
                //console.log('\ncompleted:', replyBuffer.toString());
                //process.stdout.write(replyBuffer);
                //

                //console.log('\n erase remote command');
                //debugOutput = true;
                // clear current bash line on the remote server
                self.ignoreNextReply = true;
                self.sendLine('\u0015');
                resolve(replyBuffer.toString());
            }
        };
    });
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
SSHClientApp.prototype.getCurrentDir = function () {
    var self = this;
    return self.batchRequest('pwd').then(function (batchReply) {
        //console.log('batchReply:', batchReply);
        var lines = batchReply.trim().split('\n');
        return {
            cwd: lines[0].trim(),
            prompt: lines[1].trim()
        };
    });
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
SSHClientApp.prototype.openSFTPSession = function () {
    var self = this;
    return new Promise(function (resolve, reject) {
        self.client.sftp(function  (err, sftp) {
            if (err) {
                reject(err);
            } else {
                resolve(sftp);
            }
        });
    });
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
SSHClientApp.prototype.getFile = function (fileName) {
    var self = this;
    return self.getCurrentDir().then(function (dirInfo) {
        var fullFileName = fileName[0] == '/' ? fileName : path.join(dirInfo.cwd, fileName);
        Helper.logToTerminal(`Downloading ${self.connectInfo.host}:${path.normalize(fullFileName)} to ${process.cwd()}/...`);
        /*console.log('cur dir:', dirInfo.cwd);
        console.log('prompt:', dirInfo.prompt);*/
        return self.openSFTPSession().then(function (sftp) {
            sftp.fastGet(fullFileName, path.basename(fileName), function (err) {
                if (err) {
                    throw err;
                } else {
                    Helper.logToTerminal('File has been downloaded successfully.');
                    process.stdout.write(dirInfo.prompt + ' ');
                }
            });
        });
    }).catch(function (err) {
        console.error('get file error:', err);
    });
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
SSHClientApp.prototype.putFile = function (fileName) {
    var self = this;
    return self.getCurrentDir().then(function (dirInfo) {
        var fullFileName = path.normalize(path.join(process.cwd(), fileName));
        Helper.logToTerminal(`Uploading ${fullFileName} to ${self.connectInfo.host}:${dirInfo.cwd}/...`);
        return self.openSFTPSession().then(function (sftp) {
            sftp.fastPut(fileName, path.basename(fileName), function (err) {
                if (err) {
                    throw err;
                } else {
                    Helper.logToTerminal('File has been uploaded successfully.');
                    process.stdout.write(dirInfo.prompt + ' ');
                }
            });
        })
    }).catch(function (err) {
        console.error('get file error:', err);
    });
};


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
SSHClientApp.prototype.onCtrlC = function () {
    var self = this;
    //console.log('Ctrl+C pressed');
    if (self.shellStream) {
        // send Ctrl+C ASCII char 0x03
        self.shellStream.write('\u0003');
    } else {
        console.log('Exiting...');
        process.exit();
    }
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
SSHClientApp.prototype.onCommand = function (line) {
    var self = this;
    //console.log('onCommand:', line);

    var localCmdTemplate = /^(put|get)(\s+.*)?$/;
    var match = line.trim().match(localCmdTemplate);
    if (match) {
        //console.log('local command:', match);
        var cmd = match[1];
        if (match[2]) {
            var fileName = match[2].trim();
            switch(cmd) {
                case 'get':
                    self.getFile(fileName);
                    break;
                case 'put':
                    self.putFile(fileName);
                    break;
            }
        } else {
            console.log('You must specify file name with get or put commands.');
            self.lineReader.prompt();
        }
    } else {
        self.sendLine(line + '\n');
    }
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
SSHClientApp.prototype.startShell = function () {
    var self = this;
    return new Promise(function (resolve, reject) {
        var windowOptions = {term: 'xterm'};

        if (process.stdout.isTTY) {
            windowOptions.cols = process.stdout.columns;
            windowOptions.rows = process.stdout.rows;
        }

        self.client.shell(windowOptions, function (err, stream) {
            if (err) {
                reject(err);
            } else {
                resolve(stream);
            }
        });
    });
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
SSHClientApp.prototype.onError = function (err) {
    var self = this;
    console.log('SSHClientApp: onError:', err);
};


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
SSHClientApp.prototype.localForward = function (params) {
    var self = this;
    return new Promise(function (resolve, reject) {
        self.localServer = net.createServer(function (socket) {
            //console.log('on connection from' + socket.remoteAddr);
            self.client.forwardOut(params.bindHost, params.bindPort, params.connectHost, params.connectPort, function (err, stream) {
                if (err) {
                    socket.end();
                } else {
                    stream.pipe(socket);
                    socket.pipe(stream);
                }
            });
        }).on('listening', function () {
            self.localServer.removeAllListeners('error');
            self.localServer.on('error', function (err) {
                console.error('Local server error:', err);
            });
            resolve();
        }).on('error', function (err) {
            reject(err);
        }).listen({
            host: params.bindHost,
            port: params.bindPort
        });
    });
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
SSHClientApp.prototype.remoteForward = function (params) {
    var self = this;
    return new Promise(function (resolve, reject) {
        self.client.on('tcp connection', function (info, acceptCnn, rejectCnn) {
            var socket = net.createConnection(params.connectPort, params.connectHost, function () {
                var stream = acceptCnn();
                stream.pipe(socket);
                socket.pipe(stream);
            }).on('error', function (err) {
                console.log('Remote forward error:', err);
                rejectCnn();
            })
        });
        self.client.forwardIn(params.bindHost, params.bindPort, function (err, remotePort) {
            if (err) {
                reject(err);
            } else {
                resolve(remotePort);
            }
        })
    });
};

module.exports = SSHClientApp;