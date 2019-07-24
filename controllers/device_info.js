
const DeviceModel = require('../models/device');
const Config = require('../models/config');
const Notification = require('../models/notification');
const mqtt = require('../mqtts');
const sio = require('../sio');
const Validator = require('../public/javascripts/device_validator');
const DeviceVersion = require('../models/device_version');
const async = require('asyncawait/async');
const await = require('asyncawait/await');
let deviceInfoController = {};

const returnObjOrEmptyStr = function(query) {
  if (typeof query !== 'undefined' && query) {
    return query;
  } else {
    return '';
  }
};

const returnObjOrStr = function(query, str) {
  if (typeof query !== 'undefined' && query) {
    return query;
  } else {
    return str;
  }
};

const returnObjOrNum = function(query, num) {
  if (typeof query !== 'undefined' && query) {
    return query;
  } else {
    return num;
  }
};

const genericValidate = function(field, func, key, minlength, errors) {
  let validField = func(field, minlength);
  if (!validField.valid) {
    validField.err.forEach(function(error) {
      let obj = {};
      obj[key] = error;
      errors.push(obj);
    });
  }
};

const createRegistry = function(req, res) {
  if (typeof req.body.id == 'undefined') {
    return res.status(400).end();
  }

  const validator = new Validator();
  const macAddr = req.body.id.trim().toUpperCase();

  let errors = [];
  let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  let wanIp = returnObjOrEmptyStr(req.body.wan_ip).trim();
  let wanSpeed = returnObjOrEmptyStr(req.body.wan_negociated_speed).trim();
  let wanDuplex = returnObjOrEmptyStr(req.body.wan_negociated_duplex).trim();
  let installedRelease = returnObjOrEmptyStr(req.body.release_id).trim();
  let model = returnObjOrEmptyStr(req.body.model).trim().toUpperCase() +
              returnObjOrEmptyStr(req.body.model_ver).trim().toUpperCase();
  let version = returnObjOrEmptyStr(req.body.version).trim();
  let connectionType = returnObjOrEmptyStr(req.body.connection_type).trim();
  let pppoeUser = returnObjOrEmptyStr(req.body.pppoe_user).trim();
  let pppoePassword = returnObjOrEmptyStr(req.body.pppoe_password).trim();
  let lanSubnet = returnObjOrEmptyStr(req.body.lan_addr).trim();
  let lanNetmask = parseInt(returnObjOrNum(req.body.lan_netmask, 24));
  let ssid = returnObjOrEmptyStr(req.body.wifi_ssid).trim();
  let password = returnObjOrEmptyStr(req.body.wifi_password).trim();
  let channel = returnObjOrEmptyStr(req.body.wifi_channel).trim();
  let band = returnObjOrEmptyStr(req.body.wifi_band).trim();
  let mode = returnObjOrEmptyStr(req.body.wifi_mode).trim();
  let ssid5ghz = returnObjOrEmptyStr(req.body.wifi_ssid_5ghz).trim();
  let password5ghz = returnObjOrEmptyStr(req.body.wifi_password_5ghz).trim();
  let channel5ghz = returnObjOrEmptyStr(req.body.wifi_channel_5ghz).trim();
  let band5ghz = returnObjOrStr(req.body.wifi_band_5ghz, 'VHT80').trim();
  let mode5ghz = returnObjOrStr(req.body.wifi_mode_5ghz, '11ac').trim();
  let pppoe = (pppoeUser !== '' && pppoePassword !== '');
  let flmUpdater = returnObjOrEmptyStr(req.body.flm_updater).trim();
  let is5ghzCapable =
    (returnObjOrEmptyStr(req.body.wifi_5ghz_capable).trim() == '1');

  // The syn came from flashbox keepalive procedure
  // Keepalive is designed to failsafe existing devices and not create new ones
  if (flmUpdater == '0') {
    return res.status(400).end();
  }

  Config.findOne({is_default: true}, function(err, matchedConfig) {
    if (err || !matchedConfig) {
      console.log('Error creating entry: ' + err);
      return res.status(500).end();
    }

    // Validate fields
    genericValidate(macAddr, validator.validateMac, 'mac', null, errors);
    if (connectionType != 'pppoe' && connectionType != 'dhcp' &&
        connectionType != '') {
      return res.status(500);
    }
    if (pppoe) {
      genericValidate(pppoeUser, validator.validateUser,
                      'pppoe_user', null, errors);
      genericValidate(pppoePassword, validator.validatePassword,
                      'pppoe_password', matchedConfig.pppoePassLength, errors);
    }
    genericValidate(ssid, validator.validateSSID,
                    'ssid', null, errors);
    genericValidate(password, validator.validateWifiPassword,
                    'password', null, errors);
    genericValidate(channel, validator.validateChannel,
                    'channel', null, errors);

    let permissions = DeviceVersion.findByVersion(version, is5ghzCapable);
    if (permissions.grantWifiBand) {
      genericValidate(band, validator.validateBand,
                      'band', null, errors);
      genericValidate(mode, validator.validateMode,
                      'mode', null, errors);
    }
    if (permissions.grantWifi5ghz) {
      genericValidate(ssid5ghz, validator.validateSSID,
                      'ssid5ghz', null, errors);
      genericValidate(password5ghz, validator.validateWifiPassword,
                      'password5ghz', null, errors);
      genericValidate(channel5ghz, validator.validateChannel,
                      'channel5ghz', null, errors);
      genericValidate(band5ghz, validator.validateBand,
                      'band5ghz', null, errors);
      genericValidate(mode5ghz, validator.validateMode,
                      'mode5ghz', null, errors);
    }

    if (errors.length < 1) {
      newDeviceModel = new DeviceModel({
        '_id': macAddr,
        'model': model,
        'version': version,
        'installed_release': installedRelease,
        'release': installedRelease,
        'pppoe_user': pppoeUser,
        'pppoe_password': pppoePassword,
        'lan_subnet': lanSubnet,
        'lan_netmask': lanNetmask,
        'wifi_ssid': ssid,
        'wifi_password': password,
        'wifi_channel': channel,
        'wifi_band': band,
        'wifi_mode': mode,
        'wifi_is_5ghz_capable': is5ghzCapable,
        'wifi_ssid_5ghz': ssid5ghz,
        'wifi_password_5ghz': password5ghz,
        'wifi_channel_5ghz': channel5ghz,
        'wifi_band_5ghz': band5ghz,
        'wifi_mode_5ghz': mode5ghz,
        'wan_ip': wanIp,
        'wan_negociated_speed': wanSpeed,
        'wan_negociated_duplex': wanDuplex,
        'ip': ip,
        'last_contact': Date.now(),
        'do_update': false,
        'do_update_parameters': false,
      });
      if (connectionType != '') {
        newDeviceModel.connection_type = connectionType;
      }
      newDeviceModel.save(function(err) {
        if (err) {
          console.log('Error creating entry: ' + err);
          return res.status(500).end();
        } else {
          return res.status(200).json({'do_update': false,
                                       'do_newprobe': true,
                                       'release_id:': installedRelease});
        }
      });
    } else {
      console.log('Error creating entry: ' + errors);
      return res.status(500).end();
    }
  });
};

