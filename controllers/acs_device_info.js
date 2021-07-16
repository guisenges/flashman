const DevicesAPI = require('./external-genieacs/devices-api');
const TasksAPI = require('./external-genieacs/tasks-api');
const controlApi = require('./external-api/control');
const DeviceModel = require('../models/device');
const Notification = require('../models/notification');
const Config = require('../models/config');
const sio = require('../sio');
const updateController = require('./update_flashman.js');
const deviceHandlers = require('./handlers/devices');

const pako = require('pako');
const http = require('http');

let acsDeviceInfoController = {};

const checkForNestedKey = function(data, key) {
  if (!data) return false;
  let current = data;
  let splitKey = key.split('.');
  for (let i = 0; i < splitKey.length; i++) {
    if (!current[splitKey[i]]) return false;
    current = current[splitKey[i]];
  }
  return true;
};

const getFromNestedKey = function(data, key) {
  if (!data) return undefined;
  let current = data;
  let splitKey = key.split('.');
  for (let i = 0; i < splitKey.length; i++) {
    if (!current[splitKey[i]]) return undefined;
    current = current[splitKey[i]];
  }
  return current;
};

const convertSubnetMaskToInt = function(mask) {
  if (mask === '255.255.255.0') {
    return 24;
  } else if (mask === '255.255.255.128') {
    return 25;
  } else if (mask === '255.255.255.192') {
    return 26;
  }
  return 0;
};

const convertSubnetMaskToRange = function(mask) {
  // Convert masks to dhcp ranges - reserve 32+1 addresses for fixed ip/gateway
  if (mask === '255.255.255.0' || mask === 24) {
    return {min: '33', max: '254'};
  } else if (mask === '255.255.255.128' || mask === 25) {
    return {min: '161', max: '254'};
  } else if (mask === '255.255.255.192' || mask === 26) {
    return {min: '225', max: '254'};
  }
  return {};
};

const convertWifiMode = function(mode, is5ghz) {
  switch (mode) {
    case '11b':
    case '11g':
    case '11bg':
    case 'b':
    case 'g':
    case 'bg':
    case 'b,g':
      return '11g';
    case '11bgn':
    case '11a':
    case '11na':
    case 'a':
    case 'n':
    case 'g,n':
    case 'gn':
    case 'b,g,n':
    case 'bgn':
    case 'an':
    case 'a,n':
      return (is5ghz) ? '11na' : '11n';
    case '11ac':
    case 'ac':
    case 'anac':
    case 'a,n,ac':
      return (is5ghz) ? '11ac' : undefined;
    case 'ax':
    default:
      return undefined;
  }
};

const convertToDbm = function(model, rxPower) {
  switch (model) {
    case 'F670L':
    case 'G-140W-C':
      return rxPower = parseFloat((10 * Math.log10(rxPower*0.0001)).toFixed(3));
    case 'GONUAC001':
    default:
      return rxPower;
  }
};

const convertWifiBand = function(band, mode) {
  let isAC = convertWifiMode(mode) === '11ac';
  switch (band) {
    case 'auto':
      return 'auto';
    case '20MHz':
      return (isAC) ? 'VHT20' : 'HT20';
    case '40MHz':
      return (isAC) ? 'VHT40' : 'HT40';
    case '80MHz':
      return (isAC) ? 'VHT80' : undefined;
    case '160MHz':
    default:
      return undefined;
  }
};

const appendBytesMeasure = function(original, recv, sent) {
  let now = Math.floor(Date.now()/1000);
  if (!original) original = {};
  let bytes = JSON.parse(JSON.stringify(original));
  if (Object.keys(bytes).length >= 300) {
    let keysNum = Object.keys(bytes).map((k)=>parseInt(k));
    let smallest = Math.min(...keysNum);
    delete bytes[smallest];
  }
  bytes[now] = [recv, sent];
  return bytes;
};

const appendPonSignal = function(original, rxPower, txPower) {
  let now = Math.floor(Date.now() / 1000);
  if (!original) original = {};
  let dbms = JSON.parse(JSON.stringify(original));
  if (Object.keys(dbms).length >= 100) {
    let keysNum = Object.keys(dbms).map((k) => parseInt(k));
    let smallest = Math.min(...keysNum);
    delete dbms[smallest];
  }
  dbms[now] = [rxPower, txPower];
  return dbms;
};

const processHostFromURL = function(url) {
  if (typeof url !== 'string') return '';
  let doubleSlash = url.indexOf('//');
  let pathStart = url.substring(doubleSlash+2).indexOf('/');
  let endIndex = (pathStart >= 0) ? doubleSlash+2+pathStart : url.length;
  let hostAndPort = url.substring(doubleSlash+2, endIndex);
  return hostAndPort.split(':')[0];
};

const saveDeviceData = async function(mac, landevices) {
  if (!mac || !landevices || !landevices.length) return;
  let device = await DeviceModel.findById(mac.toUpperCase());
  landevices.forEach((lanDev)=>{
    let lanMac = lanDev.mac.toUpperCase();
    let registered = device.lan_devices.find((d)=>d.mac===lanMac);
    if (registered) {
      registered.dhcp_name = lanDev.name;
      registered.ip = lanDev.ip;
      registered.conn_type = (lanDev.wifi) ? 1 : 0;
      if (lanDev.wifi_freq) registered.wifi_freq = lanDev.wifi_freq;
      if (lanDev.rssi) registered.wifi_signal = lanDev.rssi;
      if (lanDev.snr) registered.wifi_snr = lanDev.snr;
      registered.last_seen = Date.now();
    } else {
      device.lan_devices.push({
        mac: lanMac,
        dhcp_name: lanDev.name,
        ip: lanDev.ip,
        conn_type: (lanDev.wifi) ? 1 : 0,
        wifi_signal: (lanDev.rssi) ? lanDev.rssi : undefined,
        wifi_freq: (lanDev.wifi_freq) ? lanDev.wifi_freq : undefined,
        wifi_snr: (lanDev.snr) ? lanDev.snr : undefined,
        last_seen: Date.now(),
        first_seen: Date.now(),
      });
    }
  });
  await device.save();
};

