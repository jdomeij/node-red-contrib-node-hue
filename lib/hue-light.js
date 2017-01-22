"use strict";
var nodeHueApi = require('node-hue-api');
var _          = require('lodash');
var Enum       = require('enum');

var inherits      = require('util').inherits;
var EventEmitter  = require('events').EventEmitter;

var colorConvert   = require('color-convert');
var colorTemp      = require('color-temp');
var colorSpace     = require('color-space');


// Light capability
const LightCapability = new Enum([
  'BRI', // Default
  'XY',
  'HS',
  'CT'
]);


// Table mapping "Model ID" to "Product Name"
var HueModelInfo = (function() {
  var retVal = {};
  
  /**
   * Create "Model ID" to "Product Name" mapping
   * @param  {string} name Product Name
   * @param  {string} type Device ID
   * @param  {string} id   Model ID
   */
  function parseModelInfo(name, type, id) {
    id.split(/ *, */).forEach((hwID)=> {
      retVal[hwID] = name;
    });
  }

  // Copied from "developers.meethue.com/documentation/supported-lights"
  parseModelInfo("Hue bulb A19", "0x0210 (Extended Color Light)", "LCT001, LCT007", "B", "Yes");
  parseModelInfo("Hue bulb A19", "0x0210 (Extended Color Light)", "LCT010, LCT014", "C", "Yes");
  parseModelInfo("Hue Spot BR30", "0x0210 (Extended Color Light)", "LCT002", "B", "Yes");
  parseModelInfo("Hue Spot GU10", "0x0210 (Extended Color Light)", "LCT003", "B", "Yes");
  parseModelInfo("Hue BR30", "0x0210 (Extended Color Light)", "LCT011", "C", "Yes");
  parseModelInfo("Hue LightStrips", "0x0200 (Color Light)", "LST001", "A", "Yes");
  parseModelInfo("Hue Living Colors Iris", "0x0200 (Color Light)", "LLC010", "A", "Yes");
  parseModelInfo("Hue Living Colors Bloom", "0x0200 (Color Light)", "LLC011, LLC012", "A", "Yes");
  parseModelInfo("Living Colors Gen3 Iris*", "0x0200 (Color Light)", "LLC006", "A", "No");
  parseModelInfo("Living Colors Gen3 Bloom, Aura*", "0x0200 (Color Light)", "LLC007", "A", "No");
  parseModelInfo("Disney Living Colors", "0x0200 (Color Light)", "LLC013", "A", "Yes");
  parseModelInfo("Hue A19 Lux", "0x0100 (Dimmable Light)", "LWB004, LWB006, LWB007, LWB010, LWB014", "-", "Yes");
  parseModelInfo("Color Light Module", "0x0210 (Extended Color Light)", "LLM001", "B", "Yes");
  parseModelInfo("Color Temperature Module", "0x0220 (Color Temperature Light)", "LLM010, LLM011, LLM012", "2200K-6500K", "Yes");
  parseModelInfo("Hue A19 White Ambiance", "0x0220 (Color Temperature Light)", "LTW001, LTW004", "2200K-6500K", "Yes");
  parseModelInfo("Hue GU-10 White Ambiance", "0x0220 (Color Temperature Light)", "LTW013, LTW014", "2200K-6500K", "Yes");
  parseModelInfo("Hue Go", "0x0210 (Extended Color Light)", "LLC020", "C", "Yes");
  parseModelInfo("Hue LightStrips Plus", "0x0210 (Extended Color Light)", "LST002", "C", "Yes");

  return retVal;
})();


/**
 * Calculate capability map from state information
 * @param  {object} state Internal state
 * @return {Enum}  Capability bitmask
 */
