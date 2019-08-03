'use strict';

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class Helper {
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    static parseForwardInfo (argv) {
        let forwardInfo = {};
        if (argv.L) {
            let params = Array.isArray(argv.L) ? argv.L[0] : argv.L;
            forwardInfo.local = Helper.parseHostPort(params);
        }

        if (argv.R) {
            let params = Array.isArray(argv.R) ? argv.R[0] : argv.R;
            forwardInfo.remote = Helper.parseHostPort(params);
        }
        return forwardInfo;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    static parseHostPort (str) {
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
        //console.log('argv:', argv);
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

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    static isPort (str) {
        if (isNaN(str)) {
            return false;
        } else {
            let number = parseInt(str);
            return number >= 0 && number <= 0xFFFF;
        }
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    static logToTerminal (str) {
        console.log(Helper.getTimeStr(), str);
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    static errorToTerminal (str) {
        console.error(Helper.getTimeStr(), str);
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    static getTimeStr () {
        let time = new Date();
        let hours = time.getHours();
        let minutes = time.getMinutes();
        let seconds = time.getSeconds();
        minutes = minutes < 10 ? '0' + minutes : minutes;
        seconds = seconds < 10 ? '0' + seconds : seconds;
        return `[${hours}:${minutes}:${seconds}]`;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    static PromiseTry (fn) {
        return new Promise((resolve, reject) => {
            try {
                resolve(fn());
            } catch (err) {
                reject(err);
            }
        });
    }
}

module.exports = Helper;