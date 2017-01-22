"use strict";

var nodeHueApi   = require('node-hue-api');

var LightServer  = require('../lib/hue-server.js');

/**
 * Exports LightServer to Node-Red
 * @param  {object} RED Node-red
 */
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

    // Create server
    this.lightServer = new LightServer(config);
  
    // Create wrapper functions
    this.getLightHandler = this.lightServer.getLightHandler.bind(this.lightServer);
    this.getLights       = this.lightServer.getLights.bind(this.lightServer);


    // Handle close event
    self.on('close', () => {
      self.lightServer.stop();

      delete hueServerList[self.id];
    });

    // Server errors
    this.lightServer.on('error', (msg, obj) => {
      self.err(msg, obj);
    });

    // Server warnings
    this.lightServer.on('warning', (msg, obj) => {
      self.warn(msg, obj);
    });

    hueServerList[self.id] = self;
  }

  RED.nodes.registerType("node-hue-bridge", LightServerWrapper);

  // Search for hub
  RED.httpAdmin.get('/node-hue/nupnp', (req, res) => {
    nodeHueApi.nupnpSearch().then((result) => {
      res.set({'content-type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify(result));
    }).fail((err) => {
      res.status(500).send(err.message + '"');
    }).done();
  });

  // Register
  RED.httpAdmin.get('/node-hue/register', (req, res) => {
    if(!req.query.address) {
      return res.status(500).send("Missing arguments");
    }
    var hue = nodeHueApi.HueApi();

    hue.registerUser(req.query.address, "node-red-contrib-node-hue")
      .then(function(result) {
        res.set({'content-type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify(result));
      }).fail(function(err) {
        res.status(500).send(err.message);
      }).done();
  });

  // Validate key
  RED.httpAdmin.get('/node-hue/validate_key', (req, res) => {
    if(!req.query.address || !req.query.key) {
      return res.status(500).send("Missing arguments");
    }

    var hue = new nodeHueApi.HueApi(req.query.address, req.query.key);
    hue.config()
      .then((result) => {
        // Check if result has ipaddress
        if (typeof result !== 'object' || !result.hasOwnProperty('ipaddress'))
          return res.status(401).send('Invalid key');

        res.set({'content-type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify({}));
      }).fail((err) => {
        res.status(500).send(err.message);
      })
  });

  // Get list of lights
  RED.httpAdmin.get('/node-hue/lights', (req, res) => {
    if(!req.query.server) {
      return res.status(500).send("Missing arguments");
    }

    // Check if we have this server
    if (!hueServerList.hasOwnProperty(req.query.server)) {
      return res.status(500).send("Server not found or not activated");
    }

    // Query server for information
    var server = hueServerList[req.query.server];
    res.set({'content-type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify(server.getLights()));
    return;
  });
}
