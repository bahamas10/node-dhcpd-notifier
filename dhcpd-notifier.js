#!/usr/bin/env node
/**
 * Alert (notify) when dhcpd gives out new leases
 *
 * Author: Dave Eddy <dave@daveeddy.com>
 * Date: July 10, 2015
 * License: MIT
 */

var assert = require('assert-plus');
var cp = require('child_process');
var fs = require('fs');
var f = require('util').format;

var bunyan = require('bunyan');
var dhcpdleases = require('dhcpd-leases');
var getopt = require('posix-getopt');
var vasync = require('vasync');

var package = require('./package.json');

var oldleases;

var usage = [
    'usage: dhcpd-notifier [-huv] <config.json>',
    '',
    'alert (notify) when dhcpd gives out new lease',
    '',
    'options',
    '',
    '  -h, --help       print this message and exit',
    '  -u, --updates    check for available updates',
    '  -v, --version    print the version number and exit',
].join('\n');

var log = bunyan.createLogger({
    name: 'dhcpd-notifier',
    level: 'info'
});

var options = [
    'h(help)',
    'u(updates)',
    'v(version)'
].join('');
var parser = new getopt.BasicParser(options, process.argv);

var option;
while ((option = parser.getopt())) {
    switch (option.option) {
    case 'h':
        console.log(usage);
        process.exit(0);
        break;
    case 'u': // check for updates
        require('latest').checkupdate(package, function(ret, msg) {
            console.log(msg);
            process.exit(ret);
        });
        return;
    case 'v':
        console.log(package.version);
        process.exit(0);
        break;
    default:
        console.error(usage);
        process.exit(1);
        break;
  }
}

var args = process.argv.slice(parser.optind());
var config = args[0] || process.env.DHCPD_NOTIFIER_CONFIG;

log.trace({config: config, args: args}, 'config: "%s"', config);

// Read configuration
try {
    assert.string(config, 'config must be set as the first argument or env DHCPD_NOTIFIER_CONFIG');
    config = JSON.parse(fs.readFileSync(config, 'utf8'));
    assert.object(config, 'config must be an object');
} catch (e) {
    console.error('failed to read config: %s', e.message);
    process.exit(1);
}

config.aliases = config.aliases || {};
config.ignore = config.ignore || [];
config.loglevel = config.loglevel || 'info';

assert.string(config.loglevel, 'config.loglevel');
assert.object(config.exec, 'config.exec');
assert.string(config.exec.file, 'config.exec.file');
assert.number(config.exec.timeout, 'config.exec.timeout');
assert.number(config.exec.timeout, 'config.exec.timeout');
assert.string(config.leases, 'config.leases');
assert.number(config.interval, 'config.interval');
assert(config.interval > 0, 'config.interval > 0');
assert.object(config.aliases, 'config.aliases');
assert.arrayOfString(config.ignore, 'config.ignore');

log.level(config.loglevel);

log.debug({config: config}, 'loaded config');
log.info('watching file %s for changes every %d seconds',
    config.leases, config.interval);

/*
 * A new lease has been seen! this queue will handle executing the child task
 * with the proper environment serially.
 */
var execQueue = vasync.queue(function (lease, cb) {
    assert.object(lease, 'lease');
    assert.string(lease.ip, 'lease.ip');
    assert.optionalString(lease.alias, 'lease.alias');
    assert.optionalString(lease['hardware ethernet'], 'lease["hardware ethernet"]');
    assert.optionalString(lease['client-hostname'], 'lease["client-hostname"]');

    var env = copyEnv();

    env.DHCPD_NOTIFIER_LEASE = JSON.stringify(lease);
    env.DHCPD_NOTIFIER_ALIAS = lease.alias || '';
    env.DHCPD_NOTIFIER_HOSTNAME = lease['client-hostname'] || '';
    env.DHCPD_NOTIFIER_MAC = lease['hardware ethernet'] || '';
    env.DHCPD_NOTIFIER_IP = lease.ip;

    var opts = {
        env: env,
        timeout: config.exec.timeout * 1000,
        encoding: 'utf8'
    };

    log.debug({opts: opts}, 'executing "%s"', config.exec.file);
    cp.execFile(config.exec.file, [], opts, function (err, stdout, stderr) {
        var all = {
            stdout: stdout,
            stderr: stderr
        };

        if (err) {
            all.err = err;
            log.error(all, 'exeuction failed');
            cb();
            return;
        }

        log.debug(all, 'execution succeeded');
        cb();
    });
}, 1);

