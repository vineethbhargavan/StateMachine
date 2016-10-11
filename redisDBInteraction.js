/* 
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */
var winston = require('winston');
var logLevels = {
    silly: 0,
    debug: 1,
    verbose: 2,
    info: 3,
    warn: 4,
    error: 5
};
var loglevel = "info";
var logger = new (winston.Logger)({
    transports: [
        new (winston.transports.Console)({'timestamp': function () {
                return new Date();
            }})
    ]
});
var dbNamespace = 'callstate';
var redis = require('redis');
var rclient = redis.createClient('6379', 'localhost');

function setRclient(key, value, name) {
    rclient.set(dbNamespace + key, JSON.stringify(value), function (err, data) {
        logger.info(name + ' set for ' + dbNamespace + key + ";" + JSON.stringify(value));
    });
}

function getRclientValues(key, name, callback) {
    rclient.get(dbNamespace + key, function (err, data) {
        logger.info(name + '  for ' + dbNamespace + key + ":" + JSON.stringify(data) + ":" + data);
        callback(JSON.parse(data));
    });
}

var machina = require('machina');
var callStateMachine = machina.Fsm.extend({
    initialState: 'entrypoint',
    states: {
        'entrypoint': {
            _onEnter: function () {
                logger.info('callStateMachine entrypoint');
            },
            updateDB: function (event, queue) {
                var call = {};
                var callTransitions = [];
                callTransitions.push(event.waitingtype);
                call.currentState = event.waitingtype;
                call.stateTransition = callTransitions;
                setRclient(event.custkey, call, 'entrypoint');
            }
        }, 'finding_op': {
            _onEnter: function () {
                logger.info('callStateMachine finding_op');
            },
            updateDB: function (event, queue) {
                this.handleUpdateAction(event, queue);
            }
        }, 'calling_op': {
            _onEnter: function () {
                logger.info('callStateMachine calling_op');
            },
            updateDB: function (event, queue) {
                this.handleUpdateAction(event, queue);
            }
        },
        'connected': {
            _onEnter: function () {
                logger.info('callStateMachine connected');
            },
            updateDB: function (event, queue) {
                this.handleUpdateAction(event, queue);
            }
        },
        'terminated': {
            _onEnter: function () {
                logger.info('callStateMachine terminated');
            },
            updateDB: function (event, queue) {
                this.handleUpdateAction(event, queue);
            },
            _onExit: function () {

            }
        },
        'dormant': {
            _onEnter: function () {
                logger.info('callStateMachine dormant');
            },
            terminateCall: function (event, queue) {
                this.terminateCallAction(event, queue);
            },
            _onExit: function () {

            }
        }

    },
    handleUpdateAction: function (event, queue) {
        var callState = getByValue(queue, event.custkey);
        var currentState = callState.indexOf(event.waitingtype);
        getRclientValues(event.custkey, event.waitingtype, function (data) {
            if (data !== undefined) {
                var previousState = callState.indexOf(data.currentState);
                logger.info("previousState/currentState" + data.currentState + "/" + event.waitingtype);
                var diff = currentState - previousState;
                logger.info("Diff of INdex:" + event.waitingtype + ";" + diff);
                if (diff !== 1) {
                    callStateTransition.handle('updateDB', event, queue);
                    return;
                } else {
                    data.currentState = event.waitingtype;
                    data.stateTransition.push(event.waitingtype);
                    setRclient(event.custkey, data, data.currentState);
                    if (event.waitingtype == 'terminated') {
                        event.waitingtype = 'dormant';
                        callStateTransition.transition(event.waitingtype);
                        callStateTransition.handle('terminateCall', event, queue);
                        return;
                    }

                }
            }
        });
    },
    terminateCallAction: function (event, queue) {
        var callIdIndex = queue.indexOf(event.custkey);
        getRclientValues(event.custkey, event.waitingtype, function (data) {
            if (data !== undefined) {
                data.currentState = event.waitingtype;
                data.stateTransition.push(event.waitingtype);
                setRclient(event.custkey, data, data.currentState);
                queue.splice(callIdIndex, 1);
                logger.info("Call Terminated Queue Status" + JSON.stringify(queue));
            }
        });
    }
});
var callStateTransition = new callStateMachine();

function getByValue(arr, value) {
    for (var i = 0, iLen = arr.length; i < iLen; i++) {
        if (arr[i].id == value)
            return arr[i].states;
    }
}

var ami_host = '192.168.0.10';
var ami = new require('asterisk-manager')('5038', ami_host, 'dashboard', 'abc123', true);
//userevent{"event":"UserEvent","privilege":"user,all","userevent":"TriggerOperator","uniqueid":["1449613043.18"],"channel":"SIP/666-00000012"}
//var io = require('sails.io.js')( require('socket.io-client') );


if (ami != undefined) {
    try {
        ami.keepConnected();
        var queue = [];
        ami.on('userevent', function (event) {
            if (event.userevent == "UpdateQueue") {
                var callState = getByValue(queue, event.custkey);
                if (callState !== undefined) {
                    callState.push(event.waitingtype);
                } else {
                    var call = {};
                    var callStates = [];
                    call.id = event.custkey;
                    callStates.push(event.waitingtype);
                    call.states = callStates;
                    queue.push(call);
                }
                callStateTransition.transition(event.waitingtype);
                callStateTransition.handle('updateDB', event, queue);
                logger.info("Queue" + JSON.stringify(queue));
            }
        });

    } catch (err) {
        logger.info('exception occured:During AMI action', err.message);
    }
} else {
    logger.info('AMI object is not Present Trying to login agan');
    ami = new require('asterisk-manager')('5038', ami_host, 'dashboard', 'abc123', true);
}


