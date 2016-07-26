/**
 *
 * NUT adapter
 *
 * Adapter loading NUT data from an UPS
 *
 */

"use strict";

var utils = require(__dirname + '/lib/utils'); // Get common adapter utils
var Nut   = require('node-nut');

var adapter = utils.adapter({
  name: 'nut',
  ready: function () {
    //oNut = new Nut(3493, 'localhost');
    var oNut = new Nut(adapter.config.host_port, adapter.config.host_ip);

    oNut.on('error', function(err) {
      adapter.log.error('Error happend: ' + err);
    });

    oNut.on('close', function() {
      adapter.log.debug('NUT Connection closed. Done.');
      setTimeout(function () {
        adapter.stop();
      }, 2000);
    });

    oNut.on('ready', function() {
      adapter.log.debug('NUT Connection ready');
      var self = this;
      this.GetUPSVars(adapter.config.ups_name,function(varlist) {
        adapter.log.debug('Got values, start setting them');
        storeNutData(varlist);
        self.close();
      });
    });

    oNut.start();
  }
});

adapter.on('stateChange', function (id, state) {
    adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));

    // you can use the ack flag to detect if state is command(false) or status(true)
    if (!state.ack) {
        adapter.log.info('ack is not set!');
    }
});

function storeNutData(varlist) {
  var last='';
  var current='';
  var index=0;
  var stateName='';

  for (var key in varlist) {
    index=key.indexOf('.');
    if (index > 0) {
      current=key.substring(0,index);
    }
    else {
      current='';
      last='';
      index=-1;
    }
    if (((last=='') || (last!=current)) && (current!='')) {
      adapter.log.debug('Create Channel '+current);
      adapter.setObjectNotExists(current, {
          type: 'channel',
          common: {name: current},
          native: {}
      });
    }
    stateName=current+'.'+key.substring(index+1).replace(/\./g,'-');
    adapter.log.debug('Create State '+stateName);
    if (stateName=='battery.charge') {
      adapter.setObjectNotExists(stateName, {
          type: 'state',
          common: {name: stateName, type: 'number', role: 'value.battery', read: true, write: false},
          native: {id: stateName}
      });
    }
    else {
      adapter.setObjectNotExists(stateName, {
          type: 'state',
          common: {name: stateName, type: 'string', read: true, write: false},
          native: {id: stateName}
      });
    }
    adapter.log.debug('Set State '+stateName+' = '+varlist[key]);
    adapter.setState(stateName, {ack: true, val: varlist[key]});
    last=current;
  }

  // Command Datapoint to be used with "NOIFY EVENTS" and upsmon
  /*
ONLINE

    The UPS is back on line.
ONBATT

    The UPS is on battery.
LOWBATT

    The UPS battery is low (as determined by the driver).
FSD

    The UPS has been commanded into the "forced shutdown" mode.
COMMOK

    Communication with the UPS has been established.
COMMBAD

    Communication with the UPS was just lost.
SHUTDOWN

    The local system is being shut down.
REPLBATT

    The UPS needs to have its battery replaced.
NOCOMM

    The UPS can’t be contacted for monitoring.
*/
  adapter.setObjectNotExists(stateName, {
      type: 'state',
      common: {
        name: 'upsmon_event',
        type: 'string',
        read: true,
        write: true,
        def:""
      },
      native: {id: stateName}
  });
  adapter.subscribeStates('upsmon_event');

  adapter.log.debug('Create Channel status');
  adapter.setObjectNotExists(current, {
      type: 'channel',
      common: {name: 'status'},
      native: {}
  });
  var severityVal = 4;
  adapter.setObjectNotExists(stateName, {
      type: 'state',
      common: {
        name: 'status.severity',
        role: 'indicator',
        type: 'number',
        read: true,
        write: false,
        def:4,
        states: '0:idle;1:operating;2:operating_critical;3:action_needed;4:unknown'
      },
      native: {id: stateName}
  });
  if (varlist['ups.status']) {
    var statusMap = {
              'OL':{name:'online',severity:'idle'},
              'OB':{name:'onbattery',severity:'operating'},
              'LB':{name:'lowbattery',severity:'operating_critical'},
              'HB':{name:'highbattery',severity:'operating_critical'},
              'RB':{name:'replacebattery',severity:'action_needed'},
              'CHRG':{name:'charging',severity:'idle'},
              'DISCHRG':{name:'discharging',severity:'operating'},
              'BYPASS':{name:'bypass',severity:'action_needed'},
              'CAL':{name:'calibration',severity:'operating'},
              'OFF':{name:'offline',severity:'action_needed'},
              'OVER':{name:'overload',severity:'action_needed'},
              'TRIM':{name:'trimming',severity:'operating'},
              'BOOST':{name:'boosting',severity:'operating'},
              'FSD':{name:'shutdown',severity:'operating_critical'}
            };
    var severity = {
              'idle':false,
              'operating':false,
              'operating_critical':false,
              'action_needed':false
            };
    var checker=' '+varlist['ups.status']+' ';
    for (var idx in statusMap) {
      if (statusMap.hasOwnProperty(idx)) {
        var found=(checker.indexOf(idx)>-1);
        stateName='status.'+statusMap[idx]['name'];
        adapter.log.debug('Create State '+stateName);
        adapter.setObjectNotExists(stateName, {
            type: 'state',
            common: {name: stateName, type: 'boolean', read: true, write: false},
            native: {id: stateName}
        });
        adapter.log.debug('Set State '+stateName+' = '+found);
        adapter.setState(stateName, {ack: true, val: found});
        if (found) {
          severity[statusMap[idx]['severity']]=true;
          adapter.log.debug('Severity Flag '+statusMap[idx]['severity']+'=true');
        }
      }
    }
    if (severity['operating_critical']) severityVal=2;
      else if (severity['action_needed']) severityVal=3;
      else if (severity['operating']) severityVal=1
      else if (severity['idle']) severityVal=0;
  }
  adapter.log.debug('Set State status.severity = '+severityVal);
  adapter.setState('status.severity', {ack: true, val: severityVal});

  adapter.log.info('All Nut values set');
}
