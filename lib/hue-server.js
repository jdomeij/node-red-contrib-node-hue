"use strict";
var nodeHueApi = require('node-hue-api');

var colorConvert   = require('color-convert');
var colorTemp      = require('color-temp');
var colorSpace     = require('color-space');

/**
 * Item representing one HUE light
 * @param {object} hueLight HUE light
 */
function LightItem(hueLight) {
  this.id       = hueLight.id;
  this.uniqueid = hueLight.uniqueid;

  this.modified = 0;

  this.info = {
    id:       hueLight.id,
    type:     hueLight.type,
    name:     hueLight.name,
    modelid:  hueLight.modelid,
    uniqueid: hueLight.uniqueid,
  }

  this.state = {
    on:        hueLight.state.on,
    reachable: hueLight.state.reachable,
    colormode: hueLight.state.colormode || 'bri',
    bri:       hueLight.state.bri || 0
  };

  if (hueLight.state.ct !== undefined)
    this.state.ct = hueLight.state.ct;

  if (hueLight.state.xy !== undefined)
    this.state.xy = hueLight.state.xy;
}

/**
 * Update light (RGB colors)
 * @param  {object} value New values
 */
LightItem.prototype.updateColorXY = function updateColorXY(value) {
  // TODO: Color conversion for RGB, HSL, ...
  if (value.bri !== undefined)
    this.state.bri = value.bri;
  if (value.xy !== undefined)
    this.state.xy = value.xy;
}


/**
 * Update light (variable temperature)
 * @param  {object} value New values
 */
LightItem.prototype.updateColorCT = function updateColorTemp(value) {
  var ct  = this.state.ct;
  var bri = this.state.bri;

  // Mired/Mirek color temperature
  if (value.ct !== undefined) {
    ct = value.ct;
  }

  // Kelvin color temperature
  else if (value.kelvin !== undefined) {
    ct = 1000000 / value.kelvin;
  }

  // Brightness
  if (value.bri !== undefined)
    bri = value.bri;

  this.state.ct = ct;
  this.state.bri = bri;
}

/**
 * Update light (dimable)
 * @param  {object} value New values
 */
LightItem.prototype.updateColorBri = function updateColorBri(value) {
  var bri = this.state.bri;
  
  if (value.bri !== undefined)
    bri = value.bri;

  this.state.bri = bri;
}

/**
 * Update light
 * @param  {object} value New values
 */
LightItem.prototype.updateColor = function updateColor(value) {
  if (!this.state.on)
    return;


  switch(this.state.colormode) {
    case 'xy':
      this.updateColorXY(value);
      break;
    case 'ct':
      this.updateColorCT(value);
      break;
    case 'bri':
    default:
      this.updateColorBri(value);
      break;
  }
}


/**
 * Generates info object for light
 * @return {object}
 */
LightItem.prototype.getColors = function getColors() {

  //var hsl = [state.hue, state.saturation, state.brightness];
  var xyY = null;
  var bri = this.state.bri;

  if (this.state.xy !== undefined) {
    xyY = this.state.xy;
  }

  else if (this.state.ct !== undefined) {
    let temp = 1000000 / this.state.ct;
    let rgb = colorTemp.temp2rgb(temp);
    xyY = colorSpace.rgb.xyy(rgb);
  }

  else {
    xyY = colorSpace.hsl.xyy([0, 0, bri]);
  }

  // Convert xyY to hsl, use original brightness
  let hsl = colorSpace.xyy.hsl(xyY);
  hsl[2] = (bri/255)*100;

  // Convert to rgb
  let rgb = colorSpace.hsl.rgb(hsl);

  // Return object
  var ret = {
    on:         this.state.on,
    reachable:  this.state.reachable,
    bri:        this.state.bri,

    xy:  [ Math.floor(1000*xyY[0])/1000, Math.floor(1000*xyY[1])/1000 ],
    hsl: [ Math.floor(hsl[0]), Math.floor(hsl[1]), Math.floor(hsl[2]) ],
    rgb: [ Math.floor(rgb[0]), Math.floor(rgb[1]), Math.floor(rgb[2]) ],
  
    hex:   colorConvert.rgb.hex(rgb),
    color: colorConvert.rgb.keyword(rgb),
  }

  // Only generate if we have temperature light
  if (this.state.ct !== undefined) {
    ret.ct     = Math.floor(this.state.ct);
    ret.kelvin = Math.floor(1000000 / this.state.ct);
  }

  return ret;
}


/**
 * Poll lights on the HUE bridge for changes
 * @param  {LightServer} self The light server
 */
