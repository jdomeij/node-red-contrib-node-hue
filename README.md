# Philips Hue nodes for Node-Red
An solution to control Philips Hue lights using Node-Red, uses [node-hue-api library](https://github.com/peter-murray/node-hue-api) for communicating with the lights.

This module provides input and output nodes for communicating with Philips Hue lights, the input node accepts multiple color format and automatically converts the values to the right format. 

### Features
* Convert input arguments to light specific arguments
* Trigger events for light changes
* Self syncing, uses background polling to detect external changes to light
* Displays current state for light in Node-Red ui

### Input node
The light is controlled by sending message with an payload containing the new state

Simplified control by sending the following values as payload

| Value | Info |
|---|---|
| `'on'` or `true` | Turn light on |
| `'off'`or `false` | Turn light off |
| numeric value | Turn light on and set brightness (0-100%) |

More advanced way to control the light is to send an object payload with one or more of the following properties set

| Property | Info |
|---|---|
| `on` | Set light state (true/false)|
| `red`, `green` and/or `blue` | Set one or more color channel for light (0-255)|
| `hex` | Set color (#f49242) |
| `hue` | Set color hue (0-360) |
| `sat` or `saturation` | Set color saturation (0-100) | 
| `bri` or `brightness` | Set light brightness (0-100%) |
| `cr`, `mired` or `mirek` | Set Mired color temperature (153 - 500) |
| `kelvin` | Set kelvin color temperature (2200-6500) |
| `duration` | Transition time (ms) |

Example: Sending the following to the light will turn it on and dim it upp to 77% over 10 seconds

```json
{
  "payload": {
    "on": true, 
    "bri": 77,
    "duration": 10000
  }
}
```

### Output node

Example output from change event 
```json
{
  "id": "light3",
  "info": {
    "id": "3",
    "name": "Bedroom 1",
    "capability": [ "bri", "ct" ],
    "group": false,
    "type": "Color temperature light",
    "uniqueid": "00:17:88:01:02:06:ef:5c-0b",
    "modelid": "LTW001"
  },
  "payload": {
    "on": true,
    "reachable": true,
    "bri": 12,
    "xy": [ 0.3244, 0.3373 ],
    "hsv": [ 27, 10, 12 ],
    "rgb": [ 31, 29, 28 ],
    "hex": "1F1D1C",
    "color": "black",
    "mired": 189,
    "kelvin": 5291
  },
  "state": {
    "on": true,
    "bri": 31,
    "ct": 189,
    "colormode": "ct"
  },
  "event": "change"
}
```

#### TODO
* Support color lights, need to verify current implementation


# Using withouth Node-RED
This library can be used independent from Node-RED, below is an simple example using [MQTT.js](https://github.com/mqttjs/MQTT.js) to enable control an lights on/off status and brightness over MQTT.

The MQTT topic `lights` will contain an list of all currently detected lights.
Specific light can be controlled by sending an message to the topics `lights/<id>/on` (boolean) or `lights/<id>/brightness` (number) with the new state.

```JavaScript
var LightServer = require('node-red-contrib-node-hue');
var mqtt        = require('mqtt');

var config = {
  mqtt: 'mqtt://<mqtt server>',
  server: {
    address: '<hue bridge>',
    key: '<api key>'
  }
}

// List of all detected lights
var lightsList = {};

var mqttClient  = mqtt.connect(config.mqtt);

// Wait for connection
mqttClient.on('connect', () => {
  // List of all detected lights with topic
  var allLights = [];

  var server = new LightServer(config.server);

  server.on('light-new', (lightInfo) => {
    var baseTopic = 'lights/' + lightInfo.id;
    if (lightsList.hasOwnProperty(baseTopic))
      return;
    var handle = server.getLightHandler(lightInfo.id);

    // Remember base topic
    lightsList[baseTopic] = handle;

    // Subscribe to topics
    mqttClient.subscribe(baseTopic + '/on');
    mqttClient.subscribe(baseTopic + '/brightness');

    allLights.push({
      name: lightInfo.info.name,
      topic: baseTopic
    });

    // publish list of all detected lights
    mqttClient.publish('lights', JSON.stringify(allLights), { retain: true} );
  });
});

// Handle messages
mqttClient.on('message', (topic, message) => {
  var pattern = /^(.*)\/(on|brightness)$/;

  // Check that the pattern match
  var match;
  if ((match = pattern.exec(topic)) == null)
    return;

  // Check so we have the light
  if (!lightsList.hasOwnProperty(match[1]))
    return;

  var light = lightsList[match[1]];
  var data = message.toString();

  if (match[2] === 'on') {
    if (!/^(true|false)$/.test(data))
      return;
    light.setLightState({ 'on': (data === 'true') });
  }

  else if (match[2] === 'brightness') {
    if (!/^[0-9]+$/.test(data))
      return;
    light.setLightState({ 'brightness': parseInt(data, 10) })
  }
});
```
