const path     = require('path');
const net      = require('net');
const readline = require('readline');
const Client   = require('ssh2').Client;
const Helper   = require('./Helper');

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class SSHClientApp {
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor() {
        SSHClientApp.BATCH_TIMEOUT = 300;

        this.client          = null;
        this.shellStream     = null;
        this.lineReader      = null;
        this.replyHook       = null;
        this.echoBuffer      = null;
        this.echoPosition    = 0;
        this.connectInfo     = null;
        this.forwardInfo     = null;
        this.ignoreNextReply = false;
        this.suppressEcho    = true;
        this.prompt          = '>';
        this.debugOutput     = false;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    run(argv) {
        return Helper.PromiseTry(() => {
            this.connectInfo = SSHClientApp.parseConnectInfo(argv);
            this.forwardInfo = SSHClientApp.parseForwardInfo(argv);

            this.client = new Client();
            return this.connect(this.connectInfo);
        }).then(() => {
            Helper.logToTerminal('Connected successfully.');

            return this.startShell().then(stream => {
                this.shellStream = stream;
                this.shellStream.on('data', this.onShellOutput.bind(this));
                this.shellStream.on('close', this.onShellClosed.bind(this));
                this.createLineReader();
            });
        }).then(() => {
            if (this.forwardInfo.local) {
                return this.localForward(this.forwardInfo.local);
            }
        }).then(() => {
            if (this.forwardInfo.remote) {
                return this.remoteForward(this.forwardInfo.remote);
            }
        });
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    createLineReader() {
        this.lineReader = readline.createInterface({
            prompt   : this.prompt,
            input    : process.stdin,
            output   : process.stdout,
            completer: (line, cb) => {
                this.requestAutoComplete(line).then(complete => {
                    cb(null, [[line + complete], line]);
                }).catch(err => {
                    cb(err);
                });
            }
        });
        this.lineReader.on('line',   this.onCommand.bind(this));
        this.lineReader.on('SIGINT', this.onCtrlC.bind(this));
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    connect(connectInfo) {
        Helper.logToTerminal(`Connecting to ${this.connectInfo.host}...`);
        return new Promise((resolve, reject) => {
            const onError = err => {
                this.client.removeListener('error', onError);
                reject(err);
            };
            this.client.on('error', onError);
            this.client.on('ready', () => {
                this.client.removeListener('error', onError);
                this.client.on('error', this.onError.bind(this));
                resolve();
            });
            this.client.connect(connectInfo);
        });
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    onShellClosed() {
        Helper.logToTerminal(`Connection to ${this.connectInfo.host} closed.`);
        this.client.end();
        if (this.lineReader) {
            this.lineReader.close();
        }
        if (this.localServer) {
            this.localServer.close();
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    onShellOutput(buffer) {
        if (this.debugOutput) {
            console.log('output:', buffer);
            console.log('string:' + buffer);
        }
        if (this.ignoreNextReply) {
            this.ignoreNextReply = false;
            return;
        }
        if (this.echoBuffer) {
            for (let i = 0; i < buffer.length; ++i) {
                if (this.echoBuffer && this.echoPosition < this.echoBuffer.length) {
                    if (!this.suppressEcho) {
                        process.stdout.write(String.fromCharCode(buffer[i]));
                    }
                    if (this.echoBuffer[this.echoPosition] === buffer[i]) {
                        if (this.echoPosition < this.echoBuffer.length - 1) {
                            this.echoPosition += 1;
                        } else {
                            this.echoBuffer = null;
                            this.echoPosition = 0;
                        }
                    }
                } else {
                    let tail = buffer.slice(i, buffer.length - i);
                    if (this.replyHook) {
                        this.replyHook(tail, false);
                    } else {
                        process.stdout.write(tail);
                    }
                    break;
                }
            }
        } else if (this.replyHook) {
            this.replyHook(buffer, true);
        } else {
            process.stdout.write(buffer);
        }
    };

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    sendLine(line) {
        if (this.shellStream) {
            this.shellStream.write(line);
            this.echoBuffer = Buffer.from(line);
            this.echoPosition = 0;
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    batchRequest (line) {
        //this.debugOutput = true;
        return new Promise((resolve, reject) => {
            let replyBuffer = null;
            let timer = null;

            const onTimeout = () => {
                timer = null;
                this.replyHook = null;
                resolve(replyBuffer.toString());
            };

            this.replyHook = (buffer) => {
                if (timer) {
                    // reset timer
                    clearTimeout(timer);
                    timer = setTimeout(onTimeout, SSHClientApp.BATCH_TIMEOUT);
                }
                if (replyBuffer) {
                    replyBuffer = Buffer.concat([replyBuffer, buffer]);
                } else {
                    replyBuffer = buffer;
                }
            };
            timer = setTimeout(onTimeout, SSHClientApp.BATCH_TIMEOUT);
            this.sendLine(line + '\n');
        });
    };

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    requestAutoComplete(line) {
        return new Promise((resolve, reject) => {
            this.sendLine(line);
            this.shellStream.write('\t');

            let replyBuffer = null;
            this.replyHook = (buffer, finish) => {
                if (replyBuffer) {
                    replyBuffer = Buffer.concat([replyBuffer, buffer]);
                } else {
                    replyBuffer = buffer;
                }
                if (finish) {
                    this.replyHook = null;
                    // clear current bash line on the remote server
                    this.ignoreNextReply = true;
                    this.sendLine('\u0015');
                    resolve(replyBuffer.toString());
                }
            };
        });
    };

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    getCurrentDir() {
        return this.batchRequest('pwd').then(batchReply => {
            let lines = batchReply.trim().split('\n');
            return {
                cwd   : lines[0].trim(),
                prompt: lines[1].trim()
            };
        });
    };

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    openSFTPSession() {
        return new Promise((resolve, reject) => {
            this.client.sftp((err, sftp) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(sftp);
                }
            });
        });
    };

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    getFile(fileName) {
        return this.getCurrentDir().then(reply => {
            let fullFileName = fileName[0] == '/' ? fileName : path.join(reply.cwd, fileName);
            Helper.logToTerminal(`Downloading ${this.connectInfo.host}:${path.normalize(fullFileName)} to ${process.cwd()}/...`);
            //console.log('dirInfo:', reply);
            return this.openSFTPSession().then(sftp => {
                sftp.fastGet(fullFileName, path.basename(fileName), err => {
                    if (err) {
                        throw err;
                    } else {
                        Helper.logToTerminal('File has been downloaded successfully.');
                        process.stdout.write(reply.prompt + ' ');
                    }
                });
            });
        }).catch(err => {
            Helper.errorToTerminal(err.message);
        });
    };

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    putFile(fileName) {
        return this.getCurrentDir().then(dirInfo => {
            let fullFileName = path.normalize(path.join(process.cwd(), fileName));
            Helper.logToTerminal(`Uploading ${fullFileName} to ${this.connectInfo.host}:${dirInfo.cwd}/...`);
            return this.openSFTPSession().then(sftp => {
                sftp.fastPut(fileName, path.basename(fileName), err => {
                    if (err) {
                        throw err;
                    } else {
                        Helper.logToTerminal('File has been uploaded successfully.');
                        process.stdout.write(dirInfo.prompt + ' ');
                    }
                });
            })
        }).catch(err => {
            Helper.errorToTerminal(err.message);
        });
    };

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    onCtrlC() {
        if (this.shellStream) {
            // send Ctrl+C ASCII char 0x03
            this.shellStream.write('\u0003');
        } else {
            Helper.logToTerminal('Exiting...');
            process.exit();
        }
    };

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    onCommand(line) {
        let localCmdTemplate = /^(put|get)(\s+.*)?$/;
        let match = line.trim().match(localCmdTemplate);
        if (match) {
            let cmd = match[1];
            if (match[2]) {
                let fileName = match[2].trim();
                switch (cmd) {
                    case 'get':
                        this.getFile(fileName);
                        break;
                    case 'put':
                        this.putFile(fileName);
                        break;
                }
            } else {
                Helper.errorToTerminal('You must specify file name with get or put commands.');
                this.lineReader.prompt();
            }
        } else {
            this.sendLine(line + '\n');
        }
    };

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    startShell() {
        return new Promise((resolve, reject) => {
            let windowOptions = {term: 'xterm'};

            if (process.stdout.isTTY) {
                windowOptions.cols = process.stdout.columns;
                windowOptions.rows = process.stdout.rows;
            }

            this.client.shell(windowOptions, (err, stream) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(stream);
                }
            });
        });
    };

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    onError(err) {
        Helper.logToTerminal(err.message);
    };

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    localForward(params) {
        return new Promise((resolve, reject) => {
            this.localServer = net.createServer(socket => {
                this.client.forwardOut(params.bindHost, params.bindPort, params.connectHost, params.connectPort, (err, stream) => {
                    if (err) {
                        socket.end();
                    } else {
                        stream.pipe(socket);
                        socket.pipe(stream);
                    }
                });
            }).on('listening', () => {
                this.localServer.removeAllListeners('error');
                this.localServer.on('error', err => {
                    Helper.errorToTerminal(err.message);
                });
                resolve();
            }).on('error', err => {
                reject(err);
            }).listen({
                host: params.bindHost,
                port: params.bindPort
            });
        });
    };

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    remoteForward(params) {
        return new Promise((resolve, reject) => {
            this.client.on('tcp connection', (info, acceptCnn, rejectCnn) => {
                let socket = net.createConnection(params.connectPort, params.connectHost, () => {
                    let stream = acceptCnn();
                    stream.pipe(socket);
                    socket.pipe(stream);
                }).on('error', err => {
                    Helper.errorToTerminal(err.message);
                    rejectCnn();
                })
            });
            this.client.forwardIn(params.bindHost, params.bindPort, (err, remotePort) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(remotePort);
                }
            })
        });
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    static parseForwardInfo (argv) {
        let forwardInfo = {};
        if (argv.L) {
            let params = Array.isArray(argv.L) ? argv.L[0] : argv.L;
            forwardInfo.local = SSHClientApp.parseHostPort(params);
        }

        if (argv.R) {
            let params = Array.isArray(argv.R) ? argv.R[0] : argv.R;
            forwardInfo.remote = SSHClientApp.parseHostPort(params);
        }
        return forwardInfo;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    static parseHostPort(str) {
        let parts = str.split(':');

        let remoteStartIndex;
        let info = {};
        if (Helper.isPort(parts[0])) {
            info.bindHost = '127.0.0.1';
            info.bindPort = parseInt(parts[0]);
            remoteStartIndex = 1;
        } else if (Helper.isPort(parts[1])) {
            info.bindHost = parts[0];
            info.bindPort = parseInt(parts[0]);
            remoteStartIndex = 2;
        } else {
            throw new Error('Wrong forwarding format. Must be: [bindHost:]port:host:port')
        }

        if (parts.length < 3) {
            throw new Error('Wrong forwarding format. Must be: [bindHost:]port:host:port')
        } else if (Helper.isPort(parts[remoteStartIndex])) {
            info.connectHost = '127.0.0.1';
            info.connectPort = parseInt(parts[remoteStartIndex]);
        } else {
            info.connectHost = parts[remoteStartIndex];
            info.connectPort = parseInt(parts[remoteStartIndex + 1]);
        }
        return info;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    static parseConnectInfo (argv) {
        if (argv._.length == 0) {
            throw new Error('You must specify username and host: user[:password]@host');
        }
        let connectString = argv._[0];

        let parts = connectString.split('@');
        if (parts.length < 2) {
            throw new Error('Wrong host format. Must be: user[:password]@host');
        }

        let connectInfo = {};

        if (argv.p !== undefined && Helper.isPort(argv.p)) {
            connectInfo.port = parseInt(argv.p);
        } else {
            connectInfo.port = 22;
        }

        connectInfo.host = parts[1];
        let loginInfo = parts[0].split(':');
        if (loginInfo.length > 1) {
            connectInfo.password = loginInfo[1];
        }
        connectInfo.username = loginInfo[0];
        if (connectInfo.password === undefined && process.env.SSH_AUTH_SOCK) {
            connectInfo.agent = process.env.SSH_AUTH_SOCK;
        }
        return connectInfo;
    }
}

module.exports = SSHClientApp;