const serializeBlocked = function(devices) {
  if (!devices) return [];
  return devices.map((device)=>{
    let dhcpLease = (!device.dhcp_name ||
                     device.dhcp_name === '!') ? '*' : device.dhcp_name;
    return device.mac + '|' + dhcpLease;
  });
};

const serializeNamed = function(devices) {
  if (!devices) return [];
  return devices.map((device)=>device.mac + '|' + device.name);
};

const deepCopyObject = function(obj) {
  return JSON.parse(JSON.stringify(obj));
};

deviceInfoController.syncDate = function(req, res) {
  // WARNING: This api is open.
  let devId;
  if (req.body.id) {
    if (req.body.id.trim().length == 17) {
      devId = req.body.id.trim().toUpperCase();
    }
  } else {
    devId = '';
  }

  let devNtp;
  if (req.body.ntp) {
    if (req.body.ntp.trim().length <= 12) {
      devNtp = req.body.ntp.trim();
    }
  } else {
    devNtp = '';
  }

  let devDate;
  if (req.body.date) {
    if (req.body.date.trim().length <= 14) {
      devDate = req.body.date.trim();
    }
  } else {
    devDate = '';
  }

  console.log('Request Date from '+ devId +': NTP '+ devNtp +' Date '+ devDate);

  let parsedate = parseInt(devDate);
  if (!isNaN(parsedate)) {
    let locDate = new Date(parsedate*1000);
    let atDate = Date.now();
    let diffDate = atDate - locDate;
    // adjust router clock if difference is more than
    // a minute ahead or more than an hour behind
    let serverDate = Math.floor(Date.now() / 1000);
    if ((diffDate < -(60*1000)) || (diffDate>(60*60*1000))) {
      res.status(200).json({'need_update': 1, 'new_date': serverDate});
    } else {
      res.status(200).json({'need_update': 0, 'new_date': serverDate});
    }
  } else {
    res.status(500).end();
  }
};


