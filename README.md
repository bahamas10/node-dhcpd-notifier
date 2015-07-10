dhcpd-notifier
==============

Alert (notify) when dhcpd gives out new leases via [Pushover](https://pushover.net/) or just stdout

NOTE: This is a command-line tool to be run as a daemon

Installation
------------

    [sudo] npm install -g dhcpd-notifier

Usage
-----

Create a configuration JSON file

``` json
{
  "leases": "/var/db/isc-dhcp/dhcpd.leases",
  "interval": 10,
  "json": false,
  "aliases": {
    "00:00:00:00:00:01": "My Custom Host"
  },
  "ignore": [
    "00:00:00:00:00:02"
  ],
  "pushover": {
    "user": "foo",
    "token": "bar"
  }
}
```

Start the daemon with the config

    $ dhcpd-notifier config.json
    watching file /var/db/isc-dhcp/dhcpd.leases for changes every 10 seconds
    using pushover: {"user":"foo","token":"bar"}
    ...

This will emit a line to stdout (all others are stderr) and send a notification to
Pushover when a new lease is discovered.

Configuration
-------------

- `config.leases` the [dhcpd.leases(5)](http://linux.die.net/man/5/dhcpd.leases) file used by dhcpd
- `config.interval` number of seconds to reread the leases file
- `config.json` log in JSON format, defaults to false
- `config.aliases` a mapping of mac address to custom host name to be used when a new lease is found.  This is useful if a host does not provide an accurate hostname when requesting a lease
- `config.ignore` an array of mac address to ignore when generating notifications
- `config.pushover` passed directly to the constructor of [pushovernotifications](https://www.npmjs.com/package/pushover-notifications) - `user` and `token` are all that is needed

License
-------

MIT License
