#!/usr/bin/env node

const yargs        = require('yargs');
const SSHClientApp = require('./lib/SSHClientApp');
const Helper       = require('./lib/Helper');

let app = new SSHClientApp();

app.run(yargs.argv).catch(err => {
    if (err.errno == 'ECONNREFUSED') {
        Helper.errorToTerminal(`Can't connect to ${err.address}`);
    } else {
        Helper.errorToTerminal(err);
    }
});