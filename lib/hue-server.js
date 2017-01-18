"use strict";
var nodeHueApi = require('node-hue-api');
var _          = require('lodash');
var LightItem  = require('./hue-light.js');

var inherits      = require('util').inherits;
var EventEmitter  = require('events').EventEmitter;

/**
 * Create light/group id from HUE info
 * @param  {object}  hueInfo HUE info
 * @param  {boolean} isLight Light or Group ID
 * @return {string} ID
 */
function createLightID(hueInfo, isLight) {
  return `${isLight?'light':'group'}${hueInfo.id}`;
}


/**
 * Server handling all lights
 * @class  LightServer
 * @param {object} config Configuration
 */
function LightServer(config) {
  EventEmitter.call(this);

  var self = this;

  self.config = _.merge({}, config);

  // Convert from string
  if (typeof self.config.interval === 'string')
    self.config.interval = parseInt(self.config.interval, 10);
  
  // Ensure that we don't use to low poll interval
  if (typeof self.config.interval !== 'number' || isNaN(self.config.interval) || self.interval < 500)
    self.config.interval = 500;

  // List of all registerd nodes
  this.nodeList = {};
  this.nodeListCount = 0;

  // List of all lights
  this.lights = {};

  // Create new API
  this.hueApi = new nodeHueApi.HueApi(this.config.address, this.config.key);

  // Create wrapper function for setLightState
  this.hueApiSetLightState = function setLightState(id, state) {
    self.hueApi.setLightState(id, state, function(err) {
      if (err)
        self.emit('warning', err.toString());
    });
  };

  // Create wrapper function for setGroupLightState
  this.hueApiSetGroupLightState = function setGroupLightState(id, state) {
    self.hueApi.setGroupLightState(id, state, function(err) {
      if (err)
        self.emit('warning', err.toString());
    });
  };

  this.lightPollInterval = null;

  // Manually initiate polling to detect all lights
  this.pollChanges((err) => {
    if (err) {
      self.emit('warning', err.toString());
      return;
    }

    /**
     * Function to ignore all errors for poll function
     */
    function ignorePollResult() {
    }

    // Only start poll after successfully got all lights, bind to function that ignores all erros
    self.lightPollInterval = setInterval(self.pollChanges.bind(self, ignorePollResult), self.config.interval);
  });

}

inherits(LightServer, EventEmitter);


/**
 * Poll Bridge for changes
 * @param  {function} callback Done callback
 */
LightServer.prototype.pollChanges = function pollChanges(callback) {
  var self = this;

  /**
   * Process list of Lights or Groups
   * @param  {array}  list    List
   * @param  {boolean} isLight Lights or Groups
   */
  function processItems(list, isLight) {
    list.forEach((hueInfo) => {
      // Ignore group 0
      if (!isLight && hueInfo.id === '0')
        return;

      var lightID = createLightID(hueInfo, isLight);

      // New light found
      if (!self.lights.hasOwnProperty(lightID)) {
        self.newLight(lightID, hueInfo, isLight);
        return;
      }

      // Update info for existing light
      var hueLight = self.lights[lightID];
      hueLight.updateInfo(hueInfo);
    });
  }

  // First request lights information
  this.hueApi.lights((lightsErr, lightsInfo) => {
    if (lightsErr)
      return callback(lightsErr);

    // Then request groups information
    this.hueApi.groups((groupErr, groupInfo) => {
      if (groupErr)
        return callback(groupErr);

      // Process both lists
      processItems(lightsInfo.lights, true);
      processItems(groupInfo, false);
    
      callback(null);
    });
  });
}

/**
 * Stop the server
 */
LightServer.prototype.stop = function stop() {
  var self = this;
  if (this.lightPollInterval !== null)
    clearInterval(this.lightPollInterval);
  this.lightPollInterval = null;

  // Stop and remove lights
  Object.keys(this.lights).forEach((lightID) => {
    var light = self.lights[lightID];
    light.stop();
  });
  this.lights = {};
}


/**
 * Create new light for the server
 * @param {string}  lightID  ID for light/group
 * @param {object}  hueInfo  Hue info
 * @param {boolean} isLight  Light or group
 */
LightServer.prototype.newLight = function newLight(lightID, hueInfo, isLight) {
  var self = this;
  
  var light = new LightItem(lightID, hueInfo, isLight);
  var apiFunc = isLight ? this.hueApiSetLightState : this.hueApiSetGroupLightState;

  light.on('error', (msg, obj) => {
    self.emit('error', msg, obj);
  });

  light.on('warning', (msg, obj) => {
    self.emit('warning', msg, obj);
  });

  light.on('change', () => {
    self.statusUpdateLight(lightID, light, 'change');
  });

  light.on('updated', () => {
    self.statusUpdateLight(lightID, light, 'updated');
  })

  // Pass new state to Hue api to update the light
  light.on('sendToLight', (hueID, newState) => {
    apiFunc(hueID, newState);
  });

  // Attach the light
  self.lights[lightID] = light;

  // Because we only attach the change event after the light is initialized we need to
  // manually trigger status update
  self.statusUpdateLight(lightID, light, 'new');
}


/**
 * Using light find all connected nodes and update state for them
 * @param {string} lightID  ID for light/group
 * @param {object} light    HUE light
 * @param {string} event    Event triggering this update
 */
LightServer.prototype.statusUpdateLight = function statusUpdateLight(lightID, light, event) {
  var self = this;

  if (this.nodeList.hasOwnProperty(lightID)) {
    let tmp = this.nodeList[lightID];
    let message;

    Object.keys(tmp).forEach((nodeID) => {
      var node = self.nodeList[lightID][nodeID];
      light.updateNodeStatus(node);
      
      // Ouput node
      if (node.isOutput) {

        // Only generate message if needed
        if (message === undefined) {
          message = light.getStateMessage();
          message.event = event;
        }

        node.send(message);
      }
    });
  }
};


