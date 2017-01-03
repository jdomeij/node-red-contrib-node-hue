"use strict";
var nodeHueApi = require('node-hue-api');
var _          = require('lodash');
var Enum       = require('enum');

var inherits      = require('util').inherits;  
var EventEmitter  = require('events').EventEmitter;

var colorConvert   = require('color-convert');
var colorTemp      = require('color-temp');
var colorSpace     = require('color-space');

// Color mode enums
const ColorMode = new Enum({
  BRIGHTNESS:   'Brightness',
  COLOR:        'Color',
  TEMPERATURE:  'Temperature',
});

// Hue color mode to enum conversion table
const ColorModeHue = new Enum({
  BRIGHTNESS:   'bri',
  COLOR:        'xy',
  TEMPERATURE:  'ct'
});

// Hue color mode to enum conversion table
const ColorModeInternal = new Enum({
  bri: ColorMode.BRIGHTNESS,
  xy:  ColorMode.COLOR,
  hue: ColorMode.COLOR,
  ct:  ColorMode.TEMPERATURE
});


/**
 * Converts/Filters Hue state to internal state
 * @param  {object} hueState Hue state
 * @return {object} Internal state
 */
function convertHueState(hueState) {
  const hueStateProperties = {
    on: true,
    bri: true,
    hue: true,
    sat: true,
    xy: true,
    ct: true,
    reachable: true,
    colormode: true, 
  };

  var state = _.reduce(hueState, (coll, value, key) => {
    if (!hueStateProperties.hasOwnProperty(key))
      return coll;
    if (hueStateProperties[key] === true)
      coll[key] = value;
    return coll;
  }, {});

  return state;
}


/**
 * Item representing one light
 * @param {object} hueLight HUE light
 */
function LightItem(hueLight) {
  this.uniqueid = hueLight.uniqueid;
  this.modified = 0;

  this.info = {
    id:       hueLight.id,
    type:     hueLight.type,
    name:     hueLight.name,
    modelid:  hueLight.modelid,
    uniqueid: hueLight.uniqueid,
  }

  this.state = convertHueState(hueLight.state);

  EventEmitter.call(this);
}

inherits(LightItem, EventEmitter);


/**
 * Stop client
 */
LightItem.prototype.stop = function stop() {
}


/**
 * Sync light information with local information
 * @param  {object} info Hue light information
 */
LightItem.prototype.updateInfo = function updateInfo(info) {
  // We need to ignore the changes for this light until modified value has expired
  if (this.modified >= process.uptime())
    return;

  var hueState = convertHueState(info.state);
  var isUpdated = false;

  // Determine if state is updated
  isUpdated = this.state.on        !== hueState.on        || isUpdated;
  isUpdated = this.state.reachable !== hueState.reachable || isUpdated;


  // Only check the rest of values if light is on
  if (hueState.on && hueState.reachable) {
    isUpdated = !_.isEqual(this.state, hueState);
    if (isUpdated)
      _.merge(this.state, hueState);
  }
  else {
    // Update state variables
    this.state.on        = info.state.on;
    this.state.reachable = info.state.reachable;
  }

  // Values/state has been updated
  if (isUpdated)
    this.emit('change');
}


/**
 * Check if we have new color and calculate updated properties
 * @param  {object} input  Input arguments
 * @param  {object} output New state arguments
 * @return {bool}          Is color updated
 */
LightItem.prototype.updateColorRGB = function updateColorRGB(/*input, output*/) {

  // TODO: Color conversion for RGB, hsv, ...
  return false;

  /*
  if (value.bri !== undefined)
    this.state.bri = value.bri;
  if (value.xy !== undefined)
    this.state.xy = value.xy;
  */
}


/**
 * Check if we have new temperature color and calculate updated properties
 * @param  {object} input  Input arguments
 * @param  {object} output New state arguments
 * @return {bool}          Is temperature color updated
 */
