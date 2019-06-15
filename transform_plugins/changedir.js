/* This is a sample plugin that filters out all the samples
 * from a Shape Demo type except for the samples that identify 
 * a change in X or Y direction
 */


var exports = module.exports = {}

// Returns a (potentially modified) sample or null if this sample
// should NOT be sent to Splunk
// 'recv' is an object with the following properties:
//  {
//      data: the Javascript object received from DDS
//      host: the current host name as defined by Splunk. Can be overridden 
//            if you want to use as host name some other value (including the
//            source machine of your sample)
//      time: the reception timestamp (as string). Can be overridden if
//            you want to use as time some other value (perhaps coming from
//            the source of the sample)
//      source: initially unset, it can be populated by this transformatiomn
//            plugin to be assigned to this event
//  }
//
//  Note also that the recv.data contains the following extra (metadata) properties
//  that are added by the modular input:
//      $$subscriberName
//      $$readerName
var prevX, prevY;
var dirX, dirY;   // true=increasing, false=decreasing
exports.transformSample = function(recv) {
    var sample = recv.data;

    // Send only a sample when the x or y direction changes
    var send = false;
    if (prevX !== undefined) {
        if (sample.x < prevX) {
            if (dirX !== false) {
                dirX = false;
                send = true;
            }
        } else if (sample.x > prevX) {
            if (dirX !== true) {
                dirX = true;
                send = true;
            }
        }
    }

    if (prevY !== undefined) {
        if (sample.y < prevY) {
            if (dirY !== false) {
                dirY = false;
                send = true;
            }
        } else if (sample.y > prevY) {
            if (dirY !== true) {
                dirY = true;
                send = true;
            }
        }
    }

    prevX=sample.x;
    prevY=sample.y;
    if (send) {
        // Add some extra properties to the sample
        sample.$$directionX=dirX?"RIGHT":"LEFT";
        sample.$$directionY=dirY?"DOWN":"UP";
        return recv;
    }
    return null;
}


