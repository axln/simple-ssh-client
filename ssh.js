#!/usr/bin/env node

const yargs        = require('yargs');
const Helper       = require('./lib/Helper');
const SSHClientApp = require('./lib/SSHClientApp');

let app = new SSHClientApp();

console.log(process.cwd());

console.log(yargs.argv);
app.run(yargs.argv).catch(err => {
    if (err.errno == 'ECONNREFUSED') {
        Helper.errorToTerminal(`Can't connect to ${err.address}`);
    } else {
        Helper.errorToTerminal(err.message);
    }
});