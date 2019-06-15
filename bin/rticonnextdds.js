#!/usr/bin/env node

/* $Id$

 (c) Copyright, Real-Time Innovations, 2019.
 All rights reserved.
 No duplications, whole or partial, manual or electronic, may be made
 without express written permission.  Any such copies, or
 revisions thereof, must display this notice unaltered.
 This code contains trade secrets of Real-Time Innovations, Inc.

=========================================================================*/

'use strict';

var fs = require('fs');
var path = require('path');
var rti = require('rticonnextdds-connector');
var xml2json = require('xml2json');


// Build path-dependent constants  from command line process.argv[1] (full path
// to this script. I.e.: "/opt/splunk/etc/apps/rticonnextdds_splunk_modinput/bin/rticonnextdds_splunk_modinput.js")
let tmp=process.argv[1].split(path.sep);
const APP_NAME = tmp.pop();             // rticonnextdds_splunk_modinput.js
tmp.pop();
// tmp is now ['', 'opt', 'splunk', ..., 'rticonnextdds_splunk_modinput']
const APP_HOME = tmp.join(path.sep);    // "/opt/splunk/etc/apps/rticonnextdds_splunk_modinput"
let tmp2 = tmp.slice();                 // Make a copy - use tmp2 to build XML_SCHEME_FILE
tmp.pop();
tmp.pop();
// tmp is now ['', 'opt', 'splunk']
const SPLUNK_HOME = tmp.join(path.sep);

// Finally compose the XML_SCHEME_FILE using tmp2
let tmp3 = tmp2.slice();
tmp2.push("etc");
tmp2.push("scheme.xml");
const XML_SCHEME_FILE = tmp2.join(path.sep);

// Build the transform plugin dir
tmp3.push("transform_plugins");
const TRANSFORM_PLUGIN_DIR = tmp3.join(path.sep);


const LOG_ERROR = "ERROR";
const LOG_WARNING = "WARN";
const LOG_INFO  = "INFO";

// The configuration is initialized after command-line parsing is completed.
// It is set only for normal run and for --validate-arguments mode
var theConfig;

// {{{ readConfig
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Reads the configuration from stdin. Used both for validation and during run.
// Refer to docs/xmldump.txt for details on the structure of the input XML
//
// Throws an exception if there are some parameters that are missing or invalid
//
// opValidate: is a boolean set to TRUE if this function should just validate
//             the input, or FALSE to fully parse the configuration.
//
// Returns a Javascript object with the important info:
// {
//   // Standard properties
//      participant: string,
//      readers: [string, string, ...],
//      userxml: string,            // optional
//      transformPlugin: [module, module, ...]   // optional module is a transform plugin
//      verbose: boolean,
//
//   // Advanced properties
//      server_host: string,
//      server_uri: string,
//      session_key: string,
//      checkpoint_dir: string,
//      name: string,              // Instance name
//      host: string,
//      index: string,
// }
function readConfig(opValidate) {
    var buffer = fs.readFileSync(0);        // Read the whole config from stdin
    var configRaw = xml2json.toJson(buffer, {object: true});

    // Uncomment the following line to save the whole XML document passed from Splunk
    // fs.writeFileSync("/tmp/debug.xml", buffer.toString());

    var config = {};

    function parseParams(params) {
        for (var i in params) {
            var param = params[i];
            if (param.name == "participant") {
                // Validate domain participant
                if (!param.$t) {
                    throw new Error("Participant cannot be empty");
                }
                if (param.$t.indexOf("::") == -1) {
                    throw new Error("Invalid format for 'participant'");
                }
                config.participant = param.$t.trim();
                continue;
            }
            if (param.name == "readers") {
                if (!param.$t) {
                    throw new Error("Malware Reader cannot be empty");
                }
                let tmp = param.$t.split(",");
                // Verify that each entry of the array contains '::'
                if (!tmp.every(x => (x.indexOf("::") > 0))) {
                    throw new Error("Invalid format for 'readers'");
                }
                config.readers = tmp.map(x => x.trim());        // Trim each line
                continue;
            }
            if (param.name == "userxml" && param.$t) {
                config.userxml = param.$t;
                continue;
            }
            if (param.name == "transform" && param.$t) {
                let tmp = param.$t.split(",");
                tmp = tmp.map(x => x.trim());
                config.transformPlugin = [];
                for (let i in tmp) {
                    let tt = tmp[i];
                    let plugin = require(TRANSFORM_PLUGIN_DIR + path.sep + tt + ".js");

                    // Ensure the loaded plugin contains the 'transformSample' function
                    if (!plugin.hasOwnProperty("transformSample") || 
                            (typeof(plugin.transformSample) != "function")) {
                        throw new Error("Error: transform plugin '" + tt + "' is invalid");
                    }

                    config.transformPlugin.push(plugin);
                }
                continue;
            }
            if (param.name == "host" && param.$t) {
                config.host = param.$t;
                continue;
            }
            if (param.name == "index" && param.$t) {
                config.index = param.$t;
                continue;
            }
            if (param.name == "verbose") {
                config.verbose = parseBoolen(param.$t.trim(), false);
            }
        }
    }

    if (opValidate) {
        // Only validate the configRaw to make sure the required parameters are present and in the correct format
        config.server_host = configRaw.items.server_host;
        config.server_uri = configRaw.items.server_uri;
        config.server_key = configRaw.items.server_key;
        config.checkpoint_dir = configRaw.items.checkpoint_dir;

        if (configRaw.items.item instanceof Array) {
            // TODO: Validate only one instance
            throw new Error("Multiple stanza not supported");
        }
        config.name = configRaw.items.item.name;
        parseParams(configRaw.items.item.param);

    } else {
        // op is RUN, a slightly different structure...
        config.server_host = configRaw.input.server_host;
        config.server_uri = configRaw.input.server_uri;
        config.server_key = configRaw.input.server_key;
        config.checkpoint_dir = configRaw.input.checkpoint_dir;
        config.name = configRaw.input.configuration.stanza.name;
        parseParams(configRaw.input.configuration.stanza.param);
    }

    // By default the modular input is invoked with cwd="/"
    // we need to specify the USER_QOS_PROFILES.xml if not specified from the config parameters
    if (!config.userxml) {
        config.userxml = APP_HOME + path.sep + "USER_QOS_PROFILES.xml";
    }
    return config;
}