LightItem.prototype.updateColorTemp = function updateColorTemp(input, output) {
  var ct  = this.state.ct;
  var bri = this.state.bri;
  var changed = false;

  // Mired/Mirek color temperature
  if (input.ct !== undefined) {
    ct = input.ct;
    changed = true;
  }

  else if (input.mirek !== undefined) {
    ct = input.mirek;
    changed = true;
  }

  else if (input.mired !== undefined) {
    ct = input.mired;
    changed = true;
  }

  // Kelvin color temperature
  else if (input.kelvin !== undefined) {
    ct = 1000000 / input.kelvin;
    changed = true;
  }

  // Brightness
  if (input.bri !== undefined)
    bri = input.bri * 2.55;
  else if (input.brightness)
    bri = input.brightness * 2.55;

  // No changes (brightness does not count)
  if (!changed)
    return false;


  output.colormode = ColorModeHue.TEMPERATURE.val;
  output.ct        = Math.floor(ct);
  output.bri       = Math.floor(bri);
  return true;
}


/**
 * Check if we have new brightness value and calculate updated properties
 * @param  {object} input  Input arguments
 * @param  {object} output New state arguments
 * @return {bool}          Is brightness updated
 */
LightItem.prototype.updateColorBri = function updateColorBri(input, output) {
  var bri = this.state.bri;
  var changed = false;
  
  if (input.bri !== undefined) {
    changed = true;
    bri = input.bri * 2.55;
  }

  else if (input.brightness !== undefined) {
    changed = true;
    bri = input.brightness * 2.55;
  }

  // No change
  if (!changed)
    return false;

  // We don't set new mode if only brightness was changed
  output.bri = Math.floor(bri);
  return true;
}


/**
 * Parse/Convert input parameters to correct light parameter and update current state
 * @param  {object} input  Input arguments
 * @return {object}        Updated state parameters
 */
LightItem.prototype.updateColor = function updateColor(input) {

  var newValues = {};

  // First check if RGB values has been updated
  if (this.updateColorRGB(input, newValues))
    ;

  // If not check if temp values
  else if (this.updateColorTemp(input, newValues))
    ;

  // Always check if brightness is updated
  else if (this.updateColorBri(input, newValues))
    ;

  // Update current state
  _.merge(this.state, newValues);

  this.emit('change');

  return newValues;
}


/**
 * Generates info object for light
 * @return {object} Color information
 */
LightItem.prototype.getColors = function getColors() {

  //var hsv = [state.hue, state.saturation, state.brightness];
  var xyY = null;
  var bri = this.state.bri/2.55;

  if (this.state.xy !== undefined) {
    xyY = [this.state.xy[0], this.state.xy[1], bri];
  }

  else if (this.state.ct !== undefined) {
    let temp = 1000000 / this.state.ct;
    let rgb = colorTemp.temp2rgb(temp);
    xyY = colorSpace.rgb.xyy(rgb);
  }

  else {
    xyY = colorSpace.hsv.xyy([0, 0, bri]);
  }

  // Convert xyY to hsv, use original brightness
  let hsv = colorSpace.xyy.hsv(xyY);
  hsv[2] = bri;

  if (this.state.colormode === ColorMode.TEMPERATURE)
    hsv[1] = 1;

  // Convert to rgb
  let rgb = colorSpace.hsv.rgb(hsv);

  // Return object
  var payload = {
    on:         this.state.on,
    reachable:  this.state.reachable,

    bri: Math.floor(bri),

    xy:  [ Math.floor(1000*xyY[0])/1000, Math.floor(1000*xyY[1])/1000 ],
    hsv: [ Math.floor(hsv[0]), Math.floor(hsv[1]), Math.floor(hsv[2]) ],
    rgb: [ Math.floor(rgb[0]), Math.floor(rgb[1]), Math.floor(rgb[2]) ],
  
    hex:   colorConvert.rgb.hex(rgb),
    color: colorConvert.rgb.keyword(rgb),
  }

  // Only generate if we have temperature light
  if (this.state.ct !== undefined) {
    payload.mired  = Math.floor(this.state.ct);
    payload.kelvin = Math.floor(1000000 / this.state.ct);
  }

  // Build return value
  var retVal = {
    id:       this.info.id,
    uniqueid: this.info.uniqueid,
    name:     this.info.name,
    payload: payload
  };

  return retVal;
}


