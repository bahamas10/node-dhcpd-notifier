dhcpd-notifier
==============

Alert (notify) when dhcpd gives out new leases

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
  "loglevel": "debug",
  "aliases": {
    "00:00:00:00:00:01": "My Custom Host"
  },
  "ignore": [
    "00:00:00:00:00:02"
  ],
  "exec": {
    "file": "./example-script",
    "timeout": 30
  }
}
```

`exec.file` is a script/program that will be executed whenever a new lease is
given that will contain lease information passed in as environmental variables,
see [example-script](./example-script) as an example.

Start the daemon with the config - logging is done via
[bunyan](https://github.com/trentm/node-bunyan#readme)

    $ dhcpd-notifier example-config.json | bunyan
    [2018-04-09T18:16:59.231Z] DEBUG: dhcpd-notifier/10312 on dhcp.rapture.com: loaded config
	config: {
	  "leases": "/var/db/isc-dhcp/dhcpd.leases",
	  "interval": 10,
	  "loglevel": "debug",
	  "aliases": {
	    "00:00:00:00:00:01": "My Custom Host"
	  },
	  "ignore": [
	    "00:00:00:00:00:02"
	  ],
	  "exec": {
	    "file": "./example-script",
	    "timeout": 30
	  }
	}
    [2018-04-09T18:16:59.236Z]  INFO: dhcpd-notifier/10312 on dhcp.rapture.com: watching file /var/db/isc-dhcp/dhcpd.leases for changes every 10 seconds
    [2018-04-09T18:17:39.336Z]  INFO: dhcpd-notifier/10312 on dhcp.rapture.com: new lease: "DESKTOP-FH2DLSM" 10.0.1.183 c8:3a:35:XX:XX:XX (n/a)
    [2018-04-09T18:17:39.340Z] DEBUG: dhcpd-notifier/10312 on dhcp.rapture.com: executing "./example-script"
	opts: {
	  "env": {
	    "USER": "dave",
	    "PATH": "/opt/local/sbin:/opt/local/bin:/opt/custom/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/home/dave/bin",
	    "PWD": "/home/dave/dev/node-dhcpd-notifier",
	    "LANG": "en_US.UTF-8",
	    "TZ": "US/Eastern",
	    "HOME": "/home/dave",
	    "DHCPD_NOTIFIER_LEASE": "{\"ip\":\"10.0.1.183\",\"starts\":\"2018-04-09T18:17:35.000Z\",\"ends\":\"2018-04-09T20:17:35.000Z\",\"cltt\":\"2018-04-09T18:17:35.000Z\",\"binding state\":\"active\",\"next binding state\":\"free\",\"rewind binding state\":\"free\",\"hardware ethernet\":\"c8:3a:35:XX:XX:XX\",\"uid\":\"\\\\001\\\\310:5\\\\300\\\\305\\\\024\",\"set vendor-class-identifier\":\"= \\\"MSFT 5.0\\\"\",\"client-hostname\":\"DESKTOP-FH2DLSM\"}",
	    "DHCPD_NOTIFIER_ALIAS": "",
	    "DHCPD_NOTIFIER_HOSTNAME": "DESKTOP-FH2DLSM",
	    "DHCPD_NOTIFIER_MAC": "c8:3a:35:XX:XX:XX",
	    "DHCPD_NOTIFIER_IP": "10.0.1.183"
	  },
	  "timeout": 30000,
	  "encoding": "utf8"
	}
    [2018-04-09T18:17:39.405Z] DEBUG: dhcpd-notifier/10312 on dhcp.rapture.com: execution succeeded (stderr="")
	stdout: dhcp lease for 'DESKTOP-FH2DLSM' (alias=) 10.0.1.183 - c8:3a:35:XX:XX:XX


Configuration
-------------

- `config.leases` the [dhcpd.leases(5)](http://linux.die.net/man/5/dhcpd.leases) file used by dhcpd
- `config.interval` number of seconds to reread the leases file
- `config.aliases` a mapping of mac address to custom host name to be used when a new lease is found.  This is useful if a host does not provide an accurate hostname when requesting a lease
- `config.ignore` an array of mac address to ignore when generating notifications
- `config.loglevel` bunyan log level to use, defaults to `info`
- `config.exec.file` program/script to execute when a new lease is given
- `config.exec.timeout` timeout (in seconds) to allow `config.exec.file` to run

License
-------

MIT License
