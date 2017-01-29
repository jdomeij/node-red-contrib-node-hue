module.exports = function(RED) {
  "use strict";

  require('./hue-node.js')(RED, true);
};