// Create new device entry or update an existing one
deviceInfoController.updateDevicesInfo = function(req, res) {
  if (process.env.FLM_BYPASS_SECRET == undefined) {
    if (req.body.secret != req.app.locals.secret) {
      console.log('Error in SYN: Secret not match!');
      return res.status(404).end();
    }
  }

  let devId = req.body.id.toUpperCase();
  DeviceModel.findById(devId, function(err, matchedDevice) {
    if (err) {
      console.log('Error finding device '+devId+': ' + err);
      return res.status(500).end();
    } else {
      if (matchedDevice == null) {
        createRegistry(req, res);
      } else {
        let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

        // Update old entries
        if (!matchedDevice.get('do_update_parameters')) {
          matchedDevice.do_update_parameters = false;
        }

        // Parameters only modified on first comm between device and flashman
        let bodyModel =
          returnObjOrEmptyStr(req.body.model).trim().toUpperCase();
        let bodyModelVer =
          returnObjOrEmptyStr(req.body.model_ver).trim().toUpperCase();
        if (matchedDevice.model == '' || matchedDevice.model == bodyModel) {
          // Legacy versions include only model so let's include model version
          matchedDevice.model = bodyModel + bodyModelVer;
        }
        let lanSubnet = returnObjOrEmptyStr(req.body.lan_addr).trim();
        let lanNetmask = parseInt(returnObjOrNum(req.body.lan_netmask, 24));
        if (!matchedDevice.lan_subnet || matchedDevice.lan_subnet == '') {
          matchedDevice.lan_subnet = lanSubnet;
        }
        if (!matchedDevice.lan_netmask) {
          matchedDevice.lan_netmask = lanNetmask;
        }

        // Store if device has dual band capability
        const is5ghzCapable =
          (returnObjOrEmptyStr(req.body.wifi_5ghz_capable).trim() == '1');
        matchedDevice.wifi_is_5ghz_capable = is5ghzCapable;

        let sentVersion = returnObjOrEmptyStr(req.body.version).trim();
        if (matchedDevice.version != sentVersion) {
          console.log('Device '+ devId +' changed version to: '+ sentVersion);

          // Legacy registration only. Register advanced wireless
          // values for routers with versions older than 0.13.0.
          let permissionsSentVersion = DeviceVersion.findByVersion(
            sentVersion, is5ghzCapable);
          let permissionsCurrVersion = DeviceVersion.findByVersion(
            matchedDevice.version, is5ghzCapable);
          let errors = [];
          const validator = new Validator();
          if ( permissionsSentVersion.grantWifiBand &&
              !permissionsCurrVersion.grantWifiBand) {
            let band =
              returnObjOrEmptyStr(req.body.wifi_band).trim();
            let mode =
              returnObjOrEmptyStr(req.body.wifi_mode).trim();

            genericValidate(band, validator.validateBand,
                            'band', null, errors);
            genericValidate(mode, validator.validateMode,
                            'mode', null, errors);

            if (errors.length < 1) {
              matchedDevice.wifi_band = band;
              matchedDevice.wifi_mode = mode;
            }
          }
          if ( permissionsSentVersion.grantWifi5ghz &&
              !permissionsCurrVersion.grantWifi5ghz) {
            let ssid5ghz =
              returnObjOrEmptyStr(req.body.wifi_ssid_5ghz).trim();
            let password5ghz =
              returnObjOrEmptyStr(req.body.wifi_password_5ghz).trim();
            let channel5ghz =
              returnObjOrEmptyStr(req.body.wifi_channel_5ghz).trim();
            let band5ghz =
              returnObjOrStr(req.body.wifi_band_5ghz, 'VHT80').trim();
            let mode5ghz =
              returnObjOrStr(req.body.wifi_mode_5ghz, '11ac').trim();

            genericValidate(ssid5ghz, validator.validateSSID,
                            'ssid5ghz', null, errors);
            genericValidate(password5ghz, validator.validateWifiPassword,
                            'password5ghz', null, errors);
            genericValidate(channel5ghz, validator.validateChannel,
                            'channel5ghz', null, errors);
            genericValidate(band5ghz, validator.validateBand,
                            'band5ghz', null, errors);
            genericValidate(mode5ghz, validator.validateMode,
                            'mode5ghz', null, errors);

            if (errors.length < 1) {
              matchedDevice.wifi_ssid_5ghz = ssid5ghz;
              matchedDevice.wifi_password_5ghz = password5ghz;
              matchedDevice.wifi_channel_5ghz = channel5ghz;
              matchedDevice.wifi_band_5ghz = band5ghz;
              matchedDevice.wifi_mode_5ghz = mode5ghz;
            }
          }
          matchedDevice.version = sentVersion;
        }

        let sentNtp = returnObjOrEmptyStr(req.body.ntp).trim();
        if (matchedDevice.ntp_status != sentNtp) {
          console.log('Device '+ devId +' changed NTP STATUS to: '+ sentNtp);
          matchedDevice.ntp_status = sentNtp;
        }

        // Parameters *NOT* available to be modified by REST API
        matchedDevice.wan_ip =
        returnObjOrEmptyStr(req.body.wan_ip).trim();
        matchedDevice.wan_negociated_speed =
        returnObjOrEmptyStr(req.body.wan_negociated_speed).trim();
        matchedDevice.wan_negociated_duplex =
        returnObjOrEmptyStr(req.body.wan_negociated_duplex).trim();
        matchedDevice.ip = ip;
        matchedDevice.last_contact = Date.now();

        let hardReset = returnObjOrEmptyStr(req.body.hardreset).trim();
        if (hardReset == '1') {
          matchedDevice.last_hardreset = Date.now();
        }

        let upgradeInfo = returnObjOrEmptyStr(req.body.upgfirm).trim();
        if (upgradeInfo == '1') {
          if (matchedDevice.do_update) {
            console.log('Device ' + devId + ' upgraded successfuly');
            matchedDevice.do_update = false;
            matchedDevice.do_update_status = 1; // success
          } else {
            console.log(
              'WARNING: Device ' + devId +
              ' sent a upgrade ack but was not marked as upgradable!'
            );
          }
        }

        let sentRelease = returnObjOrEmptyStr(req.body.release_id).trim();
        matchedDevice.installed_release = sentRelease;

        let flmUpdater = returnObjOrEmptyStr(req.body.flm_updater).trim();
        if (flmUpdater == '1' || flmUpdater == '') {
          // The syn came from flashman_updater (or old routers...)

          // We can disable since the device will receive the update
          matchedDevice.do_update_parameters = false;
          // Remove notification to device using MQTT
          mqtt.anlixMessageRouterReset(matchedDevice._id);
        }

        matchedDevice.save();
        let blockedDevices = deepCopyObject(matchedDevice.lan_devices).filter(
          function(lanDevice) {
            if (lanDevice.is_blocked) {
              return true;
            } else {
              return false;
            }
          }
        );
        let namedDevices = deepCopyObject(matchedDevice.lan_devices).filter(
          function(lanDevice) {
            if ('name' in lanDevice && lanDevice.name != '') {
              return true;
            } else {
              return false;
            }
          }
        );
        Config.findOne({is_default: true}, function(err, matchedConfig) {
          let zabbixFqdn = '';
          if (matchedConfig && matchedConfig.measure_configs.zabbix_fqdn) {
            zabbixFqdn = matchedConfig.measure_configs.zabbix_fqdn;
          }
          return res.status(200).json({
            'do_update': matchedDevice.do_update,
            'do_newprobe': false,
            'mqtt_status': (matchedDevice._id in mqtt.clients),
            'release_id': returnObjOrEmptyStr(matchedDevice.release),
            'connection_type': returnObjOrEmptyStr(matchedDevice.connection_type),
            'pppoe_user': returnObjOrEmptyStr(matchedDevice.pppoe_user),
            'pppoe_password': returnObjOrEmptyStr(matchedDevice.pppoe_password),
            'lan_addr': returnObjOrEmptyStr(matchedDevice.lan_subnet),
            'lan_netmask': returnObjOrEmptyStr(matchedDevice.lan_netmask),
            'wifi_ssid': returnObjOrEmptyStr(matchedDevice.wifi_ssid),
            'wifi_password': returnObjOrEmptyStr(matchedDevice.wifi_password),
            'wifi_channel': returnObjOrEmptyStr(matchedDevice.wifi_channel),
            'wifi_band': returnObjOrEmptyStr(matchedDevice.wifi_band),
            'wifi_mode': returnObjOrEmptyStr(matchedDevice.wifi_mode),
            'wifi_ssid_5ghz': returnObjOrEmptyStr(matchedDevice.wifi_ssid_5ghz),
            'wifi_password_5ghz': returnObjOrEmptyStr(matchedDevice.wifi_password_5ghz),
            'wifi_channel_5ghz': returnObjOrEmptyStr(matchedDevice.wifi_channel_5ghz),
            'wifi_band_5ghz': returnObjOrEmptyStr(matchedDevice.wifi_band_5ghz),
            'wifi_mode_5ghz': returnObjOrEmptyStr(matchedDevice.wifi_mode_5ghz),
            'app_password': returnObjOrEmptyStr(matchedDevice.app_password),
            'zabbix_psk': returnObjOrEmptyStr(matchedDevice.measure_config.measure_psk),
            'zabbix_fqdn': zabbixFqdn,
            'zabbix_active': returnObjOrEmptyStr(matchedDevice.measure_config.is_active),
            'blocked_devices': serializeBlocked(blockedDevices),
            'named_devices': serializeNamed(namedDevices),
            'forward_index': returnObjOrEmptyStr(matchedDevice.forward_index),
            'blocked_devices_index': returnObjOrEmptyStr(matchedDevice.blocked_devices_index),
          });
        });
      }
    }
  });
};

