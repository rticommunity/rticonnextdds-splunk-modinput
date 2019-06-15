[rticonnextdds://<name>]
participant = <string>
* Fully qualified name of the domain participant to use using the format "ParticipantLibrary::ParticipantName"

readers = <string>
* Comma-separated list of fully qualified names of data readers to instantiate. Each data reader is identified using format "SubscriberName::DatareaderName"

transform = <string>
* Optional comma-separated list of transformation plug-ins that will be invoked (in order) to transform/manipulate/filter the samples received before insertion

userxml = <string>
* Optional full path of the XML file containing the specified profiles. If not provided it will use the default USER_QOS_PROFILES.xml

verbose = <boolean>
* Enable extra verbosity on splunkd.log
