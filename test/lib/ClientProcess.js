const path          = require('path');
const child_process = require('child_process');
const Helper        = require('./Helper');

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class ClientProcess {
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    constructor(cmdLine) {
        ClientProcess.EXEC_DELAY = 1000;

        this.cmdLine      = cmdLine;
        this.child        = null;
        this.stdin        = null;
        this.stdout       = null;
        this.stderr       = null;
        this.outputBuffer = null;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    start() {
        return new Promise((resolve, reject) => {
            var scriptFileName = path.join(__dirname, '../../ssh.js');
            this.child = child_process.fork(scriptFileName, this.cmdLine.split(' '), {
                cwd: path.join(__dirname, '../../'),
                stdio: 'pipe'
            });
            this.stdin  = this.child.stdin;
            this.stdout = this.child.stdout;
            this.stderr = this.child.stderr;

            const dataHandler = buffer => {
                this.child.stdout.removeListener('data', dataHandler);
                this.child.stderr.removeListener('data', dataHandler);

                this.child.stdout.on('data', this.onData.bind(this));
                this.child.stderr.on('data', this.onData.bind(this));

                this.outputBuffer = buffer;
                resolve();
            };
            const errorHandler = err => {
                this.child.removeListener('error', errorHandler);
                reject(err);
            };

            this.child.stdout.on('data', dataHandler);
            this.child.stderr.on('data', dataHandler);
            this.child.on('error', errorHandler);
        });
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    onData(buffer) {
        if (this.outputBuffer) {
            this.outputBuffer = Buffer.concat([this.outputBuffer, buffer]);
        } else {
            this.outputBuffer = buffer;
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    close() {
        this.child.kill();
    }
}

module.exports = ClientProcess;