const createRegistry = async function(req) {
  let data = req.body.data;
  let hasPPPoE = (data.wan.pppoe_user !== '');
  let subnetNumber = convertSubnetMaskToInt(data.lan.subnet_mask);
  let cpeIP = processHostFromURL(data.common.ip);
  let splitID = req.body.acs_id.split('-');
  
  let matchedConfig = await Config.findOne({is_default: true}).catch(
    function(err) {
      console.error('Error creating entry: ' + err);
      return false;
    }
  );
  if (!matchedConfig) {
    console.error('Error creating entry. Config does not exists.');
    return false;
  }
  let ssid = data.wifi2.ssid.trim();
  let ssid5ghz = data.wifi5.ssid.trim();
  let ssid2ghzPrefix = '';
  let ssid5ghzPrefix = '';
  let isSsidPrefixEnabled = false;
  let createPrefixErrNotification = false;
  if (matchedConfig.personalizationHash !== '' &&
      matchedConfig.isSsidPrefixEnabled) {
    const check2ghz = deviceHandlers.checkSsidPrefixNewRegistry(
      matchedConfig.ssidPrefix, ssid);
    const check5ghz = deviceHandlers.checkSsidPrefixNewRegistry(
      matchedConfig.ssidPrefix, ssid5ghz);
    if (!check2ghz.enablePrefix || !check5ghz.enablePrefix) {
      createPrefixErrNotification = true;
      isSsidPrefixEnabled = false;
    } else {
      isSsidPrefixEnabled = true;
      ssid2ghzPrefix = check2ghz.ssidPrefix;
      ssid5ghzPrefix = check5ghz.ssidPrefix;
      ssid = check2ghz.ssid;
      ssid5ghz = check5ghz.ssid;
    }
  }

  let newDevice = new DeviceModel({
    _id: data.common.mac.toUpperCase(),
    use_tr069: true,
    serial_tr069: splitID[splitID.length - 1],
    acs_id: req.body.acs_id,
    model: (data.common.model) ? data.common.model : '',
    version: data.common.version,
    installed_release: data.common.version,
    release: data.common.version,
    connection_type: (hasPPPoE) ? 'pppoe' : 'dhcp',
    pppoe_user: (hasPPPoE) ? data.wan.pppoe_user : undefined,
    pppoe_password: (hasPPPoE) ? data.wan.pppoe_pass : undefined,
    wifi_ssid: ssid,
    wifi_channel: (data.wifi2.auto) ? 'auto' : data.wifi2.channel,
    wifi_mode: convertWifiMode(data.wifi2.mode, false),
    wifi_band: convertWifiBand(data.wifi2.band, data.wifi2.mode),
    wifi_state: (data.wifi2.enable) ? 1 : 0,
    wifi_is_5ghz_capable: true,
    wifi_ssid_5ghz: ssid5ghz,
    wifi_channel_5ghz: (data.wifi5.auto) ? 'auto' : data.wifi5.channel,
    wifi_mode_5ghz: convertWifiMode(data.wifi5.mode, true),
    wifi_state_5ghz: (data.wifi5.enable) ? 1 : 0,
    lan_subnet: data.lan.router_ip,
    lan_netmask: (subnetNumber > 0) ? subnetNumber : undefined,
    ip: (cpeIP) ? cpeIP : undefined,
    wan_ip: (hasPPPoE) ? data.wan.wan_ip_ppp : data.wan.wan_ip,
    wan_negociated_speed: data.wan.rate,
    wan_negociated_duplex: data.wan.duplex,
    sys_up_time: data.common.uptime,
    wan_up_time: (hasPPPoE) ? data.wan.uptime_ppp : data.wan.uptime,
    created_at: Date.now(),
    last_contact: Date.now(),
    isSsidPrefixEnabled: isSsidPrefixEnabled,
  });
  try {
    await newDevice.save();
    await acsDeviceInfoController.reportOnuDevices(req.app, [newDevice]);
  } catch (err) {
    console.error(err);
    return false;
  }
  // Update SSID prefix on CPE if enabled
  if (isSsidPrefixEnabled) {
    let changes = {wan: {}, lan: {}, wifi2: {}, wifi5: {}};
    let hasChanges = false;
    if ((ssid2ghzPrefix + ssid) !== ssid) {
      changes.wifi2.ssid = ssid2ghzPrefix + ssid;
      hasChanges = true;
    }
    if ((ssid5ghzPrefix + ssid5ghz) !== ssid5ghz) {
      changes.wifi5.ssid = ssid5ghzPrefix + ssid5ghz;
      hasChanges = true;
    }
    // Increment sync task loops
    newDevice.acs_sync_loops += 1;  
    // Possibly TODO: Let acceptLocalChanges be configurable for the admin
    let acceptLocalChanges = false;
    if (!acceptLocalChanges) {
      if (hasChanges) {
        acsDeviceInfoController.updateInfo(newDevice, changes);
      }
    }
  }
  if (createPrefixErrNotification) {
    // Notify if ssid prefix was impossible to be assigned
    let matchedNotif = await Notification
    .findOne({'message_code': 5, 'target': newDevice._id})
    .catch(function(err) {
      console.error('Error fetching database: ' + err);
    });
    if (!matchedNotif || matchedNotif.allow_duplicate) {
      let notification = new Notification({
        'message': 'Não foi possível habilitar o prefixo SSID ' +
                   'pois o tamanho máximo de 32 caracteres foi excedido.',
        'message_code': 5,
        'severity': 'alert',
        'type': 'communication',
        'action_title': 'Ok',
        'allow_duplicate': false,
        'target': newDevice._id,
      });
      await notification.save().catch(
        function(err) {
          console.error('Error creating notification: ' + err);
        }
      );
    }
  }
  return true;
};

