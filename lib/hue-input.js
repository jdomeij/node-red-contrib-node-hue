module.exports = function(RED) {
  "use strict";

  // The main node definition - most things happen in here
  function LightNode(n) {
    var node = this;
    //var debug = !!n.debug;

    // Controls if light is input or output node according to server
    this.isOutput = false;

    // Get server configuration
    this.server = RED.nodes.getNode(n.server);

    // Create a RED node
    RED.nodes.createNode(this, n);

    node.lightID = n.lightID;
    node.state = {
      lightID: n.lightID,
    };

    if (node.server)
      node.server.nodeRegister(node.lightID, node.id, this);
    
    node.on('close', () => {
      if (node.server)
        node.server.nodeUnregister(node.lightID, node.id);
    });

    node.on('input', (msg) => {
      if (node.server)
        node.server.lightChange(node.lightID, msg.payload);
    });
  }

  RED.nodes.registerType('node-hue-in', LightNode);
};