// Receive device firmware upgrade confirmation
deviceInfoController.confirmDeviceUpdate = function(req, res) {
  DeviceModel.findById(req.body.id, function(err, matchedDevice) {
    if (err) {
      console.log('Error finding device: ' + err);
      return res.status(500).end();
    } else {
      if (matchedDevice == null) {
        return res.status(500).end();
      } else {
        let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        matchedDevice.ip = ip;
        matchedDevice.last_contact = Date.now();
        let upgStatus = returnObjOrEmptyStr(req.body.status).trim();
        if (upgStatus == '1') {
          console.log('Device ' + req.body.id + ' is going on upgrade...');
        } else if (upgStatus == '0') {
          console.log('WARNING: Device ' + req.body.id +
                      ' failed in firmware check!');
          matchedDevice.do_update_status = 3; // img check failed
        } else if (upgStatus == '2') {
          console.log('WARNING: Device ' + req.body.id +
                      ' failed to download firmware!');
          matchedDevice.do_update_status = 2; // img download failed
        } else if (upgStatus == '') {
          console.log('WARNING: Device ' + req.body.id +
                      ' ack update on an old firmware! Reseting upgrade...');
          matchedDevice.do_update = false;
          matchedDevice.do_update_status = 1; // success
        }

        matchedDevice.save();
        return res.status(200).end();
      }
    }
  });
};

