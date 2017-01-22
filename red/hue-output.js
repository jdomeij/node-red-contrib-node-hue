module.exports = function(RED) {
  "use strict";

  /**
   * Light node handling communication between Light Server and Node-Red
   * @param {object} n Node
   */
  function LightNode(n) {
    var node = this;

    // Controls if light is input or output node
    this.isOutput = true;

    // Get server configuration
    this.server = RED.nodes.getNode(n.server);

    // Create a RED node
    RED.nodes.createNode(this, n);

    node.lightID = n.lightID;
    node.state = {
      lightID: n.lightID,
    };

    // Light not found (yet), set status to unknown
    node.status({fill:"red",shape:"ring",text:"unknown"});

    if (!node.server)
      return;

    // Get light handler for this lightID
    this.lightHandler = node.server.getLightHandler(node.lightID)

    // light message handler
    /**
     * Handles messages from light, update node status and output message if output node
     * @param  {object} data Light message
     */
    this.lightMessageHandler = function lightMessageHandler(data) {
      if (!data || !data.payload)
        ;
      else if (!data.payload.reachable) {
        node.status({fill:"red",shape:"ring",text:"disconnected"});
      } else if (!data.payload.on) {
        node.status({fill:"grey",shape:"dot",text:"off"});
      } else {
        node.status({fill:"yellow",shape:"dot",text: `on (${data.payload.bri}%)`});
      }

      if (node.isOutput)
        node.send(data);
    }.bind(this);

    // Try to get current state for the light
    let message;
    if ((message = this.lightHandler.getLightState()) != null) {
      message.event = 'new';
      node.lightMessageHandler(message);
    }

    // Handle events from the light
    this.lightHandler.on('new', this.lightMessageHandler);
    this.lightHandler.on('update', this.lightMessageHandler);

    
    node.on('close', () => {
      if (!node.lightHandler)
        return;
      node.lightHandler.removeListener('new', node.lightMessageHandler);
      node.lightHandler.removeListener('update', node.lightMessageHandler);
    });

    node.on('input', (msg) => {
      if (!node.isOutput && node.lightHandler)
        node.lightHandler.setLightState(msg.payload);
    });
  }

  RED.nodes.registerType('node-hue-out', LightNode);
};
