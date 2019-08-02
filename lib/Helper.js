'use strict';

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function Helper() {}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
Helper.parseForwardInfo = function (argv) {
    var forwardInfo = {};
    if (argv.L) {
        var localParams = Array.isArray(argv.L) ? argv.L[0] : argv.L;
        forwardInfo.local = Helper.parseHostPort(localParams);
    }

    if (argv.R) {
        var remoteParams = Array.isArray(argv.R) ? argv.R[0] : argv.R;
        forwardInfo.remote = Helper.parseHostPort(remoteParams);
    }
    return forwardInfo;
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
Helper.parseHostPort = function (str) {
    var parts = str.split(':');

    var remoteStartIndex;
    var info = {};
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
};


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
Helper.parseConnectInfo = function (connectString) {
    var parts = connectString.split('@');
    if (parts.length < 2) {
        throw new Error('Wrong host format. Must be: user[:password]@host');
    }

    var connectInfo = {port: 22};
    connectInfo.host = parts[1];
    var loginInfo = parts[0].split(':');
    if (loginInfo.length > 1) {
        connectInfo.password = loginInfo[1];
    }
    connectInfo.username = loginInfo[0];
    if (connectInfo.password === undefined && process.env.SSH_AUTH_SOCK) {
        connectInfo.agent = process.env.SSH_AUTH_SOCK;
    }
    return connectInfo;
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
Helper.isPort = function (str) {
    if (isNaN(str)) {
        return false;
    } else {
        var number = parseInt(str);
        return number >= 0 && number <= 0xFFFF;
    }
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
Helper.logToTerminal = function (str) {
    console.log(Helper.getTimeStr(), str);
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
Helper.errorToTerminal = function (str) {
    console.error(Helper.getTimeStr(), str);
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
Helper.getTimeStr = function () {
    var time = new Date();
    var hours = time.getHours();
    var minutes = time.getMinutes();
    var seconds = time.getSeconds();
    minutes = minutes < 10 ? '0' + minutes : minutes;
    seconds = seconds < 10 ? '0' + seconds : seconds;
    return `[${hours}:${minutes}:${seconds}]`;
};

module.exports = Helper;