deviceInfoController.registerMqtt = function(req, res) {
  if (req.body.secret == req.app.locals.secret) {
    DeviceModel.findById(req.body.id, function(err, matchedDevice) {
      if (err) {
        console.log('Attempt to register MQTT secret for device ' +
          req.body.id + ' failed: Cant get device profile.');
        return res.status(400).json({is_registered: 0});
      }
      if (!matchedDevice) {
        console.log('Attempt to register MQTT secret for device ' +
          req.body.id + ' failed: No device found.');
        return res.status(404).json({is_registered: 0});
      }
      if (!matchedDevice.mqtt_secret) {
        matchedDevice.mqtt_secret = req.body.mqttsecret;
        matchedDevice.save();
        console.log('Device ' +
          req.body.id + ' register MQTT secret successfully.');
        return res.status(200).json({is_registered: 1});
      } else {
        // Device have a secret. Modification of secret is forbidden!
        console.log('Attempt to register MQTT secret for device ' +
          req.body.id + ' failed: Device have a secret.');
        // Send notification
        Notification.findOne({
          'message_code': 1,
          'target': matchedDevice._id},
        function(err, matchedNotif) {
          if (!err && (!matchedNotif || matchedNotif.allow_duplicate)) {
            let notification = new Notification({
              'message': 'Este firmware Flashbox foi ' +
                         'modificado ou substituído localmente',
              'message_code': 1,
              'severity': 'alert',
              'type': 'communication',
              'action_title': 'Permitir comunicação',
              'action_url': '/devicelist/command/' +
                            matchedDevice._id + '/rstmqtt',
              'allow_duplicate': false,
              'target': matchedDevice._id,
            });
            notification.save(function(err) {
              if (!err) {
                sio.anlixSendDeviceStatusNotification(matchedDevice._id,
                                                      notification);
              }
            });
          } else {
            sio.anlixSendDeviceStatusNotification(matchedDevice._id,
                                                  matchedNotif);
          }
        });
        return res.status(404).json({is_registered: 0});
      }
    });
  } else {
    console.log('Attempt to register MQTT secret for device ' +
      req.body.id + ' failed: Client Secret not match!');
    return res.status(401).json({is_registered: 0});
  }
};