/**
 * Poll lights on the HUE bridge for changes
 * @param  {LightServer} lightServer The light server
 */
function huePoll(lightServer) {
  /**
   * Process response from Hue API
   * @param  {Error} err        Error
   * @param  {object} lightsInfo Light information
   */
  function processLights(err, lightsInfo) {
    if (err) {
      lightServer.warn(err.toString());
      return;
    }

    lightsInfo.lights.forEach((info) => {
      try {
        if (!lightServer.lights.hasOwnProperty(info.uniqueid)) {
          lightServer.addLight(info);
          return;
        }
        let light = lightServer.lights[info.uniqueid];
        light.updateInfo(info);
      }
      catch (e) {
        lightServer.warn(err.toString());
      }
    });
  }

  // Request light information
  lightServer.hueApi.lights(processLights);
}


/**
 * Update node state depending on light status
 * @param  {object}     node    Flow node
 * @param  {LightItem}  light   Light item
 */
function updateNodeStatus(node, light) {

  if (!light.state.reachable) {
    node.status({fill:"red",shape:"ring",text:"disconnected"});
  } else if (!light.state.on) {
    node.status({fill:"grey",shape:"dot",text:"off"});
  } else {
    let bri = Math.floor((light.state.bri/2.55));
    node.status({fill:"yellow",shape:"dot",text: `on (${bri}%)`});
  }
}


/**
 * Server handling all lights
 * @class  LightServer
 * @param {object} config Configuration
 */
function LightServer(config) {
  var self = this;

  self.config = _.merge({}, config);

  // Ensure that we don't use to low poll interval
  if (self.config.interval !== 'number' || self.interval < 500)
    self.config.interval = 500;

  // List of all registerd nodes
  this.nodeList = {};
  this.nodeListCount = 0;

  // List of all lights
  this.lights = {};

  // Create new API
  this.hueApi = new nodeHueApi.HueApi(this.config.address, this.config.key);

  // Try to fetch lights
  self.hueApi.lights(function(err, data) {
    if (err) {
      self.error(err.toString(), err);
      return;
    }

    data.lights.forEach((item) => {
      self.addLight(item);
    });

    // Only start poll after successfully  got all lights
    self.lightPollInterval = setInterval(self.huePoll, self.config.interval);
  });

  this.lightPollInterval = null;
  this.huePoll = huePoll.bind(this, this);
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
      
      updateNodeStatus(node, light);
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
  //var self = this;

  if (this.nodeList.hasOwnProperty(light.uniqueid)) {
    let tmp = this.nodeList[light.uniqueid];
    Object.keys(tmp).forEach((item) => {
      updateNodeStatus(tmp[item], light);
      if (tmp[item].isOutput)
        tmp[item].send(light.getColors());
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
    updateNodeStatus(light, node);
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
  var self = this;

  if (!this.lights.hasOwnProperty(lightID))
    return;

  var light = this.lights[lightID];

  // Ensure that we don't trigger on our own update
  light.modified = process.uptime() + 1;

  // Update light information
  light.updateColor(value);

  // Build new light state
  var newState = nodeHueApi.lightState.create();

  // Duration specified
  if (typeof value.duration === 'number' && value.duration > 0) {
    newState.transition(value.duration);
    
    // Increase modified value to include transition time
    light.modified += Math.floor(1 + (value.duration/1000));
  }

  // New state is on
  if (light.state.on) {
    newState.on();

    if (light.state.bri !== undefined)
      newState.bri(light.state.bri);

    // New temperature or color
    if (light.state.ct !== undefined)
      newState.ct(light.state.ct);
    else if (light.state.xy !== undefined)
      newState.xy(light.state.xy);
  }
  else
    newState.off();

  // Update light
  this.hueApi.setLightState(light.info.id, newState, function(err) {
    if (err) {
      self.warn(err.toString());
      return;
    }
  });
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

    self.name    = config.name;
    self.key     = config.key;
    self.address = config.address;
    self.interval= config.interval;

    this.lightServer = new LightServer(config);
  
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

