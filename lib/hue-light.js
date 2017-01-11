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
  BRIGHTNESS:   'bri',
  COLOR_XY:     'xy',
  COLOR_HUE:    'hs',
  TEMPERATURE:  'ct',
});


/**
 * Converts/Filters Hue info to internal state object
 * @param  {object}  hueInfo Hue info
 * @param  {boolean} isLight Light or Group boolean
 * @return {object} Internal state
 */
function convertHueState(hueInfo, isLight) {
  const hueStateProperties = {
    on: true,
    bri: true,
    hue: true,
    sat: true,
    xy: true,
    ct: true,
    colormode: true,
  };

  // Get current state
  var hueState = hueInfo.state;
  if (!isLight)
    hueState = hueInfo.action;

  var state = _.reduce(hueState, (coll, value, key) => {
    if (!hueStateProperties.hasOwnProperty(key))
      return coll;

    var stateItem = hueStateProperties[key];
    if (stateItem === true)
      coll[key] = value;
    if (typeof stateItem === 'string')
      coll[stateItem] = value;
    return coll;
  }, {});


  if (state.colormode == null) {
    if (hueInfo.state.ct !== undefined)
      state.colormode = 'ct';
    else
      state.colormode = 'bri';
  }

  return state;
}


/**
 * Ensure that value is inside value range
 * @param  {number} val Current value
 * @param  {number} min Min value
 * @param  {number} max Max value
 * @return {number} Limited value
 */
function limitValue(val, min, max) {
  if (isNaN(val))
    val = min;
  if (val > max)
    val = max;
  if (val < min)
    val = min;
  return val;
}


/**
 * Item representing one light
 * @param {string}  id        ID for light/group
 * @param {object}  hueInfo   HUE item info
 * @param {boolean} isLight   Is item a light, or group
 */