deviceInfoController.receiveLog = function(req, res) {
  let id = req.headers['x-anlix-id'];
  let bootType = req.headers['x-anlix-logs'];
  let envsec = req.headers['x-anlix-sec'];

  if (process.env.FLM_BYPASS_SECRET == undefined) {
    if (envsec != req.app.locals.secret) {
      console.log('Error Receiving Log: Secret not match!');
      return res.status(404).json({processed: 0});
    }
  }

  DeviceModel.findById(id, function(err, matchedDevice) {
    if (err) {
      console.log('Log Receiving for device ' +
        id + ' failed: Cant get device profile.');
      return res.status(400).json({processed: 0});
    }
    if (!matchedDevice) {
      console.log('Log Receiving for device ' +
        id + ' failed: No device found.');
      return res.status(404).json({processed: 0});
    }

    if (bootType == 'FIRST') {
      matchedDevice.firstboot_log = new Buffer(req.body);
      matchedDevice.firstboot_date = Date.now();
      matchedDevice.save();
      console.log('Log Receiving for device ' +
        id + ' successfully. FIRST BOOT');
    } else if (bootType == 'BOOT') {
      matchedDevice.lastboot_log = new Buffer(req.body);
      matchedDevice.lastboot_date = Date.now();
      matchedDevice.save();
      console.log('Log Receiving for device ' +
        id + ' successfully. LAST BOOT');
    } else if (bootType == 'LIVE') {
      sio.anlixSendLiveLogNotifications(id, req.body);
      console.log('Log Receiving for device ' +
        id + ' successfully. LIVE');
    }

    return res.status(200).json({processed: 1});
  });
};

deviceInfoController.getPortForward = function(req, res) {
  if (req.body.secret == req.app.locals.secret) {
    DeviceModel.findById(req.body.id, function(err, matchedDevice) {
      if (err) {
        console.log('Router ' + req.body.id + ' Get Port Forwards ' +
          'failed: Cant get device profile.');
        return res.status(400).json({success: false});
      }
      if (!matchedDevice) {
        console.log('Router ' + req.body.id + ' Get Port Forwards ' +
          'failed: No device found.');
        return res.status(404).json({success: false});
      }

      let resOut = matchedDevice.lan_devices.filter(function(lanDevice) {
        if (typeof lanDevice.port !== 'undefined' &&
            lanDevice.port.length > 0) {
          return true;
        } else {
          return false;
        }
      });

      let outData = [];
      for (let i = 0; i < resOut.length; i++) {
        tmpData = {};
        tmpData.mac = resOut[i].mac;
        tmpData.port = resOut[i].port;
        tmpData.dmz = resOut[i].dmz;

        if (('router_port' in resOut[i]) &&
            resOut[i].router_port.length != 0) {
          tmpData.router_port = resOut[i].router_port;
        }
        outData.push(tmpData);
      }

      if (matchedDevice.forward_index) {
        return res.status(200).json({
          'success': true,
          'forward_index': matchedDevice.forward_index,
          'forward_rules': outData,
        });
      }
    });
  } else {
    console.log('Router ' + req.body.id + ' Get Port Forwards ' +
      'failed: Client Secret not match!');
    return res.status(401).json({success: false});
  }
};