acsDeviceInfoController.syncDevice = async function(req, res) {
  let data = req.body.data;
  if (!data || !data.common || !data.common.mac) {
    return res.status(500).json({
      success: false,
      message: 'Missing mac field',
    });
  }

  let device = await DeviceModel.findById(data.common.mac.toUpperCase());
  if (!device) {
    if (await createRegistry(req)) {
      return res.status(200).json({success: true});
    } else {
      return res.status(500).json({
        success: false,
        message: 'Failed to create device registry',
      });
    }
  }
  if (!device.use_tr069) {
    return res.status(500).json({
      success: false,
      message: 'Attempt to sync acs data with non-tr-069 device',
    });
  }
  let hasPPPoE = (data.wan.pppoe_user !== '');
  let subnetNumber = convertSubnetMaskToInt(data.lan.subnet_mask);
  let cpeIP = processHostFromURL(data.common.ip);
  let changes = {wan: {}, lan: {}, wifi2: {}, wifi5: {}};
  let hasChanges = false;
  device.acs_id = req.body.acs_id;
  let splitID = req.body.acs_id.split('-');
  device.serial_tr069 = splitID[splitID.length - 1];
  if (data.common.model) device.model = data.common.model.trim();
  if (data.common.version) device.version = data.common.version.trim();
  if (hasPPPoE) {
    if (device.connection_type !== 'pppoe') {
      changes.wan.pppoe_user = data.wan.pppoe_user.trim();
      changes.wan.pppoe_pass = data.wan.pppoe_pass.trim();
      hasChanges = true;
    }
    if (!device.pppoe_user) {
      device.pppoe_user = data.wan.pppoe_user.trim();
    } else if (device.pppoe_user.trim() !== data.wan.pppoe_user.trim()) {
      changes.wan.pppoe_user = device.pppoe_user.trim();
      hasChanges = true;
    }
    if (!device.pppoe_password) {
      device.pppoe_password = data.wan.pppoe_pass.trim();
    } else if (data.wan.pppoe_pass && // make sure this onu reports the password
               device.pppoe_password.trim() !== data.wan.pppoe_pass.trim()) {
      changes.wan.pppoe_pass = device.pppoe_password.trim();
      hasChanges = true;
    }
  } else {
    if (device.connection_type !== 'dhcp') {
      changes.wan.pppoe_user = device.pppoe_user.trim();
      changes.wan.pppoe_pass = device.pppoe_password.trim();
      hasChanges = true;
    }
  }

  if (typeof data.wifi2.enable !== 'undefined') {
    let enable = (data.wifi2.enable) ? 1 : 0;
    if (device.wifi_state !== enable) {
      changes.wifi2.enable = device.wifi_state;
      hasChanges = true;
    }
  }
  if (typeof data.wifi5.enable !== 'undefined') {
    let enable = (data.wifi5.enable) ? 1 : 0;
    if (device.wifi_state_5ghz !== enable) {
      changes.wifi5.enable = device.wifi_state_5ghz;
      hasChanges = true;
    }
  }
  
  let ssidPrefix = await updateController.
          getSsidPrefix(device.
            isSsidPrefixEnabled);
  if (data.wifi2.ssid && !device.wifi_ssid) {
    device.wifi_ssid = data.wifi2.ssid.trim();
  }
  if (ssidPrefix + device.wifi_ssid.trim()
    !== data.wifi2.ssid.trim()) {
    changes.wifi2.ssid = device.wifi_ssid.trim();
    hasChanges = true;
  }
  let channel2 = (data.wifi2.auto) ? 'auto' : data.wifi2.channel.toString();
  if (channel2 && !device.wifi_channel) {
    device.wifi_channel = channel2;
  } else if (device.wifi_channel !== channel2) {
    changes.wifi2.channel = device.wifi_channel;
    hasChanges = true;
  }
  let mode2 = convertWifiMode(data.wifi2.mode, false);
  if (data.wifi2.mode && !device.wifi_mode) {
    device.wifi_mode = mode2;
  } else if (device.wifi_mode !== mode2) {
    changes.wifi2.mode = device.wifi_mode;
    hasChanges = true;
  }
  let band2 = convertWifiBand(data.wifi2.band, data.wifi2.mode);
  if (data.wifi2.band && !device.wifi_band) {
    device.wifi_band = band2;
  } else if (device.wifi_band !== band2) {
    changes.wifi2.band = device.wifi_band;
  }

  if (data.wifi5.ssid && !device.wifi_ssid_5ghz) {
    device.wifi_ssid_5ghz = data.wifi5.ssid.trim();
  }
  if (ssidPrefix + device.wifi_ssid_5ghz.trim()
    !== data.wifi5.ssid.trim()) {
    changes.wifi5.ssid = device.wifi_ssid_5ghz.trim();
    hasChanges = true;
  }
  let channel5 = (data.wifi5.auto) ? 'auto' : data.wifi5.channel.toString();
  if (channel5 && !device.wifi_channel_5ghz) {
    device.wifi_channel_5ghz = channel5;
  } else if (device.wifi_channel_5ghz !== channel5) {
    changes.wifi5.channel = device.wifi_channel_5ghz;
    hasChanges = true;
  }
  let mode5 = convertWifiMode(data.wifi5.mode, true);
  if (data.wifi5.mode && !device.wifi_mode_5ghz) {
    device.wifi_mode_5ghz = mode5;
  } else if (device.wifi_mode_5ghz !== mode5) {
    changes.wifi5.mode = device.wifi_mode_5ghz;
    hasChanges = true;
  }
  let band5 = convertWifiBand(data.wifi5.band, data.wifi5.mode);
  if (data.wifi5.band && !device.wifi_band_5ghz) {
    device.wifi_band_5ghz = band5;
  } else if (device.wifi_band_5ghz !== band5) {
    changes.wifi5.band = device.wifi_band_5ghz;
  }

  if (data.lan.router_ip && !device.lan_subnet) {
    device.lan_subnet = data.lan.router_ip;
  } else if (device.lan_subnet !== data.lan.router_ip) {
    changes.lan.router_ip = device.lan_subnet;
    hasChanges = true;
  }
  if (subnetNumber > 0 && !device.lan_netmask) {
    device.lan_netmask = subnetNumber;
  } else if (device.lan_netmask !== subnetNumber) {
    changes.lan.subnet_mask = device.lan_netmask;
    hasChanges = true;
  }
  if (data.wan.recv_bytes && data.wan.sent_bytes) {
    device.wan_bytes = appendBytesMeasure(
      device.wan_bytes,
      data.wan.recv_bytes,
      data.wan.sent_bytes,
    );
  }
  if (data.wan.pon_rxpower) {
    device.pon_rxpower = convertToDbm(data.common.model, data.wan.pon_rxpower);
  }
  if (data.wan.pon_txpower) {
    device.pon_txpower = convertToDbm(data.common.model, data.wan.pon_txpower);
  }
  if (data.wan.pon_rxpower && data.wan.pon_txpower) {
    device.pon_signal_measure = appendPonSignal(
      device.pon_signal_measure,
      device.pon_rxpower,
      device.pon_txpower,
    );
  }
  if (data.wan.name) {
    device.wan_username = data.wan.name;
  }
  if (data.wan.password) {
    device.wan_password = data.wan.password;
  }
  if (data.common.version && data.common.version !== device.installed_release) {
    device.installed_release = data.common.version;
  }
  if (data.wan.rate) device.wan_negociated_speed = data.wan.rate;
  if (data.wan.duplex) device.wan_negociated_duplex = data.wan.duplex;
  if (data.common.uptime) device.sys_up_time = data.common.uptime;
  if (hasPPPoE && data.wan.wan_ip_ppp) device.wan_ip = data.wan.wan_ip_ppp;
  else if (!hasPPPoE && data.wan.wan_ip) device.wan_ip = data.wan.wan_ip;
  if (hasPPPoE && data.wan.uptime_ppp) device.wan_up_time = data.wan.uptime_ppp;
  else if (!hasPPPoE && data.wan.uptime) device.wan_up_time = data.wan.uptime;
  if (cpeIP) device.ip = cpeIP;

  if (hasChanges) {
    // Increment sync task loops
    device.acs_sync_loops += 1;
    let syncLimit = 5;
    if (device.acs_sync_loops === syncLimit) {
      // Inform via log that this device has entered a sync loop
      let serialChanges = JSON.stringify(changes);
      console.log(
        'Device '+device.acs_id+' has entered a sync loop: '+serialChanges,
      );
    } else if (device.acs_sync_loops <= syncLimit) {
      // Guard against looping syncs - do not force changes if over limit
      // Possibly TODO: Let acceptLocalChanges be configurable for the admin
      let acceptLocalChanges = false;
      if (!acceptLocalChanges) {
        if (hasChanges) {
          acsDeviceInfoController.updateInfo(device, changes);
        }
      }
    }
  } else {
    let informDiff = Date.now() - device.last_contact;
    if (informDiff >= 20000) {
      // 20s - Guard against any very short inform repetitions from GenieACS
      device.acs_sync_loops = 0;
    }
  }
  device.last_contact = Date.now();
  // daily data fetching
  if (!device.last_contact_daily) {
    device.last_contact_daily = Date.now();
  } else if (Date.now() - device.last_contact_daily > 24*60*60*1000) {
    // for every day fetch to device port forward entries
    device.last_contact_daily = Date.now();
    acsDeviceInfoController.
    checkPortForwardRules(device,
      device.port_mapping.length - data.wan.port_mapping_entries);
  }
  await device.save();
  return res.status(200).json({success: true});
};