function huePoll(lightServer) {
  var timestamp = process.uptime();

  function checkLight(newLight) {
    
    if (!lightServer.lights.lightMap.hasOwnProperty(newLight.uniqueid)) {
      return;
    }

    var light = lightServer.lights.lightMap[newLight.uniqueid];

    // We need to ignore the changes for this light until modified value has expired
    if (light.modified >= timestamp)
      return;

    var lightState = light.state;
    var newState   = newLight.state;

    // Determine if value is updated
    var isUpdated = lightState.on !== newState.on || false;
    if (newState.on) {
      isUpdated = lightState.bri !== newState.bri || isUpdated;

      if (lightState.ct !== undefined && newState.ct !== undefined)
        isUpdated = lightState.ct !== newState.ct || isUpdated;

      if (lightState.xy !== undefined && newState.xy !== undefined)
        isUpdated = lightState.xy !== newState.xy || isUpdated;
    }

    // Copy colors if updated and new state is on
    if (isUpdated && newState.on) {
      lightState.on = newState.on,
      light.updateColor(newState);
    }

    // Update state variables
    lightState.reachable = newState.reachable;
    lightState.on = newState.on;

    // No change
    if (!isUpdated)
      return;

    // Calculate new color values
    let newStateColors = light.getColors();

    // Inform all subscribers
    Object.keys(lightServer.nodeListID[light.id]).forEach((nodeID) => {
      var node = lightServer.nodeListID[light.id][nodeID];
      
      updateNodeStatus(node, light);
      if (node.isOutput === true)
        node.send(newStateColors);
    });
  }

  // Request light information
  lightServer.hueApi.lights(function(err, val) {
    if (err) {
      lightServer.warn(err.toString());
      return;
    }
    val.lights.forEach((light) => {
      try {
        checkLight(light);
      }
      catch(e) {
        lightServer.warn(e.toString());
        return;
      }
    });
  });
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
    let bri = Math.floor((light.state.bri/255)*100);
    node.status({fill:"green",shape:"dot",text: `on (${bri}%)`});
  }
}


module.exports = function(RED) {
  /**
   * Server handling all lights
   * @class  LightServer
   */
  function LightServer(config) {
    var self = this;
    RED.nodes.createNode(self, config);

    self.name    = config.name;
    self.key     = config.key;
    self.network = config.network;
    self.interval= config.interval;

    // Ensure that we don't use to low poll interval
    if (self.interval !== 'number' || self.interval < 500)
      self.interval = 500;

    this.nodeListID = {};
    this.nodeListIDCount = 0;

    this.lightListID = {};
    this.lights = {
      lightID: {},
      lightMap: {},
      lightName: {},
    }

    // Create new API
    this.hueApi = new nodeHueApi.HueApi(this.network, this.key);

    // Try to fetch lights
    self.hueApi.lights(function(err, data) {
      if (err) {
        self.error(err.toString());
        return;
      }

      data.lights.forEach((item) => {
        var light = new LightItem(item);

        self.lights.lightMap[light.uniqueid] = light;
        self.lightListID[light.id] = light;

        self.statusUpdateLight(light);
      });

      // Only start poll after successfully  got all lights
      self.huePollInterval = setInterval(self.huePoll, self.interval);
    });

    self.on('close', self.stop.bind(self));

    this.huePollInterval = null;
    this.huePoll = huePoll.bind(this, this);
  }

  /**
   * Stop the server
   */
  LightServer.prototype.stop = function stop() {
    if (this.huePollInterval !== null)
      clearInterval(this.huePollInterval);
    this.huePollInterval = null;
  }

  /**
   * Using light find all connected nodes and update state for them
   * @param  {object} light Lifx light
   */
  LightServer.prototype.statusUpdateLight = function statusUpdateLight(light) {
    //var self = this;

    if (this.nodeListID.hasOwnProperty(light.info.id)) {
      let tmp = this.nodeListID[light.info.id];
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
  LightServer.prototype.registerNode = function registerNode(lightID, nodeID, node) {
    if (!this.nodeListID.hasOwnProperty(lightID))
      this.nodeListID[lightID] = {};
    this.nodeListID[lightID][nodeID] = node;


    if (this.lightListID.hasOwnProperty(lightID)) {
      let light = this.lightListID[lightID];
      updateNodeStatus(light, node);
      if (node.isOutput)
        node.send(light.getColors());

    }
  };

  /**
   * Remove Node-Red node from the server
   * @param  {string} lightID ID/Label for the light
   * @param  {string} nodeID  ID for the node
   */
  LightServer.prototype.unregisterNode = function unregisterNode(lightID, nodeID) {

    if (!this.nodeListID.hasOwnProperty(lightID))
      return;

    if (!this.nodeListID[lightID].hasOwnProperty(nodeID))
      return;
    
    delete this.nodeListID[lightID][nodeID];

  };


  /**
   * Change light state
   * @param  {string} lightID ID/Label for the light
   * @param  {object} value   New values for the light
   */
  LightServer.prototype.changeLightState = function changeLightState(lightID, value) {
    var self = this;

    if (!this.lightListID.hasOwnProperty(lightID))
      return;

    var light = this.lightListID[lightID];

    // Ensure that we don't trigger on our own update
    light.modified = process.uptime() + 1;

    // Update light color
    light.updateColor(value);

    if (typeof value.on === 'boolean') {
      light.state.on = value.on;
    }

    // Build new light state
    var newState = nodeHueApi.lightState.create();

    // Delay
    if (typeof value.delay === 'number') {
      newState.transition(value.delay);
      
      // Increase modified value to include delay
      light.modified += Math.floor(1 + (value.delay/1000));
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
    this.hueApi.setLightState(light.id, newState, function(err) {
      if (err) {
        self.warn(err.toString());
        return;
      }
    })

    // No nodes for this light
    if (!this.nodeListID.hasOwnProperty(lightID))
      return 

    // Calculate colors for this light
    var newStateColors = light.getColors();

    // Update status for all nodes and send data to input nodes
    Object.keys(this.nodeListID[lightID]).forEach((nodeID) => {
      var node = this.nodeListID[lightID][nodeID];
      
      updateNodeStatus(node, light);
      if (node.isOutput === true)
        node.send(newStateColors);
    });

  }

  RED.nodes.registerType("node-hue-server", LightServer);
}