deviceInfoController.receiveDevices = function(req, res) {
  let id = req.headers['x-anlix-id'];
  let envsec = req.headers['x-anlix-sec'];

  if (process.env.FLM_BYPASS_SECRET == undefined) {
    if (envsec != req.app.locals.secret) {
      console.log('Error Receiving Devices: Secret not match!');
      return res.status(404).json({processed: 0});
    }
  }

  DeviceModel.findById(id, function(err, matchedDevice) {
    if (err) {
      console.log('Devices Receiving for device ' +
        id + ' failed: Cant get device profile.');
      return res.status(400).json({processed: 0});
    }
    if (!matchedDevice) {
      console.log('Devices Receiving for device ' +
        id + ' failed: No device found.');
      return res.status(404).json({processed: 0});
    }
    const validator = new Validator();
    let devsData = req.body.Devices;
    let outData = [];

    for (let connDeviceMac in devsData) {
      if (Object.prototype.hasOwnProperty.call(devsData, connDeviceMac)) {
        let outDev = {};
        let upConnDevMac = connDeviceMac.toLowerCase();
        let upConnDev = devsData[upConnDevMac];
        // Skip if not lowercase
        if (!upConnDev) continue;

        let ipRes = validator.validateIP(upConnDev.ip);
        let devReg = matchedDevice.getLanDevice(upConnDevMac);
        // Check wifi or cable data
        if (upConnDev.conn_type) {
          upConnDev.conn_type = parseInt(upConnDev.conn_type);
        }
        if (upConnDev.conn_speed) {
          upConnDev.conn_speed = parseInt(upConnDev.conn_speed);
        }
        if (upConnDev.wifi_signal) {
          upConnDev.wifi_signal = parseFloat(upConnDev.wifi_signal);
        }
        if (upConnDev.wifi_snr) {
          upConnDev.wifi_snr = parseInt(upConnDev.wifi_snr);
        }
        if (upConnDev.wifi_freq) {
          upConnDev.wifi_freq = parseFloat(upConnDev.wifi_freq);
        }
        if (devReg) {
          if ((upConnDev.hostname) && (upConnDev.hostname != '') &&
              (upConnDev.hostname != '!')
          ) {
            devReg.dhcp_name = upConnDev.hostname;
          }
          if (!devReg.first_seen) {
            devReg.first_seen = Date.now();
          }
          devReg.last_seen = Date.now();
          if (devReg.name && devReg.name != '') {
            outDev.hostname = devReg.name;
          } else {
            outDev.hostname = devReg.dhcp_name;
          }
          devReg.ip = (ipRes.valid ? upConnDev.ip : null);
          if (Array.isArray(upConnDev.ipv6)) {
            devReg.ipv6 = upConnDev.ipv6;
          }
          if (Array.isArray(upConnDev.dhcpv6)) {
            devReg.dhcpv6 = upConnDev.dhcpv6;
          }
          devReg.conn_type = ([0, 1].includes(upConnDev.conn_type) ?
                              upConnDev.conn_type : null);
          devReg.conn_speed = upConnDev.conn_speed;
          devReg.wifi_signal = upConnDev.wifi_signal;
          devReg.wifi_snr = upConnDev.wifi_snr;
          devReg.wifi_freq = upConnDev.wifi_freq;
          devReg.wifi_mode = (['G', 'N', 'AC'].includes(upConnDev.wifi_mode) ?
                              upConnDev.wifi_mode : null);
        } else {
          let hostName = (upConnDev.hostname != '' &&
                          upConnDev.hostname != '!') ? upConnDev.hostname : '';
          matchedDevice.lan_devices.push({
            mac: upConnDevMac,
            dhcp_name: hostName,
            first_seen: Date.now(),
            last_seen: Date.now(),
            ip: (ipRes.valid ? upConnDev.ip : null),
            ipv6: (Array.isArray(upConnDev.ipv6) ? upConnDev.ipv6 : null),
            dhcpv6: (Array.isArray(upConnDev.dhcpv6) ? upConnDev.dhcpv6 : null),
            conn_type: ([0, 1].includes(upConnDev.conn_type) ?
                        upConnDev.conn_type : null),
            conn_speed: upConnDev.conn_speed,
            wifi_signal: upConnDev.wifi_signal,
            wifi_snr: upConnDev.wifi_snr,
            wifi_freq: upConnDev.wifi_freq,
            wifi_mode: (['G', 'N', 'AC'].includes(upConnDev.wifi_mode) ?
                        upConnDev.wifi_mode : null),
          });
          outDev.hostname = hostName;
        }
        outDev.has_dhcpv6 = (Array.isArray(upConnDev.dhcpv6) &&
                             upConnDev.dhcpv6.length > 0 ? true : false);
        outDev.mac = upConnDevMac;
        outData.push(outDev);
      }
    }

    matchedDevice.last_devices_refresh = Date.now();
    matchedDevice.save();

    // if someone is waiting for this message, send the information
    sio.anlixSendOnlineDevNotifications(id, outData);
    console.log('Devices Receiving for device ' +
      id + ' successfully.');

    return res.status(200).json({processed: 1});
  });
};