acsDeviceInfoController.rebootDevice = function(device, res) {
  // Make sure we only work with TR-069 devices with a valid ID
  if (!device || !device.use_tr069 || !device.acs_id) return;
  let acsID = device.acs_id;
  let task = {name: 'reboot'};
  TasksAPI.addTask(acsID, task, true, 10000, [], (result)=>{
    if (result.task.name !== 'reboot') return;
    if (result.finished) res.status(200).json({success: true});
    else {
      res.status(200).json({
        success: false,
        message: 'Dispositivos não respondeu à requisição',
      });
    }
  });
};

// TODO: Move this function to external-genieacs?
const fetchLogFromGenie = function(success, mac, acsID) {
  if (!success) {
    // Return with log unavailable
    let data = 'Log não disponível!';
    let compressedLog = pako.gzip(data);
    sio.anlixSendLiveLogNotifications(mac, compressedLog);
    return;
  }
  let splitID = acsID.split('-');
  let model = splitID.slice(1, splitID.length-1).join('-');
  let logField = DevicesAPI.getModelFields(splitID[0], model).fields.log;
  let query = {_id: acsID};
  let path = '/devices/?query='+JSON.stringify(query)+'&projection='+logField;
  let options = {
    method: 'GET',
    hostname: 'localhost',
    // hostname: '207.246.65.243',
    port: 7557,
    path: encodeURI(path),
  };
  let req = http.request(options, (resp)=>{
    resp.setEncoding('utf8');
    let data = '';
    resp.on('data', (chunk)=>data+=chunk);
    resp.on('end', async ()=>{
      data = JSON.parse(data)[0];
      let success = false;
      if (!checkForNestedKey(data, logField+'._value')) {
        data = 'Log não disponível!';
      } else {
        success = true;
        data = getFromNestedKey(data, logField+'._value');
      }
      let compressedLog = pako.gzip(data);
      if (success) {
        let deviceEdit = await DeviceModel.findById(mac);
        deviceEdit.last_contact = Date.now();
        deviceEdit.lastboot_date = Date.now();
        deviceEdit.lastboot_log = Buffer.from(compressedLog);
        await deviceEdit.save();
      }
      sio.anlixSendLiveLogNotifications(mac, compressedLog);
    });
  });
  req.end();
};

// TODO: Move this function to external-genieacs?
const fetchWanBytesFromGenie = function(mac, acsID) {
  let splitID = acsID.split('-');
  let model = splitID.slice(1, splitID.length-1).join('-');
  let fields = DevicesAPI.getModelFields(splitID[0], model).fields;
  let recvField = fields.wan.recv_bytes;
  let sentField = fields.wan.sent_bytes;
  let query = {_id: acsID};
  let projection = recvField + ',' + sentField;
  let path = '/devices/?query='+JSON.stringify(query)+'&projection='+projection;
  let options = {
    method: 'GET',
    hostname: 'localhost',
    // hostname: '207.246.65.243',
    port: 7557,
    path: encodeURI(path),
  };
  let req = http.request(options, (resp)=>{
    resp.setEncoding('utf8');
    let data = '';
    let wanBytes = {};
    resp.on('data', (chunk)=>data+=chunk);
    resp.on('end', async ()=>{
      data = JSON.parse(data)[0];
      let success = false;
      if (checkForNestedKey(data, recvField+'._value') &&
          checkForNestedKey(data, sentField+'._value')) {
        success = true;
        wanBytes = {
          recv: getFromNestedKey(data, recvField+'._value'),
          sent: getFromNestedKey(data, sentField+'._value'),
        };
      }
      if (success) {
        let deviceEdit = await DeviceModel.findById(mac);
        deviceEdit.last_contact = Date.now();
        wanBytes = appendBytesMeasure(
          deviceEdit.wan_bytes,
          wanBytes.recv,
          wanBytes.sent,
        );
        deviceEdit.wan_bytes = wanBytes;
        await deviceEdit.save();
      }
      sio.anlixSendUpStatusNotification(mac, {wanbytes: wanBytes});
    });
  });
  req.end();
};

const fetchUpStatusFromGenie = function(mac, acsID) {
  let splitID = acsID.split('-');
  let model = splitID.slice(1, splitID.length-1).join('-');
  let fields = DevicesAPI.getModelFields(splitID[0], model).fields;
  let upTimeField = fields.wan.uptime.replace('*', 1);
  let upTimePPPField1 = fields.wan.uptime_ppp.replace('*', 1).replace('*', 1);
  let upTimePPPField2 = fields.wan.uptime_ppp.replace('*', 1).replace('*', 2);
  let PPPoEUser1 = fields.wan.pppoe_user.replace('*', 1).replace('*', 1);
  let PPPoEUser2 = fields.wan.pppoe_user.replace('*', 1).replace('*', 2);
  let query = {_id: acsID};
  let projection = fields.common.uptime +
      ',' + upTimeField +
      ',' + upTimePPPField1 +
      ',' + upTimePPPField2 +
      ',' + PPPoEUser1 +
      ',' + PPPoEUser2;
  let path = '/devices/?query='+JSON.stringify(query)+'&projection='+projection;
  let options = {
    method: 'GET',
    hostname: 'localhost',
    // hostname: '207.246.65.243',
    port: 7557,
    path: encodeURI(path),
  };
  let req = http.request(options, (resp)=>{
    resp.setEncoding('utf8');
    let data = '';
    let sysUpTime = 0;
    let wanUpTime = 0;
    resp.on('data', (chunk)=>data+=chunk);
    resp.on('end', async ()=>{
      data = JSON.parse(data)[0];
      let successSys = false;
      let successWan = false;
      if (checkForNestedKey(data, fields.common.uptime+'._value')) {
        successSys = true;
        sysUpTime = getFromNestedKey(data, fields.common.uptime+'._value');
      }
      if (checkForNestedKey(data, PPPoEUser1+'._value')) {
        successWan = true;
        let hasPPPoE = getFromNestedKey(data, PPPoEUser1+'._value');
        if (hasPPPoE && checkForNestedKey(data, upTimePPPField1+'._value')) {
          wanUpTime = getFromNestedKey(data, upTimePPPField1+'._value');
        }
      } else if (checkForNestedKey(data, PPPoEUser2+'._value')) {
        successWan = true;
        let hasPPPoE = getFromNestedKey(data, PPPoEUser2+'._value');
        if (hasPPPoE && checkForNestedKey(data, upTimePPPField2+'._value')) {
          wanUpTime = getFromNestedKey(data, upTimePPPField2+'._value');
        }
      } else {
          successWan = true;
          if (checkForNestedKey(data, upTimeField+'._value')) {
            wanUpTime = getFromNestedKey(data, upTimeField+'._value');
          }
      }
      if (successSys || successWan) {
        let deviceEdit = await DeviceModel.findById(mac);
        deviceEdit.last_contact = Date.now();
        deviceEdit.sys_up_time = sysUpTime;
        deviceEdit.wan_up_time = wanUpTime;
        await deviceEdit.save();
      }
      sio.anlixSendUpStatusTr069Notification(mac, {
        sysuptime: sysUpTime,
        wanuptime: wanUpTime,
      });
    });
  });
  req.end();
};

