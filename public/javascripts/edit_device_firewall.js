
const selectizeOptionsMacs = {
  create: true,
  createFilter: RegExp('^([0-9A-Fa-f]{2}:){5}([0-9A-Fa-f]{2})$'),
  labelField: 'label',
  render: {
    option_create: function(data, escape) {
      return $('<div></div>').addClass('create').append(
        'Adicionar: ',
        $('<strong></strong>').html(escape(data.input))
      );
    },
    option: function(data, escape) {
      let dataVal =
        isJsonString(data.value) ? JSON.parse(data.value)[0] : data.value;
      return $('<div></div>').addClass('option').append(
        $('<span></span>').addClass('title')
        .html(escape(data.label.toUpperCase())),
        $('<span></span>').addClass('description')
        .html(escape(dataVal.toUpperCase()))
      );
    },
  },
};

const selectizeOptionsPorts = {
  create: true,
  createFilter: function(input) {
    const checkVal = function(val) {
      if (!isNaN(val)) {
        let intPort = parseInt(val);
        if (intPort >= 1 && intPort <= 65535) {
          return true;
        }
      }
      return false;
    };

    if (input.indexOf(':') == -1) {
      return checkVal(input);
    } else {
      res = input.split(':', 2);
      if (!checkVal(res[0])) {
        return false;
      }
      return checkVal(res[1]);
    }
    return false;
  },
  render: {
    option_create: function(data, escape) {
      if (data.input.indexOf(':') == -1) {
        return $('<div></div>').addClass('create').append(
          'Adicionar: ',
          $('<strong></strong>').html(escape(data.input))
        );
      } else {
        res = data.input.split(':', 2);
        return $('<div></div>').addClass('create').append(
          'Dispositivo: ',
          $('<strong></strong>').html(escape(res[0])),
          '<br>Externo: ',
          $('<strong></strong>').html(escape(res[1]))
        );
      }
    },
  },
};

const removeByKey = function(array, params) {
  array.some(function(item, index) {
    if (array[index][params.key] === params.value) {
      array.splice(index, 1);
      return true;
    }
    return false;
  });
  return array;
};

const isJsonString = function(str) {
  try {
    JSON.parse(str);
  } catch (e) {
    return false;
  }
  return true;
};

const insertOpenFirewallDoorRule = function(deviceEntry) {
  // Prepare badge list of ports
  let portListBadges = $('<td>').addClass('text-center');
  let portListBadgesIpv6 = $('<td>').addClass('text-center');
  // Check if has ipv6 open port functionality
  console.log($('#hasFirewallPortOpenIpv6').val());
  let hasPortOpenIpv6 = ($('#hasFirewallPortOpenIpv6').val() == 'true');
  $.each(deviceEntry.port, function(idx, portValue) {
    let finalValueIpv4 = portValue;
    let finalValueIpv6 = portValue;
    if (deviceEntry.router_port && Array.isArray(deviceEntry.router_port) &&
       deviceEntry.router_port.length == deviceEntry.port.length) {
      if (portValue != deviceEntry.router_port[idx]) {
        finalValueIpv4 = portValue + ':' + deviceEntry.router_port[idx];
      }
    }
    portListBadges.append(
      $('<span>').addClass('badge badge-primary mr-1').html(finalValueIpv4)
    );
    if (hasPortOpenIpv6) {
      portListBadgesIpv6.append(
        $('<span>').addClass('badge badge-primary mr-1').html(finalValueIpv6)
      );
    }
  });
  // Prepare DMZ string
  let dmzString = deviceEntry.dmz ? 'Sim':'Não';
  // Delete rule if MAC already exists
  let rulesTable = $('#openFirewallPortsRules');
  rulesTable.find('[data-device="' + deviceEntry.mac + '"]').remove();
  // Create table entries
  rulesTable.append(
    $('<tr>').append(
      $('<td>').addClass('text-left').append(
        $('<span>').css('display', 'block').append(
          $('<strong>').html(deviceEntry.label.toUpperCase())
                                .addClass('conn-device-label')
        ),
        $('<span>').css('display', 'block')
                          .html(deviceEntry.mac.toUpperCase())
      ),
      portListBadges,
      portListBadgesIpv6,
      $('<td>').addClass('text-center').html(dmzString),
      $('<td>').addClass('text-right').append(
        $('<button>').append(
          $('<div>').addClass('fas fa-times fa-lg')
        ).addClass('btn btn-sm btn-danger my-0 openFirewallPortsRemoveRule')
        .attr('type', 'button')
      )
    ).addClass('bounceIn')
    .attr('data-device', deviceEntry.mac)
  );
  // Delete rule from list if MAC already exists
  let rules = $('#openFirewallPortsFinalRules');
  let portsFinal = [];
  if (rules.val() != '') {
    portsFinal = JSON.parse(rules.val());
    portsFinal = removeByKey(portsFinal, {key: 'mac', value: deviceEntry.mac});
  }
  // Populate rules list
  let newport = {};
  newport.mac = deviceEntry.mac;
  newport.port = deviceEntry.port;
  newport.dmz = deviceEntry.dmz;
  if (deviceEntry.router_port && Array.isArray(deviceEntry.router_port) &&
       deviceEntry.router_port.length == deviceEntry.port.length &&
       deviceEntry.router_port.length > 0) {
    newport.router_port = deviceEntry.router_port;
  }

  portsFinal.push(newport);
  rules.val(JSON.stringify(portsFinal));
};

