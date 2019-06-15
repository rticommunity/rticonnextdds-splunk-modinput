# RTI ConnextDDS Splunk Modular Input

A Splunk Modular Input to allow inserting into Splunk data being sent over RTI ConnextDDS



## Usage:

1. Manually clone this repository directly from the Splunk app's home dir:

```
cd /opt/splunk/etc/apps
git clone https://github.com/rticommunity/rticonnextdds-splunk-modinput.git
```

2. Restart Splunk so it will detect the new App.

3. From Splunk (logged in as Administrator), select Settings -> Data inputs

4. You should see now a new data input called "RTI Connext DDS Splunk Modular Input". Click on the "+ Add new" button on the right to create an instance

   

### Arguments:

**Name:** Name of the stanza. This value identify the *source* of the events that are coming from this instance. The form of the *source* field is: ```rticonnextdds://<stanzaName>``` .

**Participant**: Fully qualified name of the DDS Domain Participant to use in form "ParticipantLibrary::ParticipantName"

**Readers**: A comma-separated value of fully qualified data readers that are defined in the provided XML file. The format of each data reader name is: "SubscriberName::DatareaderName". Make sure you include ALL the data readers defined in the supplied XML file here!

**Transform**: A comma-separated list of plugins (as defined in the ```transform_plugins``` directory) that will be invoked after the reception of each sample from DDS. The plugin can be used to filter out or transform the received data before sending it to Splunk. Multiple plug-ins are invoked in the same order as declared here.

**UserXML**: The full path of the XML file containing the configuration to use. If this parameter is not specified, the application will use a file called "USER_QOS_PROFILES.xml" located in the app's home directory 



### Example with Shapes Demo

This repository contains a User QoS Profile XML file under the  ```examples``` directory that allow the reception of the data coming from Shapes Demo. This example will also demonstrate the use of transformation plug-ins. will Follow this script to see this modular input in action to filter and insert data from Shapes Demo.

Create an instance of the RTI Connext DDS Splunk Modular Input and use the following parameters:

* name=```ShapeDemo```
* Participant = ```SplunkParticipantLibrary::SplunkParticipant```
* Data Readers List = ```SquareSubscriber::SquareReader, CircleSubscriber::CircleReader```
* Transformation plug-Ins: ```changedir```
* User XML: ```/opt/splunk/etc/apps/rticonnextdds_splunk_modinput/examples/ShapesDemo.xml```
* Verbose: FALSE



Select the Search & Reporting App from Splunk and enter the following real-time filter: ```sourcetype=rticonnextdds``` . Select a 30 second window

Start Shapes demo, and start publishing a Square using Shapes Extended data type (the default type). 

You should see periodically some samples coming into Splunk. The selected transformation plug-in ```changedir``` filters out all the samples received from Shapes Demo, except when a change in direction is detected either on the x or y direction.

The same modular input can be used for multiple participants, create a new instance and now use the following parameters:

- name=```BasicShapeDemo```
- Participant = ```SplunkParticipantLibrary::BaseParticipant```
- Data Readers List = ```TriangleSubscriber::TriangleReader```
- Transformation plug-Ins: ```changedir```
- User XML: ```/opt/splunk/etc/apps/rticonnextdds_splunk_modinput/examples/ShapesDemo.xml```
- Verbose: FALSE

Start a new instance of Shapes Demo. Select Controls -> Configuration. 

Stop the participant and select "Shape" as data type. Start the participant and now publish a triangle.

You should receive triangle samples in Splunk whenever the triangle change direction.