// TODO: Move this function to external-genieacs?
acsDeviceInfoController.fetchPonSignalFromGenie = function(mac, acsID) {
  let splitID = acsID.split('-');
  let model = splitID.slice(1, splitID.length-1).join('-');
  let fields = DevicesAPI.getModelFields(splitID[0], model).fields;
  let rxPowerField = fields.wan.pon_rxpower;
  let txPowerField = fields.wan.pon_txpower;
  let query = {_id: acsID};
  let projection = rxPowerField + ',' + txPowerField;
  let path = '/devices/?query='+JSON.stringify(query)+'&projection='+projection;
  let options = {
    method: 'GET',
    hostname: 'localhost',
    // hostname: '207.246.65.243',
    port: 7557,
    path: encodeURI(path),
  };
  let req = http.request(options, (resp)=>{
    resp.setEncoding('utf8');
    let data = '';
    let ponSignal = {};
    resp.on('data', (chunk)=>data+=chunk);
    resp.on('end', async ()=>{
      data = JSON.parse(data)[0];
      let success = false;
      if (checkForNestedKey(data, rxPowerField+'._value') &&
          checkForNestedKey(data, txPowerField+'._value')) {
        success = true;
        ponSignal = {
          rxpower: getFromNestedKey(data, rxPowerField+'._value'),
          txpower: getFromNestedKey(data, txPowerField+'._value'),
        };
      }
      if (success) {
        let deviceEdit = await DeviceModel.findById(mac);
        deviceEdit.last_contact = Date.now();
        if (ponSignal.rxpower) ponSignal.rxpower = convertToDbm(deviceEdit.model,
                                                                ponSignal.rxpower);
        if (ponSignal.txpower) ponSignal.txpower = convertToDbm(deviceEdit.model,
                                                                ponSignal.txpower);
        ponSignal = appendPonSignal(
          deviceEdit.pon_signal_measure,
          ponSignal.rxpower,
          ponSignal.txpower,
        );
        deviceEdit.pon_signal_measure = ponSignal;
        await deviceEdit.save();
      }
      sio.anlixSendPonSignalNotification(mac, {ponsignalmeasure: ponSignal});
      return ponSignal;
    });
  });
  req.end();
};

// TODO: Move this function to external-genieacs?
const fetchDevicesFromGenie = function(mac, acsID) {
  let splitID = acsID.split('-');
  let model = splitID.slice(1, splitID.length-1).join('-');
  let fields = DevicesAPI.getModelFields(splitID[0], model).fields;
  let hostsField = fields.devices.hosts;
  let assocField = fields.devices.associated;
  assocField = assocField.split('.').slice(0, -2).join('.');
  let query = {_id: acsID};
  let projection = hostsField + ',' + assocField;
  let path = '/devices/?query='+JSON.stringify(query)+'&projection='+projection;
  let options = {
    method: 'GET',
    hostname: 'localhost',
    // hostname: '207.246.65.243',
    port: 7557,
    path: encodeURI(path),
  };
  let req = http.request(options, (resp)=>{
    resp.setEncoding('utf8');
    let data = '';
    resp.on('data', (chunk)=>data+=chunk);
    resp.on('end', async ()=>{
      data = JSON.parse(data)[0];
      let success = true;
      let hostKeys = [];
      let hostCountField = hostsField+'.HostNumberOfEntries._value';
      // Make sure we have a host count and assodicated devices fields
      if (checkForNestedKey(data, hostCountField) &&
          checkForNestedKey(data, assocField)) {
        getFromNestedKey(data, hostCountField);
        // Host indexes might not respect order because of expired leases, so
        // we just use whatever keys show up
        let hostBaseField = fields.devices.hosts_template;
        hostKeys = Object.keys(getFromNestedKey(data, hostBaseField));
        // Filter out meta fields from genieacs
        hostKeys = hostKeys.filter((k)=>k[0] && k[0]!=='_');
      } else {
        success = false;
      }
      if (success) {
        let iface2 = fields.wifi2.ssid.replace('.SSID', '');
        let iface5 = fields.wifi5.ssid.replace('.SSID', '');
        let devices = [];
        hostKeys.forEach((i)=>{
          let device = {};
          // Collect device mac
          let macKey = fields.devices.host_mac.replace('*', i);
          device.mac = getFromNestedKey(data, macKey+'._value');
          // Collect device hostname
          let nameKey = fields.devices.host_name.replace('*', i);
          device.name = getFromNestedKey(data, nameKey+'._value');
          // Collect device ip
          let ipKey = fields.devices.host_ip.replace('*', i);
          device.ip = getFromNestedKey(data, ipKey+'._value');
          // Collect layer 2 interface
          let ifaceKey = fields.devices.host_layer2.replace('*', i);
          let l2iface = getFromNestedKey(data, ifaceKey+'._value');
          if (l2iface === iface2) {
            device.wifi = true;
            device.wifi_freq = 2.4;
          } else if (l2iface === iface5) {
            device.wifi = true;
            device.wifi_freq = 5;
          }
          // Push basic device information
          devices.push(device);
        });
        // Change iface identifiers to use only numerical identifier
        iface2 = iface2.split('.');
        iface5 = iface5.split('.');
        iface2 = iface2[iface2.length-1];
        iface5 = iface5[iface5.length-1];
        // Filter wlan interfaces
        let interfaces = Object.keys(getFromNestedKey(data, assocField));
        interfaces = interfaces.filter((i)=>i[0]!='_');
        if (fields.devices.associated_5) {
          interfaces.push('5');
        }
        interfaces.forEach((iface)=>{
          // Find out how many devices are associated in this interface
          let totalField = fields.devices.assoc_total.replace('*', iface);
          let assocCount = getFromNestedKey(data, totalField+'._value');
          for (let i = 1; i < assocCount+1; i++) {
            // Collect associated mac
            let macKey = fields.devices.assoc_mac;
            macKey = macKey.replace('*', iface).replace('*', i);
            let macVal = getFromNestedKey(data, macKey+'._value').toUpperCase();
            let device = devices.find((d)=>d.mac.toUpperCase()===macVal);
            if (!device) continue;
            // Mark device as a wifi device
            device.wifi = true;
            if (iface == iface2) {
              device.wifi_freq = 2.4;
            } else if (iface == iface5) {
              device.wifi_freq = 5;
            }
            // Collect rssi, if available
            if (fields.devices.host_rssi) {
              let rssiKey = fields.devices.host_rssi;
              rssiKey = rssiKey.replace('*', iface).replace('*', i);
              device.rssi = getFromNestedKey(data, rssiKey+'._value');
            }
            // Collect snr, if available
            if (fields.devices.host_snr) {
              let snrKey = fields.devices.host_snr;
              snrKey = snrKey.replace('*', iface).replace('*', i);
              device.snr = getFromNestedKey(data, snrKey+'._value');
            }
          }
        });
        await saveDeviceData(mac, devices);
      }
      sio.anlixSendOnlineDevNotifications(mac, null);
    });
  });
  req.end();
};