// }}}
// {{{ transformSample
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Given a JSON representation of the received sample returns:
// - null or undefined (or false) if the given object should be skipped and not
//   inserted into Splunk
//
// - An object with the following properties:
//   {
//      data:   [required]  Object to insert
//      host:   [optional]  String representing the host source of this sample
//      time:   [optional]  The timestamp to associate to this event
//      source: [optional]  The data source as reported to Splunk
//   }
// 
// NOTE:
//   - If host is not provided, the current host name will be used
//   - If timestamp is not provided, the current reception timestamp will be used
//
// before serializing to stdout for Splunk to be processed.
var prevX, prevY;
var dirX, dirY;   // true=increasing, false=decreasing
function transformSample(sample, readerName) {
    // Send only a sample when the x or y direction changes
    var send = false;
    if (prevX === undefined) {
        send = true;
    } else if (sample.x < prevX) {
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

    if (prevY === undefined) {
        send = true;
    } else if (sample.y < prevY) {
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

    prevX=sample.x;
    prevY=sample.y;
    if (send) {
        // Add some extra properties to the sample
        sample.$$directionX=dirX?"RIGHT":"LEFT";
        sample.$$directionY=dirY?"DOWN":"UP";
        return { data: JSON.stringify(sample) };
    }
    return null;
}

// }}}
// {{{ parseBoolen
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
function parseBoolen(value, defaultValue) {
    switch(value.toLowerCase().trim()) {
        case "true":
        case "yes":
        case "1":
            return true;

        case "false":
        case "no":
        case "0":
            return false;
    }
    return defaultValue;
}
// }}}
// {{{ usage
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
function usage() {
    console.log("Usage: " + APP_NAME + " [arguments]");
    console.log("Where arguments are:");
    console.log("  --scheme: prints the scheme of introspection");
    console.log("  --validate-arguments: validate XML config from stdin");
    console.log("  --test: send some test data to Splunk");
}

// }}}
// {{{ logInfo
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// Log to stderr the message. Usage:
//      logInfo(LOG_INFO, "Hello world");
//      logInfo(LOG_ERROR, "Hello error");
function logInfo(verbosity, msg) {
    var instanceName = theConfig ? theConfig.name : "<N/A>";
    var prefix=""
    if (theConfig && theConfig.name) {
        prefix += "[" + theConfig.name + "]";
    }
    console.error(verbosity + " " + prefix + ": " + msg);
}

// }}}
// {{{ do_test
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
function do_test() {
    console.error("INFO rti_avdemo is running do_test");
    console.log("<stream>");
    console.log("  <event unbroken=\"1\">");
    console.log("    <source>rti</source>");
    console.log("    <data>testData1</data>");
    console.log("  </event>");
    console.log("  <event unbroken=\"1\">");
    console.log("    <done/>");
    console.log("  </event>");
    console.log("</stream>");
    return 0;
}

// }}}
// {{{ do_validateArgs
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
function do_validateArgs() {
    try {
        theConfig = readConfig(true);
        var theConnector = new rti.Connector(theConfig.participant, theConfig.userxml);

    } catch(e) {
        console.log("<error>\n" +
                    "  <message>" + e.message + e.stack + "</message>\n" +
                    "</error>");
        return 1;
    }
    return 0;
}

// }}}
// {{{ do_run
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
function do_run() {
    try {
        theConfig = readConfig();
        logInfo(LOG_INFO, "app is starting...");
        var connector = new rti.Connector(theConfig.participant, theConfig.userxml);
        var allReaders = [];
        for (let i in theConfig.readers) {
            var readerName = theConfig.readers[i];
            allReaders.push({ reader: connector.getInput(readerName), name: readerName});
        }
        logInfo(LOG_INFO, "current stanza is using " + theConfig.readers.length + " data reader(s)");

        // allReaders elements are:
        //  {
        //      reader: Connector Input object
        //      name  : String (name of the reader)
        //  }
        // Prepare output for Splunk
        console.log("<stream>");
        connector.on('on_data_available', () => {
            for (let i in allReaders) {
                let reader = allReaders[i].reader;
                let readerName = allReaders[i].name;
                let readerNameArr = readerName.split("::");
                if (readerNameArr.length != 2) {
                    throw new Error("Unexpected format for readerName");
                }
                reader.take();
                let recvCount = 0;
                let sentCount = 0;
                for (let s=0; s < reader.samples.getLength(); s++) {
                    if (reader.infos.isValid(s)) {
                        ++recvCount;

                        // Add the meta properties
                        let sample = {
                            data: reader.samples.getJSON(s),
                            host: theConfig.host,
                            time: new Date().toJSON()
                        };
                        sample.data.$$subscriberName = readerNameArr[0];
                        sample.data.$$readerName = readerNameArr[1];
                      
                        // Process the selected transformation plugins
                        if (theConfig.transformPlugin) {
                            for (let p in theConfig.transformPlugin) {
                                sample = theConfig.transformPlugin[p].transformSample(sample);
                                if (!sample) {
                                    break;
                                }
                            }
                        }

                        if (sample) {
                            ++sentCount;
                            console.log('<event><data>');
                            console.log(JSON.stringify(sample.data));
                            console.log("</data>");
                            console.log("<host>" + sample.host + "</host>");
                            console.log("<time>" + sample.time + "</time>");
                            if (sample.source) {
                                console.log("<source>" + sample.source + "</source>");
                            }
                            console.log("</event>");
                        }
                    }
                }
                if ( (theConfig.verbose) && 
                     ((recvCount > 0) || (sentCount > 0)) ) {
                    logInfo(LOG_INFO, "reader '" + readerName + "': recv=" + recvCount + ", sentToSplunk=" + sentCount + ", skipped=" + (recvCount-sentCount));
                }
            }
        });
        logInfo(LOG_INFO, "listening for DDS event, VERBOSE=" + Boolean(theConfig.verbose).toString());
    }
    catch(e) {
        logInfo(LOG_ERROR, "An error occurred in the rti_avdemo plugin: " + e.message);
        logInfo(LOG_ERROR, e.stack);
        console.log("<error><message>" + e.message + "</message></error>");
        return 1;
    }

    return 0;
}

// }}}
// Main code starts here
// -------------------------------------------------------------------------------------------------------
// argv[0] = 'node'
// argv[1] = <full path to this script>
// argv[2] = <firstArgument>
// argv[3] = <secondArgument>
// ...
// Usage:
//    rti_avdemo.js [args]
if (process.argv.length == 2) {
    // No arguments
    do_run();
}

for (var i = 2; i < process.argv.length; ++i) {
    if ((process.argv[i] == '-h')||(process.argv[i] == '--help')) {
        usage();
        process.exit(0);
    }
    if (process.argv[i] == "--scheme") {
        console.log(fs.readFileSync(XML_SCHEME_FILE).toString());
        //console.log(XML_SCHEME);
        process.exit(0);
    }
    if (process.argv[i] == "--validate-arguments") {
        process.exit(do_validateArgs());
    }
    if (process.argv[i] == "--test") {
        process.exit(do_test());
    }

    console.log("Invalid argument: " + process.argv[i]);
    process.exit(1);
}

