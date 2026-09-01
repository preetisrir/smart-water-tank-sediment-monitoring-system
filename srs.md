1. Purpose and Scope
Purpose
The purpose of the Smart Water Tank Sediment Monitoring and Automatic Water Supply Control System is to monitor sediment levels in a water tank, provide alerts when the level becomes high, and automatically control the water supply based on a predefined safe limit. The system will use Python for application logic and SQLite for storing sensor readings, alerts, and supply status.

IN Scope
Monitoring and recording water tank sediment levels.

Displaying the current sediment level on a dashboard.

Setting a safe sediment level limit.

Generating alerts when the limit is exceeded.

Automatically stopping the water supply when sediment is too high.

Storing sensor readings, alerts, and supply status in SQLite.

OUT of Scope
Automatic tank cleaning.

Water quality or chemical analysis.

Mobile application development.

Cloud-based data storage.

Predictive sediment-level analysis.

2. Functional Requirements
FR-01: The system shall monitor and record the water tank sediment level.

FR-02: The system shall display the current sediment level on a dashboard.

FR-03: The system shall allow the user to set a safe sediment level limit.

FR-04: The system shall send an alert when the sediment level exceeds the configured limit.

FR-05: The system shall automatically stop the water supply when the sediment level exceeds the configured limit.

FR-06: The system shall store sensor readings, alerts, and water supply status in SQLite.

3. Non-Functional Requirements
NFR-01 (Speed): The system shall display a new sensor reading within 3 seconds of receiving it.

NFR-02 (Speed): The system shall generate an alert within 5 seconds after detecting that the sediment level exceeds the limit.

NFR-03 (Security): The system shall restrict configuration of the sediment limit to authorized users with 100% access-control enforcement.

NFR-04 (Usability): A user shall be able to view the current sediment level and supply status within 3 clicks from the main dashboard.

NFR-05 (Reliability): The system shall successfully store at least 99% of valid sensor readings received during normal operation.

NFR-06 (Reliability): The system shall resume normal operation within 30 seconds after a temporary application restart.

4. Assumptions
The sediment sensor provides valid readings to the Python application.

The required sensor and automatic water-supply control hardware are available.

The computer running the system has Python and SQLite installed.

The user provides a suitable safe sediment level limit.

The system is intended for a small-scale college project and a single water tank.

5. Constraints
The application shall be developed using Python.

Data shall be stored using SQLite.

The project shall use a local system rather than cloud storage.

The system depends on the accuracy and availability of the connected sediment sensor.

The project has a limited development period of a few weeks.

The first version shall support one water tank only.