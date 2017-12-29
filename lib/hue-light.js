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


/**
 * Convert RGB value to Hue xy space
 * @param  {array}   rgb    RGB value array
 * @param  {?object} config Configuration
 * @param  {?number} config.divide Divider to use for input value
 * @param  {?number} config.gamma Should we do gamma correction (default true)
 * @return {array} The xy value
 */
function convertRGB2HueXY(rgb, config) {
  // Convert input values if needed
  if (_.isPlainObject(config) && _.isFinite(config.divide)) {
    rgb = [
      rgb[0] / config.divide,
      rgb[1] / config.divide,
      rgb[2] / config.divide
    ];
  }

  // Apply a gamma correction to the RGB values
  if (!(_.isPlainObject(config) && config.gamma !== false)) {
    rgb = [
      ((rgb[0] > 0.04045) ? Math.pow((rgb[0] + 0.055) / (1.0 + 0.055), 2.4) : (rgb[0] / 12.92)),
      ((rgb[1] > 0.04045) ? Math.pow((rgb[1] + 0.055) / (1.0 + 0.055), 2.4) : (rgb[1] / 12.92)),
      ((rgb[2] > 0.04045) ? Math.pow((rgb[2] + 0.055) / (1.0 + 0.055), 2.4) : (rgb[2] / 12.92))
    ];
  }

  // Apply wide gamut conversion D65
  var XYZ = [
    rgb[0] * 0.664511 + rgb[1] * 0.154324 + rgb[2] * 0.162028,
    rgb[0] * 0.283881 + rgb[1] * 0.668433 + rgb[2] * 0.047685,
    rgb[0] * 0.000088 + rgb[1] * 0.072310 + rgb[2] * 0.986039
  ];

  // Calculate the xy values from the XYZ values
  var xy = [
    XYZ[0] / (XYZ[0] + XYZ[1] + XYZ[2]),
    XYZ[1] / (XYZ[0] + XYZ[1] + XYZ[2])
  ];

  xy = [
    limitValue(xy[0], 0, 1),
    limitValue(xy[1], 0, 1)
  ];

  return xy;
}


/**
 * Convert Hue xy value to RGB
 * @param  {array}   xy    Hue xy value array
 * @param  {number}  bri   Brightness value
 * @param  {?object} config Configuration
 * @param  {?number} config.multiply Multiplier to use for output value
 * @param  {?number} config.gamma Should we do gamma correction (default true)
 * @return {array} The RGB value
 */
