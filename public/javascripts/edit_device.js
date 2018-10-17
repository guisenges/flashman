
let renderEditErrors = function(errors) {
  for (let key in errors) {
    if (errors[key].messages.length > 0) {
      let message = '';
      errors[key].messages.forEach(function(msg) {
        message += msg + ' ';
      });
      $(errors[key].field).closest('.input-entry').find('.invalid-feedback').html(message);
      $(errors[key].field)[0].setCustomValidity(message);
    }
  }
};

let socket = io();
socket.on('LIVELOG', function(macaddr, data) {
  if (($('#analyse-logs').data('bs.modal') || {})._isShown) {
    let id = $('#logRouterid_label').text();
    if (id == macaddr) {
      let textarea = $('#logArea');
      if (textarea.text() == 'Aguardando resposta do roteador...') {
        let usrtypes = ['user', 'daemon', 'kern', 'local1', 'authpriv'];
        textarea.html('<code>' + pako.ungzip(data, {to: 'string'}) + '</code>');
        textarea.highlight(
          usrtypes.map(function(x) {
            return x + '.warn';
          }),
          {element: 'strong', className: 'text-warning'}
        );
        textarea.highlight(
          usrtypes.map(function(x) {
            return x + '.err';
          }),
          {element: 'strong', className: 'text-danger'}
        );
        textarea.highlight(
          usrtypes.map(function(x) {
            return x+'.debug';
          }),
          {element: 'strong', className: 'text-info'}
        );
      }
    }
  }
});

const selectizeOptionsMacs = {
  create: true,
  valueField: 'value',
  labelField: 'label',
  render: {
    option_create: function(data, escape) {
      return '<div class="create">Novo MAC: <strong>' + escape(data.input) + '</strong>&hellip;</div>';
    },
  },
};
const selectizeOptionsPorts = {
  create: true,
  valueField: 'value',
  labelField: 'label',
  render: {
    option_create: function(data, escape) {
      return '<div class="create">Nova Porta: <strong>' + escape(data.input) + '</strong>&hellip;</div>';
    },
  },
};

let insertOpenFirewallDoorRule = function(value) {
  let ulr = $('#openFirewallPortsRules');
  let rules = $('#openFirewallPortsFinalRules');

  let textinfo='<span>'+value.mac+'</span>';
  let butdel='<span class="pull-right button-group">'
    +'<a class="badge teal lighten-2 openFirewallPortsRemoveRule"'
    +'<span>del</span></a></span>';
  ulr.append('<li class="list-group-item d-flex'
    +' justify-content-between">'+textinfo
    +butdel+'</li>');

  portsFinal=[];
  if (rules.val()!='') {
    portsFinal=JSON.parse(rules.val());
  }

  newport={};
  newport.mac=value.mac;
  newport.port=value.port;
  newport.dmz=value.dmz;
  portsFinal.push(newport);
  rules.val(JSON.stringify(portsFinal));
  console.log(portsFinal);
  console.log(rules.val());
};

socket.on('ONLINEDEV', function(macaddr, data) {
  if (($('#open-firewall-ports').data('bs.modal') || {})._isShown) {
    let id = $('#openfirewallRouterid_label').text();
    if (id == macaddr) {
      let buttonRefresh = $('#btnAnimSyncOnlineDevs');
      let inputDevs = $('#openFirewallPortsMac')[0].selectize;
      buttonRefresh.removeClass('animated rotateOut infinite');
      macoptions=[];
      $.each(data.Devices, function(key, value) {
        datanew={};
        datanew.value=key;
        datanew.label=key;
        macoptions.push(datanew);
      });
      inputDevs.addOption(macoptions);
    }
  }
});

