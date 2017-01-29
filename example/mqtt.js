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