function calculateCapabilties(state) {
  var caps = LightCapability.BRI;

  if (_.isArray(state.xy) && state.xy.length === 2 &&
      _.isFinite(state.xy[0]) && _.isFinite(state.xy[1])) {
    caps = LightCapability.get(caps | LightCapability.XY);
  }

  if (_.isFinite(state.hue) && _.isFinite(state.sat)) {
    caps = LightCapability.get(caps | LightCapability.HS);
  }

  if (_.isFinite(state.ct)) {
    caps = LightCapability.get(caps | LightCapability.CT);
  }

  return caps;
}


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
  this.info.capability = calculateCapabilties(this.state);

  // Light
  if (isLight) {
    this.info.uniqueid  = hueInfo.uniqueid;
    this.info.type      = hueInfo.type;
    this.info.modelid   = hueInfo.modelid;
    this.info.reachable = hueInfo.state.reachable;
  }
  // Group
  else {
    this.info.class     = hueInfo.class;
    this.info.type      = hueInfo.type;

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

  var newState = convertHueState(hueInfo, this.isLight);
  var isUpdated = false;

  // Check if light has changes reachable
  if (this.isLight && hueInfo.state.reachable !== this.info.reachable) {
    isUpdated = true;
    this.info.reachable = hueInfo.state.reachable;
  }

  // Determine if state is updated
  isUpdated = !_.isEqual(this.state, newState);
  if (isUpdated) {
    this.state = newState;
    this.info.capability = calculateCapabilties(this.state);
  }

  // Copy info
  this.info.name = hueInfo.name;
  this.info.type = hueInfo.type;

  // Values/state has been updated
  if (isUpdated) {
    this.emit('update');
  }
}


/**
 * Check if we have new color and calculate updated properties
 * @param  {object} input  Input arguments
 * @param  {object} output New state arguments
 * @return {bool}          Is color updated
 */