let printLogData = function(url) {
  let textarea = $('#logArea');
  let id = $('#logRouterid_label').text();
  let usrtypes = ['user', 'daemon', 'kern', 'local1', 'authpriv'];
  $.ajax({
    url: url + id,
    type: 'get',
    success: function(res, status, xhr) {
      let ct = xhr.getResponseHeader('content-type') || '';
      if (ct.indexOf('json') > -1) {
        textarea.html('ERRO: ' + res.message);
      } else {
        textarea.html('<code>' + res + '</code>');
        textarea.highlight(
          usrtypes.map(function(x) {
            return x + '.warn';
          }),
          {element: 'strong', className: 'text-warning'}
        );
        textarea.highlight(
          usrtypes.map(function(x) {
            return x + '.err';
          }),
          {element: 'strong', className: 'text-danger'}
        );
        textarea.highlight(
          usrtypes.map(function(x) {
            return x + '.debug';
          }),
          {element: 'strong', className: 'text-info'}
        );
      }
    },
    error: function(xhr, status, error) {
      textarea.html(status + ' ' + error);
    },
  });
};

let validateEditDevice = function(event) {
  $('.form-control').blur(); // Remove focus from form
  $('.edit-form input').each(function() {
    // Reset validation messages
    this.setCustomValidity('');
  });
  let validator = new Validator();

  let row = $(event.target).parents('tr');
  let index = row.data('index');

  // Get form values
  let mac = row.data('deviceid');
  let validateWifi = row.data('validateWifi');
  let validatePppoe = row.data('validatePppoe');
  let pppoe = $('#edit_connect_type-' + index.toString()).val() === 'PPPoE';
  let pppoeUser = $('#edit_pppoe_user-' + index.toString()).val();
  let pppoePassword = $('#edit_pppoe_pass-' + index.toString()).val();
  let pppoePassLength = row.data('minlengthPassPppoe');
  let ssid = $('#edit_wifi_ssid-' + index.toString()).val();
  let password = $('#edit_wifi_pass-' + index.toString()).val();
  let channel = $('#edit_wifi_channel-' + index.toString()).val();
  let externalReferenceType = $('#edit_ext_ref_type_selected-' +
                                index.toString()).html();
  let externalReferenceData = $('#edit_external_reference-' +
                                index.toString()).val();

  // Initialize error structure
  let errors = {
    pppoe_user: {field: '#edit_pppoe_user-' + index.toString()},
    pppoe_password: {field: '#edit_pppoe_pass-' + index.toString()},
    ssid: {field: '#edit_wifi_ssid-' + index.toString()},
    password: {field: '#edit_wifi_pass-' + index.toString()},
    channel: {field: '#edit_wifi_channel-' + index.toString()},
  };
  for (let key in errors) {
    if (Object.prototype.hasOwnProperty.call(errors, key)) {
      errors[key]['messages'] = [];
    }
  }

  let genericValidate = function(value, func, errors, minlength) {
    let validField = func(value, minlength);
    if (!validField.valid) {
      errors.messages = validField.err;
    }
  };

  // Validate fields
  if (pppoe && validatePppoe) {
    genericValidate(pppoeUser, validator.validateUser, errors.pppoe_user);
    genericValidate(pppoePassword, validator.validatePassword,
                    errors.pppoe_password, pppoePassLength);
  }
  if (validateWifi) {
    genericValidate(ssid, validator.validateSSID, errors.ssid);
    genericValidate(password, validator.validateWifiPassword, errors.password);
    genericValidate(channel, validator.validateChannel, errors.channel);
  }

  let hasNoErrors = function(key) {
    return errors[key].messages.length < 1;
  };

  if (Object.keys(errors).every(hasNoErrors)) {
    // If no errors present, send to backend
    let data = {'content': {
      'connection_type': (pppoe) ? 'pppoe' : 'dhcp',
      'external_reference': {
        kind: externalReferenceType,
        data: externalReferenceData,
      },
    }};
    if (validatePppoe) {
      data.content['pppoe_user'] = (pppoe) ? pppoeUser : '';
      data.content['pppoe_password'] = (pppoe) ? pppoePassword : '';
    }
    if (validateWifi) {
      data.content['wifi_ssid'] = ssid;
      data.content['wifi_password'] = password;
      data.content['wifi_channel'] = channel;
    }

    $.ajax({
      type: 'POST',
      url: '/devicelist/update/' + mac,
      dataType: 'json',
      data: JSON.stringify(data),
      contentType: 'application/json',
      success: function(resp) {
        location.reload();
      },
      error: function(xhr, status, error) {
        let resp = JSON.parse(xhr.responseText);
        if ('errors' in resp) {
          let keyToError = {
            pppoe_user: errors.pppoe_user,
            pppoe_password: errors.pppoe_password,
            ssid: errors.ssid,
            password: errors.password,
            channel: errors.channel,
          };
          resp.errors.forEach(function(pair) {
            let key = Object.keys(pair)[0];
            keyToError[key].messages.push(pair[key]);
          });
          renderEditErrors(errors);
        }
      },
    });
  } else {
    // Else, render errors on form
    renderEditErrors(errors);
  }
  return false;
};