function convertHueXY2RGB(xy, bri, config) {
  // Convert to XYZ
  var XYZ = [
    (bri / xy[1]) * xy[0],
    bri,
    (bri / xy[1]) * (1 - xy[0] - xy[1]),
  ]

  // Convert to RGB using Wide RGB D65 conversion
  var rgb = [
    +XYZ[0] * 1.656492 - XYZ[1] * 0.354851 - XYZ[2] * 0.255038,
    -XYZ[0] * 0.707196 + XYZ[1] * 1.655397 + XYZ[2] * 0.036152,
    +XYZ[0] * 0.051713 - XYZ[1] * 0.121364 + XYZ[2] * 1.011530
  ]

  // Apply reverse gamma correction
  if (!(_.isPlainObject(config) && config.gamma !== false)) {
    rgb  [
      rgb[0] <= 0.0031308 ? 12.92 * rgb[0] : (1.0 + 0.055) * Math.pow(rgb[0], (1.0 / 2.4)) - 0.055,
      rgb[1] <= 0.0031308 ? 12.92 * rgb[1] : (1.0 + 0.055) * Math.pow(rgb[1], (1.0 / 2.4)) - 0.055,
      rgb[2] <= 0.0031308 ? 12.92 * rgb[2] : (1.0 + 0.055) * Math.pow(rgb[2], (1.0 / 2.4)) - 0.055
    ];
  }

  // Limit rgb values
  rgb = [
    limitValue(rgb[0], 0, 1),
    limitValue(rgb[1], 0, 1),
    limitValue(rgb[2], 0, 1)
  ];

  // Convert output values
  if (_.isPlainObject(config) && _.isFinite(config.multiply)) {
    rgb = [
      rgb[0] * config.multiply,
      rgb[1] * config.multiply,
      rgb[2] * config.multiply
    ];
  }
  return rgb;
}


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

  if (!_.isPlainObject(state))
    return caps;

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

  // Need state to be defined before calling convertHueState
  this.state = {};

  this.state = this.convertHueState(hueInfo, isLight);
  this.info.capability = calculateCapabilties(this.state);

  // Light
  if (isLight) {
    this.info.uniqueid  = hueInfo.uniqueid || 'n/a';
    this.info.type      = hueInfo.type || 'n/a';
    this.info.modelid   = hueInfo.modelid || 'n/a';
    this.info.reachable = (hueInfo.hasOwnProperty('state') && hueInfo.state.reachable === true);
  }
  // Group
  else {
    this.info.class     = hueInfo.class || 'n/a';
    this.info.type      = hueInfo.type || 'n/a';

    // Copy light list
    this.info.lights = [];
    if (hueInfo.hasOwnProperty('lights') && _.isArray(hueInfo.lights))
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
  if (!_.isPlainObject(hueInfo) ||
      !_.isPlainObject(hueInfo.state))
    return;

  // We need to ignore the changes for this light until modified value has expired
  if (this.modified >= process.uptime()) {
    return;
  }


  var newState = this.convertHueState(hueInfo, this.isLight);
  var isUpdated = false;

  if (!_.isPlainObject(newState)) {
    return;
  }

  // Check if light has changes reachable
  if (this.isLight && hueInfo.state.reachable !== this.info.reachable) {
    isUpdated = true;
    this.info.reachable = hueInfo.state.reachable;
  }

  // Workaround for items missing brightness
  if (newState.bri === undefined) {
    newState.bri = 0;
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
 * Converts/Filters Hue info to internal state object
 * @param  {object}  hueInfo Hue info
 * @param  {boolean} isLight Light or Group boolean
 * @return {object} Internal state
 */
LightItem.prototype.convertHueState = function convertHueState(hueInfo, isLight) {
  if (!_.isPlainObject(hueInfo) || !_.isPlainObject(hueInfo.state))
    return

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


  // Workaround for system withouth brightness
  if (state.bri === undefined)
    state.bri = this.state.bri || 0;
  if (state.on === undefined)
    state.on = this.state.on || false;


  if (state.colormode == null) {
    if (hueInfo.state.ct !== undefined)
      state.colormode = 'ct';
    else
      state.colormode = 'bri';
  }

  return state;
}


/**
 * Check if we have new color and calculate updated properties
 * Node: The XY support is not 100% correct so we prefer the HS method
 * @param  {object} input  Input arguments
 * @param  {object} output New state arguments
 * @return {bool}          Is color updated
 */
LightItem.prototype.parseColorRGB = function parseColorRGB(input, output) {
  if (!_.isPlainObject(input) ||
      !_.isPlainObject(output))
    return;

  // Check for XY or HS color support
  if (!(this.info.capability & LightCapability.XY) &&
      !(this.info.capability & LightCapability.HS) )
    return false;

  var changed = null;
  var xy;
  var bri = (this.state.bri * 100) / 0xFF;
  var hsv = [0, 0, bri];

  // XY color
  if (this.info.capability & LightCapability.XY) {
    xy = [
      this.state.xy[0],
      this.state.xy[1]
    ];
  }

  // HSV color
  if (this.info.capability & LightCapability.HS) {
    hsv = [
      (this.state.hue * 359) / 0xFFFF,
      (this.state.sat * 100) / 0xFF,
      bri
    ];
  }

  // Generate missing color
  if (!(this.info.capability & LightCapability.XY)) {
    let rgb = colorSpace.hsv.rgb(hsv);
    xy = convertRGB2HueXY(rgb, {divide: 0xFF});
  }

  if (!(this.info.capability & LightCapability.HS)) {
    let rgb = convertHueXY2RGB(xy, 1, {multiply: 0xFF});
    hsv = colorSpace.rgb.hsv(rgb);
    hsv[2] = bri;
  }

  // Color parsing
  // xy
  if (_.isArray(input.xy) &&
      input.xy.length === 2 &&
      _.isFinite(input.xy[0]) &&
      _.isFinite(input.xy[1])) {
    changed = LightCapability.XY;

    xy[0] = limitValue(input.xy[0], 0, 1);
    xy[1] = limitValue(input.xy[1], 0, 1);

    let rgb = convertHueXY2RGB(xy, 1, {multiply: 0xFF});
    hsv = colorSpace.rgb.hsv(rgb);
    hsv[2] = bri;
  }

  // xy as separate parts
  else if (_.isFinite(input.x) ||
           _.isFinite(input.y)) {
    changed = LightCapability.XY;

    if (_.isFinite(input.x))
      xy[0] = limitValue(input.x, 0, 1);
    if (_.isFinite(input.y))
      xy[1] = limitValue(input.y, 0, 1);

    let rgb = convertHueXY2RGB(xy, 1, {multiply: 0xFF});
    hsv = colorSpace.rgb.hsv(rgb);
    hsv[2] = bri;
  }

  // hue
  else if (_.isFinite(input.hue)) {
    changed = LightCapability.HS;
    
    hsv[0] = limitValue(input.hue, 0, 359);
    let rgb = colorSpace.hsv.rgb(hsv);

    xy = convertRGB2HueXY(rgb, {divide: 0xFF});
  }

  // rgb channel
  else if (_.isArray(input.rgb) &&
          input.rgb.length === 3 &&
           _.isFinite(input.rgb[0]) &&
           _.isFinite(input.rgb[1]) &&
           _.isFinite(input.rgb[2])) {
    changed = LightCapability.HS | LightCapability.BRI;
    
    // Create new rgb ensuring valus is in valid range
    let rgb = [
      limitValue(input.rgb[0], 0, 0xFF),
      limitValue(input.rgb[1], 0, 0xFF),
      limitValue(input.rgb[2], 0, 0xFF)
    ];

    // Convert to hsv
    hsv = colorSpace.rgb.hsv(rgb);
    bri = hsv[2];

    // Convert to Hue xy
    xy = convertRGB2HueXY(rgb, {divide: 0xFF});
  }

  // rgb channel
  else if (_.isFinite(input.red) ||
           _.isFinite(input.green) ||
           _.isFinite(input.blue)) {
    changed = LightCapability.HS | LightCapability.BRI;


    // Convert HSV to RGB and update affected channels
    let rgb = colorSpace.hsv.rgb(hsv);

    // Get channel values
    if (_.isFinite(input.red))
      rgb[0] = input.red;
    if (_.isFinite(input.green))
      rgb[1] = input.green;
    if (_.isFinite(input.blue))
      rgb[2] = input.blue;

    // Ensure that values is in valid range
    rgb[0] = limitValue(rgb[0], 0, 0xFF);
    rgb[1] = limitValue(rgb[1], 0, 0xFF);
    rgb[2] = limitValue(rgb[2], 0, 0xFF);

    // Convert back to HSV
    hsv = colorSpace.rgb.hsv(rgb);
    bri = hsv[2];

    // Convert to Hue xy
    xy = convertRGB2HueXY(rgb, {divide: 0xFF});
  }

  // hex
  else if (typeof input.hex === 'string' && /^#?[0-9a-fA-F]{6}$/.test(input.hex)) {
    changed = LightCapability.HS | LightCapability.BRI;

    let rgb = colorConvert.hex.rgb(input.hex);

    hsv = colorSpace.rgb.hsv(rgb);
    bri = hsv[2];

    xy = convertRGB2HueXY(rgb, {divide: 0xFF});
  }


  // Saturation
  if (_.isFinite(input.sat)) {
    changed = LightCapability.HS;
    hsv[1] = limitValue(input.sat, 0, 100);

    let rgb = colorSpace.hsv.rgb(hsv);
    xy = convertRGB2HueXY(rgb, {divide: 0xFF});
  }
  else if (_.isFinite(input.saturation)) {
    changed |= LightCapability.HS;
    hsv[1] = limitValue(input.saturation, 0, 100);

    let rgb = colorSpace.hsv.rgb(hsv);
    xy = convertRGB2HueXY(rgb, {divide: 0xFF});
  }

  // No change
  if (changed === null)
    return false;

  // Don't trigger change on brightness
  if (_.isFinite(input.bri)) {
    changed |= LightCapability.BRI;
    bri = input.bri;
  }
  else if (_.isFinite(input.brightness)) {
    changed |= LightCapability.BRI;
    bri = input.brightness;
  }

  // Update brightness, Hue API limits the value to 254
  if (changed & LightCapability.BRI)
    output.bri = limitValue(Math.round(bri*(0xFF/100), 0, 254));

  // XY value was updated
  if (changed & LightCapability.XY) {
    // Use XY color if capable
    if (this.info.capability & LightCapability.XY) {
      output.colormode = 'xy';
      output.xy = [
        limitValue(Math.round(10000*xy[0])/10000),
        limitValue(Math.round(10000*xy[1])/10000)
      ];
    }
    // Convert to HSV color
    else if (this.info.capability & LightCapability.HS) {
      output.colormode = 'hs';
      output.hue = Math.round((hsv[0] * 0xFFFF) / 359);
      output.sat = Math.round((hsv[1] * 0xFF) / 100);
    }
  }
  // HSV value was updated
  else if (changed & LightCapability.HS) {
    // Use HSV value if capable
    if (this.info.capability & LightCapability.HS) {
      output.colormode = 'hs';
      output.hue = Math.round((hsv[0] * 0xFFFF) / 359);
      output.sat = Math.round((hsv[1] * 0xFF) / 100);
    }
    // Convert to XY color
    else if (this.info.capability & LightCapability.XY) {
      output.colormode = 'xy';
      output.xy = [
        limitValue(Math.round(10000*xy[0])/10000),
        limitValue(Math.round(10000*xy[1])/10000)
      ];
    }
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
  // Max value according to Hue API is 254
  output.bri       = limitValue(Math.round(bri), 0, 254);
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
  // Max value according to Hue API is 254
  output.bri = limitValue(Math.round(bri), 0, 254);
  return true;
}


/**
 * Update light to new state, parse/convert input parameters to correct light parameter
 * @param  {object}   input       Input arguments
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

  // First check if color values has been updated
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
    if (newValues.bri !== undefined)
      newState.bri(this.state.bri);

    // Color temp
    if (this.state.colormode === 'ct' && newValues.ct !== undefined) {
      newState.ct(this.state.ct);
    }
    // Hsv value
    else if (this.state.colormode === 'hs' && 
             (newValues.hue !== undefined || newValues.sat !== undefined)) {
      newState.hue(this.state.hue);
      newState.sat(this.state.sat);
    }
    // xy value
    else if (this.state.colormode === 'xy' && newValues.xy !== undefined) {
      newState.xy(this.state.xy);
    }

    // Alert handling
    if (typeof input.alert === 'string' && input.alert.length) {
      newState.alert(input.alert);
    }
    else if (input.alert === true) {
      newState.alert('select');
    }
    else if (input.alert === null || input.alert === '' || input.alert === false) {
      newState.alert('none');
    }

    // Effect handling
    if (typeof input.effect === 'string' && input.effect.length) {
      newState.effect(input.effect);
    }
    else if (input.effect === null || input.effect === '') {
      newState.effect('none');
    }
  }
  
  // Off
  else {
    newState.off();
  }

  // Duration specified
  if (_.isFinite(input.duration) && input.duration > 0) {
    newState.transition(input.duration);
    
    // Increase modified value to include transition time
    this.modified += Math.round(1 + (input.duration/1000));
  }

  // Tell server to update light
  this.emit('sendToLight', this.info.id, newState);
  
  // Emit change to server
  this.emit('change');
}


/**
 * Get node-red message for the current state of the light
 * @return {object} State information
 */
LightItem.prototype.getStateMessage = function getStateMessage() {
  var self = this;

  //var hsv = [state.hue, state.saturation, state.brightness];
  var bri = (this.state.bri * 100) / 0xFF;
  var rgb;
  var hsv = [0, 0, bri];
  var xy;

  // Do we have any color information
  if (this.info.capability & LightCapability.XY ||
      this.info.capability & LightCapability.HS) {

    // xy color information
    if (this.info.capability & LightCapability.XY) {
      xy = [
        this.state.xy[0],
        this.state.xy[1]
      ];
    }

    // hsv color information
    if (this.info.capability & LightCapability.HS) {
      hsv = [
        (this.state.hue * 359) / 0xFFFF,
        (this.state.sat * 100) / 0xFF,
        bri
      ];
    }

    if (!(this.info.capability & LightCapability.XY)) {
      rgb = colorSpace.hsv.rgb(hsv);
      xy = convertRGB2HueXY(rgb, {divide:0xFF});
    }

    if (!(this.info.capability & LightCapability.HS)) {
      rgb = convertHueXY2RGB(xy, 1, {multiply:0xFF});
      hsv = colorSpace.rgb.hsv(rgb);
      hsv[2] = bri;

      // Re-calc RGB because we have modified brightness
      rgb = colorSpace.hsv.rgb(hsv);
    }
  }

  // Temperature Information
  else if (this.info.capability & LightCapability.CT) {
    // Convert to kelvin
    let temp = 1000000 / this.state.ct;
    // Convert to rgb
    rgb = colorTemp.temp2rgb(temp);
    
    // Convert to hsv, set luminance to 1
    hsv = colorSpace.rgb.hsv(rgb);
    hsv[1] = 10;
    hsv[2] = bri;
    
    // Re-calc rgb because we have modified sat and bri
    rgb = colorSpace.hsv.rgb(hsv);

    // And finaly convert to xy
    xy = convertRGB2HueXY(rgb, {divide:0xFF});
  }

  // Generate xy from default hsv value
  else {
    rgb = colorSpace.hsv.rgb(hsv);
    xy = convertRGB2HueXY(rgb, bri, {divide:0xFF});
  }

  // Check if we have calculated RGB yet
  if (!rgb) {
    rgb = colorSpace.hsv.rgb(hsv);
  }

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

      xy:  [ Math.round(10000*xy[0])/10000, Math.round(10000*xy[1])/10000 ],
      hsv: [ Math.round(hsv[0]), Math.round(hsv[1]), Math.round(hsv[2]) ],
      rgb: [ Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2]) ],
    
      hex:   colorConvert.rgb.hex(rgb),
      color: colorConvert.rgb.keyword(rgb),
    },

    // Raw internal state
    state: _.merge({}, this.state)
  }

  // Append Temperature info if we have it
  if (_.isFinite(this.state.ct)) {
    retVal.payload.mired  = Math.round(this.state.ct);
    retVal.payload.kelvin = Math.round(1000000 / this.state.ct);
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

  return retVal;
}

// Export
module.exports = LightItem;