function LightItem(id, hueInfo, isLight) {
  this.id = id;
  this.modified = 0;
  this.isLight = isLight;

  this.info = {
    id:       hueInfo.id,
    name:     hueInfo.name,
    reachable: true,
  }

  this.state = convertHueState(hueInfo, isLight);

  // Light
  if (isLight) {
    this.info.uniqueid = hueInfo.uniqueid;
    this.info.type = hueInfo.type;
    this.info.modelid = hueInfo.modelid;
    this.info.reachable = hueInfo.state.reachable;
  }
  // Group
  else {
    // Copy light list
    this.info.lights = hueInfo.lights.slice(0);
  }


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
 * @param  {object} hueInfo Hue light information
 */
LightItem.prototype.updateInfo = function updateInfo(hueInfo) {
  // We need to ignore the changes for this light until modified value has expired
  if (this.modified >= process.uptime())
    return;

  var hueState = convertHueState(hueInfo, this.isLight);
  var isUpdated = false;

  // Check if light has changes reachable
  if (this.isLight && hueInfo.state.reachable !== this.info.reachable) {
    isUpdated = true;
    this.info.reachable = hueInfo.state.reachable;
  }


  // Determine if state is updated
  isUpdated = this.state.on !== hueState.on || isUpdated;

  // Only check the rest of values if light is on
  if (hueState.on) {
    isUpdated = !_.isEqual(this.state, hueState);
    if (isUpdated)
      _.merge(this.state, hueState);
  }
  else {
    // Update state variables
    this.state.on = hueState.on;
  }

  // Copy info
  this.info.name = hueInfo.name;
  this.info.type = hueInfo.type;

  // Values/state has been updated, only emit if light is reachable
  if (this.info.reachable && isUpdated) {
    this.emit('change');
  }
}


/**
 * Check if we have new color and calculate updated properties
 * @param  {object} input  Input arguments
 * @param  {object} output New state arguments
 * @return {bool}          Is color updated
 */
LightItem.prototype.parseColorRGB = function parseColorRGB(input, output) {

  // No color support
  if (this.state.xy === undefined)
    return false;

  var changed = false;
  var xyY = [this.state.xy[0], this.state.xy[1], this.state.bri/2.55];

  // Color parsing
  // xy
  if (_.isArray(input.xy) &&
      input.xy.length === 2 &&
      _.isFinite(input.xy[0]) &&
      _.isFinite(input.xy[1])) {
    changed = true;
    xyY[0] = limitValue(input.xy[0], 0, 1);
    xyY[1] = limitValue(input.xy[1], 0, 1);
  }

  // x part of xy
  else if (_.ixFinite(input.x)) {
    changed = true;
    xyY[0] = limitValue(input.x, 0, 1);
  }

  // y part of xy
  else if (_.ixFinite(input.y)) {
    changed = true;
    xyY[1] = limitValue(input.y, 0, 1);
  }

  // hue
  else if (_.isFinite(input.hue)) {
    changed = true;
    let hsv = colorSpace.xyy.hsv(xyY);
    hsv[0] = input.hue;
    xyY = colorSpace.hsv.xyy(hsv);
  }

  // rgb channel
  else if (_.isFinite(input.red) ||
           _.isFinite(input.green) ||
           _.isFinite(input.blue))
  {
    changed = true;
    let rgb = colorSpace.xyY.rgb(xyY);
    if (_.isFinite(input.red))
      rgb[0] = input.red;
    if (_.isFinite(input.green))
      rgb[1] = input.green;
    if (_.isFinite(input.blue))
      rgb[2] = input.blue;

    // Ensure that values is in valid range
    rgb[0] = limitValue(rgb[0], 0, 255);
    rgb[1] = limitValue(rgb[1], 0, 255);
    rgb[2] = limitValue(rgb[2], 0, 255);

    xyY = colorSpace.rgb.xyy(rgb);
  }

  // hex
  else if (typeof input.hex === 'string' && /^#?[0-9a-fA-F]{6}$/.test(input.hex)) {
    changed = true;
    xyY = colorSpace.rgb.xyy(colorConvert.hex.rgb(input.hex));
  }


  // Saturation
  if (_.isFinite(input.sat)) {
    changed = true;
    let hsv = colorSpace.xyy.hsv(xyY);
    hsv[1] = limitValue(input.sat, 0, 100);
    xyY = colorSpace.hsv.xyy(hsv);
  }
  else if (_.isFinite(input.saturation)) {
    changed = true;
    let hsv = colorSpace.xyy.hsv(xyY);
    hsv[1] = limitValue(input.saturation, 0, 100);
    xyY = colorSpace.hsv.xyy(hsv);
  }

  // No change
  if (!changed)
    return false;

  // Don't trigger change on brightness
  if (_.isFinite(input.bri)) {
    xyY[2] = input.bri;
  }
  else if (_.isFinite(input.brightness)) {
    xyY[2] = input.brightness;
  }


  output.colormode = ColorMode.COLOR.val;
  output.xy  = [ Math.round(10000*xyY[0])/10000, Math.round(1000*xyY[1])/10000 ];
  output.bri = limitValue(Math.round(xyY[2]), 0, 255);

  return true;
}


/**
 * Check if we have new temperature color and calculate updated properties
 * @param  {object} input  Input arguments
 * @param  {object} output New state arguments
 * @return {bool}          Is temperature color updated
 */
LightItem.prototype.parseColorTemp = function parseColorTemp(input, output) {

  // No color temperature support
  if (this.state.ct === undefined)
    return false;

  var ct  = this.state.ct;
  var bri = this.state.bri;
  var changed = false;

  // Mired/Mirek color temperature
  if (_.isFinite(input.ct)) {
    ct = input.ct;
    changed = true;
  }

  else if (_.isFinite(input.mirek)) {
    ct = input.mirek;
    changed = true;
  }

  else if (_.isFinite(input.mired)) {
    ct = input.mired;
    changed = true;
  }

  // Kelvin color temperature
  else if (_.isFinite(input.kelvin)) {
    ct = 1000000 / limitValue(input.kelvin, 2000, 8000);
    changed = true;
  }

  // Brightness
  if (_.isFinite(input.bri))
    bri = input.bri * 2.55;
  else if (_.isFinite(input.brightness))
    bri = input.brightness * 2.55;

  // No changes (brightness does not count)
  if (!changed)
    return false;

  output.colormode = ColorMode.TEMPERATURE.val;
  output.ct        = limitValue(Math.round(ct), 125, 500);
  output.bri       = limitValue(Math.round(bri), 0, 255);
  return true;
}


/**
 * Check if we have new brightness value and calculate updated properties
 * @param  {object} input  Input arguments
 * @param  {object} output New state arguments
 * @return {bool}          Is brightness updated
 */
LightItem.prototype.parseBrightness = function parseBrightness(input, output) {
  var bri = this.state.bri;
  var changed = false;
  
  if (_.isFinite(input.bri)) {
    changed = true;
    bri = input.bri * 2.55;
  }

  else if (_.isFinite(input.brightness)) {
    changed = true;
    bri = input.brightness * 2.55;
  }

  // No change
  if (!changed)
    return false;

  // We don't set new mode if only brightness was changed
  output.bri = limitValue(Math.round(bri), 0, 255);
  return true;
}


/**
 * Update light to new state, parse/convert input parameters to correct light parameter
 * @param  {object}   input       Input arguments
 * @param  {function} sendToLight Function to update light state
 * @return {object}               Updated state parameters
 */
LightItem.prototype.setColor = function setColor(input, sendToLight) {

  var newValues = {};

  // Ensure that input is of correct type
  if (typeof input !== 'object') {
    // Convert boolean to on
    if (typeof input === 'boolean') {
      input = {on: input};
    }
    // On/Off string
    else if (typeof input === 'string' && (input === 'on' || input === 'off')) {
      input = { on: (input === 'on') };
    }
    // Convert number to brightness
    else if (typeof input === 'number') {
      input = { on: true, bri: input };
    }
    // Unknown input
    else {
      this.emit('warning', 'Unhandled input', input);
      return;
    }
  }

  // First check if RGB values has been updated
  if (this.parseColorRGB(input, newValues))
    ;

  // If not check if temp values
  else if (this.parseColorTemp(input, newValues))
    ;

  // Always check if brightness is updated
  else if (this.parseBrightness(input, newValues))
    ;

  // On/Off
  if (typeof input.on === 'boolean')
    newValues.on = input.on;

  // Update current state
  _.merge(this.state, newValues);

  // Update modified so we don't trigger on our own changes
  this.modified = process.uptime() + 2;

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

  // Duration specified
  if (typeof input.duration === 'number' && input.duration > 0) {
    newState.transition(input.duration);
    
    // Increase modified value to include transition time
    this.modified += Math.round(1 + (input.duration/1000));
  }

  // Send new state to light
  sendToLight(this.info.id, newState);

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
    reachable:  this.info.reachable,
    colormode:  this.state.colormode,

    bri: Math.round(bri),

    xy:  [ Math.round(10000*xyY[0])/10000, Math.round(10000*xyY[1])/10000 ],
    hsv: [ Math.round(hsv[0]), Math.round(hsv[1]), Math.round(hsv[2]) ],
    rgb: [ Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2]) ],
  
    hex:   colorConvert.rgb.hex(rgb),
    color: colorConvert.rgb.keyword(rgb),
  }

  // Only generate if we have temperature light
  if (this.state.ct !== undefined) {
    payload.mired  = Math.round(this.state.ct);
    payload.kelvin = Math.round(1000000 / this.state.ct);
  }

  // Build return value
  var retVal = {
    id:       this.id,
    type:     this.isLight ? 'light' : 'group',
    name:     this.info.name,
    payload: payload
  };

  if (this.isLight)
    retVal.uniqueid = this.info.uniqueid;

  return retVal;
}


/**
 * Update node status to according to light status
 * @param  {object}     node    Flow node
 */
LightItem.prototype.updateNodeStatus = function updateNodeStatus(node) {

  if (!this.info.reachable) {
    node.status({fill:"red",shape:"ring",text:"disconnected"});
  } else if (!this.state.on) {
    node.status({fill:"grey",shape:"dot",text:"off"});
  } else {
    let bri = Math.round((this.state.bri/2.55));
    node.status({fill:"yellow",shape:"dot",text: `on (${bri}%)`});
  }
}


// Export
module.exports = LightItem;