/**
 * Add Node-Red node to the server
 * @param {string} lightID ID/Label of the light
 * @param {string} nodeID  ID for the node
 * @param {object} node    Node-Red object
 */
LightServer.prototype.nodeRegister = function nodeRegister(lightID, nodeID, node) {
  if (!this.nodeList.hasOwnProperty(lightID))
    this.nodeList[lightID] = {};
  this.nodeList[lightID][nodeID] = node;

  // Check if we have this light already
  if (this.lights.hasOwnProperty(lightID)) {
    let light = this.lights[lightID];
    light.updateNodeStatus(node);
    if (node.isOutput) {
      // Get message and set event as new
      let message = light.getStateMessage();
      message.event = 'new';
      node.send(message);
    }
    return;
  }

  // Light not found (yet), set status to unknown
  node.status({fill:"red",shape:"ring",text:"unknown"});
};


/**
 * Remove Node-Red node from the server
 * @param  {string} lightID ID/Label for the light
 * @param  {string} nodeID  ID for the node
 */
LightServer.prototype.nodeUnregister = function nodeUnregister(lightID, nodeID) {
  if (!this.nodeList.hasOwnProperty(lightID))
    return;

  if (!this.nodeList[lightID].hasOwnProperty(nodeID))
    return;
  
  delete this.nodeList[lightID][nodeID];
};


/**
 * Change light state
 * @param  {string} lightID ID/Label for the light
 * @param  {object} value   New values for the light
 */
LightServer.prototype.lightChange = function lightChange(lightID, value) {
  if (!this.lights.hasOwnProperty(lightID))
    return;

  var light = this.lights[lightID];
  var apiFunc = this.hueApiSetLightState

  if (!light.isLight)
    apiFunc = this.hueApiSetGroupLightState;

  // Update light information
  light.setColor(value, apiFunc);
}


/**
 * Retreive list of detected lights
 * @return {array} Array with id, address and label for each light
 */
LightServer.prototype.getLights = function getLights() {
  var self = this;
  var retVal = {
    lights: [],
    groups: [],
  }

  Object.keys(self.lights).forEach((lightID) => {
    var light = self.lights[lightID];
    var val = { id: lightID, hueID: light.info.id, name: light.info.name };
    if (light.isLight)
      retVal.lights.push(val);
    else
      retVal.groups.push(val);
  });

  return retVal;
 }


module.exports = function(RED) {
  // list of servers
  var hueServerList = {};

  /**
   * LightServer wrapper for Node-Red
   * @param {object} config Configuration
   */
  function LightServerWrapper(config) {
    var self = this;
    RED.nodes.createNode(self, config);

    self.config = {
      name:     config.name,
      key:      config.key,
      address:  config.address,
      interval: config.interval,
    };

    this.lightServer = new LightServer(self.config, self);
  
    // Create wrapper functions
    this.stop           = this.lightServer.stop.bind(this.lightServer);
    
    this.nodeRegister   = this.lightServer.nodeRegister.bind(this.lightServer);
    this.nodeUnregister = this.lightServer.nodeUnregister.bind(this.lightServer);
    
    this.lightChange    = this.lightServer.lightChange.bind(this.lightServer);

    this.getLights      = this.lightServer.getLights.bind(this.lightServer);

    // Handle close event
    self.on('close', () => {
      self.stop();

      delete hueServerList[self.id];
    });

    // Server errors
    this.lightServer.on('error', (msg, obj) => {
      self.err(msg, obj);
    });

    // Server warnings
    this.lightServer.on('warning', (msg, obj) => {
      self.warn(msg, obj);
    });

    hueServerList[self.id] = self;
  }

  RED.nodes.registerType("node-hue-bridge", LightServerWrapper);

  // Search for hub
  RED.httpAdmin.get('/node-hue/nupnp', (req, res) => {
    nodeHueApi.nupnpSearch().then((result) => {
      res.set({'content-type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify(result));
    }).fail((err) => {
      res.status(500).send(err.message + '"');
    }).done();
  });

  // Register
  RED.httpAdmin.get('/node-hue/register', (req, res) => {
    if(!req.query.address) {
      return res.status(500).send("Missing arguments");
    }
    var hue = nodeHueApi.HueApi();

    hue.registerUser(req.query.address, "node-red-contrib-node-hue")
      .then(function(result) {
        res.set({'content-type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify(result));
      }).fail(function(err) {
        res.status(500).send(err.message);
      }).done();
  });

  // Validate key
  RED.httpAdmin.get('/node-hue/validate_key', (req, res) => {
    if(!req.query.address || !req.query.key) {
      return res.status(500).send("Missing arguments");
    }

    var hue = new nodeHueApi.HueApi(req.query.address, req.query.key);
    hue.config()
      .then((result) => {
        // Check if result has ipaddress
        if (typeof result !== 'object' || !result.hasOwnProperty('ipaddress'))
          return res.status(401).send('Invalid key');

        res.set({'content-type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({}));
      }).fail((err) => {
        res.status(500).send(err.message);
      })
  });

  // Get list of lights
  RED.httpAdmin.get('/node-hue/lights', (req, res) => {
    if(!req.query.server) {
      return res.status(500).send("Missing arguments");
    }

    // Check if we have this server
    if (!hueServerList.hasOwnProperty(req.query.server)) {
      return res.status(500).send("Server not found or not activated");
    }

    // Query server for information
    var server = hueServerList[req.query.server];
    res.set({'content-type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify(server.getLights()));
    return;
  });
}