deviceInfoController.getPingHosts = function(req, res) {
  if (req.body.secret == req.app.locals.secret) {
    DeviceModel.findById(req.body.id, function(err, matchedDevice) {
      if (err) {
        console.log('Router ' + req.body.id + ' Get Ping Hosts ' +
          'failed: Cant get device profile.');
        return res.status(400).json({success: false});
      }
      if (!matchedDevice) {
        console.log('Router ' + req.body.id + ' Get Ping Hosts ' +
          'failed: No device found.');
        return res.status(404).json({success: false});
      }
      if (matchedDevice.ping_hosts) {
        return res.status(200).json({
          'success': true,
          'hosts': matchedDevice.ping_hosts,
        });
      } else {
        console.log('Router ' + req.body.id + ' Get Ping Hosts ' +
          'failed: No hosts found.');
        return res.status(404).json({success: false});
      }
    });
  } else {
    console.log('Router ' + req.body.id + ' Get Port Forwards ' +
      'failed: Client Secret not match!');
    return res.status(401).json({success: false});
  }
};

deviceInfoController.receivePingResult = function(req, res) {
  let id = req.headers['x-anlix-id'];
  let envsec = req.headers['x-anlix-sec'];

  if (process.env.FLM_BYPASS_SECRET == undefined) {
    if (envsec != req.app.locals.secret) {
      console.log('Error Receiving Devices: Secret not match!');
      return res.status(404).json({processed: 0});
    }
  }

  DeviceModel.findById(id, function(err, matchedDevice) {
    if (err) {
      console.log('Ping results for device ' +
        id + ' failed: Cant get device profile.');
      return res.status(400).json({processed: 0});
    }
    if (!matchedDevice) {
      console.log('Ping results for device ' +
        id + ' failed: No device found.');
      return res.status(404).json({processed: 0});
    }

    sio.anlixSendPingTestNotifications(id, req.body);
    console.log('Ping results for device ' +
      id + ' received successfully.');

    return res.status(200).json({processed: 1});
  });
};

deviceInfoController.receiveUpnp = function(req, res) {
  let id = req.headers['x-anlix-id'];
  let envsec = req.headers['x-anlix-sec'];

  if (process.env.FLM_BYPASS_SECRET == undefined) {
    if (envsec != req.app.locals.secret) {
      console.log('Error Receiving Upnp request: Secret not match!');
      return res.status(404).json({processed: 0});
    }
  }

  DeviceModel.findById(id, function(err, matchedDevice) {
    if (err) {
      console.log('Upnp request for device ' + id +
        ' failed: Cant get device profile.');
      return res.status(400).json({processed: 0});
    }
    if (!matchedDevice) {
      console.log('Upnp request for device ' + id +
        ' failed: No device found.');
      return res.status(404).json({processed: 0});
    }

    let deviceMac = req.body.mac;
    let deviceName = req.body.name;
    let lanDevice = matchedDevice.lan_devices.find((d)=>d.mac===deviceMac);
    if (lanDevice) {
      lanDevice.upnp_name = deviceName;
      lanDevice.last_seen = Date.now();
    } else {
      matchedDevice.lan_devices.push({
        mac: blackMacDevice,
        upnp_name: deviceName,
        first_seen: Date.now(),
        last_seen: Date.now(),
      });
    }
    matchedDevice.upnp_requests.push(deviceMac); // add notification for app
    matchedDevice.save();

    // TODO: Integrate with google cloud functions to send app message

    console.log('Upnp request for device ' + id +
      ' received successfully.');

    return res.status(200).json({processed: 1});
  });
};

deviceInfoController.getZabbixConfig = async(function(req, res) {
  let id = req.headers['x-anlix-id'];
  let envsec = req.headers['x-anlix-sec'];

  // Check secret to authenticate api call
  if (process.env.FLM_BYPASS_SECRET == undefined) {
    if (envsec !== req.app.locals.secret) {
      console.log('Router ' + id + ' Get Zabbix Conf fail: Secret not match');
      return res.status(403).json({success: 0});
    }
  }

  try {
    // Check if zabbix fqdn config is set
    let config = await(Config.findOne({is_default: true}));
    if (!config) throw new {message: 'Config not found'};
    if (!config.measure_configs.zabbix_fqdn) {
      throw new {message: 'Zabbix FQDN not configured'};
    }

    // Check if device has a zabbix psk configured
    let device = await(DeviceModel.findById(id));
    if (!device) throw new {message: 'Device ' + id + ' not found'};
    if (!device.measure_config.measure_psk) {
      throw new {message: 'Device ' + id + ' has no psk configured'};
    }

    // Reply with zabbix fqdn and device zabbix psk
    return res.status(200).json({
      success: 1,
      psk: device.measure_config.measure_psk,
      fqdn: config.measure_configs.zabbix_fqdn,
      is_active: device.measure_config.is_active,
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({success: 0});
  }
});

module.exports = deviceInfoController;