/*
 * Compare old leases to new leases and push an event to the queue if any
 * notifications should be sent
 */
function processleases(leases) {
    assert.object(leases, 'leases');

    // find ips in old not in new (to remove)
    Object.keys(oldleases).forEach(function (key) {
        if (leases[key]) {
            return;
        }

        var name = oldleases[key]['client-hostname'] || '<unknown>';
        if (oldleases[key].alias) {
            name = f('%s (%s)', name, oldleases[key].alias);
        }

        log.debug('removing old lease for %s: %s', key, name);
        delete oldleases[key];
    });

    // find ips in new not in old
    Object.keys(leases).forEach(function(key) {
        var oldlease = oldleases[key];
        var lease = leases[key];

        var ip = lease.ip;
        var mac = lease['hardware ethernet'] || 'unknown';
        var name = lease['client-hostname'] || '<unknown>';
        var alias = lease.alias || 'n/a';

        if (oldlease) {
            // we've seen this before and it's not expired
            log.trace('seen lease before: "%s" %s %s (%s)',
                name, ip, mac, alias);
            return;
        }

        // if we are here, the lease is either for a brand new host, or a host
        // whose previous lease has expired (effectively brand new)
        if (config.ignore.indexOf(mac) > -1) {
            log.debug('ignoring lease: "%s" %s %s (%s)',
                name, ip, mac, alias);
            return;
        }

        // emit line to stdout
        log.info('new lease: "%s" %s %s (%s)', name, ip, mac, alias);
        execQueue.push(lease);
    });
}

/*
 * Return a key based off the ip and mac of a lease
 */
function makeKey(lease) {
    assert.object(lease, 'lease');
    assert.string(lease.ip, 'lease.ip');
    assert.optionalString(lease['hardware ethernet'],
        'lease["hardware ethernet"]');

    var mac = lease['hardware ethernet'] || 'unknown';

    return f('%s-%s', lease.ip, mac);
}

/*
 * Remove leases that have expired
 */
function removeExpiredLeases(leases, t) {
    assert.object(leases, 'leases');
    assert.date(t, 't');

    Object.keys(leases).forEach(function (ip) {
        if (leases[ip].ends < t) {
            delete leases[ip];
        }
    });
}

/*
 * Given an array of leases (from `dhcpdleases()`), return an object keyed off
 * of the mac and the IP.
 */
function formatLeases(leases) {
    assert.arrayOfObject(leases, 'leases');

    var ret = {};

    leases.forEach(function (lease) {
        var mac = lease['hardware ethernet'] || 'unknown';
        if (config.aliases.hasOwnProperty(mac)) {
            lease.alias = config.aliases[mac];
        }
        ret[makeKey(lease)] = lease;
    });

    return ret;
}

/*
 * 1. read the leases file
 * 2. format the leases and compare to the last iteration
 * 3. run "processleases" to process the differences
 * 4. schedule a later invocation of readleases (loop)
 */
function readleases() {
    log.trace({leases: config.leases}, 'reading leases');
    fs.readFile(config.leases, {encoding: 'utf8'},
        function (err, data) {

        assert.ifError(err);

        var leases = formatLeases(dhcpdleases(data));

        if (leases && oldleases) {
            var now = new Date();
            removeExpiredLeases(oldleases, now);
            removeExpiredLeases(leases, now);
            processleases(leases);
        }

        oldleases = leases;

        log.trace('leases read');
        setTimeout(readleases, config.interval * 1000);
    });
}

// Copy the current env variables to an object
function copyEnv() {
    var ret = {};
    Object.keys(process.env).forEach(function (key) {
        ret[key] = process.env[key];
    });
    return ret;
}

function main() {
    readleases();
}

main();