LightItem.prototype.parseColorRGB = function parseColorRGB(input, output) {
  // No XY color support
  if (!(this.info.capability & LightCapability.XY) &&
      !(this.info.capability & LightCapability.HS) )
    return false;

  var changed = false;
  var xyY;
  var hsv;


  if (this.info.capability & LightCapability.XY) {
    xyY = [this.state.xy[0], this.state.xy[1], (this.state.bri * 100) / 0xFF];
  }
  // TODO: Untested
  else {
    xyY = colorSpace.hsv.xyy([0, 0, (this.state.bri * 100) / 0xFF]);
  }

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
    hsv = colorSpace.xyy.hsv(xyY);
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
    if (hsv === undefined)
      hsv = colorSpace.xyy.hsv(xyY);
    hsv[1] = limitValue(input.sat, 0, 100);
    xyY = colorSpace.hsv.xyy(hsv);
  }
  else if (_.isFinite(input.saturation)) {
    changed = true;
    if (hsv === undefined)
      hsv = colorSpace.xyy.hsv(xyY);
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

  if (this.info.capability & LightCapability.XY) {
    output.colormode = 'xy';
    output.xy = [
      limitValue(Math.round(10000*xyY[0])/10000),
      limitValue(Math.round(10000*xyY[1])/10000)
    ];
    output.bri = limitValue(Math.round(xyY[2]*(0xFF/100), 0, 0xFF));
  }
  else {
    output.colormode = 'hsv';
    if (hsv === undefined)
      hsv = colorSpace.xyy.hsv(xyY);
    output.hue = limitValue(Math.round(hsv[0]*(0xFFFF/360), 0, 0xFFFF));
    output.sat = limitValue(Math.round(hsv[1]*(0xFF/100), 0, 0xFF));
    output.bri = limitValue(Math.round(xyY[2]*(0xFF/100), 0, 0xFF));
  }
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
  if (!(this.info.capability & LightCapability.CT))
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
    bri = (input.bri * 0xFF) / 100;
  else if (_.isFinite(input.brightness))
    bri = (input.brightness * 0xFF) / 100;

  // No changes (brightness does not count)
  if (!changed)
    return false;

  output.colormode = 'ct';
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
    bri = (input.bri * 0xFF) / 100;
  }

  else if (_.isFinite(input.brightness)) {
    changed = true;
    bri = (input.brightness * 0xFF) / 100;
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
 * @return {object}               Updated state parameters
 */
LightItem.prototype.setColor = function setColor(input) {

  var newValues = {
    on: this.state.on
  };

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

  // Only copy new value of new state is on
  if (newValues.on === true) {
    // Update current state
    _.merge(this.state, newValues);
  }
  // Light off
  else {
    this.state.on = false;
  }

  // Update modified so we don't trigger on our own changes
  this.modified = process.uptime() + 2;

  // Build new light state
  var newState = nodeHueApi.lightState.create();

  // On, it's not possible to set color when going offline
  if (this.state.on) {
    newState.on();

    // Brightness
    newState.bri(this.state.bri);

    // Color
    if (this.state.colormode === 'ct') {
      newState.ct(this.state.ct);
    }
    else if (this.state.colormode === 'xy') {
      newState.xy(this.state.xy);
    }
    else if (this.state.colormode === 'hue') {
      newState.hue(this.state.hue);
      newState.sat(this.state.sat);
    }
  }
  // Off
  else {
    newState.off();
  }

  // Duration specified
  if (typeof input.duration === 'number' && input.duration > 0) {
    newState.transition(input.duration);
    
    // Increase modified value to include transition time
    this.modified += Math.round(1 + (input.duration/1000));
  }

  // Emit change to server to update light
  this.emit('sendToLight', this.info.id, newState);

  this.emit('change');

  return newValues;
}


/**
 * Get node-red message for the current state of the light
 * @return {object} State information
 */
LightItem.prototype.getStateMessage = function getStateMessage() {
  var self = this;

  //var hsv = [state.hue, state.saturation, state.brightness];
  var xyY ;
  var bri = (this.state.bri * 100) / 0xFF;

  // XY Color
  if (this.info.capability & LightCapability.XY) {
    xyY = [this.state.xy[0], this.state.xy[1], bri];
  }
  // TODO: Untested
  else if (this.info.capability & LightCapability.HUE) {
    xyY = colorSpace.hsv.xyy((this.state.hue * 359) / 0xFFFF, (this.state.sat * 100) / 0xFF, bri);
  }

  // Temperature Color
  else if (this.info.capability & LightCapability.CT) {
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

  // Brightness
  else {
    xyY = colorSpace.hsv.xyy([0, 0, bri]);
  }

  // Convert xyY to hsv, use original brightness
  let hsv = colorSpace.xyy.hsv(xyY);
  hsv[2] = bri;

  // Convert to rgb
  let rgb = colorSpace.hsv.rgb(hsv);
  if (!_.isArray(rgb))
    rgb = [0, 0, 0];


  // Create state message
  var retVal = {
    id: this.id,

    // Light information
    info: {
      id:   this.info.id,
      name: this.info.name,
  
      // Conver bitmask to capability
      capability: LightCapability.enums.reduce((coll, enumItem) => {
        if (self.info.capability & enumItem)
          coll.push(enumItem.key.toLowerCase());
        return coll;
      }, []),
    },

    // Calculated colors
    payload: {
      on:        this.state.on,
      reachable: this.info.reachable,

      bri:  Math.round((this.state.bri * 100) / 0xFF),

      xy:  [ Math.round(10000*xyY[0])/10000, Math.round(10000*xyY[1])/10000 ],
      hsv: [ Math.round(hsv[0]), Math.round(hsv[1]), Math.round(hsv[2]) ],
      rgb: [ Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2]) ],
    
      hex:   colorConvert.rgb.hex(rgb),
      color: colorConvert.rgb.keyword(rgb),
    },

    // Raw internal state
    state: _.merge({}, this.state)
  }

  // Add light specific information
  if (this.isLight) {
    retVal.info.group     = false;
    retVal.info.type      = this.info.type;
    retVal.info.uniqueid  = this.info.uniqueid;
    retVal.info.modelid   = this.info.modelid;
    retVal.info.modelname = HueModelInfo[retVal.modelid];
  }
  // Add group specific information
  else {
    retVal.info.group   = true;
    retVal.info.type    = this.info.type;
    retVal.info.class   = this.info.class;
    retVal.info.lights  = this.info.lights.slice(0);
  }

  if (this.state.colormode === 'ct') {
    retVal.payload.mired  = Math.round(this.state.ct);
    retVal.payload.kelvin = Math.round(1000000 / this.state.ct);
  }

  return retVal;
}


// Export
module.exports = LightItem;