acsDeviceInfoController.requestLogs = function(device) {
  // Make sure we only work with TR-069 devices with a valid ID
  if (!device || !device.use_tr069 || !device.acs_id) return;
  let mac = device._id;
  let acsID = device.acs_id;
  let splitID = acsID.split('-');
  let model = splitID.slice(1, splitID.length-1).join('-');
  let logField = DevicesAPI.getModelFields(splitID[0], model).fields.log;
  let task = {
    name: 'getParameterValues',
    parameterNames: [logField],
  };
  TasksAPI.addTask(acsID, task, true, 10000, [], (result)=>{
    if (result.task.name !== 'getParameterValues') return;
    fetchLogFromGenie(result.finished, mac, acsID);
  });
};

acsDeviceInfoController.requestWanBytes = function(device) {
  // Make sure we only work with TR-069 devices with a valid ID
  if (!device || !device.use_tr069 || !device.acs_id) return;
  let mac = device._id;
  let acsID = device.acs_id;
  let splitID = acsID.split('-');
  let model = splitID.slice(1, splitID.length-1).join('-');
  let fields = DevicesAPI.getModelFields(splitID[0], model).fields;
  let recvField = fields.wan.recv_bytes;
  let sentField = fields.wan.sent_bytes;
  let task = {
    name: 'getParameterValues',
    parameterNames: [
      recvField,
      sentField,
    ],
  };
  TasksAPI.addTask(acsID, task, true, 10000, [], (result)=>{
    if (result.task.name !== 'getParameterValues') return;
    if (result.finished) fetchWanBytesFromGenie(mac, acsID);
  });
};

acsDeviceInfoController.requestUpStatus = function(device) {
  // Make sure we only work with TR-069 devices with a valid ID
  if (!device || !device.use_tr069 || !device.acs_id) return;
  let mac = device._id;
  let acsID = device.acs_id;
  let splitID = acsID.split('-');
  let model = splitID.slice(1, splitID.length-1).join('-');
  let fields = DevicesAPI.getModelFields(splitID[0], model).fields;
  let task = {
    name: 'getParameterValues',
    parameterNames: [
      fields.common.uptime,
      fields.wan.uptime,
      fields.wan.uptime_ppp,
      fields.wan.pppoe_user,
    ],
  };
  TasksAPI.addTask(acsID, task, true, 10000, [15000, 30000], (result)=>{
    if (result.task.name !== 'getParameterValues') return;
    if (result.finished) fetchUpStatusFromGenie(mac, acsID);
  });
};

acsDeviceInfoController.requestConnectedDevices = function(device) {
  // Make sure we only work with TR-069 devices with a valid ID
  if (!device || !device.use_tr069 || !device.acs_id) return;
  let mac = device._id;
  let acsID = device.acs_id;
  let splitID = acsID.split('-');
  let model = splitID.slice(1, splitID.length-1).join('-');
  let fields = DevicesAPI.getModelFields(splitID[0], model).fields;
  let hostsField = fields.devices.hosts;
  let assocField = fields.devices.associated;
  let totalAssocField = fields.devices.assoc_total;
  let task = {
    name: 'getParameterValues',
    parameterNames: [hostsField, assocField, totalAssocField],
  };
  if (fields.devices.associated_5) {
    task.parameterNames.push(fields.devices.associated_5);
  }
  TasksAPI.addTask(acsID, task, true, 3000, [5000, 10000], (result)=>{
    if (result.task.name !== 'getParameterValues') return;
    if (result.finished) fetchDevicesFromGenie(mac, acsID);
  });
};

acsDeviceInfoController.updateInfo = async function(device, changes) {
  // Make sure we only work with TR-069 devices with a valid ID
  if (!device || !device.use_tr069 || !device.acs_id) return;
  // let mac = device._id;
  let acsID = device.acs_id;
  let splitID = acsID.split('-');
  let model = splitID.slice(1, splitID.length-1).join('-');
  let fields = DevicesAPI.getModelFields(splitID[0], model).fields;
  let hasChanges = false;
  let hasUpdatedDHCPRanges = false;
  let task = {name: 'setParameterValues', parameterValues: []};
  let ssidPrefix = await updateController.
    getSsidPrefix(device.
      isSsidPrefixEnabled);
  Object.keys(changes).forEach((masterKey)=>{
    Object.keys(changes[masterKey]).forEach((key)=>{
      if (!fields[masterKey][key]) return;
      if (key === 'channel') {
        // Special case since channel relates to 2 fields
        let channel = changes[masterKey][key];
        let auto = channel === 'auto';
        task.parameterValues.push([
          fields[masterKey]['auto'], auto, 'xsd:boolean',
        ]);
        if (!auto) {
          task.parameterValues.push([
            fields[masterKey][key], parseInt(channel), 'xsd:unsignedInt',
          ]);
        }
        hasChanges = true;
        return;
      }
      if ((key === 'router_ip' || key === 'subnet_mask') &&
          !hasUpdatedDHCPRanges) {
        // Special case for lan ip/mask since we need to update dhcp range
        let dhcpRanges = convertSubnetMaskToRange(device.lan_netmask);
        if (dhcpRanges.min && dhcpRanges.max) {
          let subnet = device.lan_subnet;
          let networkPrefix = subnet.split('.').slice(0, 3).join('.');
          let minIP = networkPrefix + '.' + dhcpRanges.min;
          let maxIP = networkPrefix + '.' + dhcpRanges.max;
          task.parameterValues.push([
            fields['lan']['lease_min_ip'], minIP, 'xsd:string',
          ]);
          task.parameterValues.push([
            fields['lan']['lease_max_ip'], maxIP, 'xsd:string',
          ]);
          hasUpdatedDHCPRanges = true; // Avoid editing this field twice
          hasChanges = true;
        }
      }
      /*
        Verify if is to append prefix right before
        of send changes to genie;
        Because device_list, app_diagnostic_api
        and here call updateInfo, and is more clean
        to check on the edge;
      */
      if (key === 'ssid') {
        if (ssidPrefix != '') {
          changes[masterKey][key] = ssidPrefix+changes[masterKey][key];
        }
      }
      let convertedValue = DevicesAPI.convertField(
        masterKey, key, splitID[0], splitID[1], changes[masterKey][key],
      );
      task.parameterValues.push([
        fields[masterKey][key], // tr-069 field name
        convertedValue.value, // value to change to
        convertedValue.type, // genieacs type
      ]);
      hasChanges = true;
    });
  });
  if (!hasChanges) return; // No need to sync data with genie
  TasksAPI.addTask(acsID, task, true, 3000, [5000, 10000], (result)=>{
    // TODO: Do something with task complete?
  });
};

