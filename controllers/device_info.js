
const DeviceModel = require('../models/device');
const Config = require('../models/config');
const Notification = require('../models/notification');
const mqtt = require('../mqtts');
const request = require('request-promise-native');
const sio = require('../sio');
const Validator = require('../public/javascripts/device_validator');
const messaging = require('./messaging');
const updateScheduler = require('./update_scheduler');
const DeviceVersion = require('../models/device_version');
const meshHandlers = require('./handlers/mesh');
const async = require('asyncawait/async');
const await = require('asyncawait/await');
const util = require('./handlers/util');

let deviceInfoController = {};

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
  let wanIp = util.returnObjOrEmptyStr(req.body.wan_ip).trim();
  let wanSpeed = util.returnObjOrEmptyStr(req.body.wan_negociated_speed).trim();
  let wanDuplex = util.returnObjOrEmptyStr(req.body.wan_negociated_duplex).trim();
  let installedRelease = util.returnObjOrEmptyStr(req.body.release_id).trim();
  let model = util.returnObjOrEmptyStr(req.body.model).trim().toUpperCase() +
              util.returnObjOrEmptyStr(req.body.model_ver).trim().toUpperCase();
  let version = util.returnObjOrEmptyStr(req.body.version).trim();
  let connectionType = util.returnObjOrEmptyStr(req.body.connection_type).trim();
  let pppoeUser = util.returnObjOrEmptyStr(req.body.pppoe_user).trim();
  let pppoePassword = util.returnObjOrEmptyStr(req.body.pppoe_password).trim();
  let lanSubnet = util.returnObjOrEmptyStr(req.body.lan_addr).trim();
  let lanNetmask = parseInt(util.returnObjOrNum(req.body.lan_netmask, 24));
  let ssid = util.returnObjOrEmptyStr(req.body.wifi_ssid).trim();
  let password = util.returnObjOrEmptyStr(req.body.wifi_password).trim();
  let channel = util.returnObjOrEmptyStr(req.body.wifi_channel).trim();
  let band = util.returnObjOrEmptyStr(req.body.wifi_band).trim();
  let mode = util.returnObjOrEmptyStr(req.body.wifi_mode).trim();
  let power = parseInt(util.returnObjOrNum(req.body.wifi_power, 100));
  let wifiState = parseInt(util.returnObjOrNum(req.body.wifi_state, 1));
  let wifiHidden = parseInt(util.returnObjOrNum(req.body.wifi_hidden, 0));
  let ssid5ghz = util.returnObjOrEmptyStr(req.body.wifi_ssid_5ghz).trim();
  let password5ghz = util.returnObjOrEmptyStr(req.body.wifi_password_5ghz).trim();
  let channel5ghz = util.returnObjOrEmptyStr(req.body.wifi_channel_5ghz).trim();
  let band5ghz = util.returnObjOrStr(req.body.wifi_band_5ghz, 'VHT80').trim();
  let mode5ghz = util.returnObjOrStr(req.body.wifi_mode_5ghz, '11ac').trim();
  let power5ghz = parseInt(util.returnObjOrNum(req.body.wifi_power_5ghz, 100));
  let wifiState5ghz = parseInt(util.returnObjOrNum(req.body.wifi_state_5ghz, 1));
  let wifiHidden5ghz = parseInt(util.returnObjOrNum(req.body.wifi_hidden_5ghz, 0));
  let pppoe = (pppoeUser !== '' && pppoePassword !== '');
  let flmUpdater = util.returnObjOrEmptyStr(req.body.flm_updater).trim();
  let is5ghzCapable =
    (util.returnObjOrEmptyStr(req.body.wifi_5ghz_capable).trim() == '1');
  let sysUpTime = parseInt(util.returnObjOrNum(req.body.sysuptime, 0));
  let wanUpTime = parseInt(util.returnObjOrNum(req.body.wanuptime, 0));
  let wanIpv6Enabled = parseInt(util.returnObjOrNum(req.body.ipv6_enabled, 2));
  let wpsState = (parseInt(util.returnObjOrNum(req.body.wpsstate, 0)) === 1);
  let bridgeEnabled = parseInt(util.returnObjOrNum(req.body.bridge_enabled, 0));
  let bridgeSwitchDisable = parseInt(util.returnObjOrNum(req.body.bridge_switch_disable, 0));
  let bridgeFixIP = util.returnObjOrEmptyStr(req.body.bridge_fix_ip).trim();
  let bridgeFixGateway = util.returnObjOrEmptyStr(req.body.bridge_fix_gateway).trim();
  let bridgeFixDNS = util.returnObjOrEmptyStr(req.body.bridge_fix_dns).trim();
  let meshMode = parseInt(util.returnObjOrNum(req.body.mesh_mode, 0));

  let sentWifiLastChannel = util.returnObjOrEmptyStr(req.body.wifi_curr_channel).trim();
  let sentWifiLastChannel5G = util.returnObjOrEmptyStr(req.body.wifi_curr_channel_5ghz).trim();
  let sentWifiLastBand = util.returnObjOrEmptyStr(req.body.wifi_curr_band).trim();
  let sentWifiLastBand5G = util.returnObjOrEmptyStr(req.body.wifi_curr_band_5ghz).trim();

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
      return res.status(500).end();
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
    if (permissions.grantWifiPowerHiddenIpv6Box) {
      genericValidate(power, validator.validatePower,
                      'power', null, errors);
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

      // Fix for devices that uses 11a as 11ac mode
      if (mode5ghz == '11a') {
        mode5ghz = '11ac';
      }
      genericValidate(mode5ghz, validator.validateMode,
                      'mode5ghz', null, errors);
      if (permissions.grantWifiPowerHiddenIpv6Box) {
        genericValidate(power5ghz, validator.validatePower,
                        'power5ghz', null, errors);
      }
    }

    if (bridgeEnabled > 0) {
      // Make sure that connection type is DHCP. Avoids bugs in version
      // 0.26.0 of Flashbox firmware
      connectionType = 'dhcp';

      if (bridgeFixIP !== '') {
        genericValidate(bridgeFixIP, validator.validateIP,
                        'bridge_fix_ip', null, errors);
        genericValidate(bridgeFixGateway, validator.validateIP,
                        'bridge_fix_gateway', null, errors);
        genericValidate(bridgeFixDNS, validator.validateIP,
                        'bridge_fix_ip', null, errors);
      }
    }

    if (errors.length < 1) {
      let newMeshId = meshHandlers.genMeshID();
      let newMeshKey = meshHandlers.genMeshKey();
      let newDeviceModel = new DeviceModel({
        '_id': macAddr,
        'created_at': new Date(),
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
        'wifi_last_channel': sentWifiLastChannel,
        'wifi_band': band,
        'wifi_last_band': sentWifiLastBand,
        'wifi_mode': mode,
        'wifi_power': power,
        'wifi_state': wifiState,
        'wifi_hidden': wifiHidden,
        'wifi_is_5ghz_capable': is5ghzCapable,
        'wifi_ssid_5ghz': ssid5ghz,
        'wifi_password_5ghz': password5ghz,
        'wifi_channel_5ghz': channel5ghz,
        'wifi_last_channel_5ghz': sentWifiLastChannel5G,
        'wifi_band_5ghz': band5ghz,
        'wifi_last_band_5ghz': sentWifiLastBand5G,
        'wifi_mode_5ghz': mode5ghz,
        'wifi_power_5ghz': power5ghz,
        'wifi_state_5ghz': wifiState5ghz,
        'wifi_hidden_5ghz': wifiHidden5ghz,
        'wan_ip': wanIp,
        'wan_negociated_speed': wanSpeed,
        'wan_negociated_duplex': wanDuplex,
        'ipv6_enabled': wanIpv6Enabled,
        'ip': ip,
        'last_contact': Date.now(),
        'do_update': false,
        'do_update_parameters': false,
        'sys_up_time': sysUpTime,
        'wan_up_time': wanUpTime,
        'bridge_mode_enabled': (bridgeEnabled > 0),
        'bridge_mode_switch_disable': (bridgeSwitchDisable > 0),
        'bridge_mode_ip': bridgeFixIP,
        'bridge_mode_gateway': bridgeFixGateway,
        'bridge_mode_dns': bridgeFixDNS,
        'mesh_mode': meshMode,
        'mesh_id': newMeshId,
        'mesh_key': newMeshKey,
        'wps_is_active': wpsState,
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
                                       'release_id:': installedRelease,
                                       'mesh_mode': meshMode,
                                       'mesh_id': newMeshId,
                                       'mesh_key': newMeshKey});
        }
      });
    } else {
      console.log('Error creating entry: ' + JSON.stringify(errors));
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
  DeviceModel.findById(devId).lean().exec(function(err, matchedDevice) {
    if (err) {
      console.log('Error finding device ' + devId + ': ' + err);
      return res.status(500).end();
    } else {
      if (matchedDevice == null) {
        createRegistry(req, res);
      } else {
        let deviceSetQuery = {};
        let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

        // Update old entries
        if (typeof matchedDevice.do_update_parameters === 'undefined') {
          deviceSetQuery.do_update_parameters = false;
          matchedDevice.do_update_parameters = false; // Used in device response
        }

        // Parameters only modified on first comm between device and flashman
        let bodyModel =
          util.returnObjOrEmptyStr(req.body.model).trim().toUpperCase();
        let bodyModelVer =
          util.returnObjOrEmptyStr(req.body.model_ver).trim().toUpperCase();
        if (matchedDevice.model == '' || matchedDevice.model == bodyModel) {
          // Legacy versions include only model so let's include model version
          deviceSetQuery.model = bodyModel + bodyModelVer;
        }
        let lanSubnet = util.returnObjOrEmptyStr(req.body.lan_addr).trim();
        let lanNetmask = parseInt(util.returnObjOrNum(req.body.lan_netmask, 24));
        if ((!matchedDevice.lan_subnet || matchedDevice.lan_subnet == '') &&
            lanSubnet != '') {
          deviceSetQuery.lan_subnet = lanSubnet;
          matchedDevice.lan_subnet = lanSubnet; // Used in device response
        }
        if (!matchedDevice.lan_netmask) {
          deviceSetQuery.lan_netmask = lanNetmask;
          matchedDevice.lan_netmask = lanNetmask; // Used in device response
        }

        // Update WAN configuration if it was sent by device
        let changeWAN = util.returnObjOrEmptyStr(req.body.local_change_wan).trim();
        let sentConnType = util.returnObjOrEmptyStr(req.body.connection_type).trim();
        let sentBridgeEnabled = util.returnObjOrEmptyStr(req.body.bridge_enabled).trim();
        if (typeof req.body.local_change_wan !== 'undefined' && changeWAN === '1') {
          if (sentBridgeEnabled === '1') {
            // Device was set to bridge mode, change relevant fields
            // IP, Gateway and DNS are changed separately to treat legacy case
            let sentSwitch = util.returnObjOrEmptyStr(req.body.bridge_switch_disable).trim();
            sentSwitch = (sentSwitch === '1'); // Cast to bool value
            deviceSetQuery.bridge_mode_enabled = true;
            deviceSetQuery.bridge_mode_switch_disable = sentSwitch;
            matchedDevice.bridge_mode_enabled = true; // Used in device response
            matchedDevice.bridge_mode_switch_disable = sentSwitch; // Used in device response
          } else if (sentConnType === 'dhcp') {
            // Device was set to DHCP, change relevant fields
            deviceSetQuery.bridge_mode_enabled = false;
            deviceSetQuery.connection_type = 'dhcp';
            deviceSetQuery.pppoe_user = '';
            deviceSetQuery.pppoe_password = '';
            matchedDevice.bridge_mode_enabled = false; // Used in device response
            matchedDevice.connection_type = 'dhcp'; // Used in device response
          } else if (sentConnType === 'pppoe') {
            // Device was set to PPPoE, change relevant fields
            let sentUser = util.returnObjOrEmptyStr(req.body.pppoe_user).trim();
            let sentPass = util.returnObjOrEmptyStr(req.body.pppoe_password).trim();
            if (sentUser !== '' && sentPass !== '') {
              deviceSetQuery.bridge_mode_enabled = false;
              deviceSetQuery.connection_type = 'pppoe';
              deviceSetQuery.pppoe_user = sentUser;
              deviceSetQuery.pppoe_password = sentPass;
              matchedDevice.bridge_mode_enabled = false; // Used in device response
              matchedDevice.connection_type = 'pppoe'; // Used in device response
              matchedDevice.pppoe_user = sentUser; // Used in device response
              matchedDevice.pppoe_password = sentPass; // Used in device response
            }
          }
        }

        // Update bridge parameters in case fixed ip config was changed
        let sentBridgeIp = util.returnObjOrEmptyStr(req.body.bridge_fix_ip).trim();
        if (typeof req.body.bridge_fix_ip !== 'undefined' &&
            sentBridgeIp !== matchedDevice.bridge_mode_ip) {
          deviceSetQuery.bridge_mode_ip = sentBridgeIp;
          matchedDevice.bridge_mode_ip = sentBridgeIp; // Used in device response
        }
        let sentBridgeGateway = util.returnObjOrEmptyStr(req.body.bridge_fix_gateway).trim();
        if (typeof req.body.bridge_fix_gateway !== 'undefined' &&
            sentBridgeGateway !== matchedDevice.bridge_mode_gateway) {
          deviceSetQuery.bridge_mode_gateway = sentBridgeGateway;
          matchedDevice.bridge_mode_gateway = sentBridgeGateway; // Used in device response
        }
        let sentBridgeDns = util.returnObjOrEmptyStr(req.body.bridge_fix_dns).trim();
        if (typeof req.body.bridge_fix_dns !== 'undefined' &&
            sentBridgeDns !== matchedDevice.bridge_mode_dns) {
          deviceSetQuery.bridge_mode_dns = sentBridgeDns;
          matchedDevice.bridge_mode_dns = sentBridgeDns; // Used in device response
        }

        // Store if device has dual band capability
        const is5ghzCapable =
          (util.returnObjOrEmptyStr(req.body.wifi_5ghz_capable).trim() == '1');
        if (is5ghzCapable != matchedDevice.wifi_is_5ghz_capable) {
          deviceSetQuery.wifi_is_5ghz_capable = is5ghzCapable;
        }

        let sentVersion = util.returnObjOrEmptyStr(req.body.version).trim();
        if (matchedDevice.version != sentVersion) {
          // console.log(devId + ' changed version to: '+ sentVersion);

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
              util.returnObjOrEmptyStr(req.body.wifi_band).trim();
            let mode =
              util.returnObjOrEmptyStr(req.body.wifi_mode).trim();

            genericValidate(band, validator.validateBand,
                            'band', null, errors);
            genericValidate(mode, validator.validateMode,
                            'mode', null, errors);

            if (errors.length < 1) {
              if (matchedDevice.wifi_band !== band) {
                deviceSetQuery.wifi_band = band;
                matchedDevice.wifi_band = band; // Used in device response
              }
              if (matchedDevice.wifi_mode !== mode) {
                deviceSetQuery.wifi_mode = mode;
                matchedDevice.wifi_mode = mode; // Used in device response
              }
            }
          }
          if ( permissionsSentVersion.grantWifi5ghz &&
              !permissionsCurrVersion.grantWifi5ghz) {
            let ssid5ghz =
              util.returnObjOrEmptyStr(req.body.wifi_ssid_5ghz).trim();
            let password5ghz =
              util.returnObjOrEmptyStr(req.body.wifi_password_5ghz).trim();
            let channel5ghz =
              util.returnObjOrEmptyStr(req.body.wifi_channel_5ghz).trim();
            let band5ghz =
              util.returnObjOrStr(req.body.wifi_band_5ghz, 'VHT80').trim();
            let mode5ghz =
              util.returnObjOrStr(req.body.wifi_mode_5ghz, '11ac').trim();

            genericValidate(ssid5ghz, validator.validateSSID,
                            'ssid5ghz', null, errors);
            genericValidate(password5ghz, validator.validateWifiPassword,
                            'password5ghz', null, errors);
            genericValidate(channel5ghz, validator.validateChannel,
                            'channel5ghz', null, errors);
            genericValidate(band5ghz, validator.validateBand,
                            'band5ghz', null, errors);

            // Fix for devices that uses 11a as 11ac mode
            if (mode5ghz == '11a') {
              mode5ghz = '11ac';
            }
            genericValidate(mode5ghz, validator.validateMode,
                            'mode5ghz', null, errors);

            if (errors.length < 1) {
              if (matchedDevice.wifi_ssid_5ghz !== ssid5ghz) {
                deviceSetQuery.wifi_ssid_5ghz = ssid5ghz;
                // Used in device response
                matchedDevice.wifi_ssid_5ghz = ssid5ghz;
              }
              if (matchedDevice.wifi_password_5ghz !== password5ghz) {
                deviceSetQuery.wifi_password_5ghz = password5ghz;
                // Used in device response
                matchedDevice.wifi_password_5ghz = password5ghz;
              }
              if (matchedDevice.wifi_channel_5ghz !== channel5ghz) {
                deviceSetQuery.wifi_channel_5ghz = channel5ghz;
                // Used in device response
                matchedDevice.wifi_channel_5ghz = channel5ghz;
              }
              if (matchedDevice.wifi_band_5ghz !== band5ghz) {
                deviceSetQuery.wifi_band_5ghz = band5ghz;
                // Used in device response
                matchedDevice.wifi_band_5ghz = band5ghz;
              }
              if (matchedDevice.wifi_mode_5ghz !== mode5ghz) {
                deviceSetQuery.wifi_mode_5ghz = mode5ghz;
                // Used in device response
                matchedDevice.wifi_mode_5ghz = mode5ghz;
              }
            }
          }
          if ( permissionsSentVersion.grantWifiPowerHiddenIpv6Box &&
              !permissionsCurrVersion.grantWifiPowerHiddenIpv6Box) {
            let power = parseInt(util.returnObjOrNum(req.body.wifi_power, 100));
            genericValidate(power, validator.validatePower,
                            'power', null, errors);
            if (errors.length < 1) {
              if (matchedDevice.wifi_power !== power) {
                deviceSetQuery.wifi_power = power;
                matchedDevice.wifi_power = power; // Used in device response
              }
            }

            if ( permissionsSentVersion.grantWifi5ghz &&
                !permissionsCurrVersion.grantWifi5ghz) {
              let power5ghz =
                parseInt(util.returnObjOrNum(req.body.wifi_power_5ghz, 100));
              genericValidate(power5ghz, validator.validatePower,
                              'power5ghz', null, errors);
              if (errors.length < 1) {
                if (matchedDevice.wifi_power_5ghz !== power5ghz) {
                  deviceSetQuery.wifi_power_5ghz = power5ghz;
                  matchedDevice.wifi_power_5ghz = power5ghz; // Device response
                }
              }
            }

            let wanIpv6Enabled = parseInt(
              util.returnObjOrNum(req.body.ipv6_enabled, 2));
            genericValidate(wanIpv6Enabled, validator.validateIpv6Enabled,
                            'ipv6Enabled', null, errors);
            if (errors.length < 1) {
              if (matchedDevice.ipv6_enabled !== wanIpv6Enabled) {
                deviceSetQuery.ipv6_enabled = wanIpv6Enabled;
                // Used in device response
                matchedDevice.ipv6_enabled = wanIpv6Enabled;
              }
            }
          }
          if (matchedDevice.version !== sentVersion) {
            deviceSetQuery.version = sentVersion;
          }
        }

        let sentNtp = util.returnObjOrEmptyStr(req.body.ntp).trim();
        if (matchedDevice.ntp_status != sentNtp) {
          // console.log('Device '+ devId +' changed NTP STATUS to: '+ sentNtp);
          deviceSetQuery.ntp_status = sentNtp;
        }

        // Parameters *NOT* available to be modified by REST API
        let sentWanIp = util.returnObjOrEmptyStr(req.body.wan_ip).trim();
        if (sentWanIp !== matchedDevice.wan_ip) {
          deviceSetQuery.wan_ip = sentWanIp;
        }
        let sentWanNegociatedSpeed =
        util.returnObjOrEmptyStr(req.body.wan_negociated_speed).trim();
        if (sentWanNegociatedSpeed !== matchedDevice.wan_negociated_speed) {
          deviceSetQuery.wan_negociated_speed = sentWanNegociatedSpeed;
        }
        let sentWanNegociatedDuplex =
        util.returnObjOrEmptyStr(req.body.wan_negociated_duplex).trim();
        if (sentWanNegociatedDuplex !== matchedDevice.wan_negociated_duplex) {
          deviceSetQuery.wan_negociated_duplex = sentWanNegociatedDuplex;
        }
        if (matchedDevice.ip !== ip) {
          deviceSetQuery.ip = ip;
        }
        let sysUpTime = parseInt(util.returnObjOrNum(req.body.sysuptime, 0));
        deviceSetQuery.sys_up_time = sysUpTime;
        let wanUpTime = parseInt(util.returnObjOrNum(req.body.wanuptime, 0));
        deviceSetQuery.wan_up_time = wanUpTime;
        let wpsState = (
          parseInt(util.returnObjOrNum(req.body.wpsstate, 0)) === 1);
        deviceSetQuery.wps_is_active = wpsState;

        let sentWifiLastChannel =
        util.returnObjOrEmptyStr(req.body.wifi_curr_channel).trim();
        if (sentWifiLastChannel !== matchedDevice.wifi_last_channel) {
          deviceSetQuery.wifi_last_channel = sentWifiLastChannel;
        }
        let sentWifiLastChannel5G =
        util.returnObjOrEmptyStr(req.body.wifi_curr_channel_5ghz).trim();
        if (sentWifiLastChannel5G !== matchedDevice.wifi_last_channel_5ghz) {
          deviceSetQuery.wifi_last_channel_5ghz = sentWifiLastChannel5G;
        }

        let sentWifiLastBand =
        util.returnObjOrEmptyStr(req.body.wifi_curr_band).trim();
        if (sentWifiLastBand !== matchedDevice.wifi_last_band) {
          deviceSetQuery.wifi_last_band = sentWifiLastBand;
        }
        let sentWifiLastBand5G =
        util.returnObjOrEmptyStr(req.body.wifi_curr_band_5ghz).trim();
        if (sentWifiLastBand5G !== matchedDevice.wifi_last_band_5ghz) {
          deviceSetQuery.wifi_last_band_5ghz = sentWifiLastBand5G;
        }

        deviceSetQuery.last_contact = Date.now();

        let hardReset = util.returnObjOrEmptyStr(req.body.hardreset).trim();
        if (hardReset == '1') {
          deviceSetQuery.last_hardreset = Date.now();
        }

        let sentRelease = util.returnObjOrEmptyStr(req.body.release_id).trim();
        if (sentRelease !== matchedDevice.installed_release) {
          deviceSetQuery.installed_release = sentRelease;
        }

        let upgradeInfo = util.returnObjOrEmptyStr(req.body.upgfirm).trim();
        if (upgradeInfo == '1') {
          if (matchedDevice.do_update) {
            console.log('Device ' + devId + ' upgraded successfuly');
            if (matchedDevice.mesh_master) {
              // Mesh slaves call the success function with their master's mac
              updateScheduler.successUpdate(matchedDevice.mesh_master);
            } else {
              updateScheduler.successUpdate(matchedDevice._id);
            }
            messaging.sendUpdateDoneMessage(matchedDevice);
            meshHandlers.syncUpdate(matchedDevice, deviceSetQuery, sentRelease);
            deviceSetQuery.do_update = false;
            matchedDevice.do_update = false; // Used in device response
            deviceSetQuery.do_update_status = 1; // success
          } else {
            console.log(
              'WARNING: Device ' + devId +
              ' sent a upgrade ack but was not marked as upgradable!');
          }
        }

        let flmUpdater = util.returnObjOrEmptyStr(req.body.flm_updater).trim();
        if (flmUpdater == '1' || flmUpdater == '') {
          // The syn came from flashman_updater (or old routers...)

          // We can disable since the device will receive the update
          if (matchedDevice.do_update_parameters !== false) {
            deviceSetQuery.do_update_parameters = false;
          }
          // Remove notification to device using MQTT
          mqtt.anlixMessageRouterReset(matchedDevice._id);
        }

        let blockedDevices = util.deepCopyObject(matchedDevice.lan_devices).filter(
          function(lanDevice) {
            if (lanDevice.is_blocked) {
              return true;
            } else {
              return false;
            }
          }
        );
        let namedDevices = util.deepCopyObject(matchedDevice.lan_devices).filter(
          function(lanDevice) {
            if ('name' in lanDevice && lanDevice.name != '') {
              return true;
            } else {
              return false;
            }
          }
        );
        Config.findOne({is_default: true}).lean()
        .exec(function(err, matchedConfig) {
          let zabbixFqdn = '';
          if (matchedConfig && matchedConfig.measure_configs.zabbix_fqdn) {
            zabbixFqdn = matchedConfig.measure_configs.zabbix_fqdn;
          }
          const isDevOn = Object.values(mqtt.unifiedClientsMap).some((map)=>{
            return map[matchedDevice._id];
          });
          let resJson = {
            'do_update': matchedDevice.do_update,
            'do_newprobe': false,
            'mqtt_status': isDevOn,
            'release_id': util.returnObjOrEmptyStr(matchedDevice.release),
            'connection_type': util.returnObjOrEmptyStr(matchedDevice.connection_type),
            'pppoe_user': util.returnObjOrEmptyStr(matchedDevice.pppoe_user),
            'pppoe_password': util.returnObjOrEmptyStr(matchedDevice.pppoe_password),
            'lan_addr': util.returnObjOrEmptyStr(matchedDevice.lan_subnet),
            'lan_netmask': util.returnObjOrEmptyStr(matchedDevice.lan_netmask),
            'wifi_ssid': util.returnObjOrEmptyStr(matchedDevice.wifi_ssid),
            'wifi_password': util.returnObjOrEmptyStr(matchedDevice.wifi_password),
            'wifi_channel': util.returnObjOrEmptyStr(matchedDevice.wifi_channel),
            'wifi_band': util.returnObjOrEmptyStr(matchedDevice.wifi_band),
            'wifi_mode': util.returnObjOrEmptyStr(matchedDevice.wifi_mode),
            'wifi_state': matchedDevice.wifi_state,
            'wifi_power': util.returnObjOrNum(matchedDevice.wifi_power, 100),
            'wifi_hidden': matchedDevice.wifi_hidden,
            'wifi_ssid_5ghz': util.returnObjOrEmptyStr(matchedDevice.wifi_ssid_5ghz),
            'wifi_password_5ghz': util.returnObjOrEmptyStr(matchedDevice.wifi_password_5ghz),
            'wifi_channel_5ghz': util.returnObjOrEmptyStr(matchedDevice.wifi_channel_5ghz),
            'wifi_band_5ghz': util.returnObjOrEmptyStr(matchedDevice.wifi_band_5ghz),
            'wifi_mode_5ghz': util.returnObjOrEmptyStr(matchedDevice.wifi_mode_5ghz),
            'wifi_power_5ghz': util.returnObjOrNum(matchedDevice.wifi_power_5ghz, 100),
            'wifi_state_5ghz': matchedDevice.wifi_state_5ghz,
            'wifi_hidden_5ghz': matchedDevice.wifi_hidden_5ghz,
            'app_password': util.returnObjOrEmptyStr(matchedDevice.app_password),
            'zabbix_psk': util.returnObjOrEmptyStr(matchedDevice.measure_config.measure_psk),
            'zabbix_fqdn': zabbixFqdn,
            'zabbix_active': util.returnObjOrEmptyStr(matchedDevice.measure_config.is_active),
            'blocked_devices': serializeBlocked(blockedDevices),
            'named_devices': serializeNamed(namedDevices),
            'forward_index': util.returnObjOrEmptyStr(matchedDevice.forward_index),
            'blocked_devices_index': util.returnObjOrEmptyStr(matchedDevice.blocked_devices_index),
            'upnp_devices_index': util.returnObjOrEmptyStr(matchedDevice.upnp_devices_index),
            'bridge_mode_enabled': (matchedDevice.bridge_mode_enabled) ? 'y' : 'n',
            'bridge_mode_switch_disable': (matchedDevice.bridge_mode_switch_disable) ? 'y' : 'n',
            'bridge_mode_ip': util.returnObjOrEmptyStr(matchedDevice.bridge_mode_ip),
            'bridge_mode_gateway': util.returnObjOrEmptyStr(matchedDevice.bridge_mode_gateway),
            'bridge_mode_dns': util.returnObjOrEmptyStr(matchedDevice.bridge_mode_dns),
            'mesh_mode': matchedDevice.mesh_mode,
            'mesh_master': matchedDevice.mesh_master,
            'mesh_id': matchedDevice.mesh_id,
            'mesh_key': matchedDevice.mesh_key,
          };
          // Only answer ipv6 status if flashman knows current state
          if (matchedDevice.ipv6_enabled !== 2) {
            resJson.ipv6_enabled = matchedDevice.ipv6_enabled;
          }
          // Do not return yet, just respond to request so we can free socket
          res.status(200).json(resJson);
          // Now we push the changed fields to the database
          DeviceModel.updateOne({'_id': matchedDevice._id},
            {'$set': deviceSetQuery}, (err) => {
              if (err) {
                console.log(err);
                return;
              } else {
                // Convert to date string
                deviceSetQuery.last_contact =
                new Date(deviceSetQuery.last_contact).toISOString();
                // Send modified fields if device traps are activated
                if (Object.keys(deviceSetQuery).length > 0 &&
                    matchedConfig.traps_callbacks &&
                    matchedConfig.traps_callbacks.device_crud) {
                  let requestOptions = {};
                  let callbackUrl =
                  matchedConfig.traps_callbacks.device_crud.url;
                  let callbackAuthUser =
                  matchedConfig.traps_callbacks.device_crud.user;
                  let callbackAuthSecret =
                  matchedConfig.traps_callbacks.device_crud.secret;
                  if (callbackUrl) {
                    requestOptions.url = callbackUrl;
                    requestOptions.method = 'PUT';
                    requestOptions.json = {
                      'id': matchedDevice._id,
                      'type': 'device',
                      'changes': deviceSetQuery,
                    };
                    if (callbackAuthUser && callbackAuthSecret) {
                      requestOptions.auth = {
                        user: callbackAuthUser,
                        pass: callbackAuthSecret,
                      };
                    }
                    request(requestOptions).then((resp) => {
                      // Ignore API response
                      return;
                    }, (err) => {
                      // Ignore API endpoint errors
                      return;
                    });
                  }
                  return;
                }
              }
            },
          );
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
      return res.status(500).json({proceed: 0});
    } else {
      if (matchedDevice == null) {
        return res.status(500).json({proceed: 0});
      } else {
        let ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        matchedDevice.ip = ip;
        matchedDevice.last_contact = Date.now();
        if (matchedDevice.do_update && matchedDevice.do_update_status === 5) {
          // Ack timeout already happened, abort update
          matchedDevice.save();
          return res.status(500).json({proceed: 0});
        }
        let proceed = 0;
        let upgStatus = util.returnObjOrEmptyStr(req.body.status).trim();
        if (upgStatus == '1') {
          if (!matchedDevice.mesh_master || matchedDevice.mesh_master === '') {
            // Only regular devices and mesh masters report download complete
            updateScheduler.successDownload(req.body.id);
          }
          console.log('Device ' + req.body.id + ' is going on upgrade...');
          if (matchedDevice.release === '9999-aix') {
            // Disable schedule since factory firmware will not inform status
            matchedDevice.installed_release = '9999-aix';
            matchedDevice.do_update = false;
            matchedDevice.do_update_status = 1; // success
          } else {
            matchedDevice.do_update_status = 10; // ack received
          }
          proceed = 1;
        } else if (upgStatus == '0') {
          if (matchedDevice.mesh_master) {
            // Mesh slaves call update schedules function with their master mac
            updateScheduler.failedDownload(
              matchedDevice.mesh_master, req.body.id
            );
          } else {
            updateScheduler.failedDownload(req.body.id);
          }
          console.log('WARNING: Device ' + req.body.id +
                      ' failed in firmware check!');
          matchedDevice.do_update_status = 3; // img check failed
        } else if (upgStatus == '2') {
          if (matchedDevice.mesh_master) {
            // Mesh slaves call update schedules function with their master mac
            updateScheduler.failedDownload(
              matchedDevice.mesh_master, req.body.id
            );
          } else {
            updateScheduler.failedDownload(req.body.id);
          }
          console.log('WARNING: Device ' + req.body.id +
                      ' failed to download firmware!');
          matchedDevice.do_update_status = 2; // img download failed
        } else if (upgStatus == '') {
          console.log('WARNING: Device ' + req.body.id +
                      ' ack update on an old firmware! Reseting upgrade...');
          matchedDevice.do_update = false;
          matchedDevice.do_update_status = 1; // success
          proceed = 1;
        }

        matchedDevice.save();
        return res.status(200).json({proceed: proceed});
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

deviceInfoController.registerMeshSlave = function(req, res) {
  if (req.body.secret == req.app.locals.secret) {
    DeviceModel.findById(req.body.id, function(err, matchedDevice) {
      if (err) {
        console.log('Attempt to register mesh slave for device ' +
          req.body.id + ' failed: Cant get device profile.');
        return res.status(400).json({is_registered: 0});
      }
      if (!matchedDevice) {
        console.log('Attempt to register mesh slave for device ' +
          req.body.id + ' failed: No device found.');
        return res.status(404).json({is_registered: 0});
      }

      // lookup if device is already registered
      let slave = req.body.slave.toUpperCase();
      let pos = matchedDevice.mesh_slaves.indexOf(slave);
      if (pos < 0) {
        // Not found, register
        DeviceModel.findById(slave, function(err, slaveDevice) {
          if (err) {
            console.log('Attempt to register mesh slave ' + slave +
              ' for device ' + req.body.id + ' failed: cant get slave device.');
            return res.status(400).json({is_registered: 0});
          }
          if (!slaveDevice) {
            console.log('Attempt to register mesh slave ' + slave +
              ' for device ' + req.body.id +
              ' failed: Slave device not found.');
            return res.status(404).json({is_registered: 0});
          }

          if (slaveDevice.mesh_master) {
            console.log('Attempt to register mesh slave ' + slave +
              ' for device ' + req.body.id +
              ' failed: Slave device aready registred in other master.');
            return res.status(404).json({is_registered: 0});
          }

          if (slaveDevice.mesh_mode != '0' && !slaveDevice.mesh_master) {
            console.log('Attempt to register mesh slave ' + slave +
              ' for device ' + req.body.id +
              ' failed: Slave device is mesh master.');
            return res.status(404).json({is_registered: 0});
          }

          slaveDevice.mesh_master = matchedDevice._id;
          meshHandlers.syncSlaveWifi(matchedDevice, slaveDevice);
          slaveDevice.save();

          matchedDevice.mesh_slaves.push(slave);
          matchedDevice.save();

          // Push updates to the Slave
          mqtt.anlixMessageRouterUpdate(slave);

          console.log('Slave ' + slave + ' registred on Master ' +
            req.body.id + ' successfully.');
          return res.status(200).json({is_registered: 1});
        });
      } else {
        // already registred
        return res.status(200).json({is_registered: 2});
      }
    });
  } else {
    console.log('Attempt to register mesh slave for device ' +
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
        let tmpData = {};
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
    if (!('Devices' in req.body)) {
      console.log('Devices Receiving for device ' +
        id + ' failed: Invalid JSON.');
      return res.status(400).json({processed: 0});
    }

    const validator = new Validator();
    let devsData = req.body.Devices;
    let outData = [];
    let routersData = undefined;

    if ('mesh_routers' in req.body) {
      routersData = req.body.mesh_routers;
    }

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
          // If device change conn type to cable, check conn speed to be sure
          if (devReg.conn_type === 1 && upConnDev.conn_type === 0) {
            if (upConnDev.conn_speed >= 100) {
              devReg.conn_type = upConnDev.conn_type;
            }
          } else {
            devReg.conn_type = ([0, 1].includes(upConnDev.conn_type) ?
                                upConnDev.conn_type : null);
          }
          devReg.last_seen = Date.now();
          devReg.conn_speed = upConnDev.conn_speed;
          devReg.wifi_signal = upConnDev.wifi_signal;
          devReg.wifi_snr = upConnDev.wifi_snr;
          devReg.wifi_freq = upConnDev.wifi_freq;
          devReg.wifi_mode = (['G', 'N', 'AC'].includes(upConnDev.wifi_mode) ?
                              upConnDev.wifi_mode : null);
          if (upConnDev.wifi_signature != '') {
            devReg.wifi_fingerprint = upConnDev.wifi_signature;
          }
          if (upConnDev.dhcp_signature != '') {
            devReg.dhcp_fingerprint = upConnDev.dhcp_signature;
          }
          if (upConnDev.dhcp_vendor_class != '') {
            devReg.dhcp_vendor_class = upConnDev.dhcp_vendor_class;
          }
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
            wifi_fingerprint: upConnDev.wifi_signature,
            dhcp_fingerprint: upConnDev.dhcp_signature,
            dhcp_vendor_class: upConnDev.dhcp_vendor_class,
          });
          outDev.hostname = hostName;
        }
        outDev.has_dhcpv6 = (Array.isArray(upConnDev.dhcpv6) &&
                             upConnDev.dhcpv6.length > 0 ? true : false);
        outDev.mac = upConnDevMac;
        outData.push(outDev);
      }
    }

    if (routersData) {
      // Erasing existing data of previous mesh routers
      matchedDevice.mesh_routers = [];

      for (let connRouter in routersData) {
        if (Object.prototype.hasOwnProperty.call(routersData, connRouter)) {
          let upConnRouterMac = connRouter.toLowerCase();
          let upConnRouter = routersData[upConnRouterMac];
          // Skip if not lowercase
          if (!upConnRouter) continue;

          if (upConnRouter.rx_bit && upConnRouter.tx_bit) {
            upConnRouter.rx_bit = parseInt(upConnRouter.rx_bit);
            upConnRouter.tx_bit = parseInt(upConnRouter.tx_bit);
          }
          if (upConnRouter.signal) {
            upConnRouter.signal = parseFloat(upConnRouter.signal);
          }
          if (upConnRouter.rx_bytes && upConnRouter.tx_bytes) {
            upConnRouter.rx_bytes = parseInt(upConnRouter.rx_bytes);
            upConnRouter.tx_bytes = parseInt(upConnRouter.tx_bytes);
          }
          if (upConnRouter.conn_time) {
            upConnRouter.conn_time = parseInt(upConnRouter.conn_time);
          }
          if (upConnRouter.latency) {
            upConnRouter.latency = parseInt(upConnRouter.latency);
          } else {
            upConnRouter.latency = 0;
          }
          if (upConnRouter.iface) {
            let ifaceMode = 1;
            if (upConnRouter.iface === 'mesh0') ifaceMode = 2;
            if (upConnRouter.iface === 'mesh1') ifaceMode = 3;
            upConnRouter.iface = ifaceMode;
          } else {
            upConnRouter.iface = 1;
          }
          matchedDevice.mesh_routers.push({
            mac: upConnRouterMac,
            last_seen: Date.now(),
            conn_time: upConnRouter.conn_time,
            rx_bytes: upConnRouter.rx_bytes,
            tx_bytes: upConnRouter.tx_bytes,
            signal: upConnRouter.signal,
            rx_bit: upConnRouter.rx_bit,
            tx_bit: upConnRouter.tx_bit,
            latency: upConnRouter.latency,
            iface: upConnRouter.iface,
          });
        }
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


deviceInfoController.receiveSiteSurvey = function(req, res) {
  let id = req.headers['x-anlix-id'];
  let envsec = req.headers['x-anlix-sec'];

  if (process.env.FLM_BYPASS_SECRET == undefined) {
    if (envsec != req.app.locals.secret) {
      console.log('Error Receiving Site Survey: Secret not match!');
      return res.status(404).json({processed: 0});
    }
  }

  DeviceModel.findById(id, function(err, matchedDevice) {
    if (err) {
      console.log('Site Survey Receiving for device ' +
        id + ' failed: Cant get device profile.');
      return res.status(400).json({processed: 0});
    }
    if (!matchedDevice) {
      console.log('Site Survey Receiving for device ' +
        id + ' failed: No device found.');
      return res.status(404).json({processed: 0});
    }
    if (!('survey' in req.body)) {
      console.log('Site Survey Receiving for device ' +
        id + ' failed: Invalid JSON.');
      return res.status(400).json({processed: 0});
    }

    let apsData = req.body.survey;
    let outData = [];

    for (let connApMac in apsData) {
      if (Object.prototype.hasOwnProperty.call(apsData, connApMac)) {
        let outDev = {};
        let upConnApMac = connApMac.toLowerCase();
        let upConnDev = apsData[upConnApMac];
        if (!upConnDev) continue;

        let devReg = matchedDevice.getAPSurveyDevice(upConnApMac);
        if (upConnDev.freq) {
          upConnDev.freq = parseInt(upConnDev.freq);
        }
        if (upConnDev.signal) {
          upConnDev.signal = parseInt(upConnDev.signal);
        }
        let devWidth=20;
        let devVHT=false;

        if (upConnDev.largura_HT) {
          if (upConnDev.largura_HT === 'any') {
            devWidth = 40;
          } else {
            devWidth = parseInt(upConnDev.largura_HT);
          }
        }

        if (upConnDev.largura_VHT) {
          let VHTWifth=parseInt(upConnDev.largura_VHT);
          if (VHTWifth > 0) {
            devVHT=true;
            devWidth = VHTWifth;
          }
        }

        if (devReg) {
          devReg.ssid = upConnDev.SSID;
          devReg.freq = upConnDev.freq;
          devReg.signal = upConnDev.signal;
          devReg.width = devWidth;
          devReg.VHT = devVHT;
          devReg.last_seen = Date.now();
          if (!devReg.first_seen) {
            devReg.first_seen = Date.now();
          }
        } else {
          matchedDevice.ap_survey.push({
            mac: upConnApMac,
            ssid: upConnDev.SSID,
            freq: upConnDev.freq,
            signal: upConnDev.signal,
            width: devWidth,
            VHT: devVHT,
            first_seen: Date.now(),
            last_seen: Date.now(),
          });
        }
        outDev.mac = upConnApMac;
        outData.push(outDev);
      }
    }

    matchedDevice.last_site_survey = Date.now();
    matchedDevice.save();

    // if someone is waiting for this message, send the information
    sio.anlixSendSiteSurveyNotifications(id, outData);
    console.log('Site Survey Receiving for device ' +
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

deviceInfoController.getUpnpDevsPerm = function(req, res) {
  if (req.body.secret == req.app.locals.secret) {
    DeviceModel.findById(req.body.id, function(err, matchedDevice) {
      if (err) {
        console.log('Router ' + req.body.id + ' Get uPnP devices permissions ' +
          'failed: Cant get device profile.');
        return res.status(400).json({success: false});
      }
      if (!matchedDevice) {
        console.log('Router ' + req.body.id + ' Get uPnP devices permissions ' +
          'failed: No device found.');
        return res.status(404).json({success: false});
      }

      let outData = [];
      for (let i = 0; i < matchedDevice.lan_devices.length; i++) {
        let tmpData = {};
        tmpData.mac = matchedDevice.lan_devices[i].mac;
        tmpData.dmz = matchedDevice.lan_devices[i].dmz;
        tmpData.upnp = matchedDevice.lan_devices[i].upnp_permission;
        outData.push(tmpData);
      }

      if (matchedDevice.upnp_devices_index) {
        return res.status(200).json({
          'success': true,
          'upnp_devices_index': matchedDevice.upnp_devices_index,
          'upnp_devices': outData,
        });
      }
    });
  } else {
    console.log('Router ' + req.body.id + ' Get uPnP devices permissions ' +
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

    // No await needed
    Config.findOne({is_default: true}, function(err, matchedConfig) {
      if (!err && matchedConfig) {
        // Send ping results if device traps are activated
        if (matchedConfig.traps_callbacks &&
            matchedConfig.traps_callbacks.device_crud) {
          let requestOptions = {};
          let callbackUrl =
          matchedConfig.traps_callbacks.device_crud.url;
          let callbackAuthUser =
          matchedConfig.traps_callbacks.device_crud.user;
          let callbackAuthSecret =
          matchedConfig.traps_callbacks.device_crud.secret;
          if (callbackUrl) {
            requestOptions.url = callbackUrl;
            requestOptions.method = 'PUT';
            requestOptions.json = {
              'id': matchedDevice._id,
              'type': 'device',
              'changes': {ping_results: req.body.results},
            };
            if (callbackAuthUser && callbackAuthSecret) {
              requestOptions.auth = {
                user: callbackAuthUser,
                pass: callbackAuthSecret,
              };
            }
            request(requestOptions).then((resp) => {
              // Ignore API response
              return;
            }, (err) => {
              // Ignore API endpoint errors
              return;
            });
          }
        }
      }
    });

    // We don't need to wait
    return res.status(200).json({processed: 1});
  });
};

deviceInfoController.receiveSpeedtestResult = function(req, res) {
  let id = req.headers['x-anlix-id'];
  let envsec = req.headers['x-anlix-sec'];

  if (process.env.FLM_BYPASS_SECRET == undefined) {
    if (envsec != req.app.locals.secret) {
      console.log(envsec);
      console.log(req.app.locals.secret);
      console.log('Error Receiving Speedtest: Secret not match!');
      return res.status(404).json({processed: 0});
    }
  }

  DeviceModel.findById(id, function(err, matchedDevice) {
    if (err) {
      console.log('Speedtest results for device ' +
        id + ' failed: Cant get device profile.');
      return res.status(400).json({processed: 0});
    }
    if (!matchedDevice) {
      console.log('Speedtest results for device ' +
        id + ' failed: No device found.');
      return res.status(404).json({processed: 0});
    }

    let randomString = parseInt(Math.random()*10000000).toString();
    let now = new Date();
    let formattedDate = '' + now.getDate();
    formattedDate += '/' + (now.getMonth()+1);
    formattedDate += '/' + now.getFullYear();
    formattedDate += ' ' + (''+now.getHours()).padStart(2, '0');
    formattedDate += ':' + (''+now.getMinutes()).padStart(2, '0');

    if (!req.body.downSpeed) {
      req.body.downSpeed = 'Error';
      matchedDevice.last_speedtest_error.unique_id = randomString;
      matchedDevice.last_speedtest_error.error = 'Error';
    } else if (req.body.downSpeed.includes('503 Server')) {
      req.body.downSpeed = 'Unavailable';
      matchedDevice.last_speedtest_error.unique_id = randomString;
      matchedDevice.last_speedtest_error.error = 'Unavailable';
    } else if (req.body.downSpeed.includes('Mbps')) {
      matchedDevice.speedtest_results.push({
        down_speed: req.body.downSpeed,
        user: req.body.user,
        timestamp: formattedDate,
      });
      if (matchedDevice.speedtest_results.length > 5) {
        matchedDevice.speedtest_results.shift();
      }
      let permissions = DeviceVersion.findByVersion(
        matchedDevice.version,
        matchedDevice.wifi_is_5ghz_capable,
        matchedDevice.model,
      );
      req.body.limit = permissions.grantSpeedTestLimit;
    } else {
      req.body.downSpeed = 'Error';
      matchedDevice.last_speedtest_error.unique_id = randomString;
      matchedDevice.last_speedtest_error.error = 'Error';
    }

    matchedDevice.save();
    sio.anlixSendSpeedTestNotifications(id, req.body);
    console.log('Speedtest results for device ' +
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
        mac: deviceMac,
        upnp_name: deviceName,
        first_seen: Date.now(),
        last_seen: Date.now(),
      });
    }
    if (lanDevice.upnp_permission !== 'reject') {
      matchedDevice.upnp_requests.push(deviceMac); // add notification for app
    } else {
      console.log('Upnp request for device ' + id + ' ignored because of' +
        ' explicit user reject');
      return res.status(200).json({processed: 0, reason: 'User rejected upnp'});
    }
    matchedDevice.save();

    messaging.sendUpnpMessage(matchedDevice, deviceMac, deviceName);

    console.log('Upnp request for device ' + id +
      ' received successfully.');

    return res.status(200).json({processed: 1});
  });
};

deviceInfoController.receiveRouterUpStatus = function(req, res) {
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
      return res.status(400).json({processed: 0});
    }
    if (!matchedDevice) {
      return res.status(404).json({processed: 0});
    }
    let sysUpTime = parseInt(util.returnObjOrNum(req.body.sysuptime, 0));
    matchedDevice.sys_up_time = sysUpTime;
    let wanUpTime = parseInt(util.returnObjOrNum(req.body.wanuptime, 0));
    matchedDevice.wan_up_time = wanUpTime;
    if (util.isJSONObject(req.body.wanbytes)) {
      matchedDevice.wan_bytes = req.body.wanbytes;
    }
    matchedDevice.save();
    sio.anlixSendUpStatusNotification(id, req.body);
    return res.status(200).json({processed: 1});
  });
};

deviceInfoController.receiveWpsResult = function(req, res) {
  let id = req.headers['x-anlix-id'];
  let envsec = req.headers['x-anlix-sec'];

  if (process.env.FLM_BYPASS_SECRET == undefined) {
    if (envsec != req.app.locals.secret) {
      console.log('Wps: Secrets do not match');
      return res.status(404).json({processed: 0});
    }
  }

  DeviceModel.findById(id, function(err, matchedDevice) {
    if (err) {
      console.log('Wps: Error fetching database');
      return res.status(400).json({processed: 0});
    }
    if (!matchedDevice) {
      console.log('Wps: ' + id + ' not found');
      return res.status(404).json({processed: 0});
    }

    if (!('wps_inform' in req.body) || !('wps_content' in req.body)) {
      console.log('Wps: ' + id + ' wrong request body');
      return res.status(500).json({processed: 0});
    }
    const wpsInform = parseInt(req.body.wps_inform);

    if (wpsInform === 0) {
      matchedDevice.wps_is_active = (parseInt(req.body.wps_content) === 1);
    } else if (wpsInform === 2) {
      let errors = [];
      let macAddr = req.body.wps_content.trim().toUpperCase();
      const validator = new Validator();

      genericValidate(macAddr, validator.validateMac, 'mac', null, errors);
      if (errors.length < 1) {
        matchedDevice.wps_last_connected_date = Date.now();
        matchedDevice.wps_last_connected_mac = macAddr;
      } else {
        console.log('Wps: ' + id + ' wrong content format');
        return res.status(500).json({processed: 0});
      }
    }
    matchedDevice.save();
    console.log('Wps: ' + id + ' received successfully');
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