// Important: include and initialize socket.io first using socket var
socket.on('ONLINEDEVS', function(macaddr, data) {
  if (($('#open-firewall-ports').data('bs.modal') || {})._isShown) {
    let id = $('#openfirewallRouterid_label').text();
    if (id == macaddr) {
      let inputDevs = $('#openFirewallPortsMac')[0].selectize;
      // Clear old data
      inputDevs.clearOptions();
      $('.btn-syncOnlineDevs').children()
                              .removeClass('animated rotateOut infinite');
      let macoptions = [];
      $.each(data, function(idx, value) {
        let datanew = {};
        let deviceMac = value.mac;
        let deviceName = value.hostname;
        datanew.value = JSON.stringify([deviceMac, deviceName]);
        datanew.label = deviceName;
        // Populate connected devices dropdown options
        macoptions.push(datanew);
      });
      inputDevs.addOption(macoptions);
    }
  }
});

$(document).ready(function() {
  // Init selectize fields
  $('#openFirewallPortsMac').selectize(selectizeOptionsMacs);
  $('#openFirewallPortsPorts').selectize(selectizeOptionsPorts);

  $(document).on('click', '.btn-open-ports-modal', function(event) {
    let row = $(event.target).parents('tr');
    let id = row.data('deviceid');
    let hasPortForwardAsym = row.data('validate-port-forward-asym');
    let hasPortOpenIpv6 = row.data('validate-port-open-ipv6');
    $('#hasFirewallPortForwardAsym').val(hasPortForwardAsym);
    $('#hasFirewallPortOpenIpv6').val(hasPortOpenIpv6);

    $.ajax({
      type: 'GET',
      url: '/devicelist/uiportforward/' + id,
      dataType: 'json',
      success: function(res) {
        if (res.success) {
          let rulesTable = $('#openFirewallPortsRules');
          let rules = $('#openFirewallPortsFinalRules');
          rules.val('');
          rulesTable.empty();
          $.each(res.landevices, function(idx, value) {
            let deviceLabel = value.mac;
            deviceLabel = value.dhcp_name ? value.dhcp_name : deviceLabel;
            deviceLabel = value.name ? value.name : deviceLabel;
            devicePortAsym = hasPortForwardAsym ? value.router_port : null;
            insertOpenFirewallDoorRule({
              mac: value.mac, port: value.port, router_port: devicePortAsym,
              dmz: value.dmz, label: deviceLabel,
            });
          });

          $('#openfirewallRouterid_label').text(id);
          $('#open-firewall-ports').modal('show');
          $('.btn-syncOnlineDevs').trigger('click');
        } else {
          badge = $(event.target).closest('.actions-opts')
                                 .find('.badge-warning');
          if (res.message) {
            badge.text(res.message);
          }
          badge.show();
          setTimeout(function() {
            badge.hide();
          }, 1500);
        }
      },
      error: function(xhr, status, error) {
        badge = $(event.target).closest('.actions-opts')
                               .find('.badge-warning');
        if (res.message) {
          badge.text(status + ': ' + error);
        }
        badge.show();
        setTimeout(function() {
          badge.hide();
        }, 1500);
      },
    });
  });

  $('.btn-syncOnlineDevs').click(function(event) {
    let id = $('#openfirewallRouterid_label').text();
    $.ajax({
      url: '/devicelist/command/' + id + '/onlinedevs',
      type: 'post',
      dataType: 'json',
      success: function(res) {
        if (res.success) {
          $(event.target).children().addClass('animated rotateOut infinite');
        } else {
          $(event.target).title = res.message;
          $(event.target).addClass('disabled');
        }
      },
      error: function(xhr, status, error) {
        $(event.target).title = status + ': ' + error;
        $(event.target).addClass('disabled');
      },
    });
  });

  // Use this format when adding button with AJAX
  $(document).on('click', '.openFirewallPortsRemoveRule', function(event) {
    let row = $(event.target).parents('tr');
    let mac = row.data('device');

    // Delete row form table
    let rulesTable = $('#openFirewallPortsRules');
    rulesTable.find('[data-device="' + mac + '"]').remove();
    // Remove rule
    let rules = $('#openFirewallPortsFinalRules');
    let portsFinal = [];
    if (rules.val() != '') {
      portsFinal = JSON.parse(rules.val());
      portsFinal = removeByKey(portsFinal, {key: 'mac', value: mac});
      rules.val(JSON.stringify(portsFinal));
    }
  });

  $('.btn-openFirewallPortsSaveRule').click(function(event) {
    let hasPortForwardAsym = ($('#hasFirewallPortForwardAsym').val() == 'true');

    let deviceId = $('#openFirewallPortsMac')[0].selectize.getValue();
    let ports = $('#openFirewallPortsPorts')[0].selectize.getValue();
    let dmz = $('#openFirewallPortsDMZ').is(':checked');
    if (deviceId == '') {
      swal({
        title: 'Falha na inclução da regra',
        text: 'O dispositivo deve ser informado!',
        type: 'error',
        confirmButtonColor: '#4db6ac',
      });
      return;
    }
    if (ports == '') {
      swal({
        title: 'Falha na inclução da regra',
        text: 'Informe, no mínimo, uma porta para liberar acesso!',
        type: 'error',
        confirmButtonColor: '#4db6ac',
      });
      return;
    }

    let asymusage = false;
    $.each(ports, function(idx, portValue) {
      if (!hasPortForwardAsym && portValue.indexOf(':') != -1) {
        swal({
          title: 'Falha na inclução da regra',
          text: 'Roteador não aceita portas assimétricas! Atualize o Roteador.',
          type: 'error',
          confirmButtonColor: '#4db6ac',
        });
        asymusage = true;
      }
    });
    if (asymusage) {
      return;
    }

    // Check for ports already in use
    let reservedPorts = [36022];
    let hasPortInUse = false;
    let rules = $('#openFirewallPortsFinalRules');
    if (rules.val() != '') {
      let rulesJson = JSON.parse(rules.val());
      $.each(rulesJson, function(idx, ruleEntry) {
        let portsArray = [];
        if (ruleEntry.hasOwnProperty('router_port') && ruleEntry.router_port) {
          portsArray = ruleEntry.router_port;
        } else {
          portsArray = ruleEntry.port;
        }
        $.each(portsArray, function(idx, portsEntry) {
          reservedPorts.push(parseInt(portsEntry));
        });
      });
    }

    let intPorts = [];
    let portsFinal = [];
    let asymPortsFinal = [];
    $.each(ports, function(idx, portValue) {
      let portFinal = 0;
      let intPort = 0;
      if (portValue.indexOf(':') == -1) {
        portFinal = portValue;
        intPort = portValue;
        portsFinal = portsFinal.concat(parseInt(portValue));
        asymPortsFinal = asymPortsFinal.concat(parseInt(portValue));
      } else {
        res = portValue.split(':', 2);
        intPort = res[0];
        portFinal = res[1];
        portsFinal = portsFinal.concat(parseInt(intPort));
        asymPortsFinal = asymPortsFinal.concat(parseInt(portFinal));
      }

      if (reservedPorts.indexOf(parseInt(portFinal)) != -1) {
        swal({
          title: 'Falha na inclução da regra',
          text: 'Porta Externa já utilizada!',
          type: 'error',
          confirmButtonColor: '#4db6ac',
        });
        hasPortInUse = true;
      }
      reservedPorts = reservedPorts.concat(parseInt(portFinal));

      if (intPorts.indexOf(parseInt(intPort)) != -1) {
        swal({
          title: 'Falha na inclução da regra',
          text: 'Porta Interna já utilizada!',
          type: 'error',
          confirmButtonColor: '#4db6ac',
        });
        hasPortInUse = true;
      }
      intPorts = intPorts.concat(parseInt(intPort));
    });
    if (hasPortInUse) {
      return;
    }
    // Check if id has only a MAC or contains also a device name
    let deviceMac;
    let deviceLabel;
    if (isJsonString(deviceId)) {
      deviceMac = JSON.parse(deviceId)[0];
      deviceLabel = JSON.parse(deviceId)[1];
    } else {
      deviceMac = deviceId;
      deviceLabel = deviceId;
    }
    asymPortsValue = hasPortForwardAsym ? asymPortsFinal : null;
    insertOpenFirewallDoorRule({
      mac: deviceMac, port: portsFinal, router_port: asymPortsValue,
      dmz: dmz, label: deviceLabel,
    });
  });

  $('.btn-openFirewallPortsSubmit').click(function(event) {
    let id = $('#openfirewallRouterid_label').text();
    $.ajax({
      type: 'POST',
      url: '/devicelist/uiportforward/' + id,
      dataType: 'json',
      data: JSON.stringify({
        'content': $('#openFirewallPortsFinalRules').val(),
      }),
      contentType: 'application/json',
      success: function(res) {
        if (res.success) {
          swal({
            title: 'Sucesso! Reinicie o dispositivo alterado',
            type: 'success',
            confirmButtonColor: '#4db6ac',
          });
        } else {
          swal({
            title: 'Falha ao aplicar regras',
            text: res.message,
            type: 'error',
            confirmButtonColor: '#4db6ac',
          });
        }
      },
      error: function(xhr, status, error) {
        swal({
          title: 'Falha ao aplicar regras',
          text: error,
          type: 'error',
          confirmButtonColor: '#4db6ac',
        });
      },
    });
  });
});
