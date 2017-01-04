"use strict";
var nodeHueApi = require('node-hue-api');
var _          = require('lodash');
var LightItem  = require('./hue-light.js');

var inherits      = require('util').inherits;  
var EventEmitter  = require('events').EventEmitter;


/**
 * Server handling all lights
 * @class  LightServer
 * @param {object} config Configuration
 */
function LightServer(config) {
  var self = this;

  self.config = _.merge({}, config);

  // Convert to string
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

  // Try to fetch lights
  self.hueApi.lights(function(err, data) {
    if (err) {
      self.emit('error', err.toString());
      return;
    }

    data.lights.forEach((item) => {
      self.addLight(item);
    });

    // Only start poll after successfully  got all lights
    self.lightPollInterval = setInterval(self.huePoll, self.config.interval);
  });

  this.lightPollInterval = null;


  /**
   * Poll lights on the HUE bridge for changes
   * @param  {LightServer} lightServer The light server
   */
  this.huePoll = function huePoll() {
    /**
     * Process response from Hue API
     * @param  {Error} err        Error
     * @param  {object} lightsInfo Light information
     */
    function processLights(err, lightsInfo) {
      if (err) {
        self.emit('warning', err.toString());
        return;
      }

      lightsInfo.lights.forEach((info) => {
        try {
          if (!self.lights.hasOwnProperty(info.uniqueid)) {
            self.addLight(info);
            return;
          }
          let light = self.lights[info.uniqueid];
          light.updateInfo(info);
        }
        catch (e) {
          self.emit('warning', e.toString());
        }
      });
    }

    // Request light information
    self.hueApi.lights(processLights);
  }
  
  EventEmitter.call(this);
}

inherits(LightServer, EventEmitter);


/**
 * Stop the server
 */
LightServer.prototype.stop = function stop() {
  var self = this;
  if (this.lightPollInterval !== null)
    clearInterval(this.lightPollInterval);
  this.lightPollInterval = null;

  // Stop and remove lights
  Object.keys(this.lights).forEach((uniqueid) => {
    var light = self.lights[uniqueid];
    light.stop();
  });
  this.lights = {};
}


/**
 * Add light to the server
 * @param {object} info Hue info
 * @return {LightItem} New light
 */
LightServer.prototype.addLight = function addLight(info) {
  var self = this;
  var light = new LightItem(info);

  this.lights[light.uniqueid] = light;
  
  light.on('change', () => {
    // Calculate new color values
    let newStateColors = light.getColors();

    // Inform all subscribers
    Object.keys(self.nodeList[light.uniqueid]).forEach((nodeID) => {
      var node = self.nodeList[light.uniqueid][nodeID];
      
      light.updateNodeStatus(node);
      if (node.isOutput === true)
        node.send(newStateColors);
    });
  });

  self.statusUpdateLight(light);

  return light;
}


/**
 * Using light find all connected nodes and update state for them
 * @param  {object} light Lifx light
 */
LightServer.prototype.statusUpdateLight = function statusUpdateLight(light) {
  var self = this;

  if (this.nodeList.hasOwnProperty(light.uniqueid)) {
    let tmp = this.nodeList[light.uniqueid];
    Object.keys(tmp).forEach((nodeID) => {
      var node = self.nodeList[light.uniqueid][nodeID];
      light.updateNodeStatus(node);
      if (node.isOutput)
        node.send(light.getColors());
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
    if (node.isOutput)
      node.send(light.getColors());
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

  // Ensure that we don't trigger on our own update
  light.modified = process.uptime() + 1;

  // Update light information
  light.updateColor(value, this.hueApiSetLightState);
}


/**
 * Retreive list of detected lights
 * @return {array} Array with id, address and label for each light
 */
LightServer.prototype.getLights = function getLights() {
  var self = this;
  var retVal = Object.keys(self.lights).reduce((coll, lightid) => {
    var light = self.lights[lightid];
    var val = { id: light.uniqueid, info: light.info.id, name: light.info.name };
    coll.push(val);
    return coll;
  }, []);

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
    this.lightServer.on('error', (msg) => {
      self.err(msg);
    });

    // Server warnings
    this.lightServer.on('warning', (msg) => {
      self.warn(msg);
    });

    hueServerList[self.id] = self;
  }

  RED.nodes.registerType("node-hue-bridge", LightServerWrapper);

  // Get list of lights
  RED.httpAdmin.get('/node-hue/lights', function(req, res) {
    if(!req.query.server) {
      res.status(500).send("Missing arguments");
      return;
    }

    // Query server for information
    if (hueServerList.hasOwnProperty(req.query.server)) {
      var server = hueServerList[req.query.server];

      res.set({'content-type': 'application/json; charset=utf-8'})
      res.end(JSON.stringify(server.getLights()));
      return;
    }

    res.status(500).send("Server not found or not activated");
    return;
  });

}

