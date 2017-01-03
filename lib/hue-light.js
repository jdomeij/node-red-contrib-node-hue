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
 * Converts/Filters Hue info to internal state object
 * @param  {object} hueInfo Hue info
 * @return {object} Internal state
 */
function convertHueState(hueInfo) {
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

  var state = _.reduce(hueInfo.state, (coll, value, key) => {
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

  this.state = convertHueState(hueLight);

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

  var hueState = convertHueState(info);
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
    // Convert to kelvin
    let temp = 1000000 / this.state.ct;
    // Convert to rgb
    let rgb = colorTemp.temp2rgb(temp);
    // Convert to hsv, set luminance to 1
    let hsv = colorSpace.rgb.hsl(rgb);
    hsv[1] = 10;
    hsv[2] = bri;
    // And finaly convert to xy
    xyY = colorSpace.hsv.xyy(hsv);
  }

  else {
    xyY = colorSpace.hsv.xyy([0, 0, bri]);
  }

  // Convert xyY to hsv, use original brightness
  let hsv = colorSpace.xyy.hsv(xyY);
  hsv[2] = bri;

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
 * Update node status to according to light status
 * @param  {object}     node    Flow node
 */
LightItem.prototype.updateNodeStatus = function updateNodeStatus(node) {

  if (!this.state.reachable) {
    node.status({fill:"red",shape:"ring",text:"disconnected"});
  } else if (!this.state.on) {
    node.status({fill:"grey",shape:"dot",text:"off"});
  } else {
    let bri = Math.floor((this.state.bri/2.55));
    node.status({fill:"yellow",shape:"dot",text: `on (${bri}%)`});
  }
}


/**
 * Create Hue API lightState with the current values
 * @return {object} lightState for current light
 */
LightItem.prototype.getLightState = function getLightState() {
  // Build new light state
  var newState = nodeHueApi.lightState.create();

  // New state is on
  if (this.state.on) {
    newState.on();

    if (this.state.bri !== undefined)
      newState.bri(this.state.bri);

    // New temperature or color
    if (this.state.ct !== undefined)
      newState.ct(this.state.ct);
    else if (this.state.xy !== undefined)
      newState.xy(this.state.xy);
  }
  else
    newState.off();

  return newState;
}

// Export
module.exports = LightItem;