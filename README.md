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
