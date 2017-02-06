/* eslint-env mocha */
"use strict";

var HueLight = require('../lib/hue-light.js');
var _ = require('lodash');

var chai = require('chai');
var chaiSpes = require('chai-spies');

chai.use(chaiSpes);

var expect = chai.expect;


const defaultID = '123';
const defaultLightInfo = {
  "state": {
    "on": true,
    "bri": 254,
    "hue": 43812,
    "sat": 254,
    "effect": "none",
    "xy": [
      0.1558,
      0.1474
    ],
    "ct": 153,
    "alert": "select",
    "colormode": "hs",
    "reachable": false
  },
  "type": "Dimmable light",
  "name": "Test 1",
  "modelid": "LWB006",
  "manufacturername": "Philips",
  "uniqueid": "",
  "swversion": ""
};


describe('Hue-Light', () => {
  describe('constructor', () => {
    it('Default light', (done) => {
      var lightItem = new HueLight(defaultID, defaultLightInfo, true);
      expect(lightItem.id).to.equal(defaultID);
      done();
    });
    it('Default group', (done) => {
      var lightItem = new HueLight(defaultID, defaultLightInfo, false);
      expect(lightItem.id).to.equal(defaultID);
      done();
    });
  });


  describe('updateInfo', () => {
    var lightItem;
    beforeEach(() => {
      lightItem = new HueLight(defaultID, defaultLightInfo, true);
    });
    afterEach(() => {
      lightItem = null;
    });

    it('Invalid inputs', (done) => {
      lightItem.updateInfo(null);
      lightItem.updateInfo();
      lightItem.updateInfo(123);
      lightItem.updateInfo("asdfa");
      done();
    });
  });


  describe('parseColorRGB: HS', () => {
    var lightItem;
    beforeEach(() => {
      // Create light with only HS support
      var customInfo = _.extend({}, defaultLightInfo, {
        state: {
          "on": true,
          "bri": 1,
          "hue": 0,
          "sat": 0,
        }
      });

      lightItem = new HueLight(defaultID, customInfo, true);
    });
    afterEach(() => {
      lightItem = null;
    });

    it('hex: #ff0000', (done) => {
      var output = {};
      var tmp;
      tmp = lightItem.parseColorRGB({'hex': '#ff0000'}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      expect(output.hue).to.equal(0);
      expect(output.sat).to.equal(0xFF);
      expect(output.bri).to.equal(0xFF);

      done();
    });

    it('hex: #00ff00', (done) => {
      var output = {};
      var tmp;
      tmp = lightItem.parseColorRGB({'hex': '#00ff00'}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      expect(output.hue).to.closeTo((120/359) * 0xFFFF, 5);
      expect(output.sat).to.equal(0xFF);
      expect(output.bri).to.equal(0xFF);

      done();
    });

    it('hex: #0000ff', (done) => {
      var output = {};
      var tmp;
      tmp = lightItem.parseColorRGB({'hex': '#0000ff'}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      expect(output.hue).to.closeTo((240/359) * 0xFFFF, 5);
      expect(output.sat).to.equal(0xFF);
      expect(output.bri).to.equal(0xFF);

      done();
    });

    it('rgb: [255,0,0]', (done) => {
      var output = {};
      var tmp;
      tmp = lightItem.parseColorRGB({rgb: [255, 0, 0]}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      expect(output.hue).to.equal(0);
      expect(output.sat).to.equal(0xFF);
      expect(output.bri).to.equal(0xFF);

      done();
    });

    it('hue: 0, sat: 100, bri: 100', (done) => {
      var output = {};
      var tmp;
      tmp = lightItem.parseColorRGB({hue: 0, sat: 100, bri: 100}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      expect(output.hue).to.equal(0);
      expect(output.sat).to.equal(0xFF);
      expect(output.bri).to.equal(0xFF);
      done();
    });

    it('hue: 0, sat: 100, brightness: 100', (done) => {
      var output = {};
      var tmp;
      tmp = lightItem.parseColorRGB({hue: 0, sat: 100, brightness: 100}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      expect(output.hue).to.equal(0);
      expect(output.sat).to.equal(0xFF);
      expect(output.bri).to.equal(0xFF);
      done();
    });

    it('red: 255, green: 0, blue: 0', (done) => {
      var output = {};
      var tmp;
      tmp = lightItem.parseColorRGB({red: 255, green: 0, blue: 0}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      expect(output.hue).to.equal(0);
      expect(output.sat).to.equal(0xFF);
      expect(output.bri).to.equal(0xFF);
      done();
    });

    it('xy: [0.704, 0.296] (red)', (done) => {
      var output = {};
      var tmp;
      tmp = lightItem.parseColorRGB({xy: [0.704, 0.296], bri: 100}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      
      if (output.hue > 0x7FFFF)
        expect(((output.hue/0xFFFF)*359) - 360).to.closeTo(0, 5);
      else
        expect(((output.hue/0xFFFF)*359) - 360).to.closeTo(0, 5);

      expect(output.sat).to.equal(0xFF);
      done();
    });

    it('x: 0.704, y: 0.296 (red)', (done) => {
      var output = {};
      var tmp;
      tmp = lightItem.parseColorRGB({x: 0.704, y: 0.296, bri: 100}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      if (output.hue > 0x7FFFF)
        expect(((output.hue/0xFFFF)*359) - 360).to.closeTo(0, 5);
      else
        expect(((output.hue/0xFFFF)*359) - 360).to.closeTo(0, 5);
      expect(output.sat).to.equal(0xFF);
      expect(output.bri).to.equal(0xFF);
      done();
    });
  });


  describe('parseColorRGB: XY', () => {
    var lightItem;
    beforeEach(() => {
      // Create light with only HS support
      var customInfo = _.extend({}, defaultLightInfo, {
        state: {
          "on": true,
          "bri": 0xFF,
          "xy": [.5, .5],
        }
      });

      lightItem = new HueLight(defaultID, customInfo, true);
    });
    afterEach(() => {
      lightItem = null;
    });


    it('hex: #ff0000', (done) => {
      var output = {};
      var tmp;
      tmp = lightItem.parseColorRGB({'hex': '#ff0000'}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      expect(output.xy).to.be.an('array');
      expect(output.xy[0]).to.closeTo(0.7, 0.05);
      expect(output.xy[1]).to.closeTo(0.3, 0.05);
      expect(output.bri).to.equal(0xFF);

      done();
    });

    it('rgb: [255,0,0]', (done) => {
      var output = {};
      var tmp;
      tmp = lightItem.parseColorRGB({rgb: [255, 0, 0]}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      expect(output.xy).to.be.an('array');
      expect(output.xy[0]).to.closeTo(0.7, 0.05);
      expect(output.xy[1]).to.closeTo(0.3, 0.05);
      expect(output.bri).to.equal(0xFF);

      done();
    });

    it('red: 0, blue: 255 (initial red color)', (done) => {
      lightItem.state.xy = [0.704, 0.296]; //red

      var output = {};
      var tmp;
      tmp = lightItem.parseColorRGB({red: 0, blue: 255}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      expect(output.xy).to.be.an('array');
      expect(output.xy[0]).to.closeTo(0.138, 0.05);
      expect(output.xy[1]).to.closeTo(0.08, 0.05);
      expect(output.bri).to.equal(0xFF);

      done();
    });

    it('xy: [0.138, 0.08]', (done) => {
      var output = {};
      var tmp;
      tmp = lightItem.parseColorRGB({xy: [0.138, 0.08]}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      expect(output.xy).to.be.an('array');
      expect(output.xy[0]).to.closeTo(0.138, 0.05);
      expect(output.xy[1]).to.closeTo(0.08, 0.05);
      expect(output.bri).to.equal(0xFF);

      done();
    });

  });


  describe('parseColorTemp: CT', () => {
    var lightItem;
    beforeEach(() => {
      // Create light with only HS support
      var customInfo = _.extend({}, defaultLightInfo, {
        state: {
          "on": true,
          "bri": 0xFF,
          "ct": 340,
        }
      });

      lightItem = new HueLight(defaultID, customInfo, true);
    });
    afterEach(() => {
      lightItem = null;
    });

    it('ct: 300', (done) => {
      var output = {};
      var tmp;
      tmp = lightItem.parseColorTemp({ct: 300}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      expect(output.ct).to.equal(300);
      done();
    });

    it('mirek: 300', (done) => {
      var output = {};
      var tmp;
      tmp = lightItem.parseColorTemp({mirek: 300}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      expect(output.ct).to.equal(300);
      done();
    });

    it('mired: 300', (done) => {
      var output = {};
      var tmp;
      tmp = lightItem.parseColorTemp({mired: 300}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      expect(output.ct).to.equal(300);
      done();
    });

    it('kelvin: 3500, brightness: 80', (done) => {
      var output = {};
      var tmp;
      tmp = lightItem.parseColorTemp({kelvin: 3333, brightness: 80}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      expect(output.ct).to.closeTo(300, 5);
      expect(output.bri).to.closeTo(200, 5);
      done();
    });

    it('mired: 300, bri: 80', (done) => {
      var output = {};
      var tmp;
      tmp = lightItem.parseColorTemp({mired: 300, bri: 80}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      expect(output.ct).to.equal(300);
      expect(output.bri).to.closeTo(200, 5);
      done();
    });

  });


  describe('parseBrightness', () => {
    var lightItem;
    beforeEach(() => {
      // Create light with only BRI support
      var customInfo = _.extend({}, defaultLightInfo, {
        state: {
          "on": true,
          "bri": 0xFF,
        }
      });

      lightItem = new HueLight(defaultID, customInfo, true);
    });
    afterEach(() => {
      lightItem = null;
    });

    it('bri: 100', (done) => {
      var output = {};
      var tmp;
      tmp = lightItem.parseBrightness({bri: 100}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      expect(output.bri).to.equal(255);
      done();
    });

    it('brightness: 100', (done) => {
      var output = {};
      var tmp;
      tmp = lightItem.parseBrightness({brightness: 100}, output);

      expect(tmp).to.equal(true);
      expect(output).to.be.an('object');
      expect(output.bri).to.equal(255);
      done();
    });
  });


  describe('setColor', () => {
    it('default: true', (done) => {
      var lightItem = new HueLight(defaultID, defaultLightInfo, true);

      var spyChange      = chai.spy();
      var spySendToLight = chai.spy();
      var spyError       = chai.spy();
      var spyWarning     = chai.spy();

      lightItem.on('change', spyChange);
      lightItem.on('sendToLight', spySendToLight);
      lightItem.on('error', spyError);
      lightItem.on('warning', spyWarning);

      lightItem.setColor(false);

      expect(lightItem.state.on).to.equal(false);

      expect(spyChange).to.have.been.called();
      expect(spySendToLight).to.have.been.called();
      expect(spyError).to.not.have.been.called();
      expect(spyWarning).to.not.have.been.called();
      done();
    });

    it('default: off', (done) => {
      var lightItem = new HueLight(defaultID, defaultLightInfo, true);

      var spyChange      = chai.spy();
      var spySendToLight = chai.spy();
      var spyError       = chai.spy();
      var spyWarning     = chai.spy();

      lightItem.on('change', spyChange);
      lightItem.on('sendToLight', spySendToLight);
      lightItem.on('error', spyError);
      lightItem.on('warning', spyWarning);

      lightItem.setColor('off');

      expect(lightItem.state.on).to.equal(false);

      expect(spyChange).to.have.been.called();
      expect(spySendToLight).to.have.been.called();
      expect(spyError).to.not.have.been.called();
      expect(spyWarning).to.not.have.been.called();
      done();
    });

    it('default: 33', (done) => {
      var lightItem = new HueLight(defaultID, defaultLightInfo, true);

      var spyChange      = chai.spy();
      var spySendToLight = chai.spy();
      var spyError       = chai.spy();
      var spyWarning     = chai.spy();

      lightItem.on('change', spyChange);
      lightItem.on('sendToLight', spySendToLight);
      lightItem.on('error', spyError);
      lightItem.on('warning', spyWarning);

      lightItem.setColor(33);

      expect(lightItem.state.bri).to.closeTo(.33*0xFF, 2);

      expect(spyChange).to.have.been.called();
      expect(spySendToLight).to.have.been.called();
      expect(spyError).to.not.have.been.called();
      expect(spyWarning).to.not.have.been.called();

      done();
    });

    it('{ hue: 0, sat: 100, bri: 0 }', (done) => {
      // Create light with only HS support
      var customInfo = _.extend({}, defaultLightInfo, {
        state: {
          "on": true,
          "bri": 0xFF,
          "hue": 0,
          "sat": 0xFF,
        }
      });

      var lightItem = new HueLight(defaultID, customInfo, true);

      var spyChange      = chai.spy();
      var spySendToLight = chai.spy();
      var spyError       = chai.spy();
      var spyWarning     = chai.spy();

      lightItem.on('change', spyChange);
      lightItem.on('sendToLight', spySendToLight);
      lightItem.on('error', spyError);
      lightItem.on('warning', spyWarning);

      lightItem.on('change', spyChange);
      lightItem.on('sendToLight', spySendToLight);

      lightItem.setColor({hue: 0, sat: 100, bri: 100});

      expect(lightItem.state.hue).to.equal(0);
      expect(lightItem.state.sat).to.equal(0xFF);
      expect(lightItem.state.bri).to.equal(0xFF);

      expect(spyChange).to.have.been.called();
      expect(spySendToLight).to.have.been.called();
      expect(spyError).to.not.have.been.called();
      expect(spyWarning).to.not.have.been.called();

      done();
    });

    it('error: "test"', (done) => {
      var lightItem = new HueLight(defaultID, defaultLightInfo, true);

      var spyWarning     = chai.spy();
      lightItem.on('warning', spyWarning);

      lightItem.setColor('test');

      expect(spyWarning).to.have.been.called();
      done();
    });
  });


  describe('getStateMessage', () => {
    it('hue', (done) => {
      var lightItem = new HueLight(defaultID, _.extend({}, defaultLightInfo, {
        state: {
          'on': true,
          'bri': 0xFF,
          'hue': 0,
          'sat': 0xFF,
        }
      }), true);

      var data = lightItem.getStateMessage();

      expect(data.id).to.equal(defaultID);
      done();

    });

    it('xy', (done) => {
      var lightItem = new HueLight(defaultID, _.extend({}, defaultLightInfo, {
        state: {
          'on': true,
          'bri': 0xFF,
          'xy': [.7, .3]
        }
      }), true);

      var data = lightItem.getStateMessage();

      expect(data.id).to.equal(defaultID);
      done();

    });

    it('ct', (done) => {
      var lightItem = new HueLight(defaultID, _.extend({}, defaultLightInfo, {
        state: {
          'on': true,
          'bri': 0xFF,
          'ct': 300
        }
      }), true);

      var data = lightItem.getStateMessage();

      expect(data.id).to.equal(defaultID);
      done();

    });


    it('default', (done) => {
      var lightItem = new HueLight(defaultID, defaultLightInfo, true);

      var data = lightItem.getStateMessage();

      expect(data.id).to.equal(defaultID);
      done();
    });

  });

});
