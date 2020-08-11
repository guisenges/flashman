const async = require('asyncawait/async');
const await = require('asyncawait/await');
const request = require('request-promise-native');
const mqtt = require('../mqtts');
const util = require('./handlers/util');

const DeviceModel = require('../models/device');
const ConfigModel = require('../models/config');

let dataCollectingController = {};


const checkReqField = (req, fieldname, validityFunc) => {
  if (!req.body.hasOwnProperty(fieldname))
    return ''+fieldname+' inexistente.'
  if (!validityFunc(req.body[fieldname]))
    return ''+fieldname+' inválido.'
}
const checkDataColllectingFqdn = req => checkReqField(req, 'data_collecting_fqdn', util.isFqdnValid);
const checkMac = req => checkReqField(req, 'mac', util.isMacValid);
const checkDevices = req => {
  if (!req.body.hasOwnProperty(fieldname))
    return 'devices inexistente.'
  let devices = req.body.devices
  let invalidDevices = {}
  for (let mac in devices) {
    devices[mac] = mac.toUpperCase() // transform to uppercase
    if (!util.isMacValid(mac))
      invalidDevices[mac] = "invalid mac address"
    else if (devices[mac].constructor !== Boolean)
      invalidDevices[mac] = "not boolean value"
  }
  if (Object.keys(invalidDevices).length > 0)
    return {invalidDevices: invalidDevices}
}

// This should check request json and company secret validity (API only)
const checkBodyAndSecret = function(req) {
  if (!util.isJSONObject(req.body))
    return [400, 'Erro no JSON recebido']
  if (!req.body.hasOwnProperty('secret'))
    return [403, 'Não foi fornecido um secret para autenticação']
  if (req.body.secret !== req.app.locals.secret)
    return [403, 'O secret fornecido não está correto']
  return [200, ''];
};


const handleErrors = function(req, extraHandlersArray) {
  let [errorCode, errorObj] = checkBodyAndSecret(req);
  if (errorCode !== 200) {
    res.status(errorCode).json({ message: errorObj });
    return false // found a problem with request.
  }
  if (extraHandlersArray !== undefined 
    && extraHandlersArray.constructor === Array 
    && extraHandlersArray.length > 0) {
    return executeCustomRequestChecks(req, extraHandlersArray)
  }
  return true // no problems found.
};

const executeCustomRequestChecks = function(req, extraHandlersArray) {
  let errors = [] // accumulating all errors in request, except the ones found in checkBodyAndSecret().
  for (let i = 0; i < extraHandlersArray.length; i++) {
    let error = extraHandlersArray[i](req)
    if (error !== undefined) errors.push(error)
  }
  if (errors.length > 0) {
    req.status(400).json({message: errors}) // sending errors.
    return false // found at least one problem with request.
  }
  return true // no problems found.
}

// dataCollectingController.activateDevices = async(function(req, res) {
//   const customHandler = async(function(req) {
//     let content = req.body;
//     if (!content.hasOwnProperty('device_list') ||
//         !isArrayObject(content.device_list) ||
//         content.device_list.length < 1) {
//       return [500, 'Não foi fornecida uma lista de dispositivos'];
//     }
//     return content.device_list.reduce((status, device) => {
//       if (status[0] != 200) return status;
//       let mac = returnStrOrEmptyStr(device.mac).toUpperCase();
//       if (!mac) {
//         return [500, 'Um elemento da lista não forneceu endereço MAC'];
//       }
//       if (!mac.match(macRegex)) {
//         return [500, 'Um endereço MAC fornecido não é válido'];
//       }
//       try {
//         let device = await(DeviceModel.findById(mac));
//         if (!device) {
//           return [500, 'Um endereço MAC fornecido não está cadastrado'];
//         }
//       } catch (err) {
//         console.log(err);
//         return [500, 'Erro interno ao consultar o banco de dados'];
//       }
//       return status;
//     }, [200, '']);
//   });