$(document).ready(function() {
  $('.edit-form').submit(validateEditDevice);

  $('.btn-reboot').click(function(event) {
    let row = $(event.target).parents('tr');
    let id = row.data('deviceid');
    $.ajax({
      url: '/devicelist/command/' + id + '/boot',
      type: 'post',
      success: function(res) {
        let badge;
        if (res.success) {
          badge = $(event.target).closest('.actions-opts')
                                     .find('.badge-success');
        } else {
          badge = $(event.target).closest('.actions-opts')
                                     .find('.badge-warning');
          if (res.message) {
            badge.text(res.message);
          }
        }

        badge.show();
        setTimeout(function() {
          badge.hide();
        }, 1500);
      },
      error: function(xhr, status, error) {
        let badge = $(event.target).closest('.actions-opts')
                                   .find('.badge-warning');
        badge.text(status);
        badge.show();
        setTimeout(function() {
          badge.hide();
        }, 1500);
      },
    });
  });

  $('.btn-reset-app').click(function(event) {
    let row = $(event.target).parents('tr');
    let id = row.data('deviceid');
    $.ajax({
      url: '/devicelist/command/' + id + '/rstapp',
      type: 'post',
      dataType: 'json',
      success: function(res) {
        let badge;
        if (res.success) {
          badge = $(event.target).closest('.actions-opts')
                                     .find('.badge-success');
        } else {
          badge = $(event.target).closest('.actions-opts')
                                     .find('.badge-warning');
          if (res.message) {
            badge.text(res.message);
          }
        }

        badge.show();
        setTimeout(function() {
          badge.hide();
        }, 1500);
      },
      error: function(xhr, status, error) {
        let badge = $(event.target).closest('.actions-opts')
                                   .find('.badge-warning');
        badge.text(status);
        badge.show();
        setTimeout(function() {
          badge.hide();
        }, 1500);
      },
    });
  });

  $('.btn-trash').click(function(event) {
    let row = $(event.target).parents('tr');
    let id = row.data('deviceid');
    $.ajax({
      url: '/devicelist/delete/' + id,
      type: 'post',
      success: function(res) {
        setTimeout(function() {
          window.location.reload();
        }, 100);
      },
    });
  });

  $('.toggle-pass').click(function(event) {
    let inputField = $(event.target).closest('.input-group').find('input');
    if (inputField.attr('type') == 'text') {
      inputField.attr('type', 'password');
      $(this).children().removeClass('fa-eye').addClass('fa-eye-slash');
    } else {
      inputField.attr('type', 'text');
      $(this).children().removeClass('fa-eye-slash').addClass('fa-eye');
    }
  });

  $('.btn-reset-blocked').click(function(event) {
    let row = $(event.target).parents('tr');
    let id = row.data('deviceid');
    $.ajax({
      url: '/devicelist/command/' + id + '/rstdevices',
      type: 'post',
      dataType: 'json',
      success: function(res) {
        let badge;
        if (res.success) {
          badge = $(event.target).closest('.actions-opts')
                                     .find('.badge-success');
        } else {
          badge = $(event.target).closest('.actions-opts')
                                     .find('.badge-warning');
          if (res.message) {
            badge.text(res.message);
          }
        }

        badge.show();
        setTimeout(function() {
          badge.hide();
        }, 1500);
      },
      error: function(xhr, status, error) {
        let badge = $(event.target).closest('.actions-opts')
                                   .find('.badge-warning');
        badge.text(status);
        badge.show();
        setTimeout(function() {
          badge.hide();
        }, 1500);
      },
    });
  });

  $('.btn-log-modal').click(function(event) {
    let row = $(event.target).parents('tr');
    let id = row.data('deviceid');

    $('#logRouterid_label').text(id);
    $('#analyse-logs').modal('show');
  });

  $('.btn-openFirewallPorts-modal').click(function(event) {
    let row = $(event.target).parents('tr');
    let id = row.data('deviceid');

    $.ajax({
      url: '/devicelist/portforward/' + id,
      type: 'get',
      dataType: 'json',
      success: function(res) {
        if (res.success) {
          let ulr = $('#openFirewallPortsRules');
          let rules = $('#openFirewallPortsFinalRules');
          let hasChanged = $('#openFirewallPortsFinalRulesChanged');
          hasChanged.text='false';
          rules.val('');
          console.log(res.Devices);
          ulr.empty();
          $.each(res.Devices, function(idx, value) {
            insertOpenFirewallDoorRule(value);
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
          badge.text(status+': '+error);
        }
        badge.show();
        setTimeout(function() {
          badge.hide();
        }, 1500);
      },
    });
  });

  $('.btn-syncOnlineDevs').click(function(event) {
    let buttonRefresh = $('#btnAnimSyncOnlineDevs');
    let id = $('#openfirewallRouterid_label').text();
    $.ajax({
      url: '/devicelist/command/' + id + '/onlinedevs',
      type: 'post',
      dataType: 'json',
      success: function(res) {
        if (res.success) {
          buttonRefresh.addClass('animated rotateOut infinite');
        } else {
          event.target.title=res.message;
          buttonRefresh.addClass('text-danger');
        }
      },
      error: function(xhr, status, error) {
        event.target.title=status+': '+error;
        buttonRefresh.addClass('text-danger');
      },
    });
  });

  $('#openFirewallPortsRules').on('click', 'a', function(event) {
    // Delete rule
    console.log('FIRED!');
    console.log($(this).index());
  });

  $('.btn-openFirewallPortsSaveRule').click(function(event) {
    let mac=$('#openFirewallPortsMac').val();
    let ports=$('#openFirewallPortsPorts').val();
    let dmz=$('#openFirewallPortsDMZ').val();
    if (mac=='') {
      swal({
        title: 'Falha na Inclução da Regra',
        text: 'Endereço MAC deve ser informado!',
        type: 'error',
        confirmButtonColor: '#4db6ac',
      });
      return;
    }
    if (ports=='') {
      swal({
        title: 'Falha na Inclução da Regra',
        text: 'Informe, no mínimo, uma porta para liberar acesso!',
        type: 'error',
        confirmButtonColor: '#4db6ac',
      });
      return;
    }

    insertOpenFirewallDoorRule({
      mac: mac,
      port: ports,
      dmz: dmz,
    });
  });

  $('.btn-log-live').click(function(event) {
    let textarea = $('#logArea');
    let id = $('#logRouterid_label').text();
    $.ajax({
      url: '/devicelist/command/' + id + '/log',
      type: 'post',
      dataType: 'json',
      success: function(res) {
        if (res.success) {
          textarea.html('Aguardando resposta do roteador...');
        } else {
          textarea.html(res.message);
        }
      },
      error: function(xhr, status, error) {
        textarea.html(status+': '+error);
      },
    });
  });

  $('.btn-log-upgrade').click(function(event) {
    printLogData('/devicelist/uifirstlog/');
  });

  $('.btn-log-init').click(function(event) {
    printLogData('/devicelist/uilastlog/');
  });
});