acsDeviceInfoController.changePortForwardRules = async function(device, rulesDiffLength) {
  // Make sure we only work with TR-069 devices with a valid ID
  if (!device || !device.use_tr069 || !device.acs_id) return;
  let i;
  let ret;
  // let mac = device._id;
  let acsID = device.acs_id;
  let splitID = acsID.split('-');
  let model = splitID.slice(1, splitID.length-1).join('-');
  let fields = DevicesAPI.getModelFields(splitID[0], model).fields;
  let changeEntriesSizeTask = {name: 'addObject', objectName: ''};
  let updateTasks = {name: 'setParameterValues', parameterValues: []};
  let specFields = fields.port_mapping;
  // check if already exists add, delete, set sent tasks
  // getting older tasks for this device id.
  let query = {device: acsID}; // selecting all tasks for a given device id.
  let tasks = await TasksAPI.getFromCollection('tasks', query).catch((e) => {
  /* rejected value will be error object in case of connection errors.*/
    console.log('!@# -> '+e.code+
      'when getting old tasks from genieacs rest api'+
      ', for device '+acsID+'.');
    return undefined;
  });
  if (!Array.isArray(tasks)) {
    return;
  }
  /* if find some task with name addObject or deleteObject */
  let hasAlreadySentTasks = tasks.some((t) => {
    return t.name === 'addObject' ||
    t.name === 'deleteObject';
  });
  /* drop this call of changePortForwardRules
  */
  if (hasAlreadySentTasks) {
    console.log('!@# -> Dropped change port forward rules in '+acsID);
    return;
  }
  // change array size via addObject or deleteObject
  if (rulesDiffLength < 0) {
    rulesDiffLength = -rulesDiffLength;
    changeEntriesSizeTask.name = 'deleteObject';
    for (i = (device.port_mapping.length + rulesDiffLength);
        i > device.port_mapping.length;
        i--) {
      changeEntriesSizeTask.objectName = specFields.template + '.' + i;
      ret = await TasksAPI.addTask(acsID, changeEntriesSizeTask, true,
        3000, [5000, 10000]);
      if (!ret.finished) {
        return;
      }
      console.log('!@# -> Task sent to delete '+
        rulesDiffLength+
        ' port mapping entries in '+acsID);
    }
  } else {
    changeEntriesSizeTask.objectName = specFields.template;
    for (i = 0; i < rulesDiffLength; i++) {
      ret = await TasksAPI.addTask(acsID, changeEntriesSizeTask, true,
        3000, [5000, 10000]);
      if (!ret.finished) {
        return;
      }
    }
    console.log('!@# -> Task sent to add '+
      rulesDiffLength+
      ' port mapping entries in '+acsID);
  }
  // set entries values for respective array in the device
  for (i = 0; i < device.port_mapping.length; i++) {
    let iterateTemplate = specFields.template + '.' + (i+1) + '.';
    updateTasks.parameterValues.push([
      iterateTemplate
      +
      specFields.enable,
      true,
      'xsd:boolean',
    ]);
    updateTasks.parameterValues.push([
      iterateTemplate
      +
      specFields.lease,
      0,
      'xsd:unsignedInt',
    ]);
    updateTasks.parameterValues.push([
      iterateTemplate
      +
      specFields.external_port_start,
      device.port_mapping[i].external_port_start,
      'xsd:unsignedInt',
    ]);
    if (specFields.external_port_end != '') {
      updateTasks.parameterValues.push([
        iterateTemplate
        +
        specFields.external_port_end,
        device.port_mapping[i].external_port_end,
        'xsd:unsignedInt',
      ]);
    }
    updateTasks.parameterValues.push([
      iterateTemplate
      +
      specFields.internal_port_start,
      device.port_mapping[i].internal_port_start,
      'xsd:unsignedInt',
    ]);
    if (specFields.internal_port_end != '') {
      updateTasks.parameterValues.push([
        iterateTemplate
        +
        specFields.internal_port_end,
        device.port_mapping[i].internal_port_end,
        'xsd:unsignedInt',
      ]);
    }
    updateTasks.parameterValues.push([
      iterateTemplate
      +
      specFields.protocol,
      DevicesAPI.getProtocolByModel(model),
      'xsd:string',
    ]);
    updateTasks.parameterValues.push([
      iterateTemplate
      +
      specFields.client,
      device.port_mapping[i].ip,
      'xsd:string',
    ]);
    updateTasks.parameterValues.push([
      iterateTemplate
      +
      specFields.description,
      '',
      'xsd:string',
    ]);
    updateTasks.parameterValues.push([
      iterateTemplate
      +
      specFields.remote_host,
      '0.0.0.0',
      'xsd:string',
    ]);
  }
  console.log('!@# -> Task sent to update port mapping entries in '+acsID);
  TasksAPI.addTask(acsID, updateTasks,
      true, 3000, [5000, 10000]);
};