//   // Handle request errors
//   let [errorCode, errorMsg] = await(!handleErrors(req, customHandler));
//   if (errorCode !== 200 && errorMsg !== '') {
//     return res.status(errorCode).json({
//       message: errorMsg,
//     });
//   }

//   // For each device, send MQTT message
//   let deviceList = req.body.device_list;
//   try {
//     deviceList.forEach((dev)=>{
//       let mac = dev.mac.toUpperCase();
//       let device = await(DeviceModel.findById(mac));
//       device.measure_config.is_active = true;
//       await(device.save());
//       mqtt.anlixMessageRouterMeasure(mac.toUpperCase(), 'on');
//     });
//     return res.status(200).end();
//   } catch (err) {
//     console.log(err);
//     return res.status(500).json({
//       message: 'Erro interno ao consultar o banco de dados',
//     });
//   }
// });

// dataCollectingController.deactivateDevices = async(function(req, res) {
//   const customHandler = async(function(req) {
//     let content = req.body;
//     if (!content.hasOwnProperty('mac_list') ||
//         !isArrayObject(content.mac_list) ||
//         content.mac_list.length < 1) {
//       return [500, 'Não foi fornecida uma lista de dispositivos'];
//     }
//     return content.mac_list.reduce((status, mac)=>{
//       if (status[0] != 200) return status;
//       if (!mac.match(macRegex)) {
//         return [500, 'Um endereço MAC fornecido não é válido'];
//       }
//       try {
//         let device = await(DeviceModel.findById(mac.toUpperCase()));
//         if (!device) {
//           return [500, 'Um endereço MAC fornecido não está cadastrado'];
//         }
//       } catch (err) {
//         console.log(err);
//         return [500, 'Erro interno ao consultar o banco de dados'];
//       }
//       return [200, ''];
//     }, [200, '']);
//   });

//   // Handle request errors
//   let [errorCode, errorMsg] = await(!handleErrors(req, customHandler));
//   if (errorCode !== 200 && errorMsg !== '') {
//     return res.status(errorCode).json({
//       message: errorMsg,
//     });
//   }

//   // For each device, update config and send MQTT message
//   let macList = req.body.mac_list;
//   try {
//     macList.forEach((mac)=>{
//       let device = await(DeviceModel.findById(mac.toUpperCase()));
//       device.measure_config.is_active = false;
//       await(device.save());
//       mqtt.anlixMessageRouterMeasure(mac.toUpperCase(), 'off');
//     });
//     return res.status(200).end();
//   } catch (err) {
//     console.log(err);
//     return res.status(500).json({
//       message: 'Erro interno ao consultar o banco de dados',
//     });
//   }
// });

// dataCollectingController.updateLicenseStatus = async(function(req, res) {
//   const customHandler = async(function(req) {
//     let content = req.body;
//     if (!content.hasOwnProperty('status')) {
//       return [500, 'Não foi fornecido um valor de status para a licença'];
//     }
//     return [200, ''];
//   });

//   // Handle request errors
//   let [errorCode, errorMsg] = await(!handleErrors(req, customHandler));
//   if (errorCode !== 200 && errorMsg !== '') {
//     return res.status(errorCode).json({
//       message: errorMsg,
//     });
//   }

//   // Save new license status in config
//   let status = req.body.status;
//   try {
//     let config = await(ConfigModel.findOne({is_default: true}));
//     if (!config) throw new {};
//     config.measure_configs.is_license_active = status;
//     await(config.save());
//     return res.status(200).end();
//   } catch (err) {
//     console.log(err);
//     return res.status(500).json({
//       message: 'Erro acessando o banco de dados',
//     });
//   }
// });

// dataCollectingController.pingLicenseStatus = async(function() {
//   try {
//     let config = await(ConfigModel.findOne({is_default: true}));
//     if (!config || !config.measure_configs.is_active) return;
//     let controllerUrl = 'https://';
//     controllerUrl += config.measure_configs.controller_fqdn;
//     controllerUrl += '/license/status';
//     let body = await(request({
//       url: controllerUrl,
//       method: 'POST',
//       json: {
//         'secret': process.env.FLM_COMPANY_SECRET,
//       },
//     }));
//     config.measure_configs.is_license_active = body.is_active;
//     await(config.save());
//   } catch (err) {
//     console.log('Failed to update license status');
//     console.log(err);
//   }
// });

