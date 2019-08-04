const path         = require('path');
const fs           = require('fs');
const crypto       = require('crypto');
const ssh2         = require('ssh2');
const readline     = require('readline');
const EventEmitter = require('events');


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class TestSSHServer extends EventEmitter {
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor(port) {
        super();
        this.hostKey = fs.readFileSync(path.join(__dirname, 'keys/ssh_host_rsa_key'));
        this.sshServer = new ssh2.Server({hostKeys: [this.hostKey]}, this.onClient.bind(this));
        this.port = port;
        this.allowedUser = Buffer.from('user');
        this.allowedPass = Buffer.from('password');

    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    async run() {
        return new Promise((resolve, reject) => {
            this.sshServer.on('listening', () => {
                this.sshServer.removeAllListeners('error');
                this.sshServer.removeAllListeners('listening');
                this.sshServer.on('error', err => {
                    console.error('SSH server error: ', err);
                });
                resolve();
            });
            this.sshServer.on('error', err => {
                this.sshServer.removeAllListeners('error');
                reject(err);
            });
            this.sshServer.listen(this.port, '127.0.0.1');
        });
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    stop() {
        this.sshServer.close();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    onClient(client) {
        console.log('Client connected');
        this.emit('client', client);
        client.on('authentication', this.onClientAuth.bind(this));
        client.on('ready', () => {
            this.onClientReady(client);
        });
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    onClientAuth(ctx) {
        var user = Buffer.from(ctx.username);
        if (user.length !== this.allowedUser.length || !crypto.timingSafeEqual(user, this.allowedUser)) {
            return ctx.reject();
        }

        switch (ctx.method) {
            case 'password':
                var password = Buffer.from(ctx.password);
                if (password.length !== this.allowedPass.length || !crypto.timingSafeEqual(password, this.allowedPass)) {
                    return ctx.reject();
                }
                break;
            default:
                return ctx.reject();
        }
        ctx.accept();
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    onClientReady(client) {
        console.log('client authenticated');
        client.on('session', function (accept, reject) {
            var session = accept();
            session.on('pty', function (accept, reject, info) {
                accept();
            });
            session.on('shell', function (accept, reject) {
                var stream = accept();
                var closed = false;
                stream.write('Welcome to the SSH test server!\r\n');
                stream.write('user@server$ ');
                var rl = readline.createInterface({
                    input: stream,
                    output: stream,
                    prompt: 'user@server$ '
                });
                rl.on('line', function (line) {
                    console.log('line:', line);
                    if (line == 'exit') {
                        stream.write('\r\nlogout\r\n');
                        stream.end();
                        stream.exit(0);
                        closed = true;
                    } else {
                        stream.write('\r\n' + line + '\r\n');
                        rl.prompt();
                    }

                });
                stream.on('data', function (data) {
                    if (!closed) {
                        stream.write(data);
                    }
                });

                stream.on('end', function () {
                    console.log('stream closed');
                });
            });
        });

    }
}

module.exports = TestSSHServer;