acsDeviceInfoController.checkPortForwardRules = async function(device, rulesDiffLength) {
  if (!device || !device.use_tr069 || !device.acs_id) return;
  // let mac = device._id;
  let acsID = device.acs_id;
  let splitID = acsID.split('-');
  let model = splitID.slice(1, splitID.length-1).join('-');
  let fields = DevicesAPI.getModelFields(splitID[0], model).fields;
  let task = {
    name: 'getParameterValues',
    parameterNames: [fields.port_mapping.template],
  };
  /*
    if entries sizes are not the same, no need to check
    entry by entry differences
  */
  if (rulesDiffLength != 0) {
    acsDeviceInfoController.changePortForwardRules(device,
      rulesDiffLength);
    return;
  }
  let result = await TasksAPI.addTask(acsID, task, true, 10000, []);
  if (result.finished == true && result.task.name === 'getParameterValues') {
    let query = {_id: acsID};
    let projection1 = fields.port_mapping.template.
    replace('*', '1').replace('*', '1');
    let projection2 = fields.port_mapping.template.
    replace('*', '1').replace('*', '2');
    let path = '/devices/?query=' + JSON.stringify(query) + '&projection=' +
               projection1 + ',' + projection2;
    let options = {
      method: 'GET',
      hostname: 'localhost',
      // hostname: '207.246.65.243',
      port: 7557,
      path: encodeURI(path),
    };
    let req = http.request(options, (resp) => {
      resp.setEncoding('utf8');
      let data = '';
      let i;
      resp.on('data', (chunk)=>data+=chunk);
      resp.on('end', async ()=>{
        data = JSON.parse(data)[0];
        let isDiff = false;
        let template = '';
        if (checkForNestedKey(data, projection1)) {
          template = projection1;
        } else if (checkForNestedKey(data, projection2)) {
          template = projection2;
        }
        if (template != '') {
          for (i = 0; i < device.port_mapping.length; i++) {
            let iterateTemplate = template+'.'+(i+1)+'.';
            if (checkForNestedKey(data, iterateTemplate+fields.port_mapping.enable)) {
              if (getFromNestedKey(data, iterateTemplate+fields.port_mapping.enable) != true) {
                isDiff = true;
                break;
              }
            }
            if (checkForNestedKey(data, iterateTemplate+fields.port_mapping.lease)) {
              if (getFromNestedKey(data, iterateTemplate+fields.port_mapping.lease) != 0) {
                isDiff = true;
                break;
              }
            }
            if (checkForNestedKey(data, iterateTemplate+fields.port_mapping.protocol)) {
              if (getFromNestedKey(data, iterateTemplate+fields.port_mapping.protocol) !=
               DevicesAPI.getProtocolByModel(model)) {
                isDiff = true;
                break;
              }
            }
            if (checkForNestedKey(data, iterateTemplate+fields.port_mapping.client)) {
              if (getFromNestedKey(data, iterateTemplate+fields.port_mapping.client) !=
                device.port_mapping[i].ip) {
                isDiff = true;
                break;
              }
            }
            if (checkForNestedKey(data, iterateTemplate+fields.port_mapping.external_port_start)) {
              if (getFromNestedKey(data, iterateTemplate+fields.port_mapping.external_port_start) !=
                device.port_mapping[i].external_port_start) {
                isDiff = true;
                break;
              }
            }
            if (fields.port_mapping.external_port_end != '') {
              if (checkForNestedKey(data, iterateTemplate+fields.port_mapping.external_port_end)) {
                if (getFromNestedKey(data, iterateTemplate+fields.port_mapping.external_port_end) !=
                  device.port_mapping[i].external_port_end) {
                  isDiff = true;
                  break;
                }
              }
            }
            if (checkForNestedKey(data, iterateTemplate+fields.port_mapping.internal_port_start)) {
              if (getFromNestedKey(data, iterateTemplate+fields.port_mapping.internal_port_start) !=
                device.port_mapping[i].internal_port_start) {
                isDiff = true;
                break;
              }
            }
            if (fields.port_mapping.internal_port_end != '') {
              if (checkForNestedKey(data, iterateTemplate+fields.port_mapping.internal_port_end)) {
                if (getFromNestedKey(data, iterateTemplate+fields.port_mapping.internal_port_end) !=
                  device.port_mapping[i].internal_port_end) {
                  isDiff = true;
                  break;
                }
              }
            }
          }
          if (isDiff) {
            acsDeviceInfoController.changePortForwardRules(device, 0);
          }
        } else {
          console.log('Wrong PortMapping in the device tree from genie');
        }
      });
    });
    req.end();
  }
};

acsDeviceInfoController.pingOfflineDevices = async function() {
  // Get TR-069 configs from database
  let matchedConfig = await Config.findOne(
    {is_default: true}, 'tr069',
  ).exec().catch((err) => err);
  if (matchedConfig.constructor === Error) {
    console.log('Error getting user config in database to ping offline CPEs');
    return;
  }
  // Compute offline threshold from options
  let currentTime = Date.now();
  let interval = matchedConfig.tr069.inform_interval;
  let threshold = matchedConfig.tr069.offline_threshold;
  let offlineThreshold = new Date(currentTime - (interval*threshold));
  // Query database for offline TR-069 CPE devices
  let offlineDevices = await DeviceModel.find({
    use_tr069: true,
    last_contact: {$lt: offlineThreshold},
  }, {
    acs_id: true,
  });
  // Issue a task for every offline device to try and force it to reconnect
  for (let i = 0; i < offlineDevices.length; i++) {
    let id = offlineDevices[i].acs_id;
    let splitID = id.split('-');
    let model = splitID.slice(1, splitID.length-1).join('-');
    let fields = DevicesAPI.getModelFields(splitID[0], model).fields;
    let task = {
      name: 'getParameterValues',
      parameterNames: [fields.common.uptime],
    };
    await TasksAPI.addTask(id, task, true, 50, [], null);
  }
};

acsDeviceInfoController.reportOnuDevices = async function(app, devices=null) {
  try {
    let devicesArray = null;
    if (!devices) {
      devicesArray = await DeviceModel.find({
        use_tr069: true,
        is_license_active: {$exists: false}},
      {
        serial_tr069: true,
        model: true,
        version: true,
        is_license_active: true});
    } else {
      devicesArray = devices;
    }
    if (!devicesArray || devicesArray.length == 0) {
      // Nothing to report
      return {success: false, message: 'Nenhum a reportar'};
    }
    let response = await controlApi.reportDevices(app, devicesArray);
    if (response.success) {
      for (let device of devicesArray) {
        device.is_license_active = true;
        await device.save();
      }
      if (response.noLicenses) {
        let matchedNotif = await Notification.findOne({
          'message_code': 4,
          'target': 'general'});
        if (!matchedNotif || matchedNotif.allow_duplicate) {
          let notification = new Notification({
            'message': 'Sua conta está sem licenças para CPEs TR-069 ' +
                       'sobrando. Entre em contato com seu representante ' +
                       'comercial',
            'message_code': 4,
            'severity': 'danger',
            'type': 'communication',
            'allow_duplicate': false,
            'target': 'general',
          });
          await notification.save();
        }
      } else if (response.licensesNum < 50) {
        let matchedNotif = await Notification.findOne({
          'message_code': 3,
          'target': 'general'});
        if (!matchedNotif || matchedNotif.allow_duplicate) {
          let notification = new Notification({
            'message': 'Sua conta está com apenas ' + response.licensesNum +
                       ' licenças CPE TR-069 sobrando. ' +
                       'Entre em contato com seu representante comercial',
            'message_code': 3,
            'severity': 'alert',
            'type': 'communication',
            'allow_duplicate': false,
            'target': 'general',
          });
          await notification.save();
        }
      }
    }
  } catch (err) {
    console.error('Error in license report: ' + err);
    return {success: false, message: 'Erro na requisição'};
  }
};

module.exports = acsDeviceInfoController;
