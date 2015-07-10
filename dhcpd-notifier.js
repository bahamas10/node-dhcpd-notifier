#!/usr/bin/env node
/**
 * Alert (notify) when dhcpd gives out new leases
 *
 * Author: Dave Eddy <dave@daveeddy.com>
 * Date: July 10, 2015
 * License: MIT
 */

var assert = require('assert');
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
    case 'h': console.log(usage); process.exit(0);
    case 'u': // check for updates
      require('latest').checkupdate(package, function(ret, msg) {
        console.log(msg);
        process.exit(ret);
      });
      return;
    case 'v': console.log(package.version); process.exit(0);
    default: console.error(usage); process.exit(1);
  }
}

var args = process.argv.slice(parser.optind());
var config = args[0] || process.env.DHCPD_NOTIFIER_CONFIG;

try {
  assert(config, 'config must be set as the first argument or env DHCPD_NOTIFIER_CONFIG');
  config = JSON.parse(fs.readFileSync(config, 'utf8'));
  assert(typeof config === 'object', 'config must be an object');
} catch (e) {
  console.error('failed to read config: %s', e.message);
  process.exit(1);
}

config.leases = config.leases || '/var/db/isc-dhcp/dhcpd.leases';
config.interval = config.interval || 10;
config.aliases = config.aliases || {};
config.ignore = config.ignore || [];

console.error('watching file %s for changes every %d seconds', config.leases, config.interval);

// pushover
var po;
if (config.pushover) {
  console.error('using pushover: %j', config.pushover);
  po = new (require('pushover-notifications'))(config.pushover);
}

var oldleases;

function processleases(leases) {
  // find ips in new not in old
  Object.keys(leases).forEach(function(ip) {
    if (oldleases[ip])
      return;
    var lease = leases[ip];
    lease.ip = ip;

    var mac = lease['hardware ethernet'];
    if (config.aliases[mac])
      lease.alias = config.aliases[mac];

    if (config.ignore.indexOf(mac) > -1)
      return;

    // emit line to stdout
    var name = lease.alias || lease['client-hostname'] || '<unknown>';
    if (config.json)
      console.log(JSON.stringify(lease));
    else
      console.log('[%s] new lease: "%s" %s %s', (new Date().toISOString()), name, ip, mac);

    // pushover if set
    if (po) {
      console.error('sending pushover...');
      po.send({
        title: f('dhcp lease for "%s"', name),
        message: f('%s - %s', ip, mac)
      }, function(err, res) {
        if (err)
          console.error('failed to pushover: %s', err.message);
        else
          console.error('sent pushover: %s', res);
      });
    }
  });
}

function readleases() {
  // read the leases file
  fs.readFile(config.leases, 'utf8', function(err, data) {
    if (err) {
      console.error('error: %s', err.message);
    } else {
      var leases;
      try {
        leases = dhcpdleases(data);
      } catch(e) {
        console.error('error: %s', e.message);
      }

      if (leases && oldleases)
        processleases(leases);

      oldleases = leases;
    }

    setTimeout(readleases, config.interval * 1000);
  });
}
readleases();
