module.exports = function(RED, isOutput) {
  "use strict";

  /**
   * Light node handling communication between Light Server and Node-Red
   * @param {object} n Node
   */
  function LightNode(n) {
    var node = this;

    // Controls if light is input or output node
    this.isOutput = isOutput;

    // Get server configuration
    this.server = RED.nodes.getNode(n.server);

    // Create a RED node
    RED.nodes.createNode(this, n);

    node.lightID = n.lightID;
    node.state = {
      lightID: n.lightID,
    };

    // Light not found (yet), set status to unknown
    node.status( { fill:"red", shape:"ring", text:"unidentified" } );

    // No server, bail out
    if (!node.server)
      return;

    // Get light handler for this lightID
    try {
      this.lightHandler = node.server.getLightHandler(node.lightID)
    }
    catch(e) {
      node.error(e.message, e.stack);
    }

    // light message handler
    /**
     * Handles messages from light, update node status and output message if output node
     * @param  {object} data Light message
     */
    this.lightMessageHandler = function lightMessageHandler(data) {
      if (!data || !data.payload)
        ;
      else if (!data.payload.reachable) {
        node.status( { fill:"red", shape:"ring", text:"disconnected" } );
      }
      else if (!data.payload.on) {
        node.status( { fill:"grey", shape:"dot", text:"off" } );
      }
      else {
        node.status( { fill:"yellow", shape:"dot", text: `on (${data.payload.bri}%)` } );
      }

      // Send data if output node
      if (node.isOutput)
        node.send(data);
    }.bind(this);

    // Try to get current state for the light
    let message;
    try {
      if ((message = this.lightHandler.getLightState()) != null) {
        message.event = 'new';
        node.lightMessageHandler(message);
      }
    }
    catch (e) {
      node.error(e.message, e.stack);
    }

    // Handle events from the light
    this.lightHandler.on('new', this.lightMessageHandler);
    this.lightHandler.on('update', this.lightMessageHandler);

    // Node is closing down, remove listeners
    node.on('close', () => {
      if (!node.lightHandler)
        return;
      node.lightHandler.removeListener('new', node.lightMessageHandler);
      node.lightHandler.removeListener('update', node.lightMessageHandler);
    });

    // Data from node, pass to light if input node
    node.on('input', (msg) => {
      if (!node.isOutput && node.lightHandler) {
        try {
          node.lightHandler.setLightState(msg.payload);
        }
        catch (e) {
          node.error(e.message, e.stack);
        }
      }
    });
  }

  if (isOutput)
    RED.nodes.registerType('node-hue-out', LightNode);
  else
    RED.nodes.registerType('node-hue-in', LightNode);
};
