const colors        = require('colors');
const SSHClientApp  = require('../lib/SSHClientApp');
const TestSSHServer = require('./lib/TestSSHServer');
const ClientProcess = require('./lib/ClientProcess');
const Helper        = require('./lib/Helper');

let tests = [
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    {
        title: 'Params: Parse connect string with password',
        run: async () => {
            var argv = {
                _: ['user:password@host']
            };
            var info = SSHClientApp.parseConnectInfo(argv);
            return info.port == 22 && info.host == 'host' && info.username == 'user' && info.password == 'password';
        }
    },
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    {
        title: 'Params: Parse connect string without password',
        run: async () => {
            var argv = {
                _: ['user@host']
            };
            var info = SSHClientApp.parseConnectInfo(argv);
            if (process.env.SSH_AUTH_SOCK) {
                return info.port == 22 && info.host == 'host' && info.username == 'user' && info.agent == process.env.SSH_AUTH_SOCK;
            } else {
                return info.port == 22 && info.host == 'host' && info.username == 'user';
            }

        }
    },
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    {
        title: 'Params: Non-standard port',
        run: async ()  => {
            var argv = {
                _: ['user:password@host'],
                p: 2222
            };
            var info = SSHClientApp.parseConnectInfo(argv);
            return info.port == 2222 && info.host == 'host' && info.username == 'user';
        }
    },
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    {
        title: 'Params: Local forwarding [full]',
        run: async () => {
            var argv = {
                _: ['user:password@host'],
                L: 'bindaddr:8000:localhost:8080'
            };
            var info = SSHClientApp.parseForwardInfo(argv);
            return info.local.bindHost == 'bindaddr' &&
                info.local.bindPort == 8000 &&
                info.local.connectHost == 'localhost' &&
                info.local.connectPort == 8080;
        }
    },
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    {
        title: 'Params: Local forwarding [local port only]',
        run: async () => {
            var argv = {
                _: ['user:password@host'],
                L: '8000:localhost:8080'
            };
            var info = SSHClientApp.parseForwardInfo(argv);
            return info.local.bindHost == '127.0.0.1' &&
                info.local.bindPort == 8000 &&
                info.local.connectHost == 'localhost' &&
                info.local.connectPort == 8080;
        }
    },
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    {
        title: 'Params: Remote forwarding [full]',
        run: async () => {
            var argv = {
                _: ['user:password@host'],
                R: 'bindaddr:8000:localhost:8080'
            };
            var info = SSHClientApp.parseForwardInfo(argv);
            return info.remote.bindHost == 'bindaddr' &&
                info.remote.bindPort == 8000 &&
                info.remote.connectHost == 'localhost' &&
                info.remote.connectPort == 8080;
        }
    },
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    {
        title: 'Params: Local forwarding [local port only]',
        run: async () => {
            var argv = {
                _: ['user:password@host'],
                R: '8000:localhost:8080'
            };
            var info = SSHClientApp.parseForwardInfo(argv);
            return info.remote.bindHost == '127.0.0.1' &&
                info.remote.bindPort == 8000 &&
                info.remote.connectHost == 'localhost' &&
                info.remote.connectPort == 8080;
        }
    },
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    {
        title: 'Client: Connection and authentication',
        run: () => {
            return new Promise(resolve => {
                var sshServer = new TestSSHServer(2222);
                sshServer.on('client', function (client) {
                    console.log('server got new client:', client);
                    resolve();
                });
                return sshServer.run().then(() => {
                    let client = new ClientProcess('user:password@127.0.0.1 -p 2222');
                    return client.start().then(() => {
                        console.log('output:' + client.outputBuffer);

                        return client.exec('uptime').then(() => {

                        });
                        //console.log('exec output:'  + output);

                        //sshServer.stop();
                        return true;
                    });
                });


                //await client.start();


            });
        }
    }
];

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
async function runTests() {
    console.log('Running tests...');
    const TAB_LENGTH = 50;
    for (let i = 0; i < tests.length; ++i) {
        let test = tests[i];
        var dotCount = test.title.length < TAB_LENGTH ? TAB_LENGTH - test.title.length : 3;
        console.log(`${i+1}/${tests.length}: ${test.title}`.yellow + '.'.repeat(3).yellow);
        //console.log(`Test: ${test.title}`);
        var result = await test.run();
        if (result) {
            console.log(`${i+1}/${tests.length}: Passed`.green)
        } else {
            console.log(`${i+1}/${tests.length}: Failed`.red);
            console.log('Testing stopped'.red);
            break;
        }
    }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
runTests().catch(err => {
    console.error('Testing failed:', err);
});