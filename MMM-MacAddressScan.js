/* global Log, Module, moment, config */
/* Magic Mirror
 * Module: MMM-MacAddressScan
 *
 * Based on MMM-NetworkScanner by Ian Perrin http://ianperrin.com
 * Forked, modified, and extended by Ronald Record <ronaldrecord@gmail.com>
 * MIT Licensed.
 */

Module.register("MMM-MacAddressScan", {

    // Default module config.
    defaults: {
        devices: [], // an array of device objects e.g. { macAddress: "aa:bb:cc:11:22:33", name: "DEVICE-NAME", icon: "FONT-AWESOME-ICON"}
        network: "-l", // a Local Network IP mask to limit the mac address scan, i.e. `192.168.0.0/24`. Use `-l` for the entire localnet
        showIP: true, // show IP of devices
        showUnknown: true, // shows devices found on the network even if not specified in the 'devices' option 
        showOffline: true, // shows devices specified in the 'devices' option even when offline
        showLastSeen: false, // shows when the device was last seen e.g. "Device Name - last seen 5 minutes ago"
        saveLastSeen: false, // saves when the device was last seen across restarts
        keepAlive: 180, // how long (in seconds) a device should be considered 'alive' since it was last found on the network
        updateInterval: 20, // how often (in seconds) the module should scan the network
        sort: true, // sort the devices in the mirror

        residents: [],
        occupiedCMD: null, // {notification: 'TEST', payload: {action: 'occupiedCMD'}},
        vacantCMD: null, // {notification: 'TEST', payload: {action: 'vacantCMD'}},

        colored: false, // show devices colorcoded with color defined in devices [] //
        coloredSymbolOnly: false, // show symbol only in color //
        showLastSeenWhenOffline: false, // show last seen only when offline //

        debug: false,
        
        // Show table as device rows or as device columns
        showDeviceColumns: false,
        coloredState: false,
    },

    // TelegramBot integration
    getCommands: function(commander) {
        commander.add(
            {
              // Adds Telegram command '/showip'
              command: 'showip',
              description: "Show device IPs\nTry `/showip`.",
              callback: 'command_showip',
            }
        )
        commander.add(
            {
              // Adds Telegram command '/hideip'
              command: 'hideip',
              description: "Show device IPs\nTry `/hideip`.",
              callback: 'command_hideip',
            }
        )
        commander.add(
            {
              // Adds Telegram command '/showOffline'
              command: 'showOffline',
              description: "Show offline devices\nTry `/showOffline`.",
              callback: 'command_showOffline',
            }
        )
        commander.add(
            {
              // Adds Telegram command '/hideOffline'
              command: 'hideOffline',
              description: "hide offline devices\nTry `/hideOffline`.",
              callback: 'command_hideOffline',
            }
        )
        commander.add(
            {
              // Adds Telegram command '/updateInterval'
              command: 'updateInterval',
              description: "Set interval (seconds) between device scans\nTry `/updateInterval 60`.",
              callback: 'command_updateInterval',
              args_pattern : ["/([0-9]+)/"],
              args_mapping : ["interval"]
            }
        )
        commander.add(
            {
              // Adds Telegram command '/getconfig'
              command: 'getconfig',
              description: "Show current configuration settings\nTry `/getconfig`.",
              callback: 'command_getconfig',
            }
        )
    },

    // Callback for /showip Telegram command
    command_showip: function(command, handler) {
        handler.reply("TEXT", "Showing IPs")
        this.config.showIP = true
        this.scanNetwork()
    },

    // Callback for /hideip Telegram command
    command_hideip: function(command, handler) {
        handler.reply("TEXT", "Hiding IPs")
        this.config.showIP = false
        this.scanNetwork()
    },

    // Callback for /showOffline Telegram command
    command_showOffline: function(command, handler) {
        handler.reply("TEXT", "Showing offline devices")
        this.config.showOffline = true
        this.scanNetwork()
    },

    // Callback for /hideOffline Telegram command
    command_hideOffline: function(command, handler) {
        handler.reply("TEXT", "Hiding offline devices")
        this.config.showOffline = false
        this.scanNetwork()
    },

    // Callback for /updateInterval Telegram command
    command_updateInterval: function(command, handler) {
        if (handler.args['interval'][0]) {
            var update_interval = handler.args['interval'][0]
            if (!isNaN(update_interval)) {
                if (update_interval >= 0) {
                  handler.reply("TEXT", "Setting update interval to "
                      + update_interval.toString())
                  this.config.updateInterval = update_interval
                  this.scanNetwork()
                }
            }
        }
    },

    // Callback for /getconfig Telegram command
    command_getconfig: function(command, handler) {
        let config_status = "Retrieving current configuration settings\n\n"
        if (this.config.showIP) {
            config_status = config_status + "showIP = true\n"
        } else {
            config_status = config_status + "showIP = false\n"
        }
        if (this.config.showOffline) {
            config_status = config_status + "showOffline = true\n"
        } else {
            config_status = config_status + "showOffline = false\n"
        }
        config_status = config_status + "updateInterval = "
		    + this.config.updateInterval.toString()
        handler.reply("TEXT", config_status)
    },

    // Subclass start method
    start: function() {
        Log.info("Starting module: " + this.name)
        if (this.config.debug) Log.info(this.name + " config: ", this.config)

        // Instantiate the store class
        const store = new Store({
          // We'll call our data file 'last-seen'
          configName: 'last-seen',
          // TODO: An empty array of devices? 
          defaults: {
          }
        });

        // variable for if anyone is home
        this.occupied = true

        moment.locale(config.language)

        if (self.config.saveLastSeen) this.restoreDeviceLastSeen()

        this.validateDevices()

        this.sendSocketNotification('CONFIG', this.config)

        this.scanNetwork()
    },

    // Subclass stop method
    stop: function() {
        Log.info("Stopping module: " + this.name)
        if (self.config.saveLastSeen) this.saveDeviceLastSeen()
    },

    // Subclass getStyles method
    getStyles: function() {
        return ['MMM-MacAddressScan.css', 'font-awesome.css']
    },

    // Subclass getScripts method.
    getScripts: function() {
        return ["moment.js"]
    },

    // Subclass socketNotificationReceived method.
    socketNotificationReceived: function(notification, payload) {
        if (this.config.debug) Log.info(this.name + " received a notification: " + notification, payload)

        var self = this
        var getKeyedObject = (objects = [], key) => objects.reduce(
            (acc, object) => (Object.assign(acc, {
                [object[key]]: object
            })), {}
        );

        if (notification === 'IP_ADDRESS') {
            if (this.config.debug) Log.info(this.name + " IP_ADDRESS device: ", [payload.name, payload.online])
            if (payload.hasOwnProperty("ipAddress")) {
                var device = this.config.devices.find(d => d.ipAddress === payload.ipAddress)
                this.updateDeviceStatus(device, payload.online)
            }
        }

        if (notification === 'MAC_ADDRESSES') {
            if (this.config.debug) Log.info(this.name + " MAC_ADDRESSES payload: ", payload)

            var nextState = payload.map(device =>
                Object.assign(device, {
                    lastSeen: moment()
                })
            );

            if (this.config.showOffline) {
                var networkDevicesByMac = getKeyedObject(this.networkDevices, 'macAddress');
                var payloadDevicesByMac = getKeyedObject(nextState, 'macAddress')

                nextState = this.config.devices.map(device => {
                    if (device.macAddress) {
                        var oldDeviceState = networkDevicesByMac[device.macAddress]
                        var payloadDeviceState = payloadDevicesByMac[device.macAddress]
                        var newDeviceState = payloadDeviceState || oldDeviceState || device

                        var sinceLastSeen = newDeviceState.lastSeen ?
                            moment().diff(newDeviceState.lastSeen, 'seconds') : null
                        var isStale = (sinceLastSeen >= this.config.keepAlive)

                        newDeviceState.online = (sinceLastSeen != null) && (!isStale)

                        return newDeviceState
                    } else {
                        return device
                    }
                });
            }

            this.networkDevices = nextState

            // Sort list by known device names, then unknown device mac addresses
            if (this.config.sort) {
                this.networkDevices.sort(function(a, b) {
                    var stringA, stringB;
                    stringA = (a.type != "Unknown" ? "_" + a.name + a.macAddress : a.name);
                    stringB = (b.type != "Unknown" ? "_" + b.name + b.macAddress : b.name);

                    return stringA.localeCompare(stringB);
                });
            }

            // Send notification if user status has changed
            if (this.config.residents.length > 0) {
                var anyoneHome, command;
                anyoneHome = 0;

                this.networkDevices.forEach(function(device) {
                    if (self.config.residents.indexOf(device.name) >= 0) {
                        anyoneHome = anyoneHome + device.online;
                    }
                });

                if (this.config.debug) Log.info("# people home: ", anyoneHome);
                if (this.config.debug) Log.info("Was occupied? ", this.occupied);

                if (anyoneHome > 0) {
                    if (this.occupied === false) {
                        if (this.config.debug) Log.info("Someone has come home");
                        if (this.config.occupiedCMD) {
                            var occupiedCMD = self.config.occupiedCMD;
                            this.sendNotification(occupiedCMD.notification, occupiedCMD.payload);
                        }
                        this.occupied = true;
                    }
                } else {
                    if (this.occupied === true) {
                        if (this.config.debug) Log.info("Everyone has left home");
                        if (this.config.vacantCMD) {
                            var vacantCMD = this.config.vacantCMD;
                            this.sendNotification(vacantCMD.notification, vacantCMD.payload);
                        }
                        this.occupied = false;
                    }
                }
            }

            this.updateDom();
            return;

        }

    },

    // Override dom generator.
    getDom: function() {
        var self = this;

        var wrapper = document.createElement("div");
        wrapper.classList.add("small");

        // Display a loading message
        if (!this.networkDevices) {
            wrapper.innerHTML = this.translate("LOADING");
            return wrapper;
        }

        // Display device status
        var deviceTable = document.createElement("table");
        deviceTable.classList.add("deviceTable", "small");
        
        // Show devices in columns
        // Generate header row and device state row
        
        var headerRow = document.createElement("tr");
        headerRow.classList.add("headerRow", "dimmed");
        var devStateRow = document.createElement("tr");
        devStateRow.classList.add("devStateRow", "dimmed");
        
        this.networkDevices.forEach(function(device) {
            
            if (device && (device.online || device.showOffline)) {

                // Device row
                var deviceRow = document.createElement("tr");
                var deviceOnline = (device.online ? "bright" : "dimmed");
                deviceRow.classList.add("deviceRow", deviceOnline);

                // Icon
                var deviceCell = document.createElement("td");
                deviceCell.classList.add("deviceCell");
                var icon = document.createElement("i");
                icon.classList.add("fa", "fa-fw", "fa-" + device.icon);

                // Icon color initially set to device color
                if (self.config.colored) {
                    icon.style.cssText = "color: " + device.color;
                }
                
                // If using colored state, set icon color appropriately
                if (self.config.coloredState) {
                    if (device.online) {
                        if (device.hasOnline) {
                            icon.style.cssText = "color: " + device.colorStateOnline;
                        }
                    } else {
                        if (device.hasOffline) {
                            icon.style.cssText = "color: " + device.colorStateOffline;
                        }
                    }
                }

                if (self.config.colored && !self.config.coloredSymbolOnly && device.lastSeen) {
                    deviceCell.style.cssText = "color: " + device.color;
                }

                deviceCell.appendChild(icon);
                deviceCell.innerHTML += device.name;
                if (self.config.showIP) {
                    deviceCell.innerHTML += " (" + device.ipAddress + ")";
                }

                deviceRow.appendChild(deviceCell);

                // When last seen
                if ((self.config.showLastSeen && device.lastSeen  && !self.config.showLastSeenWhenOffline) || 
                    (self.config.showLastSeen && !device.lastSeen &&  self.config.showLastSeenWhenOffline)) {
                    var dateCell = document.createElement("td");
                    dateCell.classList.add("dateCell", "dimmed", "light");
                    if (typeof device.lastSeen !== 'undefined') {
                        dateCell.innerHTML = device.lastSeen.fromNow();
                    }
                    deviceRow.appendChild(dateCell);
                }

                // Append a new row if showDeviceColumns and showInNewRow are both true

                if (self.config.showDeviceColumns && device.showInNewRow) {
                    // Append the previously processed devices to the table
                    deviceTable.appendChild(headerRow);
                    deviceTable.appendChild(devStateRow);

                    // Generate new line contents
                    headerRow = document.createElement("tr");
                    headerRow.classList.add("headerRow", "dimmed");
                    devStateRow = document.createElement("tr");
                    devStateRow.classList.add("devStateRow", "dimmed");
                }

                // Fill also header and devState row
                // Header row
                var headerDevCell = document.createElement("td");
                headerDevCell.classList.add("headerDevCell", deviceOnline);
                headerDevCell.innerHTML += device.name;
                if (self.config.showIP) {
                    headerDevCell.innerHTML += "<br/>(" + device.ipAddress + ")";
                }

                headerRow.appendChild(headerDevCell);
                
                // Device state row
                var devStateCell = document.createElement("td");
                devStateCell.classList.add("devStateCell");
                
                // Color online / offline
                if (self.config.coloredState) {
                    if (device.online) {
                        icon.style.cssText = "color: " + device.colorStateOnline;
                    } else {
                        icon.style.cssText = "color: " + device.colorStateOffline;
                    };
                }
                
                devStateCell.appendChild(icon);

                devStateRow.appendChild(devStateCell);

                // Show as Device rows or as Device columns 
                if (!self.config.showDeviceColumns) {
                    deviceTable.appendChild(deviceRow);
                }

            } else {
                if (this.config.debug) Log.info(self.name + " Online, but ignoring: '" + device + "'");
            }
        });
        
        // Show as Device rows or as Device columns 
        if (self.config.showDeviceColumns) {
            deviceTable.appendChild(headerRow);
            deviceTable.appendChild(devStateRow);
        }

        if (deviceTable.hasChildNodes()) {
            wrapper.appendChild(deviceTable);
        } else {
            // Display no devices online message
            wrapper.innerHTML = this.translate("NO DEVICES ONLINE");
        }

        return wrapper;
    },

    // Sample electron-store usage
    //
    // const Store = require('electron-store');
    // const store = new Store();
    //
    // store.set('unicorn', '\U0001f984');
    // console.log(store.get('unicorn'));
    // => '\U0001f984'
    //
    // Use dot-notation to access nested properties
    // store.set('foo.bar', true);
    // console.log(store.get('foo'));
    // => {bar: true}
    //
    // store.delete('unicorn');
    // console.log(store.get('unicorn'));
    // => undefined

    restoreDeviceLastSeen: function() {
        if (this.config.debug) Log.info(this.name + " is restoring saved device seen");
//      this.config.devices.forEach(function(device) {
//      });
    },

    saveDeviceLastSeen: function() {
        if (this.config.debug) Log.info(this.name + " is saving device seen");
        this.config.devices.forEach(function(device) {
            if (typeof device.lastSeen !== 'undefined') {
                if (device.hasOwnProperty("macAddress")) {
                    store.set(device.macAddress + '.lastseen', device.lastSeen);
                } else if (device.hasOwnProperty("ipAddress")) {
                    store.set(device.ipAddress + '.lastseen', device.lastSeen);
                }
            }
        });
    },

    validateDevices: function() {
        this.config.devices.forEach(function(device) {
            // Add missing device attributes.
            if (!device.hasOwnProperty("icon")) {
                device.icon = "question";
            }
            if (!device.hasOwnProperty("color")) {
                device.color = "#ffffff";
            }
            if (!device.hasOwnProperty("showOffline")) {
                device.showOffline = true;
            }
            if (!device.hasOwnProperty("name")) {
                if (device.hasOwnProperty("macAddress")) {
                    device.name = device.macAddress;
                } else if (device.hasOwnProperty("ipAddress")) {
                    device.name = device.ipAddress;
                } else {
                    device.name = "Unknown";
                }
            }
            // Colored State
            if (!device.hasOwnProperty("colorStateOnline")) {
                device.colorStateOnline = "#ffffff";
                device.hasOnline = false
            } else {
                device.hasOnline = true
            }
            if (!device.hasOwnProperty("colorStateOffline")) {
                device.colorStateOffline = "#ffffff";
                device.hasOffline = false
            } else {
                device.hasOffline = true
            }
            // Show device in a new row if showInNewRow property is true
            // Default if not set is false
            if (!device.hasOwnProperty("showInNewRow")) {
                device.showInNewRow = false
            }
        });
    },

    scanNetwork: function() {
        if (this.config.debug) Log.info(this.name + " is initiating network scan");
        var self = this;
        this.sendSocketNotification('SCAN_NETWORK');
        setInterval(function() {
            self.sendSocketNotification('SCAN_NETWORK');
        }, this.config.updateInterval * 1000);
        return;
    },

    updateDeviceStatus: function(device, online) {
        if (device) {
            if (this.config.debug) Log.info(this.name + " is updating device status.", [device.name, online]);
            // Last Seen
            if (online) {
                device.lastSeen = moment();
            }
            // Keep alive?
            var sinceLastSeen = device.lastSeen ?
                moment().diff(device.lastSeen, 'seconds') :
                null;
            var isStale = (sinceLastSeen >= this.config.keepAlive);
            device.online = (sinceLastSeen != null) && (!isStale);
            if (this.config.debug) Log.info(this.name + " " + device.name + " is " + (online ? "online" : "offline"));
        }
        return;
    }

});