// const customHandler = async(function(req) {
//   let content = req.body;
//   if (!content.hasOwnProperty('status')) {
//     return [500, 'Não foi fornecido um valor de status para a licença'];
//   }
//   return [200, ''];
// });

dataCollectingController.updateDataCollectingServerFqdn = async(function(req, res) {
  let checks = [checkDataColllectingFqdn]
  if (!handleErrors(checks)) return

  // Set license to true and set data collecting fqdn.
  ConfigModel.updateOne({is_default: true}, {
    '$set': {
      'data_collecting_configs.is_license_active': true, // unused.
      'data_collecting_configs.is_active': true, // unused.
      'data_collecting_configs.fqdn': req.body.data_collecting_fqdn, 
    }
  }, err => {
    if (err)
      return res.status(500).json({
        message: 'Erro acessando o banco de dados',
      })
    return res.status(200).end();
  })
});

// request body expects an object where keys are MACs and values are booleans.
dataCollectingController.setLicenses = async(function(req, res) {
  let checks = [checkDevices]
  if (!handleErrors(checks)) return

  let devices = req.body.devices
  let macs = Object.keys(devices)

  // if request had no devices.
  if (macs.length === 0)
    return res.status(400).json({message: 'Nenhum dispositivo.'})

  // check if devices exist in flashman.
  let existingDevices = {}
  await(DeviceModel.find({_id: {$in: macs}}, {_id: 1}, (docs, err) => {
    if (err)
      return res.status(500).json({message: "Erro ao acessar os dispotivos localmente."})

    // only existing devices will have returned.
    for (let i = 0; i < docs.length; i ++) 
      existingDevices[docs[i]._id] = devices[docs[i]._id]
  }))

  // saving unknown devices to return them with an error message later.
  let unknownDevices = []
  for (let mac in devices)
    if (existingDevices[mac] === undefined)
      unknownDevices.push(mac)

  if (Object.keys(existingDevices).length > 0) { // if there is at least one device.
    // send devices to license-control
    let licenseControlBody = {}
    try {
      licenseControlBody = await(request({
        url: "https://"+process.env.LC_FQDN+"/data_collecting/license/set",
        method: 'POST',
        json: {
          'devices': existingDevices,
          'secret': process.env.FLM_COMPANY_SECRET,
        },
      }));
    } catch (err) {
      return res.status(500).json({message: "Erro ao conectar ao controle de licensas."})
    }

    if (licenseControlBody.message !== undefined)
      return res.status(500).json(licenseControlBody)

    // separate devices by license state and send MQTT messages.
    let enabledDevices = []
    let disabledDevices = []
    for (let mac in licenseControlBody.devices) {
      if (licenseControlBody.devices[mac] === true) {
        enabledDevices.push(mac)
        mqtt.anlixMessageRouterDataCollecting(mac, 'on');
      } else if (licenseControlBody.devices[mac] === false) {
        disabledDevices.push(mac)
        mqtt.anlixMessageRouterDataCollecting(mac, 'off');
      }
    }

    let objs = [
      {macs: enabledDevices, val: true}, 
      {macs: disabledDevices, val: false}
    ]
    for (let i = 0; i < objs.length; i++) {
      // update locally for enabled devices and then disabled devices.
      await(DeviceModel.update({_id: {$in: objs.macs}}, {
        '$set': {'data_collecting_config.is_active': objs.val}
      }, err => {
        if (err) res.status(500).json({message: 'error ao atualizar licensas no flashman.'})
      }))
    }
  }

  // complement with unknown devices.
  if (unknownDevices.length > 0)
    for (let i = 0; i < unknownDevices.length; i ++)
      licenseControlBody[unknownDevices[i]] = 'inexistente no flashman.'

  res.json(licenseControlBody) // devices with problems in license-control will also be returned here.
});

module.exports = dataCollectingController;
