$(document).ready(function() {
  let ponSignalRXId = '';
  let ponSignalTXId = '';

  const refreshPonSignal = function(deviceId) {
    $('#btn-pon-signal-refresh').prop('disabled', true);
    $.ajax({
      url: '/devicelist/command/' + deviceId + '/upstatus',
      type: 'post',
      dataType: 'json',
      success: function(res) {
        if (res.success) {
          $('#btn-pon-signal-refresh > i').addClass('animated rotateOut infinite');
          if ($('#pon-signal-graphs').is(':hidden')) {
            $('#pon-signal-placeholder-ready').hide();
            $('#pon-signal-placeholder-progress').show();
            $('#pon-signal-placeholder-none').hide();
          }
        } else {
          $('#btn-pon-signal-refresh').prop('disabled', false);
          if ($('#pon-signal-graphs').is(':hidden')) {
            $('#pon-signal-placeholder-ready').show();
            $('#pon-signal-placeholder-progress').hide();
            $('#pon-signal-placeholder-none').hide();
          }
        }
      },
      error: function(xhr, status, error) {
        $('#btn-pon-signal-refresh').prop('disabled', false);
        if ($('#pon-signal-graphs').is(':hidden')) {
          $('#pon-signal-placeholder-ready').show();
          $('#pon-signal-placeholder-progress').hide();
          $('#pon-signal-placeholder-none').hide();
        }
      },
    });
  };

  // Important: include and initialize socket.io first using socket var
  socket.on('PONSIGNAL', function(macaddr, data) {
    if (data.pon_signal_measure && macaddr === $('#pon-signal-hlabel').text()) {
      $('#pon-signal-graph').empty();
      let rxMeasure = [];
      let txMeasure = Object.keys(data.pon_signal_measure).map(function(time) {
        let epochInUs = Number(time) * 1000;
        // Also create upBytes array
        rxMeasure.push([epochInUs, data.pon_signal_measure[time][1]]);
        // Downstream
        return [epochInUs, data.pon_signal_measure[time][0]];
      });
      let rxOptions = {
        chart: {id: 'downChart', type: 'line', toolbar: false,
                animations: {enabled: false}},
        tooltip: {x: {format: 'HH:mm'}},
        theme: {palette: 'palette4'},
        title: {text: 'Download', align: 'center'},
        series: [{name: 'Download', data: rxMeasure}],
        xaxis: {type: 'datetime', labels: {datetimeUTC: false}},
      };
      let txOptions = {
        chart: {id: 'upChart', type: 'line', toolbar: false,
                animations: {enabled: false}},
        tooltip: {x: {format: 'HH:mm'}},
        theme: {palette: 'palette5'},
        title: {text: 'Upload', align: 'center'},
        series: [{name: 'Upload', data: txMeasure}],
        xaxis: {type: 'datetime', labels: {datetimeUTC: false}},
      };
      if (ponSignalRXId === '') {
        let chartDownObj = new ApexCharts(
          document.querySelector('#pon-signal-down-graph'),
          rxOptions,
        );
        ponSignalRXId = rxOptions.chart.id;
        chartDownObj.render();
      } else {
        ApexCharts.exec(ponSignalRXId, 'updateOptions', rxOptions, false, true);
      }
      if (ponSignalTXId === '') {
        let chartTXObj = new ApexCharts(
          document.querySelector('#pon-signal-up-graph'),
          txOptions,
        );
        ponSignalTXId = txOptions.chart.id;
        chartTXObj.render();
      } else {
        ApexCharts.exec(ponSignalTXId, 'updateOptions', txOptions, false, true);
      }
      // Adjust modal content
      $('#btn-pon-signal-refresh').prop('disabled', false);
      $('#btn-pon-signal-refresh > i').removeClass('animated rotateOut infinite');
      $('#pon-signal-placeholder-ready').hide();
      $('#pon-signal-placeholder-progress').hide();
      $('#pon-signal-placeholder-none').hide();
      $('#pon-signal-graphs').show();
    }
  });

  $(document).on('click', '#btn-pon-signal-refresh', function(event) {
    let id = $('#pon-signal-hlabel').text();
    refreshPonSignal(id);
  });

  $(document).on('click', '.btn-pon-signal-modal', function(event) {
    let row = $(event.target).parents('tr');
    let id = row.data('deviceid');
    let serialid = row.data('serialid');
    let isTR069 = row.data('is-tr069') === true; // cast to bool
    ponSignalRXId = '';
    ponSignalTXId = '';
    $('#pon-signal-hlabel').text(id);
    if (isTR069) {
      $('#pon-signal-visual').text(serialid);
    } else {
      $('#pon-signal-visual').text(id);
    }
    $('#pon-signal-placeholder-ready').show();
    $('#pon-signal-placeholder-progress').hide();
    $('#pon-signal-placeholder-none').hide();
    $('#pon-signal-graphs').hide();
    $('#pon-signal').modal('show');
  });

  $('#pon-signal').on('hidden.bs.modal', function() {
    ponSignalRXId = '';
    ponSignalTXId = '';
    $('#btn-pon-signal-refresh').prop('disabled', false);
    $('#btn-pon-signal-refresh > i').removeClass('animated rotateOut infinite');
    $('#pon-signal-placeholder-ready').show();
    $('#pon-signal-placeholder-progress').hide();
    $('#pon-signal-placeholder-none').hide();
    $('#pon-signal-graphs').hide();
  });
});