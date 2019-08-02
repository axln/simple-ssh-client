#!/usr/bin/env node

const yargs        = require('yargs');
const SSHClientAPP = require('./lib/SSHClientApp');

var app = new SSHClientAPP();

app.run(yargs.argv);