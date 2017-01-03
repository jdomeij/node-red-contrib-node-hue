# Philips Hue nodes for Node-Red
An solution to control Philips Hue lights using Node-Red, uses [node-hue-api library](https://github.com/peter-murray/node-hue-api) for communicating with the lights.

This module provides input and output nodes for communicating with Philips Hue lights, the input node accepts multiple color format and automatically converts the values to the right format. 

### Features
* Convert input arguments to light specific arguments
* Trigger events for light changes
* Uses background polling to detect external changes to light
* Displays current state for light in Node-Red ui

### Input node
The following input values is accepted
| Property | Value |
|---|---|
| `on` | Set light state (true/false)|
| `bri` | Set light brightness (0-100%) |
| `cr`, `mired` or `mirek` | Set Mired color temperature (153 - 500) |
| `kelvin` | Set kelvin color temperature (2200-6500) |
| `duration` | Transition time (ms) |

### Output node

Example output from change event 
```json
{
  "name": "Bedroom 1",
  "payload": {
    "on": true, 
    "reachable": true, 
    "bri": 77, 
    "xy": [ 0.484, 0.411 ], 
    "hsv": [ 28, 72, 77 ], 
    "rgb": [ 198, 123, 53 ], 
    "hex": "C67B36", 
    "color": "peru", 
    "mired": 401, 
    "kelvin": 2493
  },
}
```

#### TODO
* Support color lights, need to parse input and convert it to correct color space
* Simplify Hub/Server configuration