#!/usr/bin/env node
/**
 * Alert (notify) when dhcpd gives out new leases
 *
 * Author: Dave Eddy <dave@daveeddy.com>
 * Date: July 10, 2015
 * License: MIT
 */

var assert = require('assert-plus');
var fs = require('fs');
var f = require('util').format;

var dhcpdleases = require('dhcpd-leases');
var getopt = require('posix-getopt');

var package = require('./package.json');

var usage = [
    'usage: dhcpd-notifier [-huv] <config.json>',
    '',
    'alert (notify) when dhcpd gives out new leases over Pushover or stdout',
    '',
    'options',
    '',
    '  -h, --help       print this message and exit',
    '  -u, --updates    check for available updates',
    '  -v, --version    print the version number and exit',
].join('\n');

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

try {
    assert.string(config, 'config must be set as the first argument or env DHCPD_NOTIFIER_CONFIG');
    config = JSON.parse(fs.readFileSync(config, 'utf8'));
    assert.object(config, 'config must be an object');
} catch (e) {
    console.error('failed to read config: %s', e.message);
    process.exit(1);
}

config.leases = config.leases || '/var/db/isc-dhcp/dhcpd.leases';
config.interval = config.interval || 10;
config.aliases = config.aliases || {};
config.ignore = config.ignore || [];

console.error('watching file %s for changes every %d seconds',
    config.leases, config.interval);

// pushover
var po;
if (config.pushover) {
    console.error('using pushover: %j', config.pushover);
    po = new (require('pushover-notifications'))(config.pushover);
}

var oldleases;

function processleases(leases) {
    assert.object(leases, 'leases');

    // find ips in old not in new (to remove)
    Object.keys(oldleases).forEach(function (key) {
        if (leases[key]) {
            return;
        }

        var name = oldleases[key].alias || oldleases[key]['client-hostname'] || '<unknown>';
        console.error('removing old lease for %s %s', key, name);
        delete oldleases[key];
    });

    // find ips in new not in old
    Object.keys(leases).forEach(function(key) {
        var oldlease = oldleases[key];
        var lease = leases[key];

        var ip = lease.ip;
        var mac = lease['hardware ethernet'];
        var name = lease['client-hostname'] || '<unknown>';
        var alias = lease.alias;

        if (oldlease) {
            // we've seen this before and it's not expired
            return;
        }

        // if we are here, the lease is either for a brand new host, or a host
        // whose previous lease has expired (effectively brand new)
        if (config.ignore.indexOf(mac) > -1) {
            return;
        }

        // emit line to stdout
        if (config.json) {
            console.log(JSON.stringify(lease));
        } else {
            console.log('[%s] new lease: "%s" %s %s (%s)',
                new Date().toISOString(), name, ip, mac, alias);
        }

        // pushover if set
        if (po) {
            console.error('sending pushover...');
            var title = f('dhcp lease for "%s"', name);
            if (alias) {
                title += f(' (%s)', alias);
            }
            var msg = f('%s -%s', ip, mac);
            po.send({
                title: title,
                message: msg
            }, function(err, res) {
                if (err) {
                    console.error('failed to pushover: %s', err.message);
                } else {
                    console.error('sent pushover: %s', res);
                }
            });
        }
    });
}

function makeKey(lease) {
    assert.object(lease, 'lease');
    assert.string(lease.ip, 'lease.ip');
    assert.string(lease['hardware ethernet'], 'lease["hardware ethernet"]');

    return f('%s-%s', lease.ip, lease['hardware ethernet']);
}

function removeExpiredLeases(leases, t) {
    assert.object(leases, 'leases');
    assert.date(t, 't');

    Object.keys(leases).forEach(function (ip) {
        if (leases[ip].ends < t) {
            delete leases[ip];
        }
    });
}

function formatLeases(leases) {
    assert.arrayOfObject(leases, 'leases');

    var ret = {};

    leases.forEach(function (lease) {
        var mac = lease['hardware ethernet'];
        if (config.aliases.hasOwnProperty(mac)) {
            lease.alias = config[mac];
        }
        ret[makeKey(lease)] = lease;
    });

    return ret;
}

function readleases() {
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

        setTimeout(readleases, config.interval * 1000);
    });
}